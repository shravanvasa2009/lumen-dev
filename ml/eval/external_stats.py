import math
from collections.abc import Mapping, Sequence
from typing import NamedTuple

import numpy as np

from train.rhythm import (
    BOOTSTRAP_RESAMPLES,
    SEED,
    Units,
    auroc,
    predictive_value_at,
    sensitivity_at,
    specificity_at,
    with_ci,
)

# §11.5 states rhythm PPV/NPV at 1%, 5% and 10% prevalence; ML-6 states diabetes at 5%, 11.6% and 20%.
RHYTHM_PREVALENCES = (0.01, 0.05, 0.10)
DIABETES_PREVALENCES = (0.05, 0.116, 0.20)
# ML-1 and ML-6 floors, judged on point estimates; the CIs are reported next to them, never used to pass.
RHYTHM_FLOOR = {"sensitivity": 0.80, "specificity": 0.90}
RHYTHM_TARGET_AUROC = 0.95
DIABETES_FLOOR = {"auroc": 0.75, "specificity": 0.85, "sensitivity": 0.60}

# ADR 0028, every value fixed before MIMIC PERform AF is opened.
LAG_SEARCH_S = (0.0, 0.6)
LAG_ESTIMATE_SPAN_S = 300.0
MATCH_TOLERANCE_S = 0.150
REFERENCE_CLEAN_F1 = 0.9
MIN_ECG_BEATS = 2
MIN_CLEAN_WINDOWS_PER_GROUP = 200
MAX_GAP_PTS = 5.0


def _interval(metric: dict | None) -> list[float] | None:
    return None if metric is None else [metric["low"], metric["high"]]


def _estimate(metric: dict | None) -> float | None:
    return None if metric is None else metric["estimate"]


def binary_report(units: Units, tau: float, prevalences: Sequence[float]) -> dict:
    # τ arrives from the frozen model card; nothing here looks at the labels to choose it.
    measured = {
        "auroc": with_ci(units, auroc),
        "sensitivity": with_ci(units, sensitivity_at(tau)),
        "specificity": with_ci(units, specificity_at(tau)),
    }
    ppv_npv_rows = []
    for prevalence in prevalences:
        ppv = with_ci(units, predictive_value_at(tau, prevalence, "ppv"))
        npv = with_ci(units, predictive_value_at(tau, prevalence, "npv"))
        ppv_npv_rows.append(
            {
                "prevalence": prevalence,
                "ppv": _estimate(ppv),
                "ppvCi95": _interval(ppv),
                "npv": _estimate(npv),
                "npvCi95": _interval(npv),
            }
        )
    return {
        "threshold": tau,
        "units": len(units.scores),
        "positives": int(np.sum(units.is_af)),
        "negatives": int(np.sum(~units.is_af)),
        **{name: _estimate(metric) for name, metric in measured.items()},
        "ci95": {name: _interval(metric) for name, metric in measured.items()},
        "undefinedResamples": {
            name: metric["undefinedResamples"] for name, metric in measured.items() if metric is not None
        },
        "ppvNpv": ppv_npv_rows,
    }


def floor_met(report: Mapping, floor: Mapping[str, float]) -> bool:
    return all(report.get(name) is not None and report[name] >= minimum for name, minimum in floor.items())


def rhythm_outcome(subject_reports: Mapping[str, Mapping], shipped: str, baselines: Sequence[str]) -> dict:
    # ML-1's fallback is "the best baseline that meets it". Only the shipped model and classical baselines
    # are eligible: ADR 0031 makes Rhythm-Net the ablation, whose external numbers never pick the winner.
    # The code reports; which model ships stays the owner's decision, so no flag changes here.
    eligible = [shipped, *baselines]
    meeting = sorted(
        (name for name in eligible if floor_met(subject_reports[name], RHYTHM_FLOOR)),
        key=lambda name: -(subject_reports[name].get("auroc") or -math.inf),
    )
    if shipped in meeting:
        outcome, action = "shipped-meets-floor", "none"
    elif meeting:
        outcome = "baseline-meets-floor"
        action = (
            f"the shipped {shipped} misses the ML-1 floor; baseline {meeting[0]} meets it. The owner decides "
            "whether to ship it (ADR 0031); this run does not change any ships flag"
        )
    else:
        outcome = "experimental"
        action = (
            "no eligible rhythm model meets the ML-1 floor: rhythm becomes Experimental with flags "
            "off (§11.5)"
        )
    return {"outcome": outcome, "eligibleForFloor": eligible, "modelsMeetingFloor": meeting, "action": action}


