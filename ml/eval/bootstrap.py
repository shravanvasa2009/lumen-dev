from collections.abc import Callable
from typing import NamedTuple

import numpy as np

Metric = Callable[[np.ndarray, np.ndarray], float]


class ConfidenceInterval(NamedTuple):
    estimate: float
    low: float
    high: float
    # Resamples where the metric was undefined (e.g. AUROC with one class); reported, not hidden.
    undefined_resamples: int


class PredictiveValues(NamedTuple):
    ppv: float
    npv: float


def cluster_bootstrap_ci(
    subjects: np.ndarray,
    y_true: np.ndarray,
    y_score: np.ndarray,
    metric: Metric,
    n_resamples: int = 2000,
    seed: int = 0,
    level: float = 0.95,
) -> ConfidenceInterval:
    subjects, y_true, y_score = np.asarray(subjects), np.asarray(y_true), np.asarray(y_score)
    if not len(subjects) == len(y_true) == len(y_score):
        raise ValueError("subjects, y_true, and y_score must have the same length")
    # Windows from one person are not independent, so whole subjects are resampled with replacement.
    _, subject_index = np.unique(subjects, return_inverse=True)
    rows_by_subject = [np.flatnonzero(subject_index == cluster) for cluster in range(subject_index.max() + 1)]
    rng = np.random.default_rng(seed)
    draws = np.empty(n_resamples)
    for draw in range(n_resamples):
        picked = rng.integers(0, len(rows_by_subject), size=len(rows_by_subject))
        rows = np.concatenate([rows_by_subject[cluster] for cluster in picked])
        draws[draw] = metric(y_true[rows], y_score[rows])
    defined = draws[~np.isnan(draws)]
    if defined.size == 0:
        raise ValueError("the metric was undefined in every bootstrap resample")
    tail = (1 - level) / 2 * 100
    return ConfidenceInterval(
        estimate=float(metric(y_true, y_score)),
        low=float(np.percentile(defined, tail)),
        high=float(np.percentile(defined, 100 - tail)),
        undefined_resamples=int(n_resamples - defined.size),
    )


def ppv_npv(sensitivity: float, specificity: float, prevalence: float) -> PredictiveValues:
    for name, value in (
        ("sensitivity", sensitivity),
        ("specificity", specificity),
        ("prevalence", prevalence),
    ):
        if not 0 <= value <= 1:
            raise ValueError(f"{name} must be in [0, 1], got {value}")
    true_pos = sensitivity * prevalence
    false_pos = (1 - specificity) * (1 - prevalence)
    true_neg = specificity * (1 - prevalence)
    false_neg = (1 - sensitivity) * prevalence
    if true_pos + false_pos == 0 or true_neg + false_neg == 0:
        raise ValueError("PPV or NPV is undefined: no positive or no negative calls at these inputs")
    return PredictiveValues(ppv=true_pos / (true_pos + false_pos), npv=true_neg / (true_neg + false_neg))
