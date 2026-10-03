import argparse
import json
import logging
import time
from collections import Counter
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
from typing import NamedTuple, Protocol

import numpy as np
import pandas as pd

from datasets import paths
from datasets.vitaldb_cases import ensure_dev_only, load_dev_split, load_split
from eval.external_mimic import rhythm_inputs
from export.provenance import load_metrics, sha256_of
from export.specs import RUNS_DIR, SPECS
from export.to_onnx import source_model
import lumen_dsp
from eval import external_mimic
from lumen_dsp.beat_classes import classify_beats
from lumen_dsp.beats import detect_beats
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.metrics import MeasuredBeat, hr_summary, measure_beats
from lumen_dsp.rhythm import has_enough_usable_intervals, rhythm_feature_vector, rhythm_windows
from lumen_dsp.shape import PulseShape, ensemble_beat
from lumen_dsp.shape_features import SHAPE_FEATURE_NAMES, shape_features
from nets.diabetes_net import HR_SUMMARY_NAMES
from nets.rhythm_net import LABELS
from train import vitaldb_pleth
from train.diabetes import TABLE_COLUMNS
from train.vitaldb_pleth import PLETH_RATE_HZ, SEGMENT_S, SegmentBands, write_atomic

BEAT_CLASSES = ("normal", "atypical", "artifact", "not-a-beat")
WAVES = ("a", "b", "c", "d", "e")
NO_WAVE = -1
# The app opens DSP-12 with the reading's rhythm label, which comes from the shipped rhythm model
# (ADR 0031: rhythm-lgbm, export/specs.py), so training takes that model's label (ADR 0047 addendum).
RHYTHM_MODEL = SPECS["rhythm-lgbm"]
# The app reads probabilities in this order (packages/core reading-result.ts RHYTHM_CLASSES).
RHYTHM_CLASSES = ("sinus", "af", "other")
# Reading labels besides RHYTHM_CLASSES: no rhythm card at all, a card that abstains, or no reading at
# all because the app's analysis refuses the segment.
NO_RHYTHM_CARD = "none"
ABSTAINED = "uncertain"
NO_READING = "refused"
# A selected PLETH window has no rejected stretch (window_reject_reason drops any window with a gap DSP-2
# would split at), so a segment's clean seconds are its whole length, as the app's cleanSeconds with no
# rejected span.
CLEAN_S = float(SEGMENT_S)

log = logging.getLogger("train.diabetes_features")


class RhythmClassifier(Protocol):
    # The trained pickle, or train.diabetes_holdout's runner for the release's ONNX file.
    def predict_proba(self, features: np.ndarray) -> np.ndarray: ...


class ShippedRhythm(NamedTuple):
    # predict_proba gives columns in nets.rhythm_net LABELS order.
    classifier: RhythmClassifier
    source_sha256: str  # of the model file it runs (for the pickle, from its metrics file)
    abstain_below: float  # the manifest entry's abstainBelow


def code_sha256() -> dict[str, str]:
    # Module names never change, so the cache is keyed on the code itself: every lumen_dsp source file
    # (beats, classes, shape, features, HRV, rhythm), the two ml modules that cut segments and build
    # rhythm inputs, and dsp_config.json, whose liveHr range vitaldb_pleth's segment choice reads and no
    # other key holds. Any change there redoes every case (~3 min on 8 workers).
    package = Path(lumen_dsp.__file__).parent
    sources = [
        *sorted(package.glob("*.py")),
        package / "dsp_config.json",
        Path(external_mimic.__file__),
        Path(vitaldb_pleth.__file__),
    ]
    return {f"{source.parent.name}/{source.name}": sha256_of(source) for source in sources}


def cache_params(rhythm_model: ShippedRhythm) -> dict:
    # Read at call time, so a case cached with other DSP settings, segment rules, feature definitions, or
    # another rhythm model is detected and redone.
    rules = DSP_CONFIG["rules"]
    return {
        "pleth": vitaldb_pleth.selection_params(),
        "dsp": {
            key: DSP_CONFIG[key]
            for key in ("dsp2", "dsp6", "dsp7", "dsp8", "dsp9", "dsp11", "dsp12", "dsp14", "dsp15")
        },
        "rules": {key: rules[key] for key in ("rhythmMinCleanS", "uncertainBelowTopProb")},
        "diabetesFeatures": DSP_CONFIG["diabetesFeatures"],
        "code": code_sha256(),
        "rhythmModel": {
            "name": RHYTHM_MODEL.name,
            "sourceSha256": rhythm_model.source_sha256,
            "abstainBelow": rhythm_model.abstain_below,
        },
    }


