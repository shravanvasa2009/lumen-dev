import numpy as np
import pytest

from datasets.augment import augment_intervals

NO_TIMING_NOISE = {"jitter_sd_ms": 0.0, "merge_rate": 0.0, "split_rate": 0.0}


def regular(count: int, interval_ms: float = 800.0) -> tuple[np.ndarray, np.ndarray]:
    return np.full(count, interval_ms), np.zeros(count, dtype=bool)


def test_same_seed_same_output():
    intervals, premature = regular(500)
    premature[::25] = True
    first = augment_intervals(intervals, premature, np.random.default_rng(4), jitter_sd_ms=20.0)
    second = augment_intervals(intervals, premature, np.random.default_rng(4), jitter_sd_ms=20.0)
    np.testing.assert_array_equal(first.intervals_ms, second.intervals_ms)
    np.testing.assert_array_equal(first.premature, second.premature)


def test_merge_and_split_preserve_total_duration():
    rng = np.random.default_rng(0)
    intervals = rng.uniform(400, 1200, 5000)
    premature = rng.random(5000) < 0.05
    augmented = augment_intervals(
        intervals, premature, np.random.default_rng(1), jitter_sd_ms=0.0, merge_rate=0.05, split_rate=0.05
    )
    assert augmented.intervals_ms.sum() == pytest.approx(intervals.sum())
    assert len(augmented.intervals_ms) == len(augmented.premature)
    assert len(augmented.intervals_ms) != len(intervals)


def test_merge_and_split_rates_over_many_draws():
    intervals, premature = regular(200_000)
    augmented = augment_intervals(intervals, premature, np.random.default_rng(2), jitter_sd_ms=0.0)
    merged = np.isclose(augmented.intervals_ms, 1600.0).sum()
    split_pieces = (augmented.intervals_ms < 800.0 - 1e-9).sum()
    # Expected 1% merged and 0.5% split (two short pieces each); tolerances are about 4 binomial SDs.
    assert merged / len(intervals) == pytest.approx(0.01, abs=0.001)
    assert split_pieces / 2 / len(intervals) == pytest.approx(0.005, abs=0.0007)


def test_dropped_premature_fraction_stays_in_range():
    fractions = []
    for seed in range(400):
        intervals, premature = regular(1000)
        premature[1:-1:10] = True
        augmented = augment_intervals(intervals, premature, np.random.default_rng(seed), **NO_TIMING_NOISE)
        dropped = premature.sum() - augmented.premature.sum()
        fractions.append(dropped / premature.sum())
    # Each sequence draws its drop fraction from 0.2-0.4; with 99 premature beats per sequence the
    # observed fraction stays within a few binomial SDs of that range, and averages 0.3.
    assert 0.12 < min(fractions) and max(fractions) < 0.5
    assert np.mean(fractions) == pytest.approx(0.3, abs=0.01)


def test_dropped_premature_beat_leaves_a_pause_of_both_intervals():
    # A premature beat 450 ms after the previous one, then a 1150 ms compensatory pause.
    intervals = np.array([800.0, 800.0, 450.0, 1150.0, 800.0, 800.0])
    premature = np.array([False, False, True, False, False, False])
    augmented = augment_intervals(
        intervals, premature, np.random.default_rng(0), drop_fraction_range=(1.0, 1.0), **NO_TIMING_NOISE
    )
    np.testing.assert_allclose(augmented.intervals_ms, [800.0, 800.0, 1600.0, 800.0, 800.0])
    assert not augmented.premature.any()


def test_final_premature_beat_is_kept():
    intervals = np.array([800.0, 800.0, 450.0])
    premature = np.array([False, False, True])
    augmented = augment_intervals(
        intervals, premature, np.random.default_rng(0), drop_fraction_range=(1.0, 1.0), **NO_TIMING_NOISE
    )
    np.testing.assert_allclose(augmented.intervals_ms, intervals)


def test_jitter_spread_matches_sigma():
    intervals, premature = regular(100_000)
    augmented = augment_intervals(
        intervals, premature, np.random.default_rng(5), jitter_sd_ms=20.0, merge_rate=0.0, split_rate=0.0
    )
    # Independent per-beat jitter: each interval differs by two draws, so its SD is sigma * sqrt(2).
    assert augmented.intervals_ms.std() == pytest.approx(20.0 * np.sqrt(2), rel=0.02)
    assert (augmented.intervals_ms >= 0).all()


@pytest.mark.parametrize(
    "overrides",
    [
        {"jitter_sd_ms": -1.0},
        {"merge_rate": 1.0},
        {"split_rate": -0.1},
        {"drop_fraction_range": (0.5, 0.2)},
        {"drop_fraction_range": (0.0, 1.5)},
    ],
)
def test_invalid_parameters_raise(overrides):
    intervals, premature = regular(10)
    settings = {"jitter_sd_ms": 10.0} | overrides
    with pytest.raises(ValueError):
        augment_intervals(intervals, premature, np.random.default_rng(0), **settings)


def test_mismatched_lengths_raise():
    with pytest.raises(ValueError):
        augment_intervals(np.ones(5), np.zeros(4, dtype=bool), np.random.default_rng(0), jitter_sd_ms=0.0)
