import math
from collections.abc import Sequence
from dataclasses import dataclass

from lumen_dsp.config import DSP_CONFIG

# Mirrors packages/core/src/rhythm-features.ts with the same loops in the same order on plain Python
# floats, so both sides produce the same doubles (§10.2 parity).


@dataclass(frozen=True)
class RhythmWindow:
    start_interval: int  # index of the window's first interval in the reading
    intervals_s: list[float]
    normalized_rmssd: float  # RMSSD / mean interval
    shannon_entropy_bits: float
    turning_point_ratio: float  # turning points / (n − 2); ties are not turning points
    sd1_s: float
    sd2_s: float
    sd1_sd2_ratio: float | None  # None when SD2 is 0
    pnn50: float
    sample_entropy: float | None  # None when no template pairs match at length m or m + 1
    atypical_fraction: float  # atypical beats among the n + 1 beats that bound the window


def _sum(values: Sequence[float]) -> float:
    # Sequential, like the TypeScript loop (built-in sum may compensate on newer Pythons).
    total = 0.0
    for value in values:
        total += value
    return total


def _population_sd(values: Sequence[float]) -> float:
    # Exactly 0 when all values are equal, so "undefined" cases stay exact.
    if all(value == values[0] for value in values):
        return 0.0
    mean = _sum(values) / len(values)
    return math.sqrt(_sum([(value - mean) ** 2 for value in values]) / len(values))


def _shannon_entropy_bits(intervals_s: list[float]) -> float:
    # Equal-width bins over [min, max]; the maximum falls in the last bin. log base 2.
    bins = DSP_CONFIG["dsp15"]["histogramBins"]
    low, high = min(intervals_s), max(intervals_s)
    counts = [0] * bins
    for value in intervals_s:
        index = 0 if high == low else min(bins - 1, math.floor((value - low) / (high - low) * bins))
        counts[index] += 1
    entropy = 0.0
    for count in counts:
        if count == 0:
            continue
        probability = count / len(intervals_s)
        entropy -= probability * math.log2(probability)
    return entropy


def _sample_entropy(intervals_s: list[float]) -> float | None:
    # Richman & Moorman (2000): r = R · population SD, Chebyshev distance ≤ r, self-matches excluded, and
    # the same first N − m templates for lengths m and m + 1. SampEn = ln(B / A).
    m = DSP_CONFIG["dsp15"]["sampleEntropyM"]
    r = DSP_CONFIG["dsp15"]["sampleEntropyR"] * _population_sd(intervals_s)
    templates = len(intervals_s) - m

    def matching_pairs(length: int) -> int:
        count = 0
        for i in range(templates):
            for j in range(i + 1, templates):
                if all(abs(intervals_s[i + k] - intervals_s[j + k]) <= r for k in range(length)):
                    count += 1
        return count

    shorter, longer = matching_pairs(m), matching_pairs(m + 1)
    return None if shorter == 0 or longer == 0 else math.log(shorter / longer)


def _window_features(start: int, intervals_s: list[float], atypical_beats: list[bool]) -> RhythmWindow:
    n = len(intervals_s)
    differences = [intervals_s[i + 1] - intervals_s[i] for i in range(n - 1)]
    mean = _sum(intervals_s) / n
    rmssd = math.sqrt(_sum([difference * difference for difference in differences]) / len(differences))
    turning_points = sum(1 for i in range(1, n - 1) if differences[i - 1] * differences[i] < 0)
    sd1 = _population_sd([difference / math.sqrt(2) for difference in differences])
    sd2 = _population_sd([(intervals_s[i + 1] + intervals_s[i]) / math.sqrt(2) for i in range(n - 1)])
    over_threshold = sum(1 for d in differences if abs(d) > DSP_CONFIG["dsp15"]["pnnThresholdS"])
    bounding_beats = atypical_beats[start : start + n + 1]
    return RhythmWindow(
        start_interval=start,
        intervals_s=intervals_s,
        normalized_rmssd=rmssd / mean,
        shannon_entropy_bits=_shannon_entropy_bits(intervals_s),
        turning_point_ratio=turning_points / (n - 2),
        sd1_s=sd1,
        sd2_s=sd2,
        sd1_sd2_ratio=None if sd2 == 0 else sd1 / sd2,
        pnn50=over_threshold / len(differences),
        sample_entropy=_sample_entropy(intervals_s),
        atypical_fraction=sum(bounding_beats) / len(bounding_beats),
    )


def rhythm_windows(
    intervals_s: Sequence[float], spans_artifact: Sequence[bool], atypical_beats: Sequence[bool]
) -> list[RhythmWindow]:
    # DSP-15: features per 32-interval window (step 16) within each run of usable intervals.
    intervals = [float(value) for value in intervals_s]
    spans = [bool(flag) for flag in spans_artifact]
    atypical = [bool(flag) for flag in atypical_beats]
    if len(spans) != len(intervals):
        raise ValueError(f"{len(intervals)} intervals but {len(spans)} artifact flags")
    if len(atypical) != len(intervals) + 1:
        raise ValueError(
            f"{len(intervals)} intervals need {len(intervals) + 1} beat flags, got {len(atypical)}"
        )
    size, step = DSP_CONFIG["dsp15"]["windowIntervals"], DSP_CONFIG["dsp15"]["windowStep"]
    windows = []
    # An excluded interval ends the run: successive differences, turning points, Poincaré pairs, and
    # sample-entropy templates must only pair intervals that are really adjacent in time.
    run_start = 0
    while run_start < len(intervals):
        if spans[run_start]:
            run_start += 1
            continue
        run_end = run_start
        while run_end < len(intervals) and not spans[run_end]:
            run_end += 1
        for start in range(run_start, run_end - size + 1, step):
            windows.append(_window_features(start, intervals[start : start + size], atypical))
        run_start = run_end
    return windows


def has_enough_usable_intervals(spans_artifact: Sequence[bool]) -> bool:
    # DSP-15: a reading needs at least 40 intervals that do not span an artifact.
    return sum(1 for spans in spans_artifact if not spans) >= DSP_CONFIG["dsp15"]["minUsableIntervals"]
