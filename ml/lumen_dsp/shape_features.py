import math
from collections.abc import Callable, Sequence

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.shape import PulseShape, systolic_peak_index

# diabetes-net's 12 shape features (§11.4, ML-6), mirroring packages/core/src/shape-features.ts with the
# same loops in the same order. The DSP-14 window is exactly one period: sample k sits at
# onset + (k / 256 − lead fraction) × period, so the onset is at 25.6 and the lead-in (samples 0–25) is the
# end of the previous period. Times are fractions of the period; amplitudes are measured on the smoothed
# beat above the onset level, relative to the systolic peak. Undefined features are None; the model, not
# this module, fills them with its training median.


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


def _area_ratio(height: Callable[[int], float], onset: float, notch: int, samples: int) -> float | None:
    # Trapezoids on heights above the onset level (0 at the onset). Systolic: onset → notch. Diastolic:
    # notch → window end, then through the lead-in back to the onset (the same cycle's end, in phase).
    first = math.floor(onset)
    systolic = height(first + 1) / 2 * (first + 1 - onset)
    for k in range(first + 1, notch):
        systolic += (height(k) + height(k + 1)) / 2
    diastolic = 0.0
    for k in range(notch, samples - 1):
        diastolic += (height(k) + height(k + 1)) / 2
    diastolic += (height(samples - 1) + height(0)) / 2
    for k in range(first):
        diastolic += (height(k) + height(k + 1)) / 2
    diastolic += height(first) / 2 * (onset - first)
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
    onset_level = smoothed[first] + (smoothed[first + 1] - smoothed[first]) * (onset - first)

    def height(k: int) -> float:
        return smoothed[k] - onset_level

    peak = systolic_peak_index(smoothed)
    peak_height = height(peak)
    # A flat beat, or one whose highest systolic sample is not after the onset, has no systolic peak.
    has_peak = peak_height > 0 and peak > onset
    # The notch is the e-wave; one before the systolic peak cannot be the dicrotic notch.
    notch = waves.e if has_peak and waves.e is not None and waves.e > peak else None

    upper_level, lower_level = DSP_CONFIG["diabetesFeatures"]["widthLevels"]

    def width(fraction: float) -> float | None:
        return _peak_width(smoothed, peak, onset_level + fraction * peak_height) if has_peak else None

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
        None if notch is None else _area_ratio(height, onset, notch, samples),
    ]
