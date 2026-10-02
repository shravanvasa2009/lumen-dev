import importlib
import math
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

import numpy as np
import wfdb

from datasets.build_intervals import r_peak_samples
from eval.external_stats import is_reference_clean, subject_lag_s
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_bandpass, filter_zero_phase
from lumen_dsp.resample import ResampledSegment, resample_cubic
from lumen_dsp.rhythm import RhythmWindow, has_enough_usable_intervals, rhythm_windows
from lumen_dsp.signals import sqi_model_input
from train.rhythm_windows import READING_S

# The two Zenodo 15906524 archives (datasets/registry.py); ADR 0028 takes each subject's rhythm label
# from the archive it comes in.
ARCHIVES = {"mimic_perform_af_wfdb.zip": True, "mimic_perform_non_af_wfdb.zip": False}
# §11.5: 19 AF and 16 non-AF subjects. A different count is reported, not hidden.
EXPECTED_SUBJECTS = {"af": 19, "nonAf": 16}
# ADR 0045 channel rule, fixed before the files are opened: the first name in each list that the
# record carries (case-insensitive) is used.
PPG_NAMES = ("PLETH", "PPG")
ECG_NAMES = ("II", "ECG", "EKG")
# ADR 0041 (dsp7.minSegmentS in packages/core): shorter DSP-2 segments are not searched for beats.
MIN_SEGMENT_S = 2.0
# §11.1: SQI-Net scores a 4 s window every 1 s.
SQI_STEP_S = 1.0
WINDOW_S = DSP_CONFIG["dsp3"]["modelWindowS"]
MODEL_RATE_HZ = DSP_CONFIG["dsp2"]["modelRateHz"]
SHAPE_RATE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]


class DspNotMergedError(Exception):
    pass


class ChannelError(Exception):
    pass


def beat_modules() -> tuple[ModuleType, ModuleType]:
    # DSP-7/8/9 in Python is Track C's lumen_dsp.beats and lumen_dsp.beat_classes (ADR 0025), imported
    # here only when the external run needs them, so this module loads before they are merged.
    try:
        return importlib.import_module("lumen_dsp.beats"), importlib.import_module("lumen_dsp.beat_classes")
    except ModuleNotFoundError as error:
        if error.name not in ("lumen_dsp.beats", "lumen_dsp.beat_classes"):
            raise
        raise DspNotMergedError(
            "lumen_dsp.beats / lumen_dsp.beat_classes (DSP-7/8/9 Python mirror, Track C) are not on this "
            "branch. ML-1 and ML-4 need the app's own beat detector; merge that PR before the external run."
        ) from error


@dataclass(frozen=True)
class Recording:
    subject: str
    is_af: bool
    fs: float
    ppg: np.ndarray
    ecg: np.ndarray


def record_paths(dataset_dir: Path) -> list[tuple[Path, bool]]:
    found = []
    for archive_name, is_af in ARCHIVES.items():
        target = dataset_dir / "records" / Path(archive_name).stem
        if not target.is_dir():
            staging = target.with_name(target.name + ".extracting")
            if staging.exists():
                shutil.rmtree(staging)
            with zipfile.ZipFile(dataset_dir / archive_name) as archive:
                archive.extractall(staging)
            staging.replace(target)
        # A RECORDS list, when present, names whole records, so a multi-segment record's segment headers
        # are not counted as subjects of their own.
        listings = sorted(target.rglob("RECORDS"))
        if listings:
            headers = [
                listing.parent / name
                for listing in listings
                for name in listing.read_text(encoding="utf-8").split()
            ]
        else:
            headers = [header.with_suffix("") for header in sorted(target.rglob("*.hea"))]
        found += [(header, is_af) for header in headers]
    return found


def pick_channel(names: list[str], wanted: tuple[str, ...]) -> int:
    upper = [name.strip().upper() for name in names]
    for candidate in wanted:
        if candidate in upper:
            return upper.index(candidate)
    raise ChannelError(f"none of {list(wanted)} among the record's signals {names}")


def load_recording(path: Path, is_af: bool) -> Recording:
    record = wfdb.rdrecord(str(path))
    ppg = pick_channel(record.sig_name, PPG_NAMES)
    ecg = pick_channel(record.sig_name, ECG_NAMES)
    return Recording(
        subject=f"{'af' if is_af else 'non-af'}:{path.name}",
        is_af=is_af,
        fs=float(record.fs),
        ppg=np.asarray(record.p_signal[:, ppg], dtype=float),
        ecg=np.asarray(record.p_signal[:, ecg], dtype=float),
    )


