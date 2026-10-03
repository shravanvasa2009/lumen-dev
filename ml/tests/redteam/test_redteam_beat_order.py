import math

from lumen_dsp.beats import detect_beats, elgendi_peaks, elgendi_windows
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.golden import morphology_segment

# Red team (§16) for order D.C_TASK-rhythm-windows-negative-interval, mirroring
# packages/core/test/redteam/beat-order.test.ts on the inputs both sides can build without the camera path.
# On 3 of 7,137 VitalDB segments DSP-7 reported two peaks in reversed time order: a 64 Hz candidate whose
# ±1-sample refinement window lay on a slope of the 256 Hz band, where the parabola through the window
# maximum has its vertex far outside the window. Each test failed when it was written.

MODEL_HZ = DSP_CONFIG["dsp2"]["modelRateHz"]
SHAPE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]
# DSP-7 refinement stays within half of W1 of its 64 Hz candidate (ADR 0068).
CLIMB_HALF = (elgendi_windows(SHAPE_HZ)[0] - 1) // 2
BPM = 42


def _is_refined_peak(values, index: float, centre: float) -> bool:
    # Copied from test_dsp7_refinement.py _is_refined_peak, for one candidate, so the two red-team files stay
    # independent. A refined peak is a local maximum of the band moved at most half a sample by the parabola,
    # or exactly a sample the climb had to stop on: a segment end, or the climb limit with the band rising.
    last = len(values) - 1

    def is_local_maximum(k: int) -> bool:
        return 0 < k < last and values[k] >= values[k - 1] and values[k] >= values[k + 1]

    return abs(index - centre) <= CLIMB_HALF + 0.5 and any(
        (abs(index - sample) <= 0.5 and is_local_maximum(sample))
        or (index == sample and (sample in (0, last) or abs(sample - centre) == CLIMB_HALF))
        for sample in (math.floor(index), math.ceil(index))
    )


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


def test_refines_every_candidate_of_the_slow_pulse_to_a_peak_of_the_band_near_it_in_time_order():
    seconds = 20
    volume = _slow_pulse_volume(_beat_times(60 / BPM, seconds))

    def sampled(rate_hz: int):
        return morphology_segment([volume(k / rate_hz) for k in range(seconds * rate_hz)], rate_hz)

    model, shape = sampled(MODEL_HZ), sampled(SHAPE_HZ)
    peaks_s = [beat.peak_s for beat in detect_beats(model, shape)]
    centres = [peak / MODEL_HZ * SHAPE_HZ for peak in elgendi_peaks(model.values, MODEL_HZ)]
    assert len(peaks_s) == len(centres)
    for peak_s, centre in zip(peaks_s, centres, strict=True):
        assert _is_refined_peak(shape.values, peak_s * SHAPE_HZ, centre)
    assert all(later > earlier for earlier, later in zip(peaks_s[:-1], peaks_s[1:], strict=True))
