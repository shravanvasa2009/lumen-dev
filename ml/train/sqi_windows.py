import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

import numpy as np
import pandas as pd
from scipy.interpolate import CubicSpline

from datasets import paths
from datasets.splits import ensure_not_external
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_bandpass, filter_zero_phase
from lumen_dsp.resample import resample_cubic
from lumen_dsp.signals import dc_level, sqi_model_input
from train import butppg

RATE_HZ = DSP_CONFIG["dsp2"]["modelRateHz"]
WINDOW = DSP_CONFIG["dsp3"]["modelWindowS"] * RATE_HZ
# §11.1: SQI-Net scores a new 4 s window every second during capture.
STEP = RATE_HZ
FRAME_RATE_HZ = butppg.PPG_RATE_HZ
# Re-timed beats are warped on a grid 10× the camera rate, so every 10th sample is a camera frame.
FINE_PER_FRAME = 10
FINE_RATE_HZ = FRAME_RATE_HZ * FINE_PER_FRAME

CLEAN, BAD = 1, 0
NATURAL = "natural"
POOR_QUALITY = "poor-quality"
RHYTHMS = ("af", "premature", "sinus")
RETIMED = tuple(f"retimed-{rhythm}" for rhythm in RHYTHMS)
CORRUPTIONS = ("motion", "pressure", "flicker", "dropout")
CLEAN_KINDS = (NATURAL, *RETIMED)
BAD_KINDS = (POOR_QUALITY, *CORRUPTIONS)

# §11.2: AF and premature-beat patterns come from MIT-BIH AF, Long-Term AF, and MIT-BIH Arrhythmia.
PATTERN_DATASETS = ("afdb", "ltafdb", "mitdb")
# §11.2: a pulse after a shorter interval is smaller; the factor is clamped to 0.4–1.2.
PULSE_SCALE_RANGE = (0.4, 1.2)
# A record's beats are re-timed only if they look alike once cut at the estimated lag, which shows the
# ECG and PPG clocks agree over the record. Fixed before any training, from §10 DSP-9's template
# correlation idea; not tuned.
MIN_BEAT_CORRELATION = 0.8
MIN_BEATS = 5
# Each warped beat is rounded to the fine grid, so patterns are drawn this much longer than the record.
PATTERN_MARGIN_S = 1.0
# Systole is kept as recorded (up to 100 ms past the peak, at most 60% of the beat), and diastole is
# stretched or squeezed to the new interval, since filling time is what a shorter interval loses.
SYSTOLE_PAST_PEAK_S = 0.1
MAX_SYSTOLE_FRACTION = 0.6

# §11.2 corruptions.
MOTION_BAND_HZ = (0.5, 5.0)
# Same order as the DSP-6 HR band filter.
MOTION_FILTER_ORDER = DSP_CONFIG["dsp6"]["hrOrder"]
MOTION_GAIN_RANGE = (1.0, 5.0)
# Burst lengths are assumptions: long enough to cover a real hand movement inside a 4 s window.
MOTION_BURST_S = (1.5, 4.0)
PRESSURE_AC_KEPT = 0.2
# Clipping level as a quantile of the flattened window, so 40–70% of samples sit on the clip.
PRESSURE_CLIP_QUANTILE = (0.3, 0.6)
FLICKER_FRACTION = (0.01, 0.02)
# Mains flicker (100 or 120 Hz) aliases anywhere into 0–15 Hz at 30 fps; below 0.5 Hz it is baseline.
FLICKER_HZ = (0.5, 14.5)
DROPOUT_S = (0.3, 1.5)
# A finger lifting off moves the level by several pulse amplitudes (assumption, not measured).
DROPOUT_STEP_GAIN = (5.0, 30.0)

log = logging.getLogger("train.sqi_windows")


