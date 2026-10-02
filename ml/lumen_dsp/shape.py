import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
from scipy import signal

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.median import median

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


def _is_local_max(y: np.ndarray, i: int) -> bool:
    return y[i - 1] < y[i] >= y[i + 1]


def _is_local_min(y: np.ndarray, i: int) -> bool:
    return y[i - 1] > y[i] <= y[i + 1]


def _label_waves(smoothed: np.ndarray, second: np.ndarray, span_end: int) -> WaveLabels:
    # a: the largest local maximum of the second derivative before the systolic peak; then b, c, d, e: the
    # first local minimum, maximum, minimum, maximum after it, in the spec's order. All within the systolic
    # span; a wave that is not found leaves it and every later wave None.
    systolic_peak = 0
    for k in range(1, span_end):
        if smoothed[k] > smoothed[systolic_peak]:
            systolic_peak = k
    a = None
    for i in range(1, systolic_peak):
        if _is_local_max(second, i) and (a is None or second[i] > second[a]):
            a = i
    if a is None:
        return WaveLabels(None, None, None, None, None)

    def following(start: int, is_wave) -> int | None:
        return next((i for i in range(start + 1, span_end - 1) if is_wave(second, i)), None)

    b = following(a, _is_local_min)
    c = None if b is None else following(b, _is_local_max)
    d = None if c is None else following(c, _is_local_min)
    e = None if d is None else following(d, _is_local_max)
    return WaveLabels(a, b, c, d, e)


def ensemble_beat(
    morphology_256: Sequence[float], onsets: Sequence[float], normal: Sequence[bool], capture_fps: float
) -> PulseShape | None:
    # DSP-14: ensemble beat of ≥ 20 normal beats of the 0.5–8 Hz morphology band at 256 Hz, with a–e labels.
    if len(onsets) != len(normal):
        raise ValueError(f"{len(onsets)} onsets but {len(normal)} normal-beat flags")
    dsp14 = DSP_CONFIG["dsp14"]
    samples, lead = dsp14["beatSamples"], dsp14["leadFraction"]
    # The configured capture rate (capture header fps, CaptureConfig.targetFps), not a measured one: a
    # nominal 60 fps session measures 59.9x.
    if capture_fps < dsp14["minFps"]:
        return None
    values = [float(value) for value in morphology_256]
    starts = [float(onset) for onset in onsets]

    # A beat runs from its onset to the next one, so both beats must be normal.
    candidates = [
        i for i in range(len(starts) - 1) if normal[i] and normal[i + 1] and starts[i + 1] - starts[i] > 0
    ]
    if len(candidates) < dsp14["minNormalBeats"]:
        return None
    longest_period = dsp14["maxPeriodRatio"] * median([starts[i + 1] - starts[i] for i in candidates])

    sums = [0.0] * samples
    beats_used = 0
    for i in candidates:
        onset = starts[i]
        period = starts[i + 1] - onset
        first = onset - lead * period
        last = onset + ((samples - 1) / samples - lead) * period
        if period > longest_period or first < 0 or math.floor(last) + 1 > len(values) - 1:
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
    window, order = dsp14["savgolWindow"], dsp14["savgolOrder"]
    smoothed = signal.savgol_filter(beat, window, order, deriv=0, mode="interp")
    second = signal.savgol_filter(beat, window, order, deriv=2, mode="interp")
    span_end = math.floor((lead + dsp14["systoleFraction"]) * samples + 0.5)
    return PulseShape(beat, smoothed, second, _label_waves(smoothed, second, span_end), beats_used)
