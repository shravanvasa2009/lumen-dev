import argparse
import json
import logging
import os
import time
from collections import Counter
from collections.abc import Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
import pandas as pd
import vitaldb

from datasets import paths, registry
from datasets.splits import ensure_not_external
from datasets.vitaldb_cases import eligible_cases, ensure_dev_only, load_split, select_dev_cases
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_bandpass, filter_zero_phase
from lumen_dsp.resample import ResampledSegment, resample_cubic

PLETH_TRACK = "SNUADC/PLETH"
PLETH_RATE_HZ = 500
# One Full Scan (§12, §6): the app averages the beats of a 90 s reading.
SEGMENT_S = 90
SEGMENTS_PER_CASE = 4
# ADC code 0 (-198.25 on SNUADC/PLETH, far below the 0-100 display range) appears as lone glitch
# samples, so it is treated like a sample the file does not have.
MISSING_CODE = 0
MAX_DROPOUT_FRACTION = 0.01
# Natural peak plateaus of the 0.395-unit quantized signal last up to ~0.2 s on VitalDB; a sensor off
# the finger or a frozen monitor output holds one code for seconds.
FLAT_RUN_S = 0.5
# On 465 sampled VitalDB windows the window's top or bottom code holds a median 0.02% of samples (99th
# percentile 0.55%); a signal on the 0.43-unit rail holds it for 1.5-4%.
CLIP_FRACTION = 0.005
# Below ~10 quantization steps peak to trough, the averaged beat shape is mostly rounding.
MIN_AMPLITUDE_CODES = 10
AMPLITUDE_BLOCK_S = 10
# Pulse amplitude (5th-95th percentile spread) may vary between 10 s blocks by at most this factor; a
# larger change is motion, a monitor gain step, or a cuff inflation on the same arm.
MAX_AMPLITUDE_RATIO = 2.0
# Normalized autocorrelation peak at a heart-period lag in the app's live HR range; band-limited noise
# without a pulse stays far below it.
MIN_PERIODICITY = 0.5

log = logging.getLogger("train.vitaldb_pleth")


@dataclass(frozen=True)
class PlethRecord:
    codes: np.ndarray  # int16 ADC codes at 500 Hz; MISSING_CODE where the file has no sample
    gain: float
    offset: float

    @classmethod
    def from_values(cls, values: np.ndarray, gain: float, offset: float) -> "PlethRecord":
        finite = np.isfinite(values)
        codes = np.full(len(values), MISSING_CODE, dtype=np.int16)
        exact = (values[finite] - offset) / gain
        rounded = np.round(exact)
        # The cache keeps codes, not floats, so it must be lossless: a float track would not be.
        if np.any(np.abs(exact - rounded) > 1e-3) or np.any(
            (rounded < 0) | (rounded > np.iinfo(np.int16).max)
        ):
            raise ValueError("PLETH values are not int16 ADC codes at this gain and offset")
        codes[finite] = rounded.astype(np.int16)
        return cls(codes=codes, gain=float(gain), offset=float(offset))


def selection_params() -> dict:
    # Read at call time, so a cached case made with other settings is detected and redone.
    return {
        "segmentS": SEGMENT_S,
        "segmentsPerCase": SEGMENTS_PER_CASE,
        "maxDropoutFraction": MAX_DROPOUT_FRACTION,
        "flatRunS": FLAT_RUN_S,
        "clipFraction": CLIP_FRACTION,
        "minAmplitudeCodes": MIN_AMPLITUDE_CODES,
        "amplitudeBlockS": AMPLITUDE_BLOCK_S,
        "maxAmplitudeRatio": MAX_AMPLITUDE_RATIO,
        "minPeriodicity": MIN_PERIODICITY,
    }


def read_pleth(path: Path | str) -> PlethRecord | None:
    # ADR 0015: the vitaldb package also accepts case numbers and URLs, which it fetches from vitaldb.net
    # behind a data-use agreement. Only a local file path ever reaches it.
    if urlparse(str(path)).netloc:
        raise ValueError(f"{path} is not a local file")
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)
    ensure_not_external(path, "train")
    vital = vitaldb.VitalFile(str(path), track_names=[PLETH_TRACK])
    if PLETH_TRACK not in vital.get_track_names():
        return None
    track = vital.trks[PLETH_TRACK]
    values = vital.to_numpy([PLETH_TRACK], 1 / PLETH_RATE_HZ)[:, 0]
    return PlethRecord.from_values(values, track.gain, track.offset)