def shipped_abstain_below() -> float:
    if not RHYTHM_MODEL.ships:
        raise ValueError(f"{RHYTHM_MODEL.name} is no longer the shipped rhythm model; update RHYTHM_MODEL")
    # buildReadingResult abstains at rules.uncertainBelowTopProb, and core's model loader refuses an entry
    # asking for another line, so the two must agree here too.
    abstain_below = RHYTHM_MODEL.abstain_below
    if abstain_below != DSP_CONFIG["rules"]["uncertainBelowTopProb"]:
        raise ValueError(f"abstainBelow {abstain_below} is not rules.uncertainBelowTopProb")
    return abstain_below


def load_rhythm_model(runs_dir: Path) -> ShippedRhythm:
    # As the release loads it: source_model refuses a pickle that is not the one its metrics describe.
    abstain_below = shipped_abstain_below()
    metrics = load_metrics(RHYTHM_MODEL, runs_dir)
    if metrics is None:
        raise FileNotFoundError(f"{runs_dir / RHYTHM_MODEL.file_stem}.json not found; train rhythm-lgbm")
    classifier = source_model(RHYTHM_MODEL, runs_dir, None)
    return ShippedRhythm(classifier, metrics["sourceSha256"], abstain_below)


def window_probs(rhythm_model: ShippedRhythm, features: list[list[float]]) -> np.ndarray:
    # The app feeds the ONNX model float32 features (export/verify_onnx checks the pickle against it on
    # float32 inputs); columns are put in RHYTHM_CLASSES order by label name.
    probs = rhythm_model.classifier.predict_proba(np.asarray(features, dtype=np.float32))
    return probs[:, [LABELS.index(name) for name in RHYTHM_CLASSES]]


def reading_rhythm(
    segments: Sequence[Sequence[MeasuredBeat]], rhythm_model: ShippedRhythm, clean_s: float
) -> str:
    # packages/core reading-result.ts: rhythmCall gives a card only with a DSP-15 window, rhythmMinCleanS
    # clean seconds, and DSP-15's usable intervals; its class is the highest mean window probability (the
    # first in sinus, af, other order on a tie); DSP-12 runs only when that class is sinus at or above
    # abstainBelow (confidentSinus). τ_AF only decides the irregular flag, not this label.
    intervals_s, spans_artifact, atypical, _ = rhythm_inputs(segments)
    # packages/core rhythmWindows throws on an interval that is not positive (two detected peaks at the
    # same or reversed times), which ends analyzeReading, so the app would save no reading.
    if any(not interval_s > 0 for interval_s in intervals_s):
        return NO_READING
    windows = rhythm_windows(intervals_s, spans_artifact, atypical) if atypical else []
    if (
        not windows
        or clean_s < DSP_CONFIG["rules"]["rhythmMinCleanS"]
        or not has_enough_usable_intervals(spans_artifact)
    ):
        return NO_RHYTHM_CARD
    # The app passes rhythmFeatureVector as computed, atypical fraction included; the model was trained
    # with that feature held constant and never splits on it.
    probs = window_probs(rhythm_model, [rhythm_feature_vector(window) for window in windows])
    # Summed in window order in double precision and then divided, as rhythmCall does.
    mean = []
    for column in range(len(RHYTHM_CLASSES)):
        total = 0.0
        for row in probs:
            total += float(row[column])
        mean.append(total / len(windows))
    top = mean.index(max(mean))
    return RHYTHM_CLASSES[top] if mean[top] >= rhythm_model.abstain_below else ABSTAINED


def segment_features(bands: SegmentBands, rhythm_model: ShippedRhythm) -> tuple[dict, PulseShape | None]:
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
    # The app's measureBeats step (reading.ts beatSegments). Its raw argument only feeds the per-beat
    # intensity and DC, which hr_summary does not read, so the morphology band stands in for the camera's
    # raw -R that VitalDB does not have; those two values are meaningless here and must not be used.
    measured = measure_beats(
        [beat.peak_s for beat in detected],
        [beat.beat_class for beat in classified],
        [beat.long_pause for beat in classified],
        [beat.amplitude for beat in detected],
        bands.shape,
    )
    rhythm = reading_rhythm([measured], rhythm_model, CLEAN_S)
    # One 90 s segment is one Full Scan; PLETH's 500 Hz passes DSP-12's 60 fps gate (Track C, order
    # D.C_TASK-hr-summary-call-on-vitaldb).
    summary = hr_summary([measured], rhythm, PLETH_RATE_HZ, CLEAN_S)
    shape_values = shape_features(pulse_shape) if pulse_shape else [None] * len(SHAPE_FEATURE_NAMES)
    row = {
        "startS": bands.start_s,
        **{f"beats_{name}": counts.get(name, 0) for name in BEAT_CLASSES},
        "longPauses": sum(beat.long_pause for beat in classified),
        "normalPairs": sum(earlier and later for earlier, later in zip(normal[:-1], normal[1:], strict=True)),
        "beatsUsed": pulse_shape.beats_used if pulse_shape else 0,
        "hasShape": pulse_shape is not None,
        "rhythm": rhythm,
        **dict(zip(SHAPE_FEATURE_NAMES, shape_values, strict=True)),
        **dict(zip(HR_SUMMARY_NAMES, summary, strict=True)),
    }
    return row, pulse_shape


