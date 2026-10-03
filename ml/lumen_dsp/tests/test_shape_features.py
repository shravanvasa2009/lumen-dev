import math

import numpy as np
import pytest

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_bandpass, filter_zero_phase
from lumen_dsp.shape import PulseShape, WaveLabels, ensemble_beat
from lumen_dsp.shape_features import shape_features

# Mirrors packages/core/test/shape-features.test.ts: the same analytic corners and hand-computed answers,
# and the same pinned values on the same synthetic PPG (ML-6 parity).

BEAT_SAMPLES = DSP_CONFIG["dsp14"]["beatSamples"]
RATE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]

# Piecewise-linear beat through these (sample, height) corners, flat outside them; the onset at 25.6 sits
# on the flat foot, so the onset level and the beat's minimum are exactly 0.
CORNERS = [(26, 0.0), (77, 1.0), (130, 0.4), (150, 0.5), (230, 0.0)]
WAVES = WaveLabels(a=30, b=40, c=60, d=90, e=130)
WAVE_HEIGHTS = {"a": 2.0, "b": -1.0, "c": 0.5, "d": -0.4, "e": 0.3}


def _piecewise_beat(corners=CORNERS) -> np.ndarray:
    # np.interp holds the end values outside the corners, as the TS helper does.
    positions, heights = zip(*corners, strict=True)
    return np.interp(np.arange(BEAT_SAMPLES, dtype=float), positions, heights)


def _analytic_shape(waves: WaveLabels = WAVES, beat: np.ndarray | None = None) -> PulseShape:
    if beat is None:
        beat = _piecewise_beat()
    second = np.zeros(BEAT_SAMPLES)
    for name, wave_height in WAVE_HEIGHTS.items():
        second[getattr(WAVES, name)] = wave_height
    return PulseShape(beat=beat, smoothed=beat, second_derivative=second, waves=waves, beats_used=20)


def test_analytic_beat_hand_computed():
    features = shape_features(_analytic_shape())
    assert len(features) == 12
    assert features[0] == pytest.approx((77 - 25.6) / 256, abs=1e-12)
    assert features[1] == pytest.approx((77 + 53 * 0.5 / 0.6 - 51.5) / 256, abs=1e-12)
    assert features[2] == pytest.approx((190 - 38.75) / 256, abs=1e-12)
    assert features[3] == pytest.approx((130 - 25.6) / 256, abs=1e-12)
    assert features[4] == pytest.approx(0.4, abs=1e-12)
    assert features[5] == pytest.approx(0.5, abs=1e-12)
    assert features[6:10] == [-0.5, 0.25, -0.2, 0.15]
    assert features[10] == pytest.approx((-1 - 0.5 + 0.4 - 0.3) / 2, abs=1e-14)
    # Systolic 51 × 1/2 + 53 × 0.7 = 62.6; diastolic 20 × 0.45 + 80 × 0.25 = 29 (sample units).
    assert features[11] == pytest.approx(29 / 62.6, abs=1e-12)


def test_gain_and_offset_do_not_change_amplitude_features():
    features = shape_features(_analytic_shape())
    moved = shape_features(_analytic_shape(beat=3 + 0.5 * _piecewise_beat()))
    for i in [0, 1, 2, 3, 4, 5, 11]:
        assert moved[i] == pytest.approx(features[i], abs=1e-12)


def test_lead_in_counts_in_the_diastolic_area():
    beat = _piecewise_beat()
    beat[:21] = 0.2
    features = shape_features(_analytic_shape(beat=beat))
    assert features[11] == pytest.approx(33.2 / 62.6, abs=1e-12)
    assert features[5] == pytest.approx(0.5, abs=1e-12)


