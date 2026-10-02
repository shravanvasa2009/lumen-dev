import argparse
import json
import logging
import time
from collections import Counter
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

from datasets import paths
from datasets.vitaldb_cases import ensure_dev_only, load_dev_split, load_split
from lumen_dsp.beat_classes import classify_beats
from lumen_dsp.beats import detect_beats
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.shape import PulseShape, ensemble_beat
from train import vitaldb_pleth
from train.hr_summary import HR_SUMMARY_NAMES, hr_summary
from train.vitaldb_pleth import PLETH_RATE_HZ, SegmentBands, write_atomic

BEAT_CLASSES = ("normal", "atypical", "artifact", "not-a-beat")
WAVES = ("a", "b", "c", "d", "e")
NO_WAVE = -1

log = logging.getLogger("train.diabetes_features")


def cache_params() -> dict:
    # Read at call time, so a case cached with other DSP settings, segment rules, or another HR/HRV
    # summary (the provisional module swapped for Track C's) is detected and redone.
    return {
        "pleth": vitaldb_pleth.selection_params(),
        "dsp": {key: DSP_CONFIG[key] for key in ("dsp2", "dsp6", "dsp7", "dsp8", "dsp9", "dsp14", "dsp15")},
        "hrSummary": hr_summary.__module__,
    }


def segment_features(bands: SegmentBands) -> tuple[dict, PulseShape | None]:
    detected = detect_beats(bands.model, bands.shape)
    # VitalDB carries no acquisition evidence (SQI, motion, exposure spans), so DSP-9's interval rule is
    # the only artifact source (Track C's reply in order D.C_TASK-dsp7-8-python).
    classified = classify_beats(detected, bands.shape, [])
    counts = Counter(beat.beat_class for beat in classified)
    # DSP-14 aligns on onsets in fractional 256 Hz samples of this segment. A beat without an observed
    # foot has no onset; dropping it leaves a double period, which DSP-14's period gate removes.
    aligned = [beat for beat in classified if beat.beat_class != "not-a-beat" and beat.onset_s is not None]
    shape_hz = DSP_CONFIG["dsp2"]["shapeRateHz"]
    onsets = [beat.onset_s * shape_hz - bands.shape.first_index for beat in aligned]
    normal = [beat.beat_class == "normal" for beat in aligned]
    # DSP-14's fps check takes the source's true sampling rate: PLETH is 500 Hz (Track C, same order).
    pulse_shape = ensemble_beat(bands.shape.values, onsets, normal, PLETH_RATE_HZ)
    summary, nn_intervals = hr_summary(classified)
    row = {
        "startS": bands.start_s,
        **{f"beats_{name}": counts.get(name, 0) for name in BEAT_CLASSES},
        "longPauses": sum(beat.long_pause for beat in classified),
        "normalPairs": sum(earlier and later for earlier, later in zip(normal[:-1], normal[1:], strict=True)),
        "beatsUsed": pulse_shape.beats_used if pulse_shape else 0,
        "hasShape": pulse_shape is not None,
        **dict(zip(HR_SUMMARY_NAMES, summary, strict=True)),
        "nnIntervals": nn_intervals,
    }
    return row, pulse_shape


def _status_path(caseid: int, out_dir: Path) -> Path:
    return out_dir / "status" / f"{caseid:04d}.json"


def _shapes_path(caseid: int, out_dir: Path) -> Path:
    return out_dir / "shapes" / f"{caseid:04d}.npz"


def _wave_indices(pulse_shape: PulseShape) -> list[int]:
    labels = [getattr(pulse_shape.waves, wave) for wave in WAVES]
    return [NO_WAVE if index is None else index for index in labels]


def extract_case_features(caseid: int, subjectid: int, pleth_dir: Path, out_dir: Path) -> dict:
    status_path = _status_path(caseid, out_dir)
    params = cache_params()
    if status_path.exists():
        cached = json.loads(status_path.read_text(encoding="utf-8"))
        if cached["params"] == params:
            return cached
    pleth_status = pleth_dir / "status" / f"{caseid:04d}.json"
    if not pleth_status.exists():
        raise FileNotFoundError(f"{pleth_status} is missing; run python -m train.vitaldb_pleth first")
    started = time.perf_counter()
    has_segments = json.loads(pleth_status.read_text(encoding="utf-8"))["segments"] > 0
    segments = vitaldb_pleth.load_segments(caseid, pleth_dir) if has_segments else []

    rows = []
    shapes: list[tuple[int, PulseShape]] = []
    for index, bands in enumerate(segments):
        row, pulse_shape = segment_features(bands)
        rows.append({"segment": index, **row})
        if pulse_shape is not None:
            shapes.append((index, pulse_shape))
    # Everything a PulseShape holds, so the 12 shape features can be computed later without the beats.
    if shapes:
        write_atomic(
            _shapes_path(caseid, out_dir),
            lambda handle: np.savez_compressed(
                handle,
                segment=np.array([index for index, _ in shapes], dtype=np.int16),
                beat=np.stack([shape.beat for _, shape in shapes]),
                smoothed=np.stack([shape.smoothed for _, shape in shapes]),
                second_derivative=np.stack([shape.second_derivative for _, shape in shapes]),
                waves=np.array([_wave_indices(shape) for _, shape in shapes], dtype=np.int16),
                beats_used=np.array([shape.beats_used for _, shape in shapes], dtype=np.int16),
            ),
        )
    else:
        # A shapes file left by a run with other settings must not outlive its status.
        _shapes_path(caseid, out_dir).unlink(missing_ok=True)
    status = {
        "caseid": caseid,
        "subjectid": subjectid,
        "params": params,
        "segments": rows,
        "seconds": round(time.perf_counter() - started, 2),
    }
    # Written last, so its presence means the case finished.
    write_atomic(status_path, lambda handle: handle.write(json.dumps(status, indent=1).encode("utf-8")))
    return status


