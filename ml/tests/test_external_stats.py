import math

import numpy as np
import pytest

from eval.external_stats import (
    DIABETES_FLOOR,
    DIABETES_PREVALENCES,
    MIN_CLEAN_WINDOWS_PER_GROUP,
    RHYTHM_FLOOR,
    BiasWindows,
    beat_f1,
    binary_report,
    floor_met,
    is_reference_clean,
    matched_pairs,
    rhythm_bias_report,
    rhythm_outcome,
    stratified_gap_ci,
    subject_lag_s,
)
from train.rhythm import Units


@pytest.fixture(autouse=True)
def fewer_resamples(monkeypatch):
    # Speed only: the code path is the same; the real run uses train.rhythm's 2,000 resamples.
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)


def units(scores, positives, subjects=None):
    scores = np.asarray(scores, dtype=float)
    subjects = np.asarray(subjects if subjects is not None else [f"s{i}" for i in range(len(scores))])
    return Units(scores, np.asarray(positives, dtype=bool), subjects.astype(str))


def screening_units():
    # 10 positives, 9 at or above τ = 0.5 (sensitivity 0.9); 20 negatives, 19 below (specificity 0.95).
    scores = [0.9] * 9 + [0.1] + [0.1] * 19 + [0.9]
    return units(scores, [True] * 10 + [False] * 20)


def test_sensitivity_and_specificity_are_taken_at_the_frozen_threshold():
    report = binary_report(screening_units(), 0.5, ())
    assert report["threshold"] == 0.5
    assert report["sensitivity"] == pytest.approx(0.9)
    assert report["specificity"] == pytest.approx(0.95)
    assert (report["positives"], report["negatives"]) == (10, 20)


def test_no_threshold_is_chosen_from_the_labels():
    # A τ of 0.95 is worse than 0.5 on these labels; the report must still use it, not search for another.
    report = binary_report(screening_units(), 0.95, ())
    assert report["threshold"] == 0.95
    assert report["sensitivity"] == 0.0
    assert report["specificity"] == 1.0


def test_ppv_and_npv_follow_bayes_at_each_prevalence():
    report = binary_report(screening_units(), 0.5, (0.01, 0.05, 0.10))
    for row in report["ppvNpv"]:
        prevalence = row["prevalence"]
        true_pos, false_pos = 0.9 * prevalence, 0.05 * (1 - prevalence)
        true_neg, false_neg = 0.95 * (1 - prevalence), 0.1 * prevalence
        assert row["ppv"] == pytest.approx(true_pos / (true_pos + false_pos))
        assert row["npv"] == pytest.approx(true_neg / (true_neg + false_neg))
        assert row["ppvCi95"][0] <= row["ppv"] <= row["ppvCi95"][1]
    # §11.5's own example: 90% sensitivity and 95% specificity give a PPV of about 15% at 1% prevalence.
    assert report["ppvNpv"][0]["ppv"] == pytest.approx(0.1538, abs=1e-4)


def test_diabetes_prevalences_are_the_ml6_ones():
    assert DIABETES_PREVALENCES == (0.05, 0.116, 0.20)


def test_confidence_intervals_resample_whole_subjects():
    # Subject a's 50 positive windows are all caught and subject b's 50 all missed. A window-level
    # bootstrap would keep sensitivity near 0.5; resampling subjects gives draws of only a (1) or only b (0).
    subjects = ["a"] * 50 + ["b"] * 50 + ["c"] * 50 + ["d"] * 50
    scores = [1.0] * 50 + [0.0] * 150
    report = binary_report(units(scores, [True] * 100 + [False] * 100, subjects), 0.5, ())
    assert report["sensitivity"] == pytest.approx(0.5)
    assert report["ci95"]["sensitivity"] == [0.0, 1.0]


def test_undefined_metric_is_reported_as_null():
    report = binary_report(units([0.2, 0.3], [False, False]), 0.5, (0.05,))
    assert report["auroc"] is None and report["sensitivity"] is None
    assert report["ci95"]["auroc"] is None
    assert report["ppvNpv"][0]["ppv"] is None


