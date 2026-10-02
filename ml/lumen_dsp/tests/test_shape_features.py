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
# on the flat foot, so the onset level is exactly 0.
CORNERS = [(26, 0.0), (77, 1.0), (130, 0.4), (150, 0.5), (230, 0.0)]
WAVES = WaveLabels(a=30, b=40, c=60, d=90, e=130)
WAVE_HEIGHTS = {"a": 2.0, "b": -1.0, "c": 0.5, "d": -0.4, "e": 0.3}


def _piecewise_beat() -> np.ndarray:
    positions, heights = zip(*CORNERS, strict=True)
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


def test_no_e_wave_nulls_the_notch_features():
    features = shape_features(_analytic_shape(WaveLabels(a=30, b=40, c=60, d=90, e=None)))
    assert features[0] is not None
    assert features[6:9] == [-0.5, 0.25, -0.2]
    assert [features[i] for i in [3, 4, 5, 9, 10, 11]] == [None] * 6


def test_no_a_wave_nulls_the_second_derivative_features():
    features = shape_features(_analytic_shape(WaveLabels(a=None, b=None, c=None, d=None, e=None)))
    assert features[6:11] == [None] * 5
    assert all(value is not None for value in features[:3])


def test_non_positive_a_wave_nulls_the_ratios():
    shape = _analytic_shape()
    shape.second_derivative[WAVES.a] = 0.0
    assert shape_features(shape)[6:11] == [None] * 5


def test_e_wave_before_the_peak_is_not_a_notch():
    features = shape_features(_analytic_shape(WaveLabels(a=30, b=40, c=60, d=90, e=70)))
    assert [features[i] for i in [3, 4, 5, 11]] == [None] * 4
    assert features[9] == 0


def test_decay_without_a_second_maximum_has_diastolic_peak_0():
    beat = _piecewise_beat()
    tail = np.arange(131, BEAT_SAMPLES)
    beat[131:] = np.maximum(0, 0.4 - (tail - 130) * 0.004)
    assert shape_features(_analytic_shape(beat=beat))[5] == 0


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


def test_no_e_wave_at_100_bpm():
    features = shape_features(_shape_at(40, 0.6))
    assert [features[i] for i in [3, 4, 5, 9, 10, 11]] == [None] * 6


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
    0.16451583897228794,
    0.22346678237348439,
    0.59140625,
    -0.13966421024181777,
    0,
    -1.4000593677131694,
    0.42584557016188307,
    -0.3535783449542628,
    0.17803459393658358,
    -1.650361186857373,
    -0.45148603546110394,
]
