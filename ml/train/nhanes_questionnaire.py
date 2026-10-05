import argparse
import hashlib
import json

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from datasets import registry
from export.specs import RUNS_DIR
from train.ada_risk import ada_risk

# ADR 0091 (pre-registered 2026-10-04): a questionnaire model on NHANES, trained on cycles G, H and I; cycle J
# (2017-18) is the held-out test and is read only by eval.nhanes_test.
TRAIN_CYCLES = ("G", "H", "I")
TEST_CYCLE = "J"
DATASET_OF_CYCLE = {"G": "nhanes", "H": "nhanes", "I": "nhanes", "J": "nhanes-2017"}
TABLES = ("DEMO", "BMX", "BPQ", "DIQ", "MCQ", "PAQ", "RHQ", "GHB", "GLU")
# The ADR 0090 profile answers (height and weight enter as BMI), in model input order.
INPUTS = [
    "ageYears",
    "male",
    "bmi",
    "familyHistory",
    "hypertension",
    "physicallyActive",
    "gestationalDiabetes",
]
# ADA 2024 diagnostic cut-offs: HbA1c ≥ 6.5 % or fasting plasma glucose ≥ 126 mg/dL.
HBA1C_DIABETES, FASTING_GLUCOSE_DIABETES = 6.5, 126.0
MIN_AGE_YEARS = 20
BANG_FLAG = 5
YES, NO = 1.0, 2.0
SEED = 20261004
MODEL_FILE = "nhanes-questionnaire-model.json"
EXCLUSIONS_FILE = "nhanes-exclusions.json"
# LightGBM's monotone constraints in INPUTS order: activity lowers risk, every other answer raises it.
# https://lightgbm.readthedocs.io/en/latest/Parameters.html#monotone_constraints
MONOTONE = [1, 1, 1, 1, 1, -1, 1]


def read_cycle(cycle: str) -> pd.DataFrame:
    key = DATASET_OF_CYCLE[cycle]
    folder = next(dataset for dataset in registry.DATASETS if dataset.key == key).local_dir
    # SAS transport files, https://pandas.pydata.org/docs/reference/api/pandas.read_sas.html
    merged = pd.read_sas(folder / f"DEMO_{cycle}.xpt")
    for table in TABLES[1:]:
        merged = merged.merge(pd.read_sas(folder / f"{table}_{cycle}.xpt"), on="SEQN", how="left")
    return merged


def inclusion_steps(raw: pd.DataFrame) -> dict[str, pd.Series]:
    # In the order the exclusions are counted. RIDSTATR 2 = interviewed and examined; RIDEXPRG 1 = pregnant at
    # the exam (BMI and glucose differ). A label needs a diabetes answer (borderline = 3) or a lab value.
    bmi = raw.BMXWT / (raw.BMXHT / 100) ** 2
    return {
        "examined": raw.RIDSTATR == 2,
        "age20OrOlder": raw.RIDAGEYR >= MIN_AGE_YEARS,
        "notPregnant": raw.RIDEXPRG != 1,
        "bmi10To100": bmi.between(10, 100),
        "bloodPressureAnswered": raw.BPQ020.isin([YES, NO]),
        "activityAnswered": raw.PAQ650.isin([YES, NO]) | raw.PAQ665.isin([YES, NO]),
        "labelKnown": raw.DIQ010.isin([YES, NO, 3.0]) | raw.LBXGH.notna() | raw.LBXGLU.notna(),
    }


def exclusion_counts(raw: pd.DataFrame) -> dict[str, int]:
    remaining = pd.Series(True, index=raw.index)
    dropped = {}
    for step, keep in inclusion_steps(raw).items():
        dropped[step] = int((remaining & ~keep).sum())
        remaining &= keep
    return {"participants": len(raw), "excludedAt": dropped, "included": int(remaining.sum())}


def answers_and_label(raw: pd.DataFrame, cycle: str) -> pd.DataFrame:
    adults = raw[np.logical_and.reduce(list(inclusion_steps(raw).values()))]
    bmi = adults.BMXWT / (adults.BMXHT / 100) ** 2
    female = adults.RIAGENDR == 2
    diagnosed = adults.DIQ010 == YES
    lab_positive = (adults.LBXGH >= HBA1C_DIABETES) | (adults.LBXGLU >= FASTING_GLUCOSE_DIABETES)
    # "Don't know" about a relative counts as no, as it would in the app's yes/no question.
    frame = pd.DataFrame(
        {
            "seqn": adults.SEQN.astype(int),
            "cycle": cycle,
            "ageYears": adults.RIDAGEYR.astype(float),
            "male": (adults.RIAGENDR == 1).astype(float),
            "bmi": bmi,
            "familyHistory": (adults.MCQ300C == YES).astype(float),
            "hypertension": (adults.BPQ020 == YES).astype(float),
            "physicallyActive": ((adults.PAQ650 == YES) | (adults.PAQ665 == YES)).astype(float),
            "gestationalDiabetes": (female & (adults.RHQ162 == YES)).astype(float),
            "diabetes": (diagnosed | lab_positive).astype(int),
            "diagnosed": diagnosed.astype(int),
            "examWeight": adults.WTMEC2YR,
        }
    )
    return frame.reset_index(drop=True)