def _status_path(caseid: int, out_dir: Path) -> Path:
    return out_dir / "status" / f"{caseid:04d}.json"


def _shapes_path(caseid: int, out_dir: Path) -> Path:
    return out_dir / "shapes" / f"{caseid:04d}.npz"


def _wave_indices(pulse_shape: PulseShape) -> list[int]:
    labels = [getattr(pulse_shape.waves, wave) for wave in WAVES]
    return [NO_WAVE if index is None else index for index in labels]


def extract_case_features(
    caseid: int, subjectid: int, pleth_dir: Path, out_dir: Path, rhythm_model: ShippedRhythm
) -> dict:
    status_path = _status_path(caseid, out_dir)
    params = cache_params(rhythm_model)
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
        row, pulse_shape = segment_features(bands, rhythm_model)
        rows.append({"segment": index, **row})
        if pulse_shape is not None:
            shapes.append((index, pulse_shape))
    # Everything a PulseShape holds, so its features can be checked or recomputed without the beats.
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
    # patient's label and split.
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


def scorable(table: pd.DataFrame) -> pd.Series:
    # Segments the app would read, with an averaged beat: the rows train.diabetes trains on and
    # train.diabetes_holdout scores.
    return table["hasShape"] & (table["rhythm"] != NO_READING)


def coverage(cases: pd.DataFrame, table: pd.DataFrame, dev_split: dict[int, str]) -> dict:
    report = {}
    for split in ("dev-train", "dev-val"):
        split_cases = cases[cases["subjectid"].map(dev_split) == split]
        split_rows = table[table["split"] == split]
        trained = split_rows[scorable(split_rows)]
        labelled = split_cases.set_index("subjectid")["preop_dm"]
        trained_subjects = labelled[labelled.index.isin(trained["subjectid"])]
        report[split] = {
            "cases": len(split_cases),
            "casesWithSegments": int(split_rows["caseid"].nunique()),
            "segments": len(split_rows),
            "segmentsWith20Normal": int(
                (split_rows["beats_normal"] >= DSP_CONFIG["dsp14"]["minNormalBeats"]).sum()
            ),
            "segmentsWithShape": int(split_rows["hasShape"].sum()),
            "segmentsWithoutShape": int((~split_rows["hasShape"]).sum()),
            "segmentsTheAppRefuses": int((split_rows["rhythm"] == NO_READING).sum()),
            "segmentsForTraining": len(trained),
            "casesForTraining": int(trained_subjects.size),
            "diabeticCases": int((labelled == 1).sum()),
            "diabeticCasesForTraining": int((trained_subjects == 1).sum()),
            "controlCasesForTraining": int((trained_subjects == 0).sum()),
            "diabeticSegmentsForTraining": int((trained["preop_dm"] == 1).sum()),
            "controlSegmentsForTraining": int((trained["preop_dm"] == 0).sum()),
            "rhythmOfTrainingSegments": {
                str(label): int(count) for label, count in trained["rhythm"].value_counts().items()
            },
            "trainingSegmentsWithValue": {
                name: int(trained[name].notna().sum()) for name in (*SHAPE_FEATURE_NAMES, *HR_SUMMARY_NAMES)
            },
        }
    return report


def feature_table(table: pd.DataFrame) -> pd.DataFrame:
    # train.diabetes's input; the label is a bool (preop_dm == 1).
    usable = table[scorable(table)]
    columns = {
        "subject": usable["subjectid"].astype("int64"),
        "label": usable["preop_dm"] == 1,
        "split": usable["split"],
        "beat": usable["beat"],
        **{name: usable[name].astype(float) for name in (*SHAPE_FEATURE_NAMES, *HR_SUMMARY_NAMES)},
    }
    return pd.DataFrame(columns)[list(TABLE_COLUMNS)].reset_index(drop=True)


def output_dir() -> Path:
    return paths.derived_dir() / "diabetes_features"


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m train.diabetes_features")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--rhythm-runs-dir", type=Path, default=RUNS_DIR, help="holds the trained shipped rhythm model"
    )
    args = parser.parse_args(argv)
    rhythm_model = load_rhythm_model(args.rhythm_runs_dir)

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
            pool.submit(
                extract_case_features, int(case.caseid), int(case.subjectid), pleth_dir, out_dir, rhythm_model
            )
            for case in cases.itertuples(index=False)
        ]
        for done, future in enumerate(as_completed(futures), start=1):
            future.result()
            if done % 100 == 0 or done == len(futures):
                log.info("%d / %d cases, %.0f s", done, len(futures), time.perf_counter() - started)
    table = segment_table(out_dir, cases, dev_split)
    table.to_parquet(out_dir / "segments.parquet", index=False)
    feature_table(table).to_parquet(out_dir / "features.parquet", index=False)
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
