import math
from collections.abc import Sequence
from dataclasses import dataclass

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.median import median

# Mirrors packages/core/src/rhythm-features.ts with the same loops in the same order on plain Python
# floats, so both sides produce the same doubles (§10.2 parity), except that Python's ** 2 goes through the
# platform pow(), which is 1 ulp off for a few inputs on Windows (red-team on #192),
# far inside the 1e-4 check.


# packages/core/src/rhythm-features.ts RHYTHM_FEATURE_NAMES: the rhythm model inputs in training order, the 8
# of rhythm_feature_vector (v1) then the 7 of rhythm_v2_features (v2). A model reads the prefix it names.
RHYTHM_FEATURE_NAMES = (
    "normalizedRmssd",
    "shannonEntropyBits",
    "turningPointRatio",
    "sd1S",
    "sd2S",
    "pnn50",
    "sampleEntropy",
    "atypicalFraction",
    "medianAbsDiffNorm",
    "shortLongPairShare",
    "rmssdPairsRemovedNorm",
    "trimmedRmssdNorm",
    "largeChangeShare",
    "rrLag1Autocorr",
    "rrLag2Autocorr",
)


@dataclass(frozen=True)
class RhythmWindow:
    start_interval: int  # index of the window's first interval in the reading
    intervals_s: list[float]
    normalized_rmssd: float  # RMSSD / mean interval
    shannon_entropy_bits: float
    turning_point_ratio: float  # turning points / (n − 2); ties are not turning points
    sd1_s: float
    sd2_s: float
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
        pnn50=over_threshold / len(differences),
        sample_entropy=_sample_entropy(intervals_s),
        atypical_fraction=sum(bounding_beats) / len(bounding_beats),
    )


def _checked_inputs(
    intervals_s: Sequence[float], spans_artifact: Sequence[bool], atypical_beats: Sequence[bool]
) -> tuple[list[float], list[bool], list[bool]]:
    intervals = [float(value) for value in intervals_s]
    spans = [bool(flag) for flag in spans_artifact]
    atypical = [bool(flag) for flag in atypical_beats]
    if len(spans) != len(intervals):
        raise ValueError(f"{len(intervals)} intervals but {len(spans)} artifact flags")
    if len(atypical) != len(intervals) + 1:
        raise ValueError(
            f"{len(intervals)} intervals need {len(intervals) + 1} beat flags, got {len(atypical)}"
        )
    # ADR 0024: the feature vector is always finite, which needs every interval finite and positive.
    for index, interval in enumerate(intervals):
        if not (math.isfinite(interval) and interval > 0):
            raise ValueError(f"interval {index} must be finite and positive seconds, got {interval}")
    return intervals, spans, atypical


def _usable_runs(spans: list[bool]) -> list[tuple[int, int]]:
    # Runs of intervals that span no artifact, as [start, end) indexes. An excluded interval ends the run:
    # successive differences, turning points, Poincaré pairs, and sample-entropy templates must only pair
    # intervals that are really adjacent in time.
    runs = []
    run_start = 0
    while run_start < len(spans):
        if spans[run_start]:
            run_start += 1
            continue
        run_end = run_start
        while run_end < len(spans) and not spans[run_end]:
            run_end += 1
        runs.append((run_start, run_end))
        run_start = run_end
    return runs


def rhythm_windows(
    intervals_s: Sequence[float], spans_artifact: Sequence[bool], atypical_beats: Sequence[bool]
) -> list[RhythmWindow]:
    # DSP-15: features per 32-interval window (step 16) within each run of usable intervals.
    intervals, spans, atypical = _checked_inputs(intervals_s, spans_artifact, atypical_beats)
    size, step = DSP_CONFIG["dsp15"]["windowIntervals"], DSP_CONFIG["dsp15"]["windowStep"]
    windows = []
    for run_start, run_end in _usable_runs(spans):
        for start in range(run_start, run_end - size + 1, step):
            windows.append(_window_features(start, intervals[start : start + size], atypical))
    return windows


def reading_wide_window(
    intervals_s: Sequence[float], spans_artifact: Sequence[bool], atypical_beats: Sequence[bool]
) -> RhythmWindow | None:
    # DSP-15 below its floors (ADR 0104): one window over the longest usable run (the first on a tie) when no
    # 32-interval window fits, from three intervals; None otherwise.
    intervals, spans, atypical = _checked_inputs(intervals_s, spans_artifact, atypical_beats)
    longest = None
    for run in _usable_runs(spans):
        if run[1] - run[0] >= DSP_CONFIG["dsp15"]["windowIntervals"]:
            return None
        if longest is None or run[1] - run[0] > longest[1] - longest[0]:
            longest = run
    if longest is None or longest[1] - longest[0] < DSP_CONFIG["lowQuality"]["rhythmMinIntervals"]:
        return None
    return _window_features(longest[0], intervals[longest[0] : longest[1]], atypical)


