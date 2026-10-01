import numpy as np
import pytest
import torch

from train import sqi
from train.sqi_windows import BAD, CLEAN, WindowSet


def window_set(labels, kinds, subjects, windows=None, reference=None):
    count = len(labels)
    rng = np.random.default_rng(0)
    return WindowSet(
        windows=(rng.normal(size=(count, 256)) if windows is None else windows).astype(np.float32),
        labels=np.asarray(labels, dtype=np.int64),
        kinds=np.asarray(kinds, dtype=str),
        subjects=np.asarray(subjects, dtype=str),
        records=np.asarray([f"{subject}001" for subject in subjects], dtype=str),
        reference_hr_bpm=np.full(count, np.nan) if reference is None else np.asarray(reference, float),
        pattern_subjects=np.full(count, "", dtype=str),
    )


def test_threshold_is_the_lowest_meeting_the_precision_target():
    scores = np.array([0.9, 0.8, 0.7, 0.6, 0.5, 0.4])
    is_clean = np.array([True, True, True, False, True, False])
    # Precision by cut: 1, 1, 1, 0.75, 0.8, 0.67; only the top three reach 0.95. τ sits halfway to the
    # next score, so it accepts exactly those windows.
    assert sqi.threshold_for_precision(scores, is_clean, 0.95) == pytest.approx(0.65)
    assert sqi.threshold_for_precision(scores, is_clean, 0.75) == pytest.approx(0.45)


def test_tied_scores_are_accepted_together():
    scores = np.array([0.9, 0.5, 0.5, 0.1])
    is_clean = np.array([True, True, False, False])
    # Accepting ≥ 0.5 takes both tied windows (precision 2/3), so τ cannot sit between them.
    assert sqi.threshold_for_precision(scores, is_clean, 0.95) == pytest.approx(0.7)


def test_no_threshold_when_the_target_is_unreachable():
    assert sqi.threshold_for_precision(np.array([0.9, 0.1]), np.array([False, True]), 0.95) is None


def test_assert_precision_refuses_a_threshold_below_target():
    scores = np.array([0.9, 0.8, 0.7])
    is_clean = np.array([True, False, True])
    sqi.assert_precision(scores, is_clean, 0.9)
    with pytest.raises(AssertionError):
        sqi.assert_precision(scores, is_clean, 0.7)


def evaluation_sets(rng):
    subjects = np.repeat([f"{number}" for number in range(100, 110)], 70)
    # Per subject: 30 natural clean, 30 corrupted, and 10 poor-quality windows that score like clean ones.
    labels = np.tile(np.r_[np.ones(30, int), np.zeros(40, int)], 10)
    kinds = np.tile(np.r_[["natural"] * 30, ["motion"] * 30, ["poor-quality"] * 10], 10)
    dev_val = window_set(labels, kinds, subjects, reference=np.full(len(labels), 72.0))
    retimed_kinds = np.tile(["retimed-af", "retimed-sinus", "retimed-premature"], 200)
    retimed = window_set(np.ones(600, int), retimed_kinds, np.repeat([f"{n}" for n in range(100, 110)], 60))
    looks_clean = (kinds != "motion").astype(float)
    scores = np.clip(looks_clean * 0.6 + rng.normal(0.2, 0.2, size=len(labels)), 0, 1)
    return dev_val, retimed, scores


def test_evaluated_precision_at_the_chosen_threshold_meets_the_target():
    # The ≥ 0.95 check runs on the same windows and scores the reported precision comes from: §11.2's
    # natural clean windows and their corruptions.
    rng = np.random.default_rng(3)
    dev_val, retimed, scores = evaluation_sets(rng)
    errors = np.zeros(len(scores))
    evaluation = sqi.evaluate(scores, dev_val, rng.uniform(size=600), retimed, errors)
    tau, metrics = evaluation["tau"], evaluation["metrics"]
    spec_set = dev_val.kinds != "poor-quality"
    accepted = spec_set & (scores >= tau)
    assert np.mean(dev_val.labels[accepted] == CLEAN) >= sqi.TARGET_PRECISION
    assert metrics["cleanPrecision"]["estimate"] >= sqi.TARGET_PRECISION
    assert metrics["cleanPrecision"]["estimate"] == pytest.approx(np.mean(dev_val.labels[accepted]))
    # Poor-quality windows do not move τ but are counted against precision in their own metric.
    with_poor = dev_val.labels[scores >= tau]
    assert metrics["cleanPrecisionWithPoorQualityRecords"]["estimate"] == pytest.approx(np.mean(with_poor))
    assert metrics["cleanPrecisionWithPoorQualityRecords"]["estimate"] < sqi.TARGET_PRECISION
    assert metrics["ml2HrWithin5BpmOfAccepted"]["estimate"] == 1.0