def test_amplitudes_are_above_the_beat_minimum_when_the_tail_falls_below_the_onset():
    # Tail falls to -0.1 at 230 and stays there; the lead-in stays at 0. Heights are value + 0.1, peak 1.1.
    features = shape_features(_analytic_shape(beat=_piecewise_beat([*CORNERS[:4], (230, -0.1)])))
    assert features[3] == pytest.approx((130 - 25.6) / 256, abs=1e-12)
    assert features[4] == pytest.approx(0.5 / 1.1, abs=1e-12)
    assert features[5] == pytest.approx(0.6 / 1.1, abs=1e-12)
    # 50% level 0.45: up at 26 + 51 × 0.45, down at 77 + 53 × 0.55/0.6.
    assert features[1] == pytest.approx((77 + 53 * 0.55 / 0.6 - (26 + 51 * 0.45)) / 256, abs=1e-12)
    # 25% level 0.175: up at 26 + 51 × 0.175, down on the last fall at 150 + 80 × 0.325/0.6.
    assert features[2] == pytest.approx((150 + 80 * 0.325 / 0.6 - (26 + 51 * 0.175)) / 256, abs=1e-12)
    # Systolic 0.4 × 0.1 + 51 × 0.6 + 53 × 0.8 = 73.04; diastolic 20 × 0.55 + 80 × 0.3 + 0.05 + 2.5 + 0.06
    # = 37.61 (the TS test spells out each term).
    assert features[11] == pytest.approx(37.61 / 73.04, abs=1e-12)


def test_no_e_wave_nulls_e_over_a_but_not_the_notch():
    full = shape_features(_analytic_shape())
    features = shape_features(_analytic_shape(WaveLabels(a=30, b=40, c=60, d=90, e=None)))
    assert features[6:9] == [-0.5, 0.25, -0.2]
    assert [features[9], features[10]] == [None, None]
    assert [features[i] for i in [3, 4, 5, 11]] == [full[i] for i in [3, 4, 5, 11]]


def test_no_a_wave_nulls_the_second_derivative_features():
    features = shape_features(_analytic_shape(WaveLabels(a=None, b=None, c=None, d=None, e=None)))
    assert features[6:11] == [None] * 5
    assert all(value is not None for value in features[:3])


def test_non_positive_a_wave_nulls_the_ratios():
    shape = _analytic_shape()
    shape.second_derivative[WAVES.a] = 0.0
    assert shape_features(shape)[6:11] == [None] * 5


def test_the_notch_does_not_follow_the_e_wave_label():
    full = shape_features(_analytic_shape())
    features = shape_features(_analytic_shape(WaveLabels(a=30, b=40, c=60, d=90, e=70)))
    assert [features[i] for i in [3, 4, 5, 11]] == [full[i] for i in [3, 4, 5, 11]]
    assert features[9] == 0


def _decay_beat() -> np.ndarray:
    # From the notch corner (0.4 at 130) down to 0 at 230 without a second maximum.
    beat = _piecewise_beat()
    tail = np.arange(131, BEAT_SAMPLES)
    beat[131:] = np.maximum(0, 0.4 - (tail - 130) * 0.004)
    return beat


def test_without_a_visible_notch_it_is_the_first_upward_bend():
    # The only positive second-derivative maximum after the peak is the 0.3 at 130.
    features = shape_features(_analytic_shape(beat=_decay_beat()))
    assert features[3] == pytest.approx((130 - 25.6) / 256, abs=1e-12)
    assert features[4] == pytest.approx(0.4, abs=1e-12)
    assert features[5] == 0
    assert features[11] == pytest.approx(20 / 62.6, abs=1e-12)  # 100 × 0.4/2 over 62.6


def test_a_minimum_that_no_maximum_follows_is_not_the_notch():
    # Minimum at 180 (in the span) with no diastolic peak after it: the notch is the bend at 130.
    features = shape_features(_analytic_shape(beat=_piecewise_beat([*CORNERS[:3], (180, -0.1)])))
    assert features[3] == pytest.approx((130 - 25.6) / 256, abs=1e-12)
    assert features[4] == pytest.approx(0.5 / 1.1, abs=1e-12)
    assert features[5] == 0


