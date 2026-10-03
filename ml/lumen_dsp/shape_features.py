import math
from collections.abc import Callable, Sequence

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.shape import PulseShape, is_local_max, is_local_min, systolic_peak_index, systolic_span_end

# diabetes-net's 12 shape features (§11.4, ML-6), mirroring packages/core/src/shape-features.ts with the
# same loops in the same order. The DSP-14 window is exactly one period: sample k sits at
# onset + (k / 256 − lead fraction) × period, so the onset is at 25.6 and the lead-in (samples 0–25) is the
# end of the previous period. Times are fractions of the period; amplitudes are measured on the smoothed
# beat above its minimum, relative to the systolic peak (ADR 0059). Undefined features are None; the
# model, not this module, fills them with its training median.

# The order of shape_features' output, shared with packages/core SHAPE_FEATURE_NAMES (a core test checks
# that the two lists are equal) and with diabetes-net's model card.
SHAPE_FEATURE_NAMES = (
    "riseTime",
    "width50",
    "width25",
    "notchTime",
    "notchHeight",
    "diastolicPeakHeight",
    "bOverA",
    "cOverA",
    "dOverA",
    "eOverA",
    "agingIndex",
    "areaRatio",
)


def _crossing(smoothed: Sequence[float], k: int, level: float) -> float:
    return k + (level - smoothed[k]) / (smoothed[k + 1] - smoothed[k])


def _peak_width(smoothed: Sequence[float], peak: int, level: float) -> float | None:
    # The last rise through `level` before the peak to the first fall through it after, within the window.
    rise = None
    for k in range(peak - 1, -1, -1):
        if smoothed[k] < level <= smoothed[k + 1]:
            rise = _crossing(smoothed, k, level)
            break
    fall = None
    for k in range(peak, len(smoothed) - 1):
        if smoothed[k] >= level > smoothed[k + 1]:
            fall = _crossing(smoothed, k, level)
            break
    return None if rise is None or fall is None else (fall - rise) / len(smoothed)


def _notch_index(smoothed: Sequence[float], second: Sequence[float], peak: int) -> int | None:
    # As packages/core notchIndex: the first local minimum after the systolic peak and before the systolic
    # span end that a local maximum (the diastolic peak) follows in the window; without one, the first
    # positive local maximum of the second derivative in the span (the first upward bend).
    span_end = systolic_span_end()
    for k in range(peak + 1, span_end - 1):
        if not is_local_min(smoothed, k):
            continue
        if any(is_local_max(smoothed, j) for j in range(k + 1, len(smoothed) - 1)):
            return k
        break
    for k in range(peak + 1, span_end - 1):
        if is_local_max(second, k) and second[k] > 0:
            return k
    return None


def _area_ratio(
    height: Callable[[int], float], onset: float, onset_height: float, notch: int, samples: int
) -> float | None:
    # Trapezoids on heights above the beat minimum. Systolic: onset → notch. Diastolic: notch → window end,
    # then through the lead-in back to the onset (the same cycle's end, in phase).
    first = math.floor(onset)
    systolic = (onset_height + height(first + 1)) / 2 * (first + 1 - onset)
    for k in range(first + 1, notch):
        systolic += (height(k) + height(k + 1)) / 2
    diastolic = 0.0
    for k in range(notch, samples - 1):
        diastolic += (height(k) + height(k + 1)) / 2
    diastolic += (height(samples - 1) + height(0)) / 2
    for k in range(first):
        diastolic += (height(k) + height(k + 1)) / 2
    diastolic += (height(first) + onset_height) / 2 * (onset - first)
    return diastolic / systolic if systolic > 0 else None


def _diastolic_peak(height: Callable[[int], float], notch: int, samples: int, peak_height: float) -> float:
    # The highest local maximum after the notch; 0 when the beat only decays.
    highest = 0.0
    for k in range(notch + 1, samples - 1):
        if height(k - 1) < height(k) >= height(k + 1):
            highest = max(highest, height(k))
    return highest / peak_height


def shape_features(pulse_shape: PulseShape) -> list[float | None]:
    smoothed = [float(value) for value in pulse_shape.smoothed]
    second = [float(value) for value in pulse_shape.second_derivative]
    waves = pulse_shape.waves
    samples = len(smoothed)
    onset = DSP_CONFIG["dsp14"]["leadFraction"] * samples
    first = math.floor(onset)
    # The 0.5 Hz high-pass of the morphology band pulls the diastolic tail, and a deep notch, below the
    # onset level; the beat's minimum is the lowest point of the cycle, so every height above it is ≥ 0.
    reference = min(smoothed)

    def height(k: int) -> float:
        return smoothed[k] - reference

    onset_height = height(first) + (height(first + 1) - height(first)) * (onset - first)
    peak = systolic_peak_index(smoothed)
    peak_height = height(peak)
    # A flat beat, or one whose highest systolic sample is not after the onset, has no systolic peak.
    has_peak = peak_height > 0 and peak > onset
    notch = _notch_index(smoothed, second, peak) if has_peak else None

    upper_level, lower_level = DSP_CONFIG["diabetesFeatures"]["widthLevels"]

    def width(fraction: float) -> float | None:
        return _peak_width(smoothed, peak, reference + fraction * peak_height) if has_peak else None

    a = 0.0 if waves.a is None else second[waves.a]

    def ratio(wave: int | None) -> float | None:
        # Ratios to the a-wave mean nothing unless it is a positive maximum.
        return second[wave] / a if a > 0 and wave is not None else None

    b, c, d, e = ratio(waves.b), ratio(waves.c), ratio(waves.d), ratio(waves.e)
    return [
        (peak - onset) / samples if has_peak else None,
        width(upper_level),
        width(lower_level),
        None if notch is None else (notch - onset) / samples,
        None if notch is None else height(notch) / peak_height,
        None if notch is None else _diastolic_peak(height, notch, samples, peak_height),
        b,
        c,
        d,
        e,
        None if b is None or c is None or d is None or e is None else b - c - d - e,
        None if notch is None else _area_ratio(height, onset, onset_height, notch, samples),
    ]