def test_ml4_gap_is_sinus_minus_af_acceptance_in_points():
    retimed = window_set(
        np.ones(10, int),
        ["retimed-af"] * 4 + ["retimed-sinus"] * 4 + ["retimed-premature"] * 2,
        ["100", "101"] * 5,
    )
    scores = np.array([0.9, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.1, 0.9, 0.9])
    gaps = sqi.ml4_proxy(scores, retimed, 0.5)
    assert gaps["af"]["estimate"] == pytest.approx(100 * (3 / 4 - 1 / 4))
    assert gaps["premature"]["estimate"] == pytest.approx(100 * (3 / 4 - 1))


def test_weights_balance_labels_kinds_and_subjects():
    windows = window_set(
        [CLEAN, CLEAN, CLEAN, CLEAN, BAD, BAD, BAD, BAD, BAD],
        [
            "natural",
            "natural",
            "retimed-af",
            "retimed-sinus",
            "motion",
            "motion",
            "motion",
            "flicker",
            "poor-quality",
        ],
        ["100", "100", "101", "101", "100", "101", "101", "100", "100"],
    )
    weights = sqi.sample_weights(windows).astype(float)
    assert weights.mean() == pytest.approx(1.0)
    clean, bad = windows.labels == CLEAN, windows.labels == BAD
    assert weights[clean].sum() == pytest.approx(weights[bad].sum())
    # Clean kinds are equal: two natural windows weigh as much as one re-timed AF window.
    assert weights[:2].sum() == pytest.approx(weights[2]) == pytest.approx(weights[3])
    # motion: subject 100 has one window, subject 101 two; each subject carries half of the kind.
    assert weights[4] == pytest.approx(weights[5] + weights[6])
    # Poor-quality records carry half of the bad side; the corruptions share the rest equally.
    assert weights[8] == pytest.approx(weights[4:8].sum())
    assert weights[7] == pytest.approx(weights[4:7].sum())


def test_spectral_hr_finds_a_pulse_rate():
    window = np.sin(2 * np.pi * 1.25 * np.arange(256) / 64.0)
    assert sqi.spectral_hr_bpm(window) == pytest.approx(75.0, abs=0.5)


def test_rule_features_are_skewness_and_hr_in_range():
    times = np.arange(256) / 64.0
    in_range = np.sin(2 * np.pi * 1.2 * times)
    too_slow = np.sin(2 * np.pi * 0.62 * times)
    features = sqi.rule_features(
        window_set([1, 1], ["natural"] * 2, ["100"] * 2, np.stack([in_range, too_slow]))
    )
    assert features.shape == (2, len(sqi.RULE_FEATURES))
    assert features[:, 1].tolist() == [1.0, 0.0]


def tiny_sets():
    rng = np.random.default_rng(5)
    times = np.arange(256) / 64.0
    clean = np.stack([np.sin(2 * np.pi * rng.uniform(1, 2) * times) for _ in range(32)])
    bad = rng.normal(size=(32, 256))
    windows = np.concatenate([clean, bad])
    labels = np.r_[np.ones(32, int), np.zeros(32, int)]
    kinds = np.where(labels == CLEAN, "natural", "motion")
    subjects = np.tile(["100", "101", "102", "103"], 16)
    return window_set(labels, kinds, subjects, windows)


def test_a_killed_run_resumes_to_the_same_weights(tmp_path):
    windows = tiny_sets()
    config = sqi.TrainConfig(max_epochs=3, patience=10, batch_size=16)
    unbroken, _ = sqi.train_network(windows, windows, tmp_path / "unbroken", config)
    sqi.train_network(windows, windows, tmp_path / "resumed", config._replace(max_epochs=1))
    resumed, history = sqi.train_network(windows, windows, tmp_path / "resumed", config)
    assert [entry["epoch"] for entry in history] == [1, 2, 3]
    for name, tensor in unbroken.state_dict().items():
        assert torch.equal(tensor, resumed.state_dict()[name]), name


def test_training_key_changes_with_settings():
    first = sqi.training_key(sqi.TrainConfig(), "windows")
    assert first == sqi.training_key(sqi.TrainConfig(), "windows")
    assert first != sqi.training_key(sqi.TrainConfig(learning_rate=1e-2), "windows")
    assert first != sqi.training_key(sqi.TrainConfig(), "other-windows")


def test_threshold_accepting_every_window_is_the_lowest_score():
    assert sqi.threshold_for_precision(np.array([0.9, 0.3]), np.array([True, True]), 0.95) == 0.3
