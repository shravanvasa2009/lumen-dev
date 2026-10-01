import math

import numpy as np

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_lowpass, filter_zero_phase
from lumen_dsp.timebase import Timebase


# DSP-3: primary −R (more blood absorbs more red light, so inverting makes the pulse rise), secondary −G.
def finger_signals(timebase: Timebase) -> tuple[np.ndarray, np.ndarray]:
    return -timebase.r, -timebase.g


# DSP-3: z-score of one model-input window; None when all samples are equal (flat: nothing to score).
# Population SD (divide by n) with sums in index order on plain floats, like packages/core.
def z_score_window(window) -> list[float] | None:
    values = [float(value) for value in window]
    if all(value == values[0] for value in values):
        return None
    total = 0.0
    for value in values:
        total += value
    mean = total / len(values)
    squares = 0.0
    for value in values:
        squares += (value - mean) ** 2
    sd = math.sqrt(squares / len(values))
    return [(value - mean) / sd for value in values]


# DSP-3: SQI-Net v1 input (ADR 0023), 256 float32: the 4 s −R window, z-scored; None if all samples equal.
def sqi_model_input(primary) -> np.ndarray | None:
    samples = DSP_CONFIG["dsp3"]["modelWindowS"] * DSP_CONFIG["dsp2"]["modelRateHz"]
    if len(primary) != samples:
        raise ValueError(f"SQI windows need {samples} samples, got {len(primary)}")
    scored = z_score_window(primary)
    return None if scored is None else np.asarray(scored, dtype=np.float32)


# DSP-3: DC level (zero-phase Butterworth low-pass below 0.3 Hz) of a uniformly sampled channel.
def dc_level(channel: np.ndarray, rate_hz: float) -> np.ndarray:
    dsp3 = DSP_CONFIG["dsp3"]
    return filter_zero_phase(butter_lowpass(dsp3["dcOrder"], dsp3["dcCutoffHz"], rate_hz), channel)