@pytest.mark.parametrize(
    ("sensitivity", "specificity", "met"),
    [(0.80, 0.90, True), (0.79, 0.99, False), (0.99, 0.89, False), (None, 0.95, False)],
)
def test_rhythm_floor_uses_point_estimates_inclusively(sensitivity, specificity, met):
    assert floor_met({"sensitivity": sensitivity, "specificity": specificity}, RHYTHM_FLOOR) is met


@pytest.mark.parametrize(
    ("auroc", "specificity", "sensitivity", "met"),
    [(0.75, 0.85, 0.60, True), (0.749, 0.9, 0.9, False), (0.9, 0.84, 0.9, False), (0.9, 0.9, 0.59, False)],
)
def test_diabetes_floor(auroc, specificity, sensitivity, met):
    report = {"auroc": auroc, "specificity": specificity, "sensitivity": sensitivity}
    assert floor_met(report, DIABETES_FLOOR) is met


def test_rhythm_outcome_keeps_a_shipped_model_that_meets_the_floor():
    reports = {"lgbm": {"sensitivity": 0.85, "specificity": 0.95, "auroc": 0.9}}
    assert rhythm_outcome(reports, "lgbm")["outcome"] == "shipped-meets-floor"


def test_rhythm_outcome_names_a_baseline_but_changes_nothing():
    reports = {
        "lgbm": {"sensitivity": 0.70, "specificity": 0.95, "auroc": 0.9},
        "net": {"sensitivity": 0.85, "specificity": 0.92, "auroc": 0.88},
        "other": {"sensitivity": 0.90, "specificity": 0.91, "auroc": 0.93},
    }
    decision = rhythm_outcome(reports, "lgbm")
    assert decision["outcome"] == "baseline-meets-floor"
    assert decision["modelsMeetingFloor"] == ["other", "net"]
    assert "owner decides" in decision["action"]


def test_rhythm_outcome_falls_back_to_experimental():
    reports = {"lgbm": {"sensitivity": 0.5, "specificity": 0.95, "auroc": 0.7}}
    decision = rhythm_outcome(reports, "lgbm")
    assert decision["outcome"] == "experimental"
    assert decision["modelsMeetingFloor"] == []


def test_lag_is_the_median_first_pulse_delay_in_the_first_five_minutes():
    r_peaks = np.arange(0, 600, 1.0)
    delays = np.where(r_peaks < 300, 0.25, 0.45)
    delays[:10] = 0.30
    ppg = r_peaks + delays
    assert subject_lag_s(r_peaks, ppg) == pytest.approx(0.25)


def test_lag_ignores_pulses_outside_the_search_range():
    r_peaks = np.arange(0, 100, 1.0)
    assert subject_lag_s(r_peaks, r_peaks + 0.7) is None
    assert subject_lag_s(r_peaks, r_peaks - 0.1) is None
    assert subject_lag_s(r_peaks, np.array([])) is None


def test_matching_is_one_to_one_within_tolerance():
    ecg = np.array([1.0, 2.0])
    assert matched_pairs(ecg, np.array([1.1, 1.12, 2.149])) == 2
    assert matched_pairs(ecg, np.array([1.16])) == 0
    # Both PPG beats sit near the first R-peak; only one can match it.
    assert matched_pairs(np.array([1.0]), np.array([0.95, 1.05])) == 1


def test_greedy_matching_takes_the_nearest_pair_first():
    # The PPG beat at 1.12 is nearer to R at 1.2 than to R at 1.0, so R at 1.0 is left unmatched.
    assert matched_pairs(np.array([1.0, 1.2]), np.array([1.12])) == 1


def test_f1_and_reference_clean_rule():
    ecg = np.arange(10, dtype=float)
    assert beat_f1(ecg, ecg + 0.05) == 1.0
    assert beat_f1(ecg, ecg[:8]) == pytest.approx(16 / 18)
    assert math.isnan(beat_f1(np.array([]), np.array([])))
    assert is_reference_clean(ecg, ecg)
    assert not is_reference_clean(ecg, ecg[:8])
    # One extra PPG beat in ten keeps F1 at 20/21 ≥ 0.9.
    assert is_reference_clean(ecg, np.append(ecg, 4.5))
    assert not is_reference_clean(np.array([1.0]), np.array([1.0]))