def ppg_frames(recording: Recording) -> tuple[np.ndarray, np.ndarray]:
    # Missing samples are dropped like lost camera frames, so DSP-2 splits segments at gaps over 150 ms.
    # The bedside pleth rises with blood volume, as Lumen's −R does, so there is no sign flip (ADR 0028).
    finite = np.isfinite(recording.ppg)
    return np.flatnonzero(finite) / recording.fs, recording.ppg[finite]


def r_peaks_s(recording: Recording) -> np.ndarray:
    # A missing ECG stretch becomes a flat line: it yields no R-peaks, so its windows are not reference-clean.
    ecg = np.where(np.isfinite(recording.ecg), recording.ecg, 0.0)
    return r_peak_samples(ecg, recording.fs) / recording.fs


def _span_s(segment: ResampledSegment, rate_hz: float) -> tuple[float, float]:
    return segment.first_index / rate_hz, (segment.first_index + len(segment.values) - 1) / rate_hz


def _morphology(segment: ResampledSegment, rate_hz: float) -> ResampledSegment:
    dsp6 = DSP_CONFIG["dsp6"]
    low_hz, high_hz = dsp6["morphologyBandHz"]
    sos = butter_bandpass(dsp6["morphologyOrder"], low_hz, high_hz, rate_hz)
    return ResampledSegment(segment.first_index, filter_zero_phase(sos, segment.values))


def morphology_pairs(t_s: np.ndarray, values: np.ndarray) -> list[tuple[ResampledSegment, ResampledSegment]]:
    # Mirrors analyzeReading's beatSegments (ADR 0041): DSP-2 at 64 and 256 Hz, paired by time overlap,
    # each band-passed to the DSP-6 morphology band.
    models = resample_cubic(t_s, values, MODEL_RATE_HZ)
    pairs = []
    for raw in resample_cubic(t_s, values, SHAPE_RATE_HZ):
        if len(raw.values) < MIN_SEGMENT_S * SHAPE_RATE_HZ:
            continue
        start_s, end_s = _span_s(raw, SHAPE_RATE_HZ)
        model = next(
            candidate
            for candidate in models
            if _span_s(candidate, MODEL_RATE_HZ)[0] <= end_s
            and _span_s(candidate, MODEL_RATE_HZ)[1] >= start_s
        )
        pairs.append((_morphology(model, MODEL_RATE_HZ), _morphology(raw, SHAPE_RATE_HZ)))
    return pairs


def rhythm_inputs(segments: list[list]) -> tuple[list[float], list[bool], list[bool], list[float]]:
    # Mirrors analyzeReading's rhythmInputs (ADR 0041): intervals between consecutive beats that are not
    # "not a beat"; an interval spans an artifact when either beat is one or it crosses a segment gap.
    beats, intervals_s, spans_artifact = [], [], []
    for segment in segments:
        for position, beat in enumerate(beat for beat in segment if beat.beat_class != "not-a-beat"):
            if beats:
                previous = beats[-1]
                intervals_s.append(beat.peak_s - previous.peak_s)
                spans_artifact.append(
                    position == 0 or previous.beat_class == "artifact" or beat.beat_class == "artifact"
                )
            beats.append(beat)
    atypical = [beat.beat_class == "atypical" for beat in beats]
    return intervals_s, spans_artifact, atypical, [beat.peak_s for beat in beats]


def reading_windows(
    intervals_s: list[float], spans_artifact: list[bool], atypical: list[bool], peaks_s: list[float]
) -> list[tuple[int, RhythmWindow]]:
    # §11.5 pseudo-readings: each interval belongs to the 90 s block its end beat falls in, as the
    # development windows are cut (train.rhythm_windows.cut_readings); DSP-15 runs within each block.
    blocks = np.floor(np.asarray(peaks_s[1:], dtype=float) / READING_S).astype(int)
    windows = []
    for block in np.unique(blocks):
        members = np.flatnonzero(blocks == block)
        start, stop = int(members[0]), int(members[-1]) + 1
        windows += [
            (int(block), window)
            for window in rhythm_windows(
                intervals_s[start:stop], spans_artifact[start:stop], atypical[start : stop + 1]
            )
        ]
    return windows


