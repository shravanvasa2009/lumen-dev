import argparse
import hashlib
import json

import numpy as np

from eval.nhanes_test import FROZEN_SHA256, frozen_model, questionnaire_logit
from export.specs import RUNS_DIR
from train.nhanes_questionnaire import TRAIN_CYCLES, load

# ADR 0091 option (a): the higher-risk cut sits at ML-6's specificity floor (acceptance.md: specificity
# ≥ 85% with sensitivity ≥ 60%), set on the training cycles only. The frozen model itself is unchanged.
SPECIFICITY_FLOOR = 0.85
SENSITIVITY_FLOOR = 0.60
CUT_FILE = "nhanes-cut.json"


def floor_threshold(logits: np.ndarray, labels: np.ndarray, specificity: float) -> float:
    return float(np.quantile(logits[labels == 0], specificity))


def operating_point(logits: np.ndarray, labels: np.ndarray, threshold: float) -> dict:
    flagged = logits >= threshold
    return {
        "sensitivity": float(flagged[labels == 1].mean()),
        "specificity": float(1 - flagged[labels == 0].mean()),
    }


def main() -> None:
    argparse.ArgumentParser(description="Set the NHANES model's cut at ML-6's specificity floor").parse_args()
    frame = load(TRAIN_CYCLES)
    labels = frame.diabetes.to_numpy()
    logits = questionnaire_logit(frozen_model()["model"], frame)
    threshold = floor_threshold(logits, labels, SPECIFICITY_FLOOR)
    training = operating_point(logits, labels, threshold)
    cut = {
        "modelSha256": FROZEN_SHA256,
        "specificityFloor": SPECIFICITY_FLOOR,
        "threshold": threshold,
        "trainCycles": list(TRAIN_CYCLES),
        "training": training,
        "trainingMeetsSensitivityFloor": training["sensitivity"] >= SENSITIVITY_FLOOR,
    }
    body = json.dumps(cut, sort_keys=True)
    (RUNS_DIR / CUT_FILE).write_text(body, encoding="utf-8")
    print(f"{body}\nsha256 {hashlib.sha256(body.encode()).hexdigest()}")


if __name__ == "__main__":
    main()