@dataclass(frozen=True)
class SegmentBands:
    start_s: float  # from the start of the case's recording
    model: ResampledSegment  # DSP-7's 64 Hz input
    shape: ResampledSegment  # 256 Hz: DSP-7 refinement, DSP-8 onsets, DSP-9 templates, DSP-14


# §11.4 domain shift: DSP-2 resampling (64 or 256 Hz), then the DSP-6 0.5-8 Hz morphology band, the
# chain the app runs on camera frames.
def morphology_band(codes: np.ndarray, gain: float, offset: float, rate: int) -> ResampledSegment:
    present = np.flatnonzero(codes != MISSING_CODE)
    segments = resample_cubic(present / PLETH_RATE_HZ, codes[present] * gain + offset, rate)
    if len(segments) != 1:
        raise ValueError(f"PLETH window splits into {len(segments)} segments at gaps over DSP-2's limit")
    dsp6 = DSP_CONFIG["dsp6"]
    low_hz, high_hz = dsp6["morphologyBandHz"]
    sos = butter_bandpass(dsp6["morphologyOrder"], low_hz, high_hz, rate)
    return ResampledSegment(segments[0].first_index, filter_zero_phase(sos, segments[0].values))


def _longest_run(flags: np.ndarray) -> int:
    edges = np.diff(np.concatenate([[0], flags.astype(np.int8), [0]]))
    starts, stops = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    return int((stops - starts).max()) if len(starts) else 0


def _periodicity(band: np.ndarray, rate: float) -> float:
    centred = band - band.mean()
    spectrum = np.fft.rfft(centred, 2 * len(centred))
    autocorr = np.fft.irfft(np.abs(spectrum) ** 2)[: len(centred)]
    live = DSP_CONFIG["liveHr"]
    shortest = int(np.ceil(rate * 60 / live["maxBpm"]))
    longest = int(np.floor(rate * 60 / live["minBpm"]))
    return float(autocorr[shortest : longest + 1].max() / autocorr[0])