def test_no_visible_notch_and_no_upward_bend_nulls_the_notch_features():
    # Second derivative 0 at 130: its only maximum after the peak is the 0 at 91, not positive.
    shape = _analytic_shape(beat=_decay_beat())
    shape.second_derivative[130] = 0.0
    features = shape_features(shape)
    assert [features[i] for i in [3, 4, 5, 11]] == [None] * 4
    assert features[9] == 0


def test_the_notch_is_not_searched_past_the_systolic_span():
    # The only minimum after the peak is at 210 (span end 205), followed by a maximum at 225.
    shape = _analytic_shape(beat=_piecewise_beat([(26, 0.0), (77, 1.0), (210, 0.2), (225, 0.3), (240, 0.0)]))
    shape.second_derivative[130] = 0.0
    features = shape_features(shape)
    assert [features[i] for i in [3, 4, 5, 11]] == [None] * 4


def test_flat_beat_nulls_the_amplitude_features():
    features = shape_features(_analytic_shape(beat=np.full(BEAT_SAMPLES, 0.5)))
    assert features[:6] + [features[11]] == [None] * 7


def _synthetic_band(count: int, rr_s: float) -> tuple[np.ndarray, list[float]]:
    # The pulse-shape model: rise σ 40 ms, fall σ 90 ms, dicrotic wave +300 ms, morphology band.
    peaks_s = [1 + i * rr_s for i in range(count)]
    wave = []
    for k in range(round((count * rr_s + 2) * RATE_HZ)):
        total = 0.0
        for peak_s in peaks_s:
            dt = k / RATE_HZ - peak_s
            systolic = math.exp(-0.5 * (dt / (0.04 if dt < 0 else 0.09)) ** 2)
            total += systolic + 0.3 * math.exp(-0.5 * ((dt - 0.3) / 0.06) ** 2)
        wave.append(total)
    dsp6 = DSP_CONFIG["dsp6"]
    band = filter_zero_phase(
        butter_bandpass(dsp6["morphologyOrder"], *dsp6["morphologyBandHz"], RATE_HZ), wave
    )
    return np.asarray(band), [(peak_s - 0.08) * RATE_HZ for peak_s in peaks_s]


def _shape_at(count: int, rr_s: float) -> PulseShape:
    band, onsets = _synthetic_band(count, rr_s)
    shape = ensemble_beat(band, onsets, [True] * count, 60)
    assert shape is not None
    return shape


def test_pinned_features_at_72_bpm():
    assert shape_features(_shape_at(30, 0.83)) == pytest.approx(EXPECTED_72_BPM, abs=1e-9)


def test_physiologically_plausible_at_72_bpm():
    features = shape_features(_shape_at(30, 0.83))
    assert features[3] > features[0]
    assert features[4] > 0
    assert features[5] > features[4]  # the model has a dicrotic wave
    assert features[11] > 0


def test_no_e_wave_at_100_bpm_but_a_notch():
    features = shape_features(_shape_at(40, 0.6))
    assert [features[9], features[10]] == [None, None]
    assert features[4] > 0
    assert features[11] > 0


def test_rise_time_reaches_the_band_passed_peak_at_100_bpm():
    # The zero-phase 0.5–8 Hz band delays this asymmetric pulse's peak by about 15 ms past the model's
    # 80 ms, so the reference is the band signal's own peak in a middle beat.
    band, onsets = _synthetic_band(40, 0.6)
    onset, next_onset = onsets[20], onsets[21]
    peak = math.ceil(onset)
    for k in range(peak, math.ceil(next_onset)):
        if band[k] > band[peak]:
            peak = k
    rise = shape_features(_shape_at(40, 0.6))[0]
    assert rise == pytest.approx((peak - onset) / (next_onset - onset), abs=0.005)


EXPECTED_72_BPM = [
    0.11484375,
    0.18982567830283364,
    0.2743389472115185,
    0.3375,
    0.17173834943772825,
    0.31015381425592337,
    -1.400059367713167,
    0.4258455701618882,
    -0.35357834495426554,
    0.17803459393658908,
    -1.6503611868573786,
    0.33386818502684,
]