def enough_intervals_by_block(spans_artifact: list[bool], peaks_s: list[float]) -> dict[int, bool]:
    # DSP-15's ≥ 40 usable intervals per reading, the app's condition for a rhythm card (ADR 0041), on
    # the same 90 s blocks as reading_windows.
    blocks = np.floor(np.asarray(peaks_s[1:], dtype=float) / READING_S).astype(int)
    return {
        int(block): has_enough_usable_intervals([spans_artifact[i] for i in np.flatnonzero(blocks == block)])
        for block in np.unique(blocks)
    }


def sqi_windows(t_s: np.ndarray, values: np.ndarray) -> list[tuple[float, np.ndarray | None]]:
    # ADR 0028: DSP-2 to 64 Hz, 4 s windows every 1 s within each segment, DSP-3 z-score, no band-pass.
    size, step = int(WINDOW_S * MODEL_RATE_HZ), int(SQI_STEP_S * MODEL_RATE_HZ)
    windows = []
    for segment in resample_cubic(t_s, values, MODEL_RATE_HZ):
        for start in range(0, len(segment.values) - size + 1, step):
            windows.append(
                (
                    (segment.first_index + start) / MODEL_RATE_HZ,
                    sqi_model_input(segment.values[start : start + size]),
                )
            )
    return windows


def _in_window(times_s: np.ndarray, start_s: float) -> np.ndarray:
    return times_s[np.searchsorted(times_s, start_s) : np.searchsorted(times_s, start_s + WINDOW_S)]


def reference_rows(
    starts_s: list[float], r_peaks: np.ndarray, ppg_peaks: np.ndarray
) -> tuple[np.ndarray, np.ndarray, float | None]:
    # ADR 0028: one lag per subject, PPG beats shifted back by it, then each window is judged on its own.
    r_peaks, ppg_peaks = np.sort(r_peaks), np.sort(ppg_peaks)
    lag = subject_lag_s(r_peaks, ppg_peaks)
    clean, hr_bpm = [], []
    for start in starts_s:
        ecg = _in_window(r_peaks, start)
        clean.append(lag is not None and is_reference_clean(ecg, _in_window(ppg_peaks - lag, start)))
        hr_bpm.append(60 / float(np.median(np.diff(ecg))) if len(ecg) >= 2 else math.nan)
    return np.asarray(clean, dtype=bool), np.asarray(hr_bpm, dtype=float), lag


@dataclass(frozen=True)
class RecordingAnalysis:
    subject: str
    is_af: bool
    rhythm: list[tuple[int, RhythmWindow]]
    sqi_inputs: list[np.ndarray | None]
    reference_clean: np.ndarray
    hr_bpm: np.ndarray
    lag_s: float | None
    # Every 90 s pseudo-reading the recording spans, with or without windows, as the app saves each one.
    blocks: int
    enough_intervals: dict[int, bool]


def analyse(recording: Recording, rhythm: bool, sqi: bool) -> RecordingAnalysis:
    beats, beat_classes = beat_modules()
    t_s, values = ppg_frames(recording)
    pairs = morphology_pairs(t_s, values)
    detected_by_segment = [beats.detect_beats(model, shape) for model, shape in pairs]
    windows: list[tuple[int, RhythmWindow]] = []
    enough: dict[int, bool] = {}
    if rhythm:
        # No acquisition spans exist for bedside data, so DSP-9 gets none (ADR 0045); SQI is judged by ML-4.
        classified = [
            beat_classes.classify_beats(detected, shape, [])
            for detected, (_model, shape) in zip(detected_by_segment, pairs, strict=True)
        ]
        intervals_s, spans_artifact, atypical, peaks_s = rhythm_inputs(classified)
        windows = reading_windows(intervals_s, spans_artifact, atypical, peaks_s)
        enough = enough_intervals_by_block(spans_artifact, peaks_s)
    sqi_inputs: list[np.ndarray | None] = []
    clean, hr_bpm, lag = np.zeros(0, dtype=bool), np.zeros(0), None
    if sqi:
        scored = sqi_windows(t_s, values)
        sqi_inputs = [model_input for _start, model_input in scored]
        ppg_peaks = np.asarray([beat.peak_s for detected in detected_by_segment for beat in detected])
        clean, hr_bpm, lag = reference_rows(
            [start for start, _input in scored], r_peaks_s(recording), ppg_peaks
        )
    blocks = math.ceil(len(recording.ppg) / recording.fs / READING_S)
    return RecordingAnalysis(
        recording.subject, recording.is_af, windows, sqi_inputs, clean, hr_bpm, lag, blocks, enough
    )
