import math

import numpy as np

from lumen_dsp.beats import detect_beats, elgendi_peaks, elgendi_windows, js_round, upstroke
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.golden import morphology_segment, ppg_wave, regular_beats
from lumen_dsp.resample import ResampledSegment
from lumen_dsp.tests.synthetic import park_miller_uniforms

MODEL_HZ = DSP_CONFIG["dsp2"]["modelRateHz"]
SHAPE_HZ = DSP_CONFIG["dsp2"]["shapeRateHz"]


def detect(beats, dicrotic_ratio, seconds):
    return detect_beats(
        morphology_segment(ppg_wave(beats, dicrotic_ratio, seconds, MODEL_HZ), MODEL_HZ),
        morphology_segment(ppg_wave(beats, dicrotic_ratio, seconds, SHAPE_HZ), SHAPE_HZ),
    )


def nearest_errors(detected, beats):
    return [min(abs(beat.peak_s - peak_s) for beat in detected) for peak_s, _ in beats]


def test_js_round_rounds_halves_up_like_math_round():
    assert [js_round(x) for x in (2.5, -2.5, 0.49999999999999994, 102.4, 51.2, 25.6)] == [
        3,
        -2,
        0,
        102,
        51,
        26,
    ]


def test_windows_round_111_and_667_ms_to_the_nearest_odd_sample_count():
    assert elgendi_windows(64) == (7, 43)
    assert elgendi_windows(256) == (29, 171)


def test_peaks_match_a_direct_transcription_of_the_published_rules_on_noise():
    uniforms = park_miller_uniforms(2000, seed=99)
    noise = [(u - 0.5) * (1 + math.sin(n / 40)) for n, u in enumerate(uniforms)]
    w1, w2 = elgendi_windows(64)
    squared = [value * value if value > 0 else 0.0 for value in noise]

    def centered_mean(n, width):
        total = 0.0
        for k in range(n - (width - 1) // 2, n + (width - 1) // 2 + 1):
            total += squared[k] if 0 <= k < len(squared) else 0.0
        return total / width

    total = 0.0
    for value in squared:
        total += value
    offset = DSP_CONFIG["dsp7"]["beta"] * (total / len(squared))
    expected, narrow, n = [], 0, 0
    while n < len(noise):
        if not centered_mean(n, w1) > centered_mean(n, w2) + offset:
            n += 1
            continue
        start = n
        while n < len(noise) and centered_mean(n, w1) > centered_mean(n, w2) + offset:
            n += 1
        if n - start < w1:
            narrow += 1
            continue
        peak = start
        for k in range(start, n):
            if noise[k] > noise[peak]:
                peak = k
        expected.append(peak)
    assert narrow > 0
    assert elgendi_peaks(noise, 64) == expected


def test_finds_every_beat_of_a_regular_rhythm_once_within_2_ms():
    beats = regular_beats(1, 29, 72)
    detected = detect(beats, 0.4, 30)
    assert len(detected) == len(beats)
    assert max(nearest_errors(detected, beats)) < 0.002


def test_refined_peaks_fall_between_256_hz_samples():
    beats = regular_beats(1.003, 29, 72)
    detected = detect(beats, 0.4, 30)
    off_grid = [b for b in detected if abs(b.peak_s * SHAPE_HZ - round(b.peak_s * SHAPE_HZ)) > 1e-6]
    assert len(off_grid) > len(detected) / 2


# A window maximum on a slope is not a peak of the band: the parabola through it has its vertex far outside
# the window (here about 500 samples before it), so only a local maximum is interpolated (as beats.test.ts).
def test_keeps_a_window_maximum_on_a_slope_on_its_sample_instead_of_extrapolating():
    model_peak = 40
    model = np.array([max(0.0, 1 - abs(k - model_peak) / 5) for k in range(100)])
    centre = 4 * model_peak
    shape = np.array([-(k - centre) - 0.001 * (k - centre) ** 2 for k in range(400)])
    detected = detect_beats(ResampledSegment(0, model), ResampledSegment(0, shape))
    assert [beat.peak_s * SHAPE_HZ for beat in detected] == [centre - 4]


# Two Elgendi blocks one 64 Hz sample apart, each with its maximum on the side facing the other, put both
# ±1-sample refinement windows on one shared 256 Hz sample. Spikes 20 and 22 samples away lift MA_beat over
# the one sample between the blocks.
def test_reports_a_peak_that_two_candidates_refine_to_only_once():
    model = np.array([0.7 * (1 - 0.3 * abs(k - 61) / 16) if abs(k - 61) <= 16 else 0.0 for k in range(130)])
    model[40] = 2.0
    model[82] = 2.0
    assert elgendi_peaks(model, MODEL_HZ) == [40, 60, 62, 82]
    shared = 4 * 61
    shape = np.array([math.exp(-0.5 * ((k - shared) / 3) ** 2) for k in range(520)])
    peaks = [
        beat.peak_s * SHAPE_HZ
        for beat in detect_beats(ResampledSegment(0, model), ResampledSegment(0, shape))
    ]
    assert [peak for peak in peaks if abs(peak - shared) <= 1] == [shared]
    assert all(later > earlier for earlier, later in zip(peaks[:-1], peaks[1:], strict=True))


def test_onset_is_exact_for_a_flat_baseline_then_a_straight_upstroke():
    ramp = [
        0.2 if k <= 100 else 0.2 + 0.01 * (k - 100) if k <= 160 else 0.8 - 0.004 * (k - 160)
        for k in range(300)
    ]
    assert math.isclose(upstroke(ramp, 160, 0).onset_index, 100, abs_tol=1e-9)


def test_upstroke_reports_the_maximum_upslope_and_the_preceding_minimum():
    valley = [
        0.5 - 0.005 * k if k <= 50 else 0.25 + 0.02 * (k - 50) if k <= 120 else 1.65 - 0.01 * (k - 120)
        for k in range(200)
    ]
    found = upstroke(valley, 120, 10)
    assert found.foot_index == 50
    assert math.isclose(found.max_upslope, 0.02, abs_tol=1e-12)
    assert math.isclose(found.onset_index, 50, abs_tol=1e-9)
    assert upstroke(valley, 120, 80).foot_index == 80


def test_onset_of_a_gaussian_upstroke_is_mu_minus_two_sigma_within_half_a_ms():
    mu_s, sigma_s = 1.0, 0.06
    wave = [math.exp(-0.5 * ((k / SHAPE_HZ - mu_s) / sigma_s) ** 2) for k in range(512)]
    peak = round(mu_s * SHAPE_HZ)
    onset = upstroke(wave, peak, peak - round(0.4 * SHAPE_HZ)).onset_index
    assert abs(onset / SHAPE_HZ - (mu_s - 2 * sigma_s)) < 0.0005


def test_no_onset_when_nothing_rises_before_the_peak():
    assert upstroke([1 - k / 100 for k in range(100)], 50, 0) is None


def test_onsets_of_a_regular_rhythm_lie_50_to_250_ms_before_the_peak():
    for beat in detect(regular_beats(1, 29, 72), 0.4, 30):
        assert 0.05 < beat.peak_s - beat.onset_s < 0.25
