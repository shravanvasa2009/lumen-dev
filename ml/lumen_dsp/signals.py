import numpy as np

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_lowpass, filter_zero_phase
from lumen_dsp.timebase import Timebase


# DSP-3: primary −R (more blood absorbs more red light, so inverting makes the pulse rise), secondary −G.
def finger_signals(timebase: Timebase) -> tuple[np.ndarray, np.ndarray]:
    return -timebase.r, -timebase.g


# DSP-3: DC level (zero-phase Butterworth low-pass below 0.3 Hz) of a uniformly sampled channel.
def dc_level(channel: np.ndarray, rate_hz: float) -> np.ndarray:
    dsp3 = DSP_CONFIG["dsp3"]
    return filter_zero_phase(butter_lowpass(dsp3["dcOrder"], dsp3["dcCutoffHz"], rate_hz), channel)
