import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy import signal

from lumen_dsp.config import DSP_CONFIG

# DSP-14 (ADR 0030), mirroring packages/core/src/pulse-shape.ts. The averaged beat is diabetes-net's
# [1, 1, 256] input, so it is built with the same operations in the same order on plain floats.


@dataclass(frozen=True)
class WaveLabels:
    # Sample indices into the 256-sample beat; None when that wave (or an earlier one) is not found.
    a: int | None
    b: int | None
    c: int | None
    d: int | None
    e: int | None


@dataclass(frozen=True)
class PulseShape:
    beat: np.ndarray  # ensemble average of min–max normalized beats: the model input
    smoothed: np.ndarray
    second_derivative: np.ndarray  # per sample²; only signs and extrema are used
    waves: WaveLabels
    beats_used: int


def savgol(values: np.ndarray, deriv: int) -> np.ndarray:
    # DSP-14: Savitzky–Golay, window 9, order 3, scipy's default edge mode 'interp'.
    dsp14 = DSP_CONFIG["dsp14"]
    return signal.savgol_filter(
        values, dsp14["savgolWindow"], dsp14["savgolOrder"], deriv=deriv, mode="interp"
    )


def _is_local_max(y: np.ndarray, i: int) -> bool:
    return y[i - 1] < y[i] >= y[i + 1]


def _is_local_min(y: np.ndarray, i: int) -> bool:
    return y[i - 1] > y[i] <= y[i + 1]


def _label_waves(smoothed: np.ndarray, second: np.ndarray, span_end: int) -> WaveLabels:
    # a: the largest local maximum of the second derivative before the systolic peak; b: the lowest point
    # after a; then c, d, e: the first local maximum, minimum, maximum after that. All within the systolic
    # span; a wave that is not found leaves it and every later wave None.
    systolic_peak = 0
    for k in range(1, span_end):
        if smoothed[k] > smoothed[systolic_peak]:
            systolic_peak = k
    a = None
    for i in range(1, systolic_peak):
        if _is_local_max(second, i) and (a is None or second[i] > second[a]):
            a = i
    if a is None or a + 1 >= span_end:
        return WaveLabels(a, None, None, None, None)
    b = a + 1
    for i in range(b + 1, span_end):
        if second[i] < second[b]:
            b = i

    def following(start: int, is_wave) -> int | None:
        return next((i for i in range(start + 1, span_end - 1) if is_wave(second, i)), None)

    c = following(b, _is_local_max)
    d = None if c is None else following(c, _is_local_min)
    e = None if d is None else following(d, _is_local_max)
    return WaveLabels(a, b, c, d, e)


def ensemble_beat(
    signal_256: Sequence[float], onsets: Sequence[float], normal: Sequence[bool], effective_fps: float
) -> PulseShape | None:
    # DSP-14: ensemble beat of ≥ 20 normal beats aligned on onsets, with a–e labels; None if not enough.
    if len(onsets) != len(normal):
        raise ValueError(f"{len(onsets)} onsets but {len(normal)} normal-beat flags")
    dsp14 = DSP_CONFIG["dsp14"]
    samples, lead = dsp14["beatSamples"], dsp14["leadFraction"]
    if effective_fps < dsp14["minFps"]:
        return None
    values = [float(value) for value in signal_256]

    sums = [0.0] * samples
    beats_used = 0
    for i in range(len(onsets) - 1):
        # A beat runs from its onset to the next one, so both beats must be normal.
        if not (normal[i] and normal[i + 1]):
            continue
        onset = float(onsets[i])
        period = float(onsets[i + 1]) - onset
        first = onset - lead * period
        last = onset + ((samples - 1) / samples - lead) * period
        if not period > 0 or first < 0 or math.floor(last) + 1 > len(values) - 1:
            continue
        raw = []
        for k in range(samples):
            x = onset + (k / samples - lead) * period
            j = math.floor(x)
            raw.append(values[j] + (values[j + 1] - values[j]) * (x - j))
        low, high = min(raw), max(raw)
        if high == low:
            continue
        for k in range(samples):
            sums[k] += (raw[k] - low) / (high - low)
        beats_used += 1
    if beats_used < dsp14["minNormalBeats"]:
        return None

    beat = np.array([total / beats_used for total in sums])
    smoothed = savgol(beat, 0)
    second = savgol(beat, 2)
    span_end = math.floor((lead + dsp14["systoleFraction"]) * samples + 0.5)
    return PulseShape(beat, smoothed, second, _label_waves(smoothed, second, span_end), beats_used)