# §10.1 possible AFib: 2 of 3 readings within 24 h. The app's values are rules.possibleAfPositives and
# rules.possibleAfReadings in packages/core config (track/dsp-live, ADR 0041); lumen_dsp's dsp_config.json
# has no rules block on main yet, so they are restated here.
POSSIBLE_AF_POSITIVES = 2
POSSIBLE_AF_READINGS = 3


def possible_af(positive: np.ndarray, subjects: np.ndarray) -> np.ndarray:
    # Over each subject's readings in time order: a reading is possible AF when it is positive and at least
    # 2 of it and its 2 most recent earlier readings are. A 20-minute recording lies within the 24 h
    # window, so every earlier reading of the same subject counts.
    flags = np.zeros(len(positive), dtype=bool)
    for index in range(len(positive)):
        history = [
            back
            for back in range(max(0, index - POSSIBLE_AF_READINGS + 1), index + 1)
            if subjects[back] == subjects[index]
        ]
        flags[index] = bool(positive[index]) and int(np.sum(positive[history])) >= POSSIBLE_AF_POSITIVES
    return flags


def subject_lag_s(r_peaks_s: np.ndarray, ppg_peaks_s: np.ndarray) -> float | None:
    # ADR 0028 constant R→PPG lag: median delay to the first PPG peak 0–600 ms after each R-peak.
    # Only R-peaks in the recording's first 5 minutes count, so the lag is fixed once per subject.
    low, high = LAG_SEARCH_S
    ppg = np.sort(np.asarray(ppg_peaks_s, dtype=float))
    delays = []
    for r_peak in np.asarray(r_peaks_s, dtype=float):
        if r_peak >= LAG_ESTIMATE_SPAN_S:
            continue
        following = ppg[np.searchsorted(ppg, r_peak + low, side="left") :]
        if following.size and following[0] - r_peak <= high:
            delays.append(following[0] - r_peak)
    return float(np.median(delays)) if delays else None


def matched_pairs(ecg_s: np.ndarray, ppg_s: np.ndarray, tolerance_s: float = MATCH_TOLERANCE_S) -> int:
    # One-to-one matches within ±tolerance, taken greedily from the nearest pair outward.
    ecg, ppg = np.asarray(ecg_s, dtype=float), np.asarray(ppg_s, dtype=float)
    candidates = sorted(
        (abs(ppg[j] - ecg[i]), i, j)
        for i in range(len(ecg))
        for j in range(len(ppg))
        if abs(ppg[j] - ecg[i]) <= tolerance_s
    )
    used_ecg, used_ppg = set(), set()
    for _distance, i, j in candidates:
        if i not in used_ecg and j not in used_ppg:
            used_ecg.add(i)
            used_ppg.add(j)
    return len(used_ecg)


def beat_f1(ecg_s: np.ndarray, ppg_s: np.ndarray) -> float:
    total = len(ecg_s) + len(ppg_s)
    return math.nan if total == 0 else 2 * matched_pairs(ecg_s, ppg_s) / total


def is_reference_clean(ecg_s: np.ndarray, shifted_ppg_s: np.ndarray) -> bool:
    return len(ecg_s) >= MIN_ECG_BEATS and beat_f1(ecg_s, shifted_ppg_s) >= REFERENCE_CLEAN_F1


class BiasWindows(NamedTuple):
    # One row per reference-clean 4 s window; flat windows are tallied separately and never appear here.
    subjects: np.ndarray
    is_af: np.ndarray
    accepted: np.ndarray  # P(clean) ≥ τ_clean
    hr_bpm: np.ndarray  # from the window's ECG beats


def _subject_counts(windows: BiasWindows, subjects: Sequence[str]) -> tuple[np.ndarray, np.ndarray]:
    accepted = np.array([np.sum(windows.accepted[windows.subjects == subject]) for subject in subjects])
    totals = np.array([np.sum(windows.subjects == subject) for subject in subjects])
    return accepted.astype(float), totals.astype(float)


def _pooled_gap_pts(accepted_af, totals_af, accepted_non_af, totals_non_af) -> float:
    if totals_af.sum() == 0 or totals_non_af.sum() == 0:
        return math.nan
    return 100 * (accepted_non_af.sum() / totals_non_af.sum() - accepted_af.sum() / totals_af.sum())


