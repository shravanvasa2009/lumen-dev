from collections import defaultdict
from pathlib import Path
from typing import NamedTuple

import numpy as np
import pandas as pd

from datasets.augment import augment_intervals
from datasets.build_intervals import MAX_INTERVAL_S, MIN_INTERVAL_S
from datasets.splits import Split
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.rhythm import RhythmWindow, rhythm_feature_vector, rhythm_windows
from nets.rhythm_net import INTERVALS, LABELS

# The order of lumen_dsp.rhythm.rhythm_feature_vector (ADR 0024), which the app's rhythmFeatureVector
# matches; the ADR 0020 addendum records it as the Rhythm-Net `features` input.
FEATURE_NAMES = (
    "normalizedRmssd",
    "shannonEntropyBits",
    "turningPointRatio",
    "sd1S",
    "sd2S",
    "pnn50",
    "sampleEntropy",
    "atypicalFraction",
)
ATYPICAL_INDEX = FEATURE_NAMES.index("atypicalFraction")
# v1 neutralizes the atypical-beat fraction (decision of 2026-10-01). Training flags come from ECG
# premature-beat annotations, about 0% in sinus, but the app's PPG DSP-9 marks 31-42% of beats atypical
# on BUT PPG sinus recordings (Track C), so a learned weight would not transfer to phones. Every
# training and dev-val window carries this constant instead, and the models ignore the app's value.
NEUTRAL_ATYPICAL_FRACTION = 0.0
# §11.5 scores each 20-minute external recording as 90 s pseudo-readings; development data is cut the
# same way, so reading-level numbers mean the same thing on both sides.
READING_S = 90.0
# Long-Term AF and MIT-BIH AF subjects carry hours of intervals each, a CinC 2017 subject one short
# recording; the cap keeps a few long recordings from deciding what the model learns.
WINDOWS_PER_SUBJECT_LABEL = 400
# §11.3: σ from BUT PPG. Each reading draws σ ~ U(0, 40 ms), bounded by the BUT PPG finger robust
# per-beat SD (38.4 ms; pooled SD 49.3 ms) of PPG peaks vs ECG, measured by Track C on 269 finger
# records and 2,178 beats (ADR 0025). The measurement includes 30 Hz quantization and pulse-transit
# variation, so it is not phone timing jitter alone.
JITTER_SD_RANGE_MS = (0.0, 40.0)

_SIZE = DSP_CONFIG["dsp15"]["windowIntervals"]
_STEP = DSP_CONFIG["dsp15"]["windowStep"]


class Reading(NamedTuple):
    subject: str  # "dataset:subject", the key of ml/splits/rhythm.json
    label: str
    intervals_ms: np.ndarray
    # One flag per beat bounding the intervals (n + 1); beat i ends interval i - 1.
    beat_premature: np.ndarray


class WindowSet(NamedTuple):
    intervals: np.ndarray  # [N, 64] float32 seconds, ADR 0020 layout
    mask: np.ndarray  # [N, 64] float32
    features: np.ndarray  # [N, 8] float32, FEATURE_NAMES order
    labels: np.ndarray  # [N] int64 index into LABELS
    subjects: np.ndarray  # [N] str
    readings: np.ndarray  # [N] int64, unique within one WindowSet


def cut_readings(intervals_ms: np.ndarray, premature: np.ndarray) -> list[tuple[np.ndarray, np.ndarray]]:
    # Each interval belongs to the 90 s block its end beat falls in. The episode's first beat has no
    # premature flag in intervals.parquet (it starts the episode), so it counts as not premature.
    intervals_ms = np.asarray(intervals_ms, dtype=float)
    beats = np.concatenate([[False], np.asarray(premature, dtype=bool)])
    block = np.floor(np.cumsum(intervals_ms) / 1000.0 / READING_S).astype(int)
    starts = np.flatnonzero(np.diff(np.concatenate([[-1], block])))
    stops = np.append(starts[1:], len(intervals_ms))
    return [
        (intervals_ms[start:stop], beats[start : stop + 1]) for start, stop in zip(starts, stops, strict=True)
    ]


def _nominal_windows(interval_count: int) -> int:
    return (interval_count - _SIZE) // _STEP + 1 if interval_count >= _SIZE else 0


