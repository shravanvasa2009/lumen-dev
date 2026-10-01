import numpy as np
import pytest

from eval.bootstrap import cluster_bootstrap_ci, ppv_npv


def mean_score(y_true, y_score):
    return float(np.mean(y_score))


def test_resamples_whole_subjects():
    # Subject a has three rows scoring 1, subject b one row scoring 0. Resampling two subjects gives
    # {a,a} -> 1, {b,b} -> 0, {a,b} -> 3/4. A row-level bootstrap would also produce 1/4 and 1/2.
    subjects = np.array(["a", "a", "a", "b"])
    scores = np.array([1.0, 1.0, 1.0, 0.0])
    seen = []

    def spy(y_true, y_score):
        seen.append(mean_score(y_true, y_score))
        return seen[-1]

    interval = cluster_bootstrap_ci(subjects, np.zeros(4), scores, spy, n_resamples=500, seed=3)
    assert set(np.round(seen, 9)) == {0.0, 0.75, 1.0}
    assert interval.estimate == pytest.approx(0.75)
    assert (interval.low, interval.high) == (0.0, 1.0)
    assert interval.undefined_resamples == 0


def test_identical_subjects_give_zero_width_interval():
    subjects = np.repeat(["a", "b", "c"], 2)
    scores = np.tile([0.2, 0.4], 3)
    interval = cluster_bootstrap_ci(subjects, np.zeros(6), scores, mean_score, n_resamples=200)
    assert interval == pytest.approx((0.3, 0.3, 0.3, 0))


def test_bootstrap_is_seeded():
    rng = np.random.default_rng(0)
    subjects = np.repeat(np.arange(20), 5)
    scores = rng.random(100)
    first = cluster_bootstrap_ci(subjects, np.zeros(100), scores, mean_score, seed=11)
    second = cluster_bootstrap_ci(subjects, np.zeros(100), scores, mean_score, seed=11)
    assert first == second
    assert first.low < first.estimate < first.high


def test_undefined_resamples_are_counted():
    # Sensitivity is undefined when a resample holds no positives (only subject b, drawn twice).
    def sensitivity(y_true, y_score):
        positives = y_true == 1
        return float(np.mean(y_score[positives] > 0.5)) if positives.any() else float("nan")

    interval = cluster_bootstrap_ci(
        np.array(["a", "b"]), np.array([1, 0]), np.array([0.9, 0.1]), sensitivity, n_resamples=400
    )
    assert 0 < interval.undefined_resamples < 400
    assert interval.estimate == 1.0


def test_mismatched_lengths_raise():
    with pytest.raises(ValueError):
        cluster_bootstrap_ci(np.array(["a"]), np.zeros(2), np.zeros(2), mean_score)


def test_ppv_npv_spec_example():
    # §11.5: 0.9 * 0.01 / (0.9 * 0.01 + 0.05 * 0.99) = 0.009 / 0.0585; NPV = 0.9405 / 0.9415.
    values = ppv_npv(0.9, 0.95, 0.01)
    assert values.ppv == pytest.approx(0.153846, abs=1e-6)
    assert values.npv == pytest.approx(0.998938, abs=1e-6)


def test_ppv_npv_even_prevalence():
    # 0.4 / (0.4 + 0.05) and 0.45 / (0.45 + 0.1).
    values = ppv_npv(0.8, 0.9, 0.5)
    assert values.ppv == pytest.approx(8 / 9)
    assert values.npv == pytest.approx(9 / 11)


@pytest.mark.parametrize("args", [(1.2, 0.9, 0.1), (0.9, -0.1, 0.1), (0.9, 0.9, 2), (0.0, 1.0, 0.1)])
def test_ppv_npv_rejects_bad_or_undefined_inputs(args):
    with pytest.raises(ValueError):
        ppv_npv(*args)
