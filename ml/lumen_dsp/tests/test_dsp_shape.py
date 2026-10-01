import math

import numpy as np
import pytest

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_bandpass, filter_zero_phase
from lumen_dsp.shape import ensemble_beat

DSP14 = DSP_CONFIG["dsp14"]
RATE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]
BEAT_SAMPLES = DSP14["beatSamples"]
LEAD = DSP14["leadFraction"]


def synthetic_ppg(peaks_s, seconds, dicrotic_ratio=0.3, dicrotic_sigma_s=0.06):
    # Same model as packages/core/test/pulse-shape.test.ts: rise σ 40 ms, fall σ 90 ms, dicrotic +300 ms.
    t_s = np.arange(round(seconds * RATE_HZ)) / RATE_HZ
    wave = np.zeros_like(t_s)
    for peak_s in peaks_s:
        dt = t_s - peak_s
        wave += np.exp(-0.5 * (dt / np.where(dt < 0, 0.04, 0.09)) ** 2)
        wave += dicrotic_ratio * np.exp(-0.5 * ((dt - 0.3) / dicrotic_sigma_s) ** 2)
    return wave


def regular_peaks(count, rr_s):
    return [1 + i * rr_s for i in range(count)]


def onsets_of(peaks_s):
    return [(peak_s - 0.08) * RATE_HZ for peak_s in peaks_s]


def morphology_band(wave):
    order, (low, high) = DSP_CONFIG["dsp6"]["morphologyOrder"], DSP_CONFIG["dsp6"]["morphologyBandHz"]
    return filter_zero_phase(butter_bandpass(order, low, high, RATE_HZ), wave)


def reference_beat(signal, onset, next_onset):
    period = next_onset - onset
    raw = []
    for k in range(BEAT_SAMPLES):
        x = onset + (k / BEAT_SAMPLES - LEAD) * period
        j = math.floor(x)
        raw.append(signal[j] + (signal[j + 1] - signal[j]) * (x - j))
    low, high = min(raw), max(raw)
    return [(value - low) / (high - low) for value in raw]


PEAKS = regular_peaks(30, 0.83)
WAVE = synthetic_ppg(PEAKS, 27)
ONSETS = onsets_of(PEAKS)


def test_averages_normalized_onset_aligned_beats():
    shape = ensemble_beat(WAVE, ONSETS, [True] * 30, 60)
    assert shape.beats_used == 29
    assert shape.beat.shape == (BEAT_SAMPLES,)
    beats = np.array([reference_beat(WAVE, ONSETS[i], ONSETS[i + 1]) for i in range(29)])
    assert np.max(np.abs(shape.beat - beats.mean(axis=0))) < 1e-14


def test_is_unchanged_by_gain_and_offset():
    reference = ensemble_beat(WAVE, ONSETS, [True] * 30, 60)
    shifted = ensemble_beat(0.7 + 1.3 * WAVE, ONSETS, [True] * 30, 60)
    assert np.max(np.abs(shifted.beat - reference.beat)) < 1e-12


def test_uses_a_beat_only_when_it_and_the_next_are_normal():
    normal = [True] * 30
    normal[10] = False
    assert ensemble_beat(WAVE, ONSETS, normal, 60).beats_used == 27


def test_needs_20_usable_normal_beats():
    peaks_21 = regular_peaks(21, 0.83)
    assert ensemble_beat(synthetic_ppg(peaks_21, 20), onsets_of(peaks_21), [True] * 21, 60).beats_used == 20
    peaks_20 = regular_peaks(20, 0.83)
    assert ensemble_beat(synthetic_ppg(peaks_20, 20), onsets_of(peaks_20), [True] * 20, 60) is None


def test_requires_a_configured_capture_rate_of_60_fps():
    assert ensemble_beat(WAVE, ONSETS, [True] * 30, 60) is not None
    assert ensemble_beat(WAVE, ONSETS, [True] * 30, 30) is None
    assert ensemble_beat(WAVE, ONSETS, [True] * 30, DSP14["minFps"] - 1) is None


def test_drops_a_beat_longer_than_1_5_median_periods():
    # Removing onset 15 merges beats 14 and 15 into one double-length "beat" flagged normal.
    missed = [onset for i, onset in enumerate(ONSETS) if i != 15]
    assert ensemble_beat(WAVE, missed, [True] * 29, 60).beats_used == 27


def test_two_alternating_shapes_average_to_their_midpoint():
    # Whole-sample windows (onset = start + 25.6), rising and falling ramps alternating: 0.5 everywhere.
    signal = [k / 255 if beat % 2 == 0 else 1 - k / 255 for beat in range(21) for k in range(256)]
    onsets = [beat * 256 + 25.6 for beat in range(21)]
    shape = ensemble_beat(signal, onsets, [True] * 21, 60)
    assert shape.beats_used == 20
    assert np.max(np.abs(shape.beat - 0.5)) < 1e-12


def test_skips_beats_whose_window_runs_off_the_signal():
    early = [0.13, *PEAKS[1:]]
    assert ensemble_beat(synthetic_ppg(early, 27), onsets_of(early), [True] * 30, 60).beats_used == 28


def test_rejects_misaligned_inputs():
    with pytest.raises(ValueError):
        ensemble_beat(WAVE, ONSETS, [True] * 29, 60)


def labels(count, rr_s, dicrotic_ratio=0.3, dicrotic_sigma_s=0.06):
    peaks = regular_peaks(count, rr_s)
    wave = synthetic_ppg(peaks, count * rr_s + 2, dicrotic_ratio, dicrotic_sigma_s)
    return ensemble_beat(morphology_band(wave), onsets_of(peaks), [True] * count, 60)


@pytest.mark.parametrize(
    ("count", "rr_s", "expected"),
    [
        # Same answers as packages/core/test/pulse-shape.test.ts on the same synthetic signals.
        (30, 0.83, (24, 49, 104, 144, 177)),
        (25, 1.1, (25, 43, 85, 115, 140)),
        (40, 0.6, (24, 58, 135, 189, None)),
    ],
)
def test_wave_labels(count, rr_s, expected):
    waves = labels(count, rr_s).waves
    assert (waves.a, waves.b, waves.c, waves.d, waves.e) == expected


def test_b_is_the_first_minimum_after_a_even_when_d_is_deeper():
    shape = labels(30, 0.83, 0.8, 0.03)
    waves = shape.waves
    assert shape.second_derivative[waves.d] < shape.second_derivative[waves.b]
    assert (waves.a, waves.b, waves.c, waves.d, waves.e) == (24, 49, 120, 143, 165)