def window_reject_reason(codes: np.ndarray) -> str | None:
    missing = codes == MISSING_CODE
    max_gap_samples = DSP_CONFIG["dsp2"]["maxGapS"] * PLETH_RATE_HZ
    if missing.mean() > MAX_DROPOUT_FRACTION or _longest_run(missing) >= max_gap_samples:
        return "dropouts"
    present = codes[~missing]
    if _longest_run(np.diff(present) == 0) + 1 > FLAT_RUN_S * PLETH_RATE_HZ:
        return "flat"
    # The offset only shifts the signal, so the checks below run on codes.
    rate = DSP_CONFIG["dsp2"]["shapeRateHz"]
    band = morphology_band(codes, 1.0, 0.0, rate).values
    block = AMPLITUDE_BLOCK_S * rate
    blocks = band[: len(band) // block * block].reshape(-1, block)
    amplitude = np.percentile(blocks, 95, axis=1) - np.percentile(blocks, 5, axis=1)
    if np.median(amplitude) < MIN_AMPLITUDE_CODES:
        return "low-amplitude"
    at_rail = max((present == present.max()).mean(), (present == present.min()).mean())
    if at_rail >= CLIP_FRACTION:
        return "clipped"
    if amplitude.max() > MAX_AMPLITUDE_RATIO * amplitude.min():
        return "unstable-amplitude"
    if _periodicity(band, rate) < MIN_PERIODICITY:
        return "aperiodic"
    return None


def select_segments(codes: np.ndarray, limit: int) -> tuple[list[int], dict[str, int]]:
    # Earliest first: VitalDB recordings start around induction, before the incision and the large
    # fluid and drug changes of surgery (§11.4 domain notes).
    window = SEGMENT_S * PLETH_RATE_HZ
    starts: list[int] = []
    rejections: Counter[str] = Counter()
    for start in range(0, len(codes) - window + 1, window):
        reason = window_reject_reason(codes[start : start + window])
        if reason is None:
            starts.append(start)
            if len(starts) == limit:
                break
        else:
            rejections[reason] += 1
    return starts, dict(rejections)


def write_atomic(path: Path, write) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    with partial.open("wb") as handle:
        write(handle)
    os.replace(partial, path)


def _status_path(caseid: int, out_dir: Path) -> Path:
    return out_dir / "status" / f"{caseid:04d}.json"


def _segments_path(caseid: int, out_dir: Path) -> Path:
    return out_dir / "segments" / f"{caseid:04d}.npz"


def extract_case(caseid: int, subjectid: int, vital_path: Path, out_dir: Path) -> dict:
    status_path = _status_path(caseid, out_dir)
    params = selection_params()
    if status_path.exists():
        cached = json.loads(status_path.read_text(encoding="utf-8"))
        if cached["params"] == params:
            return cached
    started = time.perf_counter()
    record = read_pleth(vital_path)
    status = {"caseid": caseid, "subjectid": subjectid, "pleth": record is not None, "params": params}
    if record is None:
        status |= {"recordS": None, "segments": 0, "dropped": "no-pleth", "rejections": {}, "startS": []}
    else:
        starts, rejections = select_segments(record.codes, SEGMENTS_PER_CASE)
        window = SEGMENT_S * PLETH_RATE_HZ
        start_s = [start / PLETH_RATE_HZ for start in starts]
        status |= {
            "recordS": len(record.codes) / PLETH_RATE_HZ,
            "segments": len(starts),
            "dropped": None if starts else "no-stable-segment",
            "rejections": rejections,
            "startS": start_s,
        }
        if starts:
            write_atomic(
                _segments_path(caseid, out_dir),
                lambda handle: np.savez_compressed(
                    handle,
                    codes=np.stack([record.codes[start : start + window] for start in starts]),
                    start_s=np.asarray(start_s),
                    gain=record.gain,
                    offset=record.offset,
                ),
            )
    status["seconds"] = round(time.perf_counter() - started, 2)
    # The status file is written last, so its presence means the case finished.
    write_atomic(status_path, lambda handle: handle.write(json.dumps(status, indent=1).encode("utf-8")))
    return status


def load_segments(caseid: int, out_dir: Path) -> list[SegmentBands]:
    cached = np.load(_segments_path(caseid, out_dir))
    gain, offset = float(cached["gain"]), float(cached["offset"])
    dsp2 = DSP_CONFIG["dsp2"]
    return [
        SegmentBands(
            start_s=float(start_s),
            model=morphology_band(codes, gain, offset, dsp2["modelRateHz"]),
            shape=morphology_band(codes, gain, offset, dsp2["shapeRateHz"]),
        )
        for codes, start_s in zip(cached["codes"], cached["start_s"], strict=True)
    ]


def dev_case_files(
    cases: Mapping[int, int], split: dict[str, list[int]], vital_dir: Path
) -> list[tuple[int, int, Path]]:
    ensure_dev_only(cases.values(), split)
    return [(caseid, subjectid, vital_dir / f"{caseid:04d}.vital") for caseid, subjectid in cases.items()]


def output_dir() -> Path:
    return paths.derived_dir() / "vitaldb_pleth"


def dev_cases() -> pd.DataFrame:
    # The same deterministic pick the downloader used (ADR 0014), so the cases are the downloaded ones.
    vitaldb_dir = next(dataset for dataset in registry.DATASETS if dataset.key == "vitaldb").local_dir
    split = load_split()
    picked = select_dev_cases(eligible_cases(pd.read_csv(vitaldb_dir / "clinical_data.csv")), split["dev"])
    ensure_dev_only(picked["subjectid"], split)
    return picked


def summarize(out_dir: Path, caseids: Sequence[int]) -> pd.DataFrame:
    rows = [json.loads(_status_path(caseid, out_dir).read_text(encoding="utf-8")) for caseid in caseids]
    summary = pd.DataFrame(rows).drop(columns=["params"])
    summary["rejections"] = summary["rejections"].map(json.dumps)
    summary["startS"] = summary["startS"].map(json.dumps)
    summary.to_csv(out_dir / "cases.csv", index=False)
    return summary


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m train.vitaldb_pleth")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args(argv)

    picked = dev_cases()
    vital_dir = (
        next(dataset for dataset in registry.DATASETS if dataset.key == "vitaldb").local_dir / "vital_files"
    )
    jobs = dev_case_files(
        dict(zip(picked["caseid"], picked["subjectid"], strict=True)), load_split(), vital_dir
    )
    out_dir = output_dir()
    started = time.perf_counter()
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(extract_case, int(caseid), int(subject), path, out_dir)
            for caseid, subject, path in jobs
        ]
        for done, future in enumerate(as_completed(futures), start=1):
            future.result()
            if done % 100 == 0 or done == len(futures):
                log.info("%d / %d cases, %.0f s", done, len(futures), time.perf_counter() - started)
    summary = summarize(out_dir, [caseid for caseid, _, _ in jobs])
    log.info(
        "%d cases: %d with PLETH, %d with segments, %d segments; %.0f s wall",
        len(summary),
        int(summary["pleth"].sum()),
        int((summary["segments"] > 0).sum()),
        int(summary["segments"].sum()),
        time.perf_counter() - started,
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