def bias_windows(af_rates, non_af_rates, per_subject):
    subjects, is_af, accepted = [], [], []
    for group, rates in ((True, af_rates), (False, non_af_rates)):
        for index, rate in enumerate(rates):
            name = f"{'af' if group else 'non'}{index}"
            count = round(rate * per_subject)
            subjects += [name] * per_subject
            is_af += [group] * per_subject
            accepted += [True] * count + [False] * (per_subject - count)
    hr = np.linspace(50, 120, len(subjects))
    windows = BiasWindows(np.asarray(subjects), np.asarray(is_af), np.asarray(accepted), hr)
    af_names = [f"af{index}" for index in range(len(af_rates))]
    non_af_names = [f"non{index}" for index in range(len(non_af_rates))]
    return windows, af_names, non_af_names


def test_gap_is_non_af_minus_af_in_points():
    windows, af, non_af = bias_windows([0.80, 0.80], [0.90, 0.90], 150)
    report = rhythm_bias_report(windows, af, non_af)
    assert report["rhythmBiasGapPts"] == pytest.approx(10.0)
    assert report["status"] == "measured"
    assert report["passed"] is False
    assert report["acceptRateAf"] == pytest.approx(0.8)
    assert report["acceptRateNonAf"] == pytest.approx(0.9)
    assert report["ci95"] == pytest.approx([10.0, 10.0])


def test_gap_within_five_points_passes_either_direction():
    windows, af, non_af = bias_windows([0.90, 0.90], [0.86, 0.86], 150)
    report = rhythm_bias_report(windows, af, non_af)
    assert report["rhythmBiasGapPts"] == pytest.approx(-4.0, abs=0.5)
    assert report["passed"] is True


def test_too_few_reference_clean_windows_is_insufficient_not_a_pass():
    windows, af, non_af = bias_windows([0.9], [0.9], MIN_CLEAN_WINDOWS_PER_GROUP - 1)
    report = rhythm_bias_report(windows, af, non_af)
    assert report["status"] == "insufficient-data"
    assert report["rhythmBiasGapPts"] is None
    assert report["passed"] is False
    assert report["breakdown"]["gapPtsAsMeasured"] == pytest.approx(0.0)


def test_gap_ci_resamples_subjects_within_groups():
    # AF subject a accepts everything and b nothing; non-AF accepts everything. Resampling subjects can
    # only give gaps of 0, 50 or 100 points; resampling windows would stay near 50.
    af = (np.array([100.0, 0.0]), np.array([100.0, 100.0]))
    non_af = (np.array([100.0, 100.0]), np.array([100.0, 100.0]))
    low, high, undefined = stratified_gap_ci(af, non_af, n_resamples=500, seed=1)
    assert (low, high, undefined) == (0.0, 100.0, 0)


def test_subject_with_no_clean_window_still_counts_as_a_cluster():
    windows, af, non_af = bias_windows([0.9, 0.9], [0.9, 0.9], 150)
    report = rhythm_bias_report(windows, [*af, "af-empty"], non_af)
    assert report["breakdown"]["referenceCleanWindowsPerSubject"]["af-empty"] == 0
    # A resample that draws only the empty AF subject has no AF windows: counted as undefined, not hidden.
    assert 0 < report["undefinedResamples"] < 200
    assert report["ci95"] is not None


def test_equal_weight_gap_and_heart_rate_tertiles_are_reported():
    windows, af, non_af = bias_windows([0.8, 1.0], [0.9, 0.9], 150)
    breakdown = rhythm_bias_report(windows, af, non_af)["breakdown"]
    assert breakdown["gapPtsSubjectsEqualWeight"] == pytest.approx(0.0)
    tertiles = breakdown["byHeartRateTertile"]
    assert len(tertiles) == 3
    assert sum(row["windowsAf"] + row["windowsNonAf"] for row in tertiles) == len(windows.subjects)
