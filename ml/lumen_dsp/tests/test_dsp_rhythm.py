import math

import pytest

from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.rhythm import has_enough_usable_intervals, rhythm_feature_vector, rhythm_windows

WINDOW_INTERVALS = DSP_CONFIG["dsp15"]["windowIntervals"]


def clean(count):
    return [False] * count


def only_window(intervals_s):
    windows = rhythm_windows(intervals_s, clean(len(intervals_s)), clean(len(intervals_s) + 1))
    assert len(windows) == 1
    return windows[0]


def park_miller(count, seed):
    state = seed
    uniforms = []
    for _ in range(count):
        state = (state * 16807) % 2_147_483_647
        uniforms.append(state / 2_147_483_647)
    return uniforms


ALTERNATING = [0.8 if k % 2 == 0 else 1.0 for k in range(32)]


def test_windows_take_32_intervals_with_step_16_and_drop_a_partial_window():
    assert [w.start_interval for w in rhythm_windows([0.9] * 80, clean(80), clean(81))] == [0, 16, 32, 48]
    assert [w.start_interval for w in rhythm_windows([0.9] * 79, clean(79), clean(80))] == [0, 16, 32]


def test_an_excluded_interval_ends_the_run():
    spans = clean(100)
    spans[40] = True
    windows = rhythm_windows([0.9] * 100, spans, clean(101))
    assert [w.start_interval for w in windows] == [0, 41, 57]
    assert all(len(w.intervals_s) == WINDOW_INTERVALS for w in windows)


def test_atypical_fraction_counts_the_33_bounding_beats():
    atypical = clean(33)
    atypical[5] = atypical[32] = True
    (window,) = rhythm_windows([0.9] * 32, clean(32), atypical)
    assert window.atypical_fraction == pytest.approx(2 / 33, abs=1e-15)


def test_rejects_misaligned_inputs():
    with pytest.raises(ValueError):
        rhythm_windows([0.9, 0.9], clean(1), clean(3))
    with pytest.raises(ValueError):
        rhythm_windows([0.9, 0.9], clean(2), clean(2))


def test_reading_needs_40_usable_intervals():
    spans = clean(41)
    spans[3] = True
    assert has_enough_usable_intervals(spans)
    spans[7] = True
    assert not has_enough_usable_intervals(spans)


def test_alternating_intervals_known_answers():
    window = only_window(ALTERNATING)
    assert window.normalized_rmssd == pytest.approx(0.2 / 0.9, abs=1e-12)
    assert window.shannon_entropy_bits == pytest.approx(1, abs=1e-12)
    assert window.turning_point_ratio == 1
    assert window.pnn50 == 1
    assert window.sd2_s == 0
    assert window.sample_entropy == pytest.approx(0, abs=1e-15)


def test_constant_intervals_have_zero_spread():
    window = only_window([0.9] * 32)
    assert [
        window.normalized_rmssd,
        window.shannon_entropy_bits,
        window.turning_point_ratio,
        window.pnn50,
    ] == [0] * 4
    assert [window.sd1_s, window.sd2_s] == [0, 0]


def test_ties_are_not_turning_points():
    intervals = [0.8] + [0.8 if k % 2 == 0 else 0.85 for k in range(31)]
    assert only_window(intervals).turning_point_ratio == pytest.approx(29 / 30, abs=1e-15)


def test_sample_entropy_matches_a_direct_transcription():
    # Seed 29: B = 12, A = 3 (same case as the TypeScript test).
    intervals = [0.4 + 0.8 * u for u in park_miller(32, 29)]
    n = len(intervals)
    mean = sum(intervals) / n
    r = 0.2 * math.sqrt(sum((v - mean) ** 2 for v in intervals) / n)

    def matches(length):
        return sum(
            1
            for i in range(n - 2)
            for j in range(i + 1, n - 2)
            if max(abs(intervals[i + k] - intervals[j + k]) for k in range(length)) <= r
        )

    assert (matches(2), matches(3)) == (12, 3)
    assert only_window(intervals).sample_entropy == pytest.approx(math.log(12 / 3), abs=1e-12)


def test_sample_entropy_is_undefined_without_length_3_matches():
    assert only_window([0.4 + 0.8 * u for u in park_miller(32, 1)]).sample_entropy is None


def alternating(low, high):
    return [low if k % 2 == 0 else high for k in range(32)]


def test_pnn50_counts_62_5_ms_and_skips_46_875_ms():
    assert only_window(alternating(0.75, 0.8125)).pnn50 == 1
    assert only_window(alternating(0.75, 0.796875)).pnn50 == 0


def test_pnn50_skips_a_difference_exactly_at_the_threshold():
    # 0.1 − 0.05 is exactly the double 0.05, so only > vs ≥ decides.
    assert 0.1 - 0.05 == DSP_CONFIG["dsp15"]["pnnThresholdS"]
    assert only_window(alternating(0.05, 0.1)).pnn50 == 0


def test_feature_vector_has_the_8_features_in_order():
    atypical = clean(33)
    atypical[4] = True
    (window,) = rhythm_windows([0.4 + 0.8 * u for u in park_miller(32, 29)], clean(32), atypical)
    assert rhythm_feature_vector(window) == [
        window.normalized_rmssd,
        window.shannon_entropy_bits,
        window.turning_point_ratio,
        window.sd1_s,
        window.sd2_s,
        window.pnn50,
        window.sample_entropy,
        window.atypical_fraction,
    ]


def test_feature_vector_fills_an_undefined_sample_entropy_with_the_upper_bound():
    # Seed 1: B = 4, A = 0. Richman–Moorman bound ln((N − m)(N − m − 1)/2) = ln(30 · 29 / 2) = ln(435).
    window = only_window([0.4 + 0.8 * u for u in park_miller(32, 1)])
    assert window.sample_entropy is None
    vector = rhythm_feature_vector(window)
    assert vector[6] == pytest.approx(math.log(435), abs=1e-15)
    assert all(isinstance(value, float) and math.isfinite(value) for value in vector)


def test_feature_vector_keeps_a_defined_sample_entropy():
    window = only_window([0.4 + 0.8 * u for u in park_miller(32, 29)])
    assert rhythm_feature_vector(window)[6] == window.sample_entropy


# ADR 0024: the feature vector is always finite, so an interval must be a finite positive number of
# seconds, whether or not it spans an artifact (red team).
@pytest.mark.parametrize("bad_interval", [math.nan, math.inf, -math.inf, 0.0, -0.8])
@pytest.mark.parametrize("spans_artifact", [False, True])
def test_rejects_an_interval_that_is_not_finite_and_positive(bad_interval, spans_artifact):
    intervals_s = [0.8] * 32
    intervals_s[5] = bad_interval
    spans = clean(32)
    spans[5] = spans_artifact
    with pytest.raises(ValueError, match="finite"):
        rhythm_windows(intervals_s, spans, clean(33))