def load(cycles: tuple[str, ...]) -> pd.DataFrame:
    return pd.concat([answers_and_label(read_cycle(cycle), cycle) for cycle in cycles], ignore_index=True)


def bang_points(frame: pd.DataFrame) -> np.ndarray:
    # Gestational diabetes is asked but never scored (ADR 0087).
    return np.array(
        [
            ada_risk(
                age_years=float(row.ageYears),
                male=bool(row.male),
                family_history=bool(row.familyHistory),
                hypertension=bool(row.hypertension),
                physically_active=bool(row.physicallyActive),
                bmi=float(row.bmi),
            ).points
            for row in frame.itertuples()
        ],
        dtype=float,
    )


def logistic_design(frame: pd.DataFrame) -> np.ndarray:
    # Squares let risk bend with age and BMI, as Bang's banded points do, while staying a 9-number formula.
    return np.column_stack([frame[INPUTS].to_numpy(float), frame.ageYears**2, frame.bmi**2])


def fit_logistic(frame: pd.DataFrame):
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=5000)).fit(
        logistic_design(frame), frame.diabetes
    )


def fit_lightgbm(frame: pd.DataFrame) -> LGBMClassifier:
    model = LGBMClassifier(
        n_estimators=300,
        learning_rate=0.03,
        num_leaves=15,
        min_child_samples=50,
        monotone_constraints=MONOTONE,
        random_state=SEED,
        verbose=-1,
    )
    return model.fit(frame[INPUTS].to_numpy(float), frame.diabetes)


def logit(model, frame: pd.DataFrame) -> np.ndarray:
    if isinstance(model, LGBMClassifier):
        return model.predict(frame[INPUTS].to_numpy(float), raw_score=True)
    return model.decision_function(logistic_design(frame))


CANDIDATES = {"logistic": fit_logistic, "lightgbm": fit_lightgbm}


def leave_one_cycle_out(frame: pd.DataFrame) -> dict[str, list[float]]:
    scores: dict[str, list[float]] = {"bang": [], **{name: [] for name in CANDIDATES}}
    for held in TRAIN_CYCLES:
        train, test = frame[frame.cycle != held], frame[frame.cycle == held]
        scores["bang"].append(roc_auc_score(test.diabetes, bang_points(test)))
        for name, fit in CANDIDATES.items():
            scores[name].append(roc_auc_score(test.diabetes, logit(fit(train), test)))
    return scores


def frozen_form(name: str, model) -> dict:
    if name == "logistic":
        scaler, regression = model.named_steps.values()
        return {
            "kind": "logistic",
            "design": [*INPUTS, "ageYears^2", "bmi^2"],
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
            "coef": regression.coef_[0].tolist(),
            "intercept": float(regression.intercept_[0]),
        }
    return {"kind": "lightgbm", "inputs": INPUTS, "booster": model.booster_.model_to_string()}


def matched_specificity_threshold(points: np.ndarray, logits: np.ndarray, labels: np.ndarray) -> float:
    # The logit cut whose specificity on these people matches Bang ≥ 5's, for a like-for-like sensitivity.
    bang_specificity = float(np.mean(points[labels == 0] < BANG_FLAG))
    return float(np.quantile(logits[labels == 0], bang_specificity))


def main() -> None:
    argparse.ArgumentParser(description="Train and freeze the NHANES questionnaire model").parse_args()
    exclusions = {cycle: exclusion_counts(read_cycle(cycle)) for cycle in TRAIN_CYCLES}
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    (RUNS_DIR / EXCLUSIONS_FILE).write_text(json.dumps(exclusions, indent=2), encoding="utf-8")
    print(f"exclusions by cycle: {json.dumps(exclusions)}")
    frame = load(TRAIN_CYCLES)
    print(f"training cycles {TRAIN_CYCLES}: {len(frame)} adults, {int(frame.diabetes.sum())} with diabetes")
    scores = leave_one_cycle_out(frame)
    for name, values in scores.items():
        print(
            f"leave-one-cycle-out AUROC {name}: mean {np.mean(values):.3f}",
            ", ".join(f"{value:.3f}" for value in values),
        )
    chosen = max(CANDIDATES, key=lambda name: np.mean(scores[name]))
    model = CANDIDATES[chosen](frame)
    labels = frame.diabetes.to_numpy()
    threshold = matched_specificity_threshold(bang_points(frame), logit(model, frame), labels)
    frozen = {
        "chosen": chosen,
        "model": frozen_form(chosen, model),
        "threshold": threshold,
        "trainCycles": list(TRAIN_CYCLES),
        "trainAdults": len(frame),
        "trainPositives": int(frame.diabetes.sum()),
        "leaveOneCycleOut": scores,
    }
    body = json.dumps(frozen, sort_keys=True)
    (RUNS_DIR / MODEL_FILE).write_text(body, encoding="utf-8")
    print(f"chose {chosen}; frozen {MODEL_FILE} sha256 {hashlib.sha256(body.encode()).hexdigest()}")


if __name__ == "__main__":
    main()