def _readings(episodes: pd.DataFrame, assignment: dict[str, str], split: Split) -> list[Reading]:
    keys = episodes["dataset"] + ":" + episodes["subject"]
    missing = sorted(set(keys) - set(assignment))
    if missing:
        raise KeyError(f"subjects missing from the split file: {missing[:5]}")
    readings = []
    for key, row in zip(keys, episodes.itertuples(index=False), strict=True):
        if assignment[key] != split:
            continue
        for intervals_ms, beats in cut_readings(np.asarray(row.intervals_ms), np.asarray(row.premature)):
            readings.append(Reading(key, row.label, intervals_ms, beats))
    return readings


def _capped(readings: list[Reading], cap: int, rng: np.random.Generator) -> list[int]:
    # Whole readings are kept, so reading-level scoring sees every window of each reading it gets.
    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, reading in enumerate(readings):
        if _nominal_windows(len(reading.intervals_ms)) > 0:
            groups[(reading.subject, reading.label)].append(index)
    kept = []
    for group in sorted(groups):
        budget = cap
        for index in rng.permutation(groups[group]):
            windows = _nominal_windows(len(readings[index].intervals_ms))
            if windows <= budget:
                kept.append(int(index))
                budget -= windows
    return sorted(kept)


def _augmented(reading: Reading, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    augmented = augment_intervals(
        reading.intervals_ms,
        reading.beat_premature[1:],
        rng,
        jitter_sd_ms=rng.uniform(*JITTER_SD_RANGE_MS),
    )
    # augment_intervals never drops the first beat, so its flag carries over unchanged.
    return augmented.intervals_ms, np.concatenate([reading.beat_premature[:1], augmented.premature])


def _windows(intervals_ms: np.ndarray, beat_premature: np.ndarray) -> list[RhythmWindow]:
    # DSP-9 marks an interval outside its plausible range as artifact, and DSP-15 never lets a window
    # span one. Augmentation can create such intervals (a split beat, a merged pause), so they are
    # passed as artifact spans and the windows are cut around them, as the app would.
    intervals_s = np.asarray(intervals_ms, dtype=float) / 1000.0
    spans = (intervals_s < MIN_INTERVAL_S) | (intervals_s > MAX_INTERVAL_S)
    return rhythm_windows(intervals_s.tolist(), spans.tolist(), beat_premature.tolist())


def window_inputs(window: RhythmWindow) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    # ADR 0020: raw intervals in the first slots in time order, mask 1 there and 0 in the tail.
    intervals = np.zeros(INTERVALS, dtype=np.float32)
    mask = np.zeros(INTERVALS, dtype=np.float32)
    intervals[: len(window.intervals_s)] = window.intervals_s
    mask[: len(window.intervals_s)] = 1.0
    features = np.asarray(rhythm_feature_vector(window), dtype=np.float32)
    features[ATYPICAL_INDEX] = NEUTRAL_ATYPICAL_FRACTION
    return intervals, mask, features


def build_window_set(
    episodes: pd.DataFrame,
    assignment: dict[str, str],
    split: Split,
    augment: bool,
    seed: int,
    cap: int,
    premature_only: bool = False,
) -> WindowSet:
    readings = _readings(episodes, assignment, split)
    if premature_only:
        readings = [reading for reading in readings if reading.beat_premature.any()]
    rows: list[tuple[np.ndarray, np.ndarray, np.ndarray, int, str, int]] = []
    for index in _capped(readings, cap, np.random.default_rng(seed)):
        reading = readings[index]
        # One generator per reading keeps each reading's augmentation independent of which others
        # were kept, so changing the cap does not reshuffle every draw.
        intervals_ms, beats = (
            _augmented(reading, np.random.default_rng([seed, index]))
            if augment
            else (reading.intervals_ms, reading.beat_premature)
        )
        for window in _windows(intervals_ms, beats):
            rows.append((*window_inputs(window), LABELS.index(reading.label), reading.subject, index))
    if not rows:
        raise ValueError(f"no {split} windows: no reading has {_SIZE} usable intervals")
    intervals, mask, features, labels, subjects, reading_ids = zip(*rows, strict=True)
    return WindowSet(
        np.stack(intervals),
        np.stack(mask),
        np.stack(features),
        np.asarray(labels, dtype=np.int64),
        np.asarray(subjects, dtype=str),
        np.asarray(reading_ids, dtype=np.int64),
    )


def save_window_set(windows: WindowSet, path: Path) -> None:
    partial = path.with_name(path.name + ".partial.npz")
    np.savez_compressed(partial, **windows._asdict())
    partial.replace(path)


def load_window_set(path: Path) -> WindowSet:
    with np.load(path, allow_pickle=False) as arrays:
        return WindowSet(**{name: arrays[name] for name in WindowSet._fields})
