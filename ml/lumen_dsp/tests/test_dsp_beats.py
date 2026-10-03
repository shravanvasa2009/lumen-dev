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


def test_windows_round_111_ms_667_ms_and_10_s_to_the_nearest_odd_sample_count():
    assert elgendi_windows(64) == (7, 43, 641)
    assert elgendi_windows(256) == (29, 171, 2561)


def transcribed_peaks(band, offset_width=None):
    # The rules transcribed directly: centred W1 and W2 means with samples outside the signal counted as zero;
    # THR1's offset β × the mean over the samples within ± offset_width / 2 that lie in the signal.
    w1, w2, default_offset_width = elgendi_windows(64)
    offset_half = ((offset_width or default_offset_width) - 1) // 2
    squared = [value * value if value > 0 else 0.0 for value in band]

    def centered_mean(n, width):
        total = 0.0
        for k in range(n - (width - 1) // 2, n + (width - 1) // 2 + 1):
            total += squared[k] if 0 <= k < len(squared) else 0.0
        return total / width

    offsets = []
    for n in range(len(squared)):
        start, end = max(0, n - offset_half), min(len(squared) - 1, n + offset_half)
        total = 0.0
        for k in range(start, end + 1):
            total += squared[k]
        offsets.append(DSP_CONFIG["dsp7"]["beta"] * (total / (end - start + 1)))
    expected, narrow, n = [], 0, 0
    while n < len(band):
        if not centered_mean(n, w1) > centered_mean(n, w2) + offsets[n]:
            n += 1
            continue
        start = n
        while n < len(band) and centered_mean(n, w1) > centered_mean(n, w2) + offsets[n]:
            n += 1
        if n - start < w1:
            narrow += 1
            continue
        peak = start
        for k in range(start, n):
            if band[k] > band[peak]:
                peak = k
        expected.append(peak)
    return expected, narrow


def test_peaks_match_a_direct_transcription_with_the_local_offset_on_noise():
    uniforms = park_miller_uniforms(2000, seed=99)
    noise = [(u - 0.5) * (1 + math.sin(n / 40)) for n, u in enumerate(uniforms)]
    expected, narrow = transcribed_peaks(noise)
    assert len(noise) > elgendi_windows(64)[2]
    assert narrow > 0
    assert elgendi_peaks(noise, 64) == expected


def test_a_segment_shorter_than_the_offset_window_uses_the_published_segment_wide_offset():
    uniforms = park_miller_uniforms(320, seed=7)
    noise = [(u - 0.5) * (1 + math.sin(n / 20)) for n, u in enumerate(uniforms)]
    # A window of 2 × length − 1 reaches every sample from every sample: the segment-wide mean.
    expected, _ = transcribed_peaks(noise, 2 * len(noise) - 1)
    assert expected
    assert elgendi_peaks(noise, 64) == expected


def test_running_offset_sum_equals_direct_sums_after_large_transients():
    # 5 min at 64 Hz; transients 10^4 times a beat's energy, each followed by a flat stretch longer than the
    # offset window, where no peak may appear.
    uniforms = park_miller_uniforms(64 * 300, seed=31)

    def flat(n):
        return 3200 <= n % 6400 < 4200

    band = []
    for n, u in enumerate(uniforms):
        pulse = math.exp(-0.5 * ((n % 64 - 20) / 4) ** 2) + 0.05 * (u - 0.5)
        band.append(0.0 if flat(n) else 100 * pulse if 3100 <= n % 6400 < 3200 else pulse)
    expected, _ = transcribed_peaks(band)
    peaks = elgendi_peaks(band, 64)
    assert peaks == expected
    assert not [peak for peak in peaks if flat(peak)]


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
# the window (here about 500 samples before it), so only a local maximum is interpolated. The refinement
# climbs the slope, but no further than half of W1 (14 samples at 256 Hz) from the candidate (as
# beats.test.ts).
def test_climbs_a_slope_at_most_half_of_w1_and_never_extrapolates():
    model_peak = 40
    model = np.array([max(0.0, 1 - abs(k - model_peak) / 5) for k in range(100)])
    centre = 4 * model_peak
    shape = np.array([-(k - centre) - 0.001 * (k - centre) ** 2 for k in range(400)])
    detected = detect_beats(ResampledSegment(0, model), ResampledSegment(0, shape))
    assert [beat.peak_s * SHAPE_HZ for beat in detected] == [centre - 14]


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
