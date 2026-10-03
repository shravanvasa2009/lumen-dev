import math

import pytest

from lumen_dsp.beats import detect_beats, elgendi_peaks, js_round
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.golden import morphology_segment
from lumen_dsp.rhythm import rhythm_windows

# Red team (§16) for order D.C_TASK-rhythm-windows-negative-interval, mirroring
# packages/core/test/redteam/beat-order.test.ts on the inputs both sides can build without the camera path.
# On 3 of 7,137 VitalDB segments DSP-7 reported two peaks in reversed time order: a 64 Hz candidate whose
# ±1-sample refinement window lay on a slope of the 256 Hz band, where the parabola through the window
# maximum has its vertex far outside the window. Each test failed when it was written.

MODEL_HZ = DSP_CONFIG["dsp2"]["modelRateHz"]
SHAPE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]
REFINE_HALF = js_round(DSP_CONFIG["dsp7"]["refineHalfWindowS"] * SHAPE_HZ)
BPM = 42


def _gaussian(x: float, centre: float, width: float) -> float:
    return math.exp(-0.5 * ((x - centre) / width) ** 2)


def _late_wave(x: float) -> float:
    if x < -0.08 or x > 0.45:
        return 0.0
    return 1 + x / 0.08 if x < 0 else 1 - x / 0.45


def _beat_times(period_s: float, until_s: float) -> list[float]:
    # As attacks.ts beatTimes: from −2 s to beyond until_s, by repeated addition.
    times, t_s = [], -2.0
    while t_s < until_s + 2:
        times.append(t_s)
        t_s += period_s
    return times


# 42 bpm: a narrow systolic wave (σ 40 ms, 0.12 s after the foot) and a broad late wave 0.45× as high that
# rises for 80 ms to 0.38 s, then falls in a straight line for 0.45 s (as the TS file).
def _slow_pulse_volume(beats_s: list[float]):
    def volume(t_s: float) -> float:
        total = 0.0
        for beat_s in beats_s:
            total += _gaussian(t_s - beat_s, 0.12, 0.04) + 0.45 * _late_wave(t_s - beat_s - 0.38)
        return total

    return volume


def test_refines_every_candidate_of_the_slow_pulse_within_its_window_in_time_order():
    seconds = 20
    volume = _slow_pulse_volume(_beat_times(60 / BPM, seconds))

    def sampled(rate_hz: int):
        return morphology_segment([volume(k / rate_hz) for k in range(seconds * rate_hz)], rate_hz)

    model = sampled(MODEL_HZ)
    peaks_s = [beat.peak_s for beat in detect_beats(model, sampled(SHAPE_HZ))]
    centres = [peak / MODEL_HZ * SHAPE_HZ for peak in elgendi_peaks(model.values, MODEL_HZ)]
    assert len(peaks_s) == len(centres)
    for peak_s, centre in zip(peaks_s, centres, strict=True):
        assert abs(peak_s * SHAPE_HZ - centre) <= REFINE_HALF + 0.5
    assert all(later > earlier for earlier, later in zip(peaks_s[:-1], peaks_s[1:], strict=True))


@pytest.mark.parametrize("bad", [0.0, -0.29])
def test_rhythm_windows_end_the_run_at_a_non_positive_interval_instead_of_raising(bad):
    intervals_s = [0.8] * 80
    intervals_s[40] = bad
    windows = rhythm_windows(intervals_s, [False] * 80, [False] * 81)
    assert [window.start_interval for window in windows] == [0, 41]
    assert all(bad not in window.intervals_s for window in windows)