class WindowSet(NamedTuple):
    # Model inputs (sqi_model_input), float32 [N, 256].
    windows: np.ndarray
    labels: np.ndarray
    kinds: np.ndarray
    # BUT PPG subject (3-digit prefix) the signal came from.
    subjects: np.ndarray
    records: np.ndarray
    # The record's reference HR for natural windows; NaN for synthetic ones.
    reference_hr_bpm: np.ndarray
    # Rhythm database subject whose intervals re-timed the window ("" otherwise).
    pattern_subjects: np.ndarray


class Beat(NamedTuple):
    # Foot-to-foot on the fine grid, both ends included and detrended to 0.
    shape: np.ndarray
    peak_index: int


class Pattern(NamedTuple):
    subject: str
    # The first interval only sets the first pulse's scale; the rest are laid out in time.
    intervals_s: np.ndarray


class Rows(list):
    def add(
        self,
        window: np.ndarray,
        label: int,
        kind: str,
        source: butppg.Recording,
        pattern_subject: str = "",
    ) -> None:
        scored = sqi_model_input(window)
        # A flat window never reaches the model (ADR 0023), so it is not a training example.
        if scored is None:
            return
        reference = source.reference_hr_bpm if kind in (NATURAL, POOR_QUALITY) else np.nan
        self.append((scored, label, kind, source.subject, source.record, reference, pattern_subject))

    def window_set(self) -> WindowSet:
        if not self:
            raise ValueError("no windows")
        columns = list(zip(*self, strict=True))
        return WindowSet(
            windows=np.stack(columns[0]).astype(np.float32),
            labels=np.asarray(columns[1], dtype=np.int64),
            kinds=np.asarray(columns[2], dtype=str),
            subjects=np.asarray(columns[3], dtype=str),
            records=np.asarray(columns[4], dtype=str),
            reference_hr_bpm=np.asarray(columns[5], dtype=float),
            pattern_subjects=np.asarray(columns[6], dtype=str),
        )


def raw_windows(frames: np.ndarray) -> list[np.ndarray]:
    # DSP-2 exactly as the app: cubic spline from the camera frame times onto the 64 Hz grid, then 4 s
    # windows every 1 s. The z-score happens later, in sqi_model_input.
    times = np.arange(len(frames)) / FRAME_RATE_HZ
    return [
        segment.values[start : start + WINDOW]
        for segment in resample_cubic(times, frames, RATE_HZ)
        for start in range(0, len(segment.values) - WINDOW + 1, STEP)
    ]


def _morphology_band(frames: np.ndarray) -> np.ndarray:
    dsp6 = DSP_CONFIG["dsp6"]
    low, high = dsp6["morphologyBandHz"]
    return filter_zero_phase(butter_bandpass(dsp6["morphologyOrder"], low, high, FRAME_RATE_HZ), frames)


def cut_lag_s(frames: np.ndarray, r_peaks_s: np.ndarray) -> float:
    # The phone and the ECG recorder have separate clocks, so the R-peak-to-pulse delay is a per-record
    # offset that can be anywhere within a beat. Averaging the 0.5–8 Hz signal over one median R-R period
    # after each R-peak gives the record's mean pulse; its minimum is the pulse foot, where beats are cut.
    band = _morphology_band(frames)
    times = np.arange(len(frames)) / FRAME_RATE_HZ
    period = float(np.median(np.diff(r_peaks_s)))
    lags = np.arange(0.0, period, 1.0 / FINE_RATE_HZ)
    starts = r_peaks_s[(r_peaks_s >= 0) & (r_peaks_s + period <= times[-1])]
    if len(starts) == 0:
        raise ValueError("no complete beat after an R-peak")
    profile = [np.interp(starts + lag, times, band).mean() for lag in lags]
    return float(lags[int(np.argmin(profile))])


