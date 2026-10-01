import numpy as np
from scipy import signal

# scipy is the reference that packages/core/src/filters.ts mirrors (ADR 0018); "order" is butter's N.


def _check_design(order: int, edges_hz: list[float], rate_hz: float) -> None:
    # packages/core designs even orders only (an odd order adds a real pole it does not pair).
    if order < 2 or order % 2 != 0:
        raise ValueError(f"order must be an even integer >= 2, got {order}")
    for edge_hz in edges_hz:
        if not 0 < edge_hz < rate_hz / 2:
            raise ValueError(f"edge {edge_hz} Hz must lie in (0, {rate_hz / 2}) Hz")


# DSP-6
def butter_bandpass(order: int, low_hz: float, high_hz: float, rate_hz: float) -> np.ndarray:
    _check_design(order, [low_hz, high_hz], rate_hz)
    return signal.butter(order, [low_hz, high_hz], btype="band", output="sos", fs=rate_hz)


# DSP-3, DSP-6
def butter_lowpass(order: int, cutoff_hz: float, rate_hz: float) -> np.ndarray:
    _check_design(order, [cutoff_hz], rate_hz)
    return signal.butter(order, cutoff_hz, output="sos", fs=rate_hz)


# DSP-6: forward-backward with scipy's default odd padding and sosfilt_zi initial conditions.
def filter_zero_phase(sos: np.ndarray, samples: np.ndarray) -> np.ndarray:
    return signal.sosfiltfilt(sos, samples)


# DSP-6: causal biquads for the live display, like packages/core CausalFilter.
class CausalFilter:
    def __init__(self, sos: np.ndarray):
        self._sos = sos
        self._state: np.ndarray | None = None

    def filter(self, batch: np.ndarray) -> np.ndarray:
        batch = np.asarray(batch, dtype=np.float64)
        if len(batch) == 0:
            return batch
        # The steady state comes from the first sample ever filtered, so it cannot mismatch the signal.
        if self._state is None:
            self._state = signal.sosfilt_zi(self._sos) * batch[0]
        filtered, self._state = signal.sosfilt(self._sos, batch, zi=self._state)
        return filtered