def judges_rhythm(window: RhythmWindow) -> bool:
    # DSP-15 below its floors: a reading-wide window under rhythmClassMinIntervals gives no rhythm class
    # (owner 2026-10-06, ADR 0104 answer 5).
    return len(window.intervals_s) >= DSP_CONFIG["lowQuality"]["rhythmClassMinIntervals"]


def _sample_entropy_upper_bound() -> float:
    # Undefined sample entropy (A or B = 0) takes the Richman & Moorman (2000) upper bound, ln of the number
    # of template pairs, ln((N − m)(N − m − 1) / 2): the owner's choice in H-012 (ADR 0024).
    n, m = DSP_CONFIG["dsp15"]["windowIntervals"], DSP_CONFIG["dsp15"]["sampleEntropyM"]
    return math.log((n - m) * (n - m - 1) / 2)


def rhythm_feature_vector(window: RhythmWindow) -> list[float]:
    # DSP-15: the 8 Rhythm-Net features (§11.3) in fixed order, with undefined sample entropy filled.
    return [
        window.normalized_rmssd,
        window.shannon_entropy_bits,
        window.turning_point_ratio,
        window.sd1_s,
        window.sd2_s,
        window.pnn50,
        _sample_entropy_upper_bound() if window.sample_entropy is None else window.sample_entropy,
        window.atypical_fraction,
    ]


def has_enough_usable_intervals(spans_artifact: Sequence[bool]) -> bool:
    # DSP-15: a reading needs at least 40 intervals that do not span an artifact.
    return sum(1 for spans in spans_artifact if not spans) >= DSP_CONFIG["dsp15"]["minUsableIntervals"]


_NEAR_CONSTANT_SD = 1e-9


def _pearson(a: list[float], b: list[float]) -> float:
    # Population form; 0.0 when either side is constant, so the vector stays finite (ADR 0024).
    mean_a, mean_b = _sum(a) / len(a), _sum(b) / len(b)
    sd_a, sd_b = _population_sd(a), _population_sd(b)
    # Below 1e-9 of the mean the spread is rounding left over from subtracting the mean, not rhythm, and its
    # correlation is noise (red-team on #192: one-ulp alternation read +0.94 for a true −1).
    if sd_a <= _NEAR_CONSTANT_SD * mean_a or sd_b <= _NEAR_CONSTANT_SD * mean_b:
        return 0.0
    covariance = _sum([(a[i] - mean_a) * (b[i] - mean_b) for i in range(len(a))]) / len(a)
    return covariance / (sd_a * sd_b)


def _root_mean_square(values: list[float]) -> float:
    return math.sqrt(_sum([value * value for value in values]) / len(values))


def rhythm_v2_features(window: RhythmWindow) -> list[float]:
    # DSP-15 rhythm v2 (ADR 0079): 7 irregularity features that an isolated premature beat and its
    # compensatory pause move far less than AF does.
    config = DSP_CONFIG["dsp15"]
    x = window.intervals_s
    differences = [x[i + 1] - x[i] for i in range(len(x) - 1)]
    absolute = [abs(difference) for difference in differences]
    med = median(x)

    pairs = [
        i
        for i in range(len(differences))
        if x[i] < config["prematureShortFactor"] * med and x[i + 1] > config["pauseLongFactor"] * med
    ]
    kept = [True] * len(x)
    for i in pairs:
        for j in range(max(0, i - 1), min(len(x), i + 3)):
            kept[j] = False
    kept_differences = [differences[i] for i in range(len(differences)) if kept[i] and kept[i + 1]]
    pairs_removed = 0.0 if len(kept_differences) < 2 else _root_mean_square(kept_differences) / med

    trimmed = sorted(absolute)[: max(1, math.floor(config["trimmedDiffShare"] * len(absolute)))]
    large = sum(1 for value in absolute if value > config["largeChangeFactor"] * med)
    return [
        median(absolute) / med,
        len(pairs) / len(differences),
        pairs_removed,
        _root_mean_square(trimmed) / med,
        large / len(absolute),
        _pearson(x[:-1], x[1:]),
        _pearson(x[:-2], x[2:]),
    ]