def cut_beats(source: butppg.Recording) -> list[Beat] | None:
    peaks = source.r_peaks_s
    if len(peaks) < MIN_BEATS + 1:
        return None
    frames = source.negative_red
    times = np.arange(len(frames)) / FRAME_RATE_HZ
    cuts = peaks + cut_lag_s(frames, peaks)
    cuts = cuts[(cuts >= times[0]) & (cuts <= times[-1])]
    spline = CubicSpline(times, frames, bc_type="natural")
    beats = []
    for start, stop in zip(cuts[:-1], cuts[1:], strict=True):
        count = round((stop - start) * FINE_RATE_HZ)
        shape = spline(np.linspace(start, stop, count + 1))
        shape = shape - np.linspace(shape[0], shape[-1], count + 1)
        beats.append(Beat(shape=shape, peak_index=int(np.argmax(shape))))
    if len(beats) < MIN_BEATS:
        return None
    # Beat-to-template correlation on a common 64-point grid.
    common = np.stack(
        [np.interp(np.linspace(0, 1, 64), np.linspace(0, 1, len(b.shape)), b.shape) for b in beats]
    )
    template = common.mean(axis=0)
    correlations = [np.corrcoef(beat, template)[0, 1] for beat in common]
    return beats if np.median(correlations) >= MIN_BEAT_CORRELATION else None


def warp_beat(beat: Beat, duration_s: float) -> np.ndarray:
    # Returns the beat on the fine grid over [0, duration), its last sample just before the next foot.
    source_len = len(beat.shape) - 1
    keep = min(
        beat.peak_index + round(SYSTOLE_PAST_PEAK_S * FINE_RATE_HZ), int(MAX_SYSTOLE_FRACTION * source_len)
    )
    target_len = max(round(duration_s * FINE_RATE_HZ), 2)
    target_keep = min(keep, int(MAX_SYSTOLE_FRACTION * target_len))
    steps = np.arange(target_len, dtype=float)
    positions = np.where(
        steps < target_keep,
        steps * keep / max(target_keep, 1),
        keep + (steps - target_keep) * (source_len - keep) / (target_len - target_keep),
    )
    return np.interp(positions, np.arange(source_len + 1), beat.shape)


def retimed_frames(source: butppg.Recording, beats: list[Beat], pattern: Pattern) -> np.ndarray:
    # §11.2 re-timed clean signal: the record's own beats, in order and cycled, laid out on the pattern's
    # intervals, each scaled by its preceding interval, on top of the record's own DC level (DSP-3), and
    # sampled at the camera's frame times.
    count = len(source.negative_red)
    typical = float(np.median(pattern.intervals_s[1:]))
    pieces, total = [], 0
    for index, interval in enumerate(pattern.intervals_s[1:]):
        scale = np.clip(pattern.intervals_s[index] / typical, *PULSE_SCALE_RANGE)
        piece = scale * warp_beat(beats[index % len(beats)], float(interval))
        pieces.append(piece)
        total += len(piece)
        if total >= count * FINE_PER_FRAME:
            break
    fine = np.concatenate(pieces)
    if len(fine) < count * FINE_PER_FRAME:
        raise ValueError(f"pattern from {pattern.subject} is shorter than the record")
    return fine[: count * FINE_PER_FRAME : FINE_PER_FRAME] + dc_level(source.negative_red, FRAME_RATE_HZ)


def _pattern_mask(episodes: pd.DataFrame, rhythm: str) -> pd.Series:
    in_dataset = episodes["dataset"].isin(PATTERN_DATASETS)
    if rhythm == "af":
        return in_dataset & (episodes["label"] == "af")
    if rhythm == "sinus":
        return in_dataset & (episodes["label"] == "sinus")
    return (
        in_dataset
        & (episodes["label"] == "other")
        & episodes["premature"].map(lambda flags: bool(np.any(flags)))
    )


