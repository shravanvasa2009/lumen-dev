import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from lumen_dsp.beats import DetectedBeat, js_round
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.resample import ResampledSegment

# Mirrors packages/core/src/beat-classes.ts (DSP-9 with owner decision H-016, ADR 0025) with the same loops
# in the same order on plain Python floats, so classes match exactly (§10.2).


@dataclass(frozen=True)
class RejectedSpan:
    # Seconds from capture start; reason is a RejectionReason of packages/core/src/live-session.ts.
    start_s: float
    end_s: float
    reason: str


@dataclass(frozen=True)
class ClassifiedBeat:
    peak_s: float
    onset_s: float | None
    beat_class: str  # "not-a-beat" | "artifact" | "atypical" | "normal"
    long_pause: bool  # on the interval ending at this beat: kept for rhythm, not HRV


def _median(values: Sequence[float]) -> float:
    # packages/core/src/median.ts (numpy.median semantics); NaN for no values.
    ordered = sorted(values)
    if not ordered:
        return math.nan
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 == 1 else (ordered[middle - 1] + ordered[middle]) / 2


def _js_divide(numerator: float, denominator: float) -> float:
    # JavaScript division: x / 0 is ±Infinity (NaN for 0 / 0) instead of an exception.
    if denominator != 0:
        return numerator / denominator
    if numerator == 0 or math.isnan(numerator):
        return math.nan
    return math.copysign(math.inf, numerator) * math.copysign(1.0, denominator)


def _correlation(x: list[float], y: list[float]) -> float | None:
    # Pearson correlation; None when either side is flat, since a flat window carries no shape evidence.
    mean_x = 0.0
    mean_y = 0.0
    for k in range(len(x)):
        mean_x += x[k]
        mean_y += y[k]
    mean_x /= len(x)
    mean_y /= len(y)
    cross = 0.0
    squares_x = 0.0
    squares_y = 0.0
    for k in range(len(x)):
        dx = x[k] - mean_x
        dy = y[k] - mean_y
        cross += dx * dy
        squares_x += dx * dx
        squares_y += dy * dy
    return cross / math.sqrt(squares_x * squares_y) if squares_x > 0 and squares_y > 0 else None


def _mean(column: list[float]) -> float:
    total = 0.0
    for value in column:
        total += value
    return total / len(column)


def _pointwise(windows: list[list[float]], combine: Callable[[list[float]], float]) -> list[float]:
    return [combine([window[k] for window in windows]) for k in range(len(windows[0]))]


def _neighbours_of(items: list, p: int, count: int) -> list:
    # Up to `count` items on each side of position p, without p itself.
    return items[max(0, p - count) : p] + items[p + 1 : p + 1 + count]