def stratified_gap_ci(
    af_counts: tuple[np.ndarray, np.ndarray],
    non_af_counts: tuple[np.ndarray, np.ndarray],
    n_resamples: int = BOOTSTRAP_RESAMPLES,
    seed: int = SEED,
) -> tuple[float, float, int]:
    # 95% CI of the gap, resampling whole subjects with replacement within the AF and non-AF groups.
    rng = np.random.default_rng(seed)
    draws = np.empty(n_resamples)
    for draw in range(n_resamples):
        af = rng.integers(0, len(af_counts[0]), size=len(af_counts[0]))
        non_af = rng.integers(0, len(non_af_counts[0]), size=len(non_af_counts[0]))
        draws[draw] = _pooled_gap_pts(
            af_counts[0][af], af_counts[1][af], non_af_counts[0][non_af], non_af_counts[1][non_af]
        )
    defined = draws[~np.isnan(draws)]
    if defined.size == 0:
        raise ValueError("the gap was undefined in every bootstrap resample")
    return float(np.percentile(defined, 2.5)), float(np.percentile(defined, 97.5)), n_resamples - defined.size


def _acceptance(windows: BiasWindows, mask: np.ndarray) -> float | None:
    return float(np.mean(windows.accepted[mask])) if mask.any() else None


def _tertiles(windows: BiasWindows) -> list[dict]:
    # Edges come from both groups pooled, so a rate difference between AF and non-AF cannot hide in them.
    edges = np.quantile(windows.hr_bpm, [1 / 3, 2 / 3])
    tertile = np.searchsorted(edges, windows.hr_bpm, side="right")
    bounds = [-math.inf, *edges.tolist(), math.inf]
    rows = []
    for index in range(3):
        in_tertile = tertile == index
        af = _acceptance(windows, in_tertile & windows.is_af)
        non_af = _acceptance(windows, in_tertile & ~windows.is_af)
        rows.append(
            {
                "hrBpmFrom": bounds[index] if math.isfinite(bounds[index]) else None,
                "hrBpmTo": bounds[index + 1] if math.isfinite(bounds[index + 1]) else None,
                "windowsAf": int(np.sum(in_tertile & windows.is_af)),
                "windowsNonAf": int(np.sum(in_tertile & ~windows.is_af)),
                "acceptRateAf": af,
                "acceptRateNonAf": non_af,
                "gapPts": None if af is None or non_af is None else 100 * (non_af - af),
            }
        )
    return rows


def rhythm_bias_report(
    windows: BiasWindows, af_subjects: Sequence[str], non_af_subjects: Sequence[str]
) -> dict:
    # ML-4 per ADR 0028: pooled acceptance gap (non-AF − AF) in points, with a stratified subject CI.
    # Every subject of each group is a cluster, including those with no reference-clean window.
    af_counts = _subject_counts(windows, af_subjects)
    non_af_counts = _subject_counts(windows, non_af_subjects)
    clean_af, clean_non_af = int(af_counts[1].sum()), int(non_af_counts[1].sum())
    gap = _pooled_gap_pts(*af_counts, *non_af_counts)
    sufficient = min(clean_af, clean_non_af) >= MIN_CLEAN_WINDOWS_PER_GROUP
    low, high, undefined = (
        stratified_gap_ci(af_counts, non_af_counts) if not math.isnan(gap) else (None, None, 0)
    )

    def per_subject_rates(counts: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
        has_windows = counts[1] > 0
        return counts[0][has_windows] / counts[1][has_windows]

    af_rates, non_af_rates = per_subject_rates(af_counts), per_subject_rates(non_af_counts)
    equal_weight = (
        100 * (float(np.mean(non_af_rates)) - float(np.mean(af_rates)))
        if af_rates.size and non_af_rates.size
        else None
    )
    measured_gap = None if math.isnan(gap) else gap
    return {
        # m3.mjs reads rhythmBiasGapPts; with too little data ML-4 is not claimed, so it stays null.
        "rhythmBiasGapPts": measured_gap if sufficient else None,
        "status": "measured" if sufficient else "insufficient-data",
        "passed": bool(sufficient and abs(gap) <= MAX_GAP_PTS),
        "ci95": None if low is None else [low, high],
        "undefinedResamples": undefined,
        "acceptRateAf": _acceptance(windows, windows.is_af),
        "acceptRateNonAf": _acceptance(windows, ~windows.is_af),
        "breakdown": {
            "gapPtsAsMeasured": measured_gap,
            "referenceCleanWindowsAf": clean_af,
            "referenceCleanWindowsNonAf": clean_non_af,
            "minimumPerGroup": MIN_CLEAN_WINDOWS_PER_GROUP,
            "referenceCleanWindowsPerSubject": {
                subject: int(total)
                for subject, total in zip(
                    [*af_subjects, *non_af_subjects], [*af_counts[1], *non_af_counts[1]], strict=True
                )
            },
            "gapPtsSubjectsEqualWeight": equal_weight,
            "byHeartRateTertile": _tertiles(windows) if len(windows.hr_bpm) >= 3 else [],
        },
    }