class PatternPool:
    # Patterns are drawn subject first, so subjects with many episodes (Long-Term AF) do not dominate.
    def __init__(self, episodes: pd.DataFrame, assignment: dict[str, str], split: str, rhythm: str) -> None:
        keys = episodes["dataset"] + ":" + episodes["subject"].astype(str)
        chosen = episodes[_pattern_mask(episodes, rhythm) & (keys.map(assignment) == split)]
        chosen_keys = keys[chosen.index]
        self.rhythm = rhythm
        self.by_subject = {
            subject: [
                (np.asarray(row.intervals_ms, dtype=float) / 1000.0, np.asarray(row.premature, dtype=bool))
                for row in group.itertuples()
            ]
            for subject, group in chosen.groupby(chosen_keys)
        }
        if not self.by_subject:
            raise ValueError(f"no {rhythm} patterns in {split}")
        self.subjects = sorted(self.by_subject)

    def draw(self, rng: np.random.Generator, duration_s: float) -> Pattern:
        for _ in range(1000):
            subject = self.subjects[rng.integers(len(self.subjects))]
            episodes = self.by_subject[subject]
            intervals, premature = episodes[rng.integers(len(episodes))]
            ends = np.cumsum(intervals)
            if self.rhythm == "premature":
                # Start one to four beats before a premature beat, so it lands inside the windows.
                flagged = np.flatnonzero(premature)
                start = max(int(flagged[rng.integers(len(flagged))]) - int(rng.integers(1, 5)), 0)
            else:
                start = int(rng.integers(len(intervals)))
            # Index start is the preceding interval; the laid-out ones follow it.
            begin = ends[start]
            stop = int(np.searchsorted(ends, begin + duration_s)) + 1
            if stop <= len(intervals):
                return Pattern(subject=subject, intervals_s=intervals[start:stop])
        raise ValueError(f"no {self.rhythm} pattern lasts {duration_s} s")


def corrupt_window(window: np.ndarray, kind: str, rng: np.random.Generator) -> np.ndarray:
    mean = float(window.mean())
    amplitude = float(window.std())
    if kind == "motion":
        padded = rng.normal(size=len(window) + 2 * RATE_HZ)
        band = butter_bandpass(MOTION_FILTER_ORDER, *MOTION_BAND_HZ, RATE_HZ)
        # 1 s of padding each side keeps the filter's edge transient out of the window.
        noise = filter_zero_phase(band, padded)[RATE_HZ:-RATE_HZ]
        noise *= rng.uniform(*MOTION_GAIN_RANGE) * amplitude / noise.std()
        length = round(rng.uniform(*MOTION_BURST_S) * RATE_HZ)
        start = int(rng.integers(0, len(window) - length + 1))
        envelope = np.zeros(len(window))
        # The fourth root flattens the Hann taper: full strength for most of the burst, soft edges.
        envelope[start : start + length] = np.hanning(length + 2)[1:-1] ** 0.25
        return window + envelope * noise
    if kind == "pressure":
        flattened = mean + PRESSURE_AC_KEPT * (window - mean)
        return np.minimum(flattened, np.quantile(flattened, rng.uniform(*PRESSURE_CLIP_QUANTILE)))
    if kind == "dropout":
        length = round(rng.uniform(*DROPOUT_S) * RATE_HZ)
        start = int(rng.integers(0, len(window) - length + 1))
        dropped = window.copy()
        if rng.random() < 0.5:
            # Frozen frames: the last value repeats.
            dropped[start : start + length] = window[start]
        else:
            step = rng.uniform(*DROPOUT_STEP_GAIN) * amplitude * rng.choice([-1.0, 1.0])
            dropped[start : start + length] += step
        return dropped
    raise ValueError(f"{kind} is applied per window only for motion, pressure, and dropout")