# DSP-9: class and long-pause flag for each beat of one segment; acquisition evidence comes only from the
# rejected spans and impossible intervals, never from interval irregularity.
def classify_beats(
    beats: Sequence[DetectedBeat], shape: ResampledSegment, rejected_spans: Sequence[RejectedSpan]
) -> list[ClassifiedBeat]:
    config = DSP_CONFIG["dsp9"]
    shape_hz = DSP_CONFIG["dsp2"]["shapeRateHz"]
    shortest_s, longest_s = config["artifactIntervalS"]
    smallest, largest = config["amplitudeRatioRange"]
    shape_values = [float(value) for value in shape.values]

    def overlaps_span(start_s: float, end_s: float) -> bool:
        return any(span.start_s <= end_s and span.end_s >= start_s for span in rejected_spans)

    # Median over every candidate of the segment, including the ones the rule will remove.
    upslope_floor = config["notABeatUpslopeRatio"] * _median([beat.max_upslope for beat in beats])
    classes = ["not-a-beat" if beat.max_upslope < upslope_floor else "normal" for beat in beats]

    # Intervals run between consecutive beats that are not "not a beat"; the first beat has none.
    previous_beat: list[int | None] = []
    last_beat: int | None = None
    for i in range(len(beats)):
        previous_beat.append(last_beat)
        if classes[i] != "not-a-beat":
            last_beat = i

    for i, beat in enumerate(beats):
        if classes[i] == "not-a-beat":
            continue
        previous = previous_beat[i]
        interval_s = None if previous is None else beat.peak_s - beats[previous].peak_s
        impossible = interval_s is not None and (interval_s < shortest_s or interval_s > longest_s)
        start_s = beat.peak_s if beat.onset_s is None else beat.onset_s
        if overlaps_span(start_s, beat.peak_s) or impossible:
            classes[i] = "artifact"

    before_peak = js_round(config["templateBeforePeakS"] * shape_hz)
    after_peak = js_round(config["templateAfterPeakS"] * shape_hz)

    def window_of(beat: DetectedBeat) -> list[float] | None:
        peak = js_round(beat.peak_s * shape_hz) - shape.first_index
        if peak - before_peak < 0 or peak + after_peak >= len(shape_values):
            return None
        return shape_values[peak - before_peak : peak + after_peak + 1]

    # "Early" (H-016): the interval to the previous beat is short against the median of up to `neighbours`
    # intervals on each side, all between consecutive beats that are not "not a beat".
    kept = [i for i in range(len(beats)) if classes[i] != "not-a-beat"]
    kept_intervals = [
        None if q == 0 else beats[i].peak_s - beats[kept[q - 1]].peak_s for q, i in enumerate(kept)
    ]
    early_beats = set()
    for q, i in enumerate(kept):
        own_s = kept_intervals[q]
        if own_s is None:
            continue
        others = [s for s in _neighbours_of(kept_intervals, q, config["neighbours"]) if s is not None]
        if own_s < config["earlyIntervalRatio"] * _median(others):
            early_beats.add(i)

    candidates = [i for i in range(len(beats)) if classes[i] == "normal"]
    windows = [window_of(beats[i]) for i in candidates]
    # Before any normal beat exists, the template is the pointwise median of the first windows, so one early
    # premature beat cannot become the reference.
    seed_windows = [window for window in windows if window is not None][: config["templateBeats"]]
    normal_windows: list[list[float]] = []
    for p, i in enumerate(candidates):
        reference = _median([beats[j].amplitude for j in _neighbours_of(candidates, p, config["neighbours"])])
        ratio = _js_divide(beats[i].amplitude, reference)
        window = windows[p]
        if normal_windows:
            template = _pointwise(normal_windows[-config["templateBeats"] :], _mean)
        elif seed_windows:
            template = _pointwise(seed_windows, _median)
        else:
            template = None
        similarity = _correlation(window, template) if window is not None and template is not None else None
        # A missing reference or window is no evidence either way.
        odd_size = math.isfinite(ratio) and (ratio < smallest or ratio > largest)
        odd_shape = similarity is not None and similarity < config["templateCorrelationMin"]
        # Kept as atypical, never removed: the interval only decides together with a small amplitude.
        early_and_small = (
            i in early_beats and math.isfinite(ratio) and ratio < config["earlySmallAmplitudeRatio"]
        )
        if odd_size or odd_shape or early_and_small:
            classes[i] = "atypical"
        elif window is not None:
            normal_windows.append(window)

    # Long-pause references: intervals with no acquisition problem at either end or inside.
    clean_intervals: list[tuple[int, float]] = []
    for i, beat in enumerate(beats):
        start = previous_beat[i]
        if start is None or classes[i] in ("not-a-beat", "artifact"):
            continue
        if classes[start] == "artifact" or overlaps_span(beats[start].peak_s, beat.peak_s):
            continue
        clean_intervals.append((i, beat.peak_s - beats[start].peak_s))
    long_pauses = set()
    for q, (end, length_s) in enumerate(clean_intervals):
        reference = _median([other for _, other in _neighbours_of(clean_intervals, q, config["neighbours"])])
        if length_s >= config["longPauseRatio"] * reference:
            long_pauses.add(end)

    return [
        ClassifiedBeat(
            peak_s=beat.peak_s, onset_s=beat.onset_s, beat_class=classes[i], long_pause=i in long_pauses
        )
        for i, beat in enumerate(beats)
    ]
