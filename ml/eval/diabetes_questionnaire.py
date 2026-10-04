import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold

from datasets import registry
from datasets.splits import ensure_not_external
from datasets.vitaldb_cases import eligible_cases, ensure_dev_only, load_split
from export.specs import RUNS_DIR
from lumen_dsp.shape_features import SHAPE_FEATURE_NAMES
from nets.diabetes_net import HR_SUMMARY_NAMES
from train.ada_risk import ada_risk
from train.diabetes import ALWAYS_EMPTY

# ADR 0087: the questionnaire alone vs questionnaire + pulse, on development data only (VitalDB dev split; the
# locked holdout is never read). VitalDB has age, sex, BMI and hypertension but not family history or physical
# activity, so the score here is PARTIAL (those two scored "no"); the app asks every item. Dev controls with
# pulse features are matched on sex and age decade (select_dev_cases), removing most age and sex points.
PULSE_COLUMNS = [*SHAPE_FEATURE_NAMES, *(name for name in HR_SUMMARY_NAMES if name not in ALWAYS_EMPTY)]
FOLDS, REPEATS, SEED = 5, 5, 20261004
METRICS_FILE = "diabetes-questionnaire.json"


def partial_points(clinical: pd.DataFrame) -> pd.Series:
    age = pd.to_numeric(clinical["age"].astype("string").str.extract(r"(\d+)")[0], errors="coerce")
    bmi = pd.to_numeric(clinical["bmi"], errors="coerce")

    def points(index: int) -> float:
        if pd.isna(age.loc[index]) or pd.isna(bmi.loc[index]) or not 10 <= bmi.loc[index] <= 100:
            return np.nan
        risk = ada_risk(
            age_years=int(age.loc[index]),
            male=bool(clinical.loc[index, "sex"] == "M"),
            family_history=False,
            hypertension=bool(clinical.loc[index, "preop_htn"] == 1),
            physically_active=False,
            bmi=float(bmi.loc[index]),
        )
        return np.nan if risk is None else float(risk.points)

    return pd.Series([points(index) for index in clinical.index], index=clinical.index)


def out_of_fold_pulse(
    segments: pd.DataFrame, subjects: np.ndarray, labels: np.ndarray, seed: int
) -> np.ndarray:
    # Subject-level score: the mean segment probability of a LightGBM fit on the other folds' subjects.
    scores = np.zeros(len(subjects))
    for train_index, test_index in StratifiedKFold(FOLDS, shuffle=True, random_state=seed).split(
        subjects, labels
    ):
        train = segments[segments["subjectid"].isin(subjects[train_index])]
        test = segments[segments["subjectid"].isin(subjects[test_index])]
        medians = train[PULSE_COLUMNS].median()
        model = LGBMClassifier(
            n_estimators=300,
            learning_rate=0.03,
            num_leaves=7,
            min_child_samples=40,
            subsample=0.8,
            subsample_freq=1,
            colsample_bytree=0.8,
            reg_lambda=5.0,
            random_state=seed,
            verbose=-1,
        ).fit(train[PULSE_COLUMNS].fillna(medians), train["preop_dm"].astype(int))
        by_subject = (
            pd.Series(model.predict_proba(test[PULSE_COLUMNS].fillna(medians))[:, 1], index=test["subjectid"])
            .groupby(level=0)
            .mean()
        )
        scores[test_index] = by_subject.loc[subjects[test_index]].to_numpy()
    return scores


def stacked(points: np.ndarray, pulse: np.ndarray, labels: np.ndarray, seed: int) -> np.ndarray:
    features, scores = np.column_stack([points, pulse]), np.zeros(len(labels))
    for train_index, test_index in StratifiedKFold(FOLDS, shuffle=True, random_state=seed).split(
        features, labels
    ):
        model = LogisticRegression().fit(features[train_index], labels[train_index])
        scores[test_index] = model.predict_proba(features[test_index])[:, 1]
    return scores


def evaluate(clinical: pd.DataFrame, segments: pd.DataFrame, split: dict) -> dict:
    dev = eligible_cases(clinical)
    dev = dev[dev["subjectid"].isin(set(split["dev"]))].drop_duplicates("subjectid").set_index("subjectid")
    ensure_dev_only(dev.index, split)
    dev["points"] = partial_points(dev.reset_index()).to_numpy()
    dev = dev[dev["points"].notna()]
    population = {
        "subjects": int(len(dev)),
        "diabeticSubjects": int(dev["preop_dm"].sum()),
        "questionnaireAuroc": float(roc_auc_score(dev["preop_dm"].astype(int), dev["points"])),
    }
    segments = segments[segments["hasShape"] & segments["subjectid"].isin(dev.index)]
    labels_by_subject = segments.groupby("subjectid")["preop_dm"].first().astype(int)
    subjects, labels = labels_by_subject.index.to_numpy(), labels_by_subject.to_numpy()
    points = dev.loc[subjects, "points"].to_numpy()
    pulse_aurocs, combined_aurocs = [], []
    for repeat in range(REPEATS):
        pulse = out_of_fold_pulse(segments, subjects, labels, SEED + repeat)
        pulse_aurocs.append(roc_auc_score(labels, pulse))
        combined_aurocs.append(roc_auc_score(labels, stacked(points, pulse, labels, SEED + 100 + repeat)))
    matched = {
        "subjects": int(len(subjects)),
        "diabeticSubjects": int(labels.sum()),
        "questionnaireAuroc": float(roc_auc_score(labels, points)),
        "pulseAuroc": {"mean": float(np.mean(pulse_aurocs)), "sd": float(np.std(pulse_aurocs))},
        "questionnairePlusPulseAuroc": {
            "mean": float(np.mean(combined_aurocs)),
            "sd": float(np.std(combined_aurocs)),
        },
        "repeats": REPEATS,
        "folds": FOLDS,
    }
    return {
        "score": "Bang 2009 points, partial: family history and activity not in VitalDB (scored as no)",
        "allEligibleDevSplit": population,
        "matchedPulseSet": matched,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m eval.diabetes_questionnaire")
    parser.add_argument("--segments", type=Path, required=True, help="diabetes_features segments.parquet")
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    args = parser.parse_args(argv)
    ensure_not_external(args.segments, "eval")
    vitaldb = next(dataset for dataset in registry.DATASETS if dataset.key == "vitaldb")
    clinical = pd.read_csv(vitaldb.local_dir / "clinical_data.csv")
    metrics = evaluate(clinical, pd.read_parquet(args.segments), load_split())
    args.runs_dir.mkdir(parents=True, exist_ok=True)
    (args.runs_dir / METRICS_FILE).write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