def flicker_frames(frames: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    # Applied to camera frames, where aliasing happens, before DSP-2. −R is negative, so its magnitude is
    # the red DC level.
    times = np.arange(len(frames)) / FRAME_RATE_HZ
    depth = rng.uniform(*FLICKER_FRACTION) * abs(float(frames.mean()))
    phase = rng.uniform(0, 2 * np.pi)
    return frames + depth * np.sin(2 * np.pi * rng.uniform(*FLICKER_HZ) * times + phase)


def add_clean_and_corrupted(
    rows: Rows,
    frames: np.ndarray,
    kind: str,
    source: butppg.Recording,
    rng: np.random.Generator,
    pattern_subject: str = "",
) -> None:
    # Every clean window gets one corrupted copy, the corruption chosen at random.
    flickered = raw_windows(flicker_frames(frames, rng))
    for index, window in enumerate(raw_windows(frames)):
        rows.add(window, CLEAN, kind, source, pattern_subject)
        corruption = CORRUPTIONS[rng.integers(len(CORRUPTIONS))]
        if corruption == "flicker":
            rows.add(flickered[index], BAD, corruption, source, pattern_subject)
        else:
            rows.add(corrupt_window(window, corruption, rng), BAD, corruption, source, pattern_subject)


def record_rng(seed: int, record: str, purpose: int) -> np.random.Generator:
    # Seeded per record, so a window does not change when other records are added or reordered.
    return np.random.default_rng([seed, int(record), purpose])


class BuildPlan(NamedTuple):
    natural: bool
    # Re-timed sequences per clean record and rhythm; 0 skips re-timing.
    retimed_per_rhythm: int
    corrupt_retimed: bool


def build_window_set(
    recordings: list[butppg.Recording], pools: dict[str, PatternPool], plan: BuildPlan, seed: int
) -> WindowSet:
    rows = Rows()
    for source in recordings:
        rng = record_rng(seed, source.record, 0)
        clean = source.quality == butppg.GOOD_QUALITY
        if plan.natural and clean:
            add_clean_and_corrupted(rows, source.negative_red, NATURAL, source, rng)
        elif plan.natural:
            for window in raw_windows(source.negative_red):
                rows.add(window, BAD, POOR_QUALITY, source)
        beats = cut_beats(source) if clean and plan.retimed_per_rhythm else None
        if beats is None:
            continue
        duration_s = len(source.negative_red) / FRAME_RATE_HZ
        for rhythm_index, rhythm in enumerate(RHYTHMS):
            pattern_rng = record_rng(seed, source.record, 1 + rhythm_index)
            kind = f"retimed-{rhythm}"
            for _ in range(plan.retimed_per_rhythm):
                pattern = pools[rhythm].draw(pattern_rng, duration_s + PATTERN_MARGIN_S)
                frames = retimed_frames(source, beats, pattern)
                if plan.corrupt_retimed:
                    add_clean_and_corrupted(rows, frames, kind, source, pattern_rng, pattern.subject)
                else:
                    for window in raw_windows(frames):
                        rows.add(window, CLEAN, kind, source, pattern.subject)
    return rows.window_set()


def load_recordings(assignment: dict[str, str], split: str) -> list[butppg.Recording]:
    table = butppg.finger_records()
    chosen = table[table["subject"].map(assignment) == split]
    loaded = [butppg.load_recording(row) for _, row in chosen.iterrows()]
    kept = [recording for recording in loaded if butppg.reference_consistent(recording)]
    log.info("%s: %d of %d finger records have a trustworthy reference", split, len(kept), len(loaded))
    return kept


def load_episodes() -> pd.DataFrame:
    path = paths.derived_dir() / "intervals.parquet"
    ensure_not_external(path, "train")
    return pd.read_parquet(path, columns=["dataset", "subject", "label", "intervals_ms", "premature"])


def save_window_set(windows: WindowSet, path: Path) -> None:
    partial = path.with_name(path.stem + ".partial.npz")
    np.savez_compressed(partial, **windows._asdict())
    # Replace is atomic, so a kill mid-save never leaves a truncated cache that looks complete.
    partial.replace(path)


def load_window_set(path: Path) -> WindowSet:
    with np.load(path) as stored:
        return WindowSet(**{field: stored[field] for field in WindowSet._fields})


def cached(path: Path, build: Callable[[], WindowSet]) -> WindowSet:
    if not path.exists():
        started = time.perf_counter()
        save_window_set(build(), path)
        log.info("%s built in %.0f s", path.name, time.perf_counter() - started)
    return load_window_set(path)