def segment_table(out_dir: Path, cases: pd.DataFrame, dev_split: dict[int, str]) -> pd.DataFrame:
    # One row per 90 s segment. Labels are per patient (preop_dm, ADR 0014), so every segment carries its
    # patient's label and split. The 12 shape features are a later, separate column keyed by
    # (caseid, segment), computed from shapes/<caseid>.npz once Track C's shape_features lands.
    rows = []
    for case in cases.itertuples(index=False):
        status = json.loads(_status_path(case.caseid, out_dir).read_text(encoding="utf-8"))
        averaged: dict[int, np.ndarray] = {}
        if any(segment["hasShape"] for segment in status["segments"]):
            stored = np.load(_shapes_path(case.caseid, out_dir))
            averaged = dict(zip(stored["segment"].tolist(), stored["beat"], strict=True))
        for segment in status["segments"]:
            beat = averaged.get(segment["segment"])
            rows.append(
                {
                    "caseid": case.caseid,
                    "subjectid": case.subjectid,
                    "split": dev_split[case.subjectid],
                    "preop_dm": case.preop_dm,
                    **segment,
                    "beat": None if beat is None else beat.astype(np.float32).tolist(),
                }
            )
    return pd.DataFrame(rows)


def coverage(cases: pd.DataFrame, table: pd.DataFrame, dev_split: dict[int, str]) -> dict:
    report = {}
    usable = table[table["hasShape"]]
    for split in ("dev-train", "dev-val"):
        split_cases = cases[cases["subjectid"].map(dev_split) == split]
        split_rows = table[table["split"] == split]
        split_usable = usable[usable["split"] == split]
        labelled = split_cases.set_index("subjectid")["preop_dm"]
        usable_subjects = labelled[labelled.index.isin(split_usable["subjectid"])]
        report[split] = {
            "cases": len(split_cases),
            "casesWithSegments": int(split_rows["caseid"].nunique()),
            "segments": len(split_rows),
            "segmentsWith20Normal": int(
                (split_rows["beats_normal"] >= DSP_CONFIG["dsp14"]["minNormalBeats"]).sum()
            ),
            "segmentsWithShape": len(split_usable),
            "segmentsWithoutShape": len(split_rows) - len(split_usable),
            "casesWithShape": int(usable_subjects.size),
            "diabeticCases": int((labelled == 1).sum()),
            "diabeticCasesWithShape": int((usable_subjects == 1).sum()),
            "controlCasesWithShape": int((usable_subjects == 0).sum()),
            "diabeticSegmentsWithShape": int((split_usable["preop_dm"] == 1).sum()),
            "controlSegmentsWithShape": int((split_usable["preop_dm"] == 0).sum()),
        }
    return report


def output_dir() -> Path:
    return paths.derived_dir() / "diabetes_features"


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m train.diabetes_features")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args(argv)

    cases = vitaldb_pleth.dev_cases()[["caseid", "subjectid", "preop_dm"]]
    ensure_dev_only(cases["subjectid"], load_split())
    dev_split = load_dev_split()
    unsplit = set(cases["subjectid"]) - set(dev_split)
    if unsplit:
        raise ValueError(f"{len(unsplit)} development patients are missing from diabetes-dev.json")
    pleth_dir, out_dir = vitaldb_pleth.output_dir(), output_dir()
    started = time.perf_counter()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(extract_case_features, int(case.caseid), int(case.subjectid), pleth_dir, out_dir)
            for case in cases.itertuples(index=False)
        ]
        for done, future in enumerate(as_completed(futures), start=1):
            future.result()
            if done % 100 == 0 or done == len(futures):
                log.info("%d / %d cases, %.0f s", done, len(futures), time.perf_counter() - started)
    table = segment_table(out_dir, cases, dev_split)
    table.to_parquet(out_dir / "segments.parquet", index=False)
    report = coverage(cases, table, dev_split)
    report["wallSeconds"] = round(time.perf_counter() - started)
    report["caseSecondsTotal"] = round(
        sum(
            json.loads(_status_path(caseid, out_dir).read_text(encoding="utf-8"))["seconds"]
            for caseid in cases["caseid"]
        )
    )
    (out_dir / "coverage.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    log.info("%s", json.dumps(report, indent=1))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
