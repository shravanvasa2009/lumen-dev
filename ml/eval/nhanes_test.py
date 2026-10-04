import argparse
import hashlib
import json

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from eval.bootstrap import cluster_bootstrap_ci
from export.specs import RUNS_DIR
from train.nhanes_questionnaire import MODEL_FILE, SEED, TEST_CYCLE, bang_points, load

# Workspace docs/research/diabetes-fusion.md: the one-time test of the frozen questionnaire model on NHANES
# 2017-18.
# The hash was recorded there before cycle J was first read; any other model file is refused.
FROZEN_SHA256 = "bed7718cb214e501d6b749db9022bbd0a768d3390785feb3b611588cc8a66a5e"
REPORT_FILE = "nhanes-test.json"
BANG_FLAG = 5


class NhanesTestRefusedError(Exception):
    pass


def frozen_model() -> dict:
    body = (RUNS_DIR / MODEL_FILE).read_text(encoding="utf-8")
    if hashlib.sha256(body.encode()).hexdigest() != FROZEN_SHA256:
        raise NhanesTestRefusedError(f"{MODEL_FILE} is not the pre-registered frozen model")
    return json.loads(body)


def questionnaire_logit(formula: dict, frame: pd.DataFrame) -> np.ndarray:
    # The deployable formula, from the frozen numbers alone: standardise, then a weighted sum.
    design = frame[formula["design"][:-2]].to_numpy(float)
    design = np.column_stack([design, frame.ageYears**2, frame.bmi**2])
    standardised = (design - np.array(formula["mean"])) / np.array(formula["scale"])
    return standardised @ np.array(formula["coef"]) + formula["intercept"]


def auroc_ci(labels: np.ndarray, scores: np.ndarray) -> dict:
    interval = cluster_bootstrap_ci(np.arange(len(labels)), labels, scores, roc_auc_score, seed=SEED)
    return {"estimate": interval.estimate, "low": interval.low, "high": interval.high}


def paired_delta(labels: np.ndarray, model_scores: np.ndarray, bang_scores: np.ndarray) -> dict:
    def delta(y_true: np.ndarray, pair: np.ndarray) -> float:
        return roc_auc_score(y_true, pair[:, 0]) - roc_auc_score(y_true, pair[:, 1])

    pairs = np.column_stack([model_scores, bang_scores])
    interval = cluster_bootstrap_ci(np.arange(len(labels)), labels, pairs, delta, seed=SEED)
    return {"estimate": interval.estimate, "low": interval.low, "high": interval.high}


def sensitivity_specificity(labels: np.ndarray, flagged: np.ndarray) -> dict:
    return {
        "sensitivity": float(flagged[labels == 1].mean()),
        "specificity": float(1 - flagged[labels == 0].mean()),
    }


def report(model: dict, frame: pd.DataFrame) -> dict:
    labels = frame.diabetes.to_numpy()
    model_scores = questionnaire_logit(model["model"], frame)
    bang_scores = bang_points(frame)
    delta = paired_delta(labels, model_scores, bang_scores)
    undiagnosed = frame.diagnosed.to_numpy() == 0
    weights = frame.examWeight.to_numpy()
    return {
        "testCycle": TEST_CYCLE,
        "adults": len(frame),
        "positives": int(labels.sum()),
        "model": auroc_ci(labels, model_scores),
        "bang": auroc_ci(labels, bang_scores),
        "deltaModelMinusBang": delta,
        "success": delta["low"] > 0,
        "secondary": {
            "modelAtThreshold": sensitivity_specificity(labels, model_scores >= model["threshold"]),
            "bangAtFive": sensitivity_specificity(labels, bang_scores >= BANG_FLAG),
            "weightedAuroc": {
                "model": roc_auc_score(labels, model_scores, sample_weight=weights),
                "bang": roc_auc_score(labels, bang_scores, sample_weight=weights),
            },
            "undiagnosedAuroc": {
                "positives": int(labels[undiagnosed].sum()),
                "model": roc_auc_score(labels[undiagnosed], model_scores[undiagnosed]),
                "bang": roc_auc_score(labels[undiagnosed], bang_scores[undiagnosed]),
            },
            "aurocBySex": {
                sex: {
                    "model": roc_auc_score(labels[mask], model_scores[mask]),
                    "bang": roc_auc_score(labels[mask], bang_scores[mask]),
                }
                for sex, mask in (
                    ("male", frame.male.to_numpy() == 1),
                    ("female", frame.male.to_numpy() == 0),
                )
            },
        },
    }


def main() -> None:
    argparse.ArgumentParser(
        description="One-time NHANES 2017-18 test of the questionnaire model"
    ).parse_args()
    output = RUNS_DIR / REPORT_FILE
    if output.exists():
        raise NhanesTestRefusedError(f"{output} exists: the held-out cycle is tested once")
    model = frozen_model()
    results = report(model, load((TEST_CYCLE,)))
    output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
