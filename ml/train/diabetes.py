import argparse
import json
import logging
import math
import pickle
import time
from pathlib import Path
from typing import NamedTuple

import lightgbm
import numpy as np
import pandas as pd
import torch
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler
from torch import nn

from datasets.splits import ensure_not_external
from datasets.vitaldb_cases import DEV_SPLIT_FILE, SPLIT_FILE, ensure_dev_only, load_dev_split, load_split
from export.provenance import sha256_of
from export.specs import RUNS_DIR, SPECS, ModelSpec
from nets.diabetes_net import BEAT, HR_SUMMARY, SHAPE_FEATURE_NAMES, DiabetesNet
from train.hr_summary import HR_SUMMARY_NAMES
from train.rhythm import (
    LGBM_EARLY_STOPPING_ROUNDS,
    LGBM_PARAMS,
    Units,
    auroc,
    head_logits,
    predictive_value_at,
    reliability,
    sensitivity_at,
    specificity_at,
    threshold_for_specificity,
    with_ci,
)

NETWORK = SPECS["diabetes-net"]
LOGISTIC = SPECS["diabetes-logistic"]
LGBM = SPECS["diabetes-lgbm"]
# ADR 0047: an HR-summary-only model sits in the ablation table so heart-rate confounding is visible. It is
# never exported.
HR_ONLY = "hr-summary-logistic"
SEED = 20261026
# ADR 0061 (proposed): τ_DM is the lowest threshold whose dev-val subject-level specificity meets the
# specificity part of ML-6's external floor (≥ 85%), so it keeps the most sensitivity that floor allows.
TARGET_SPECIFICITY = 0.85
THRESHOLD_RULE = (
    f"τ_DM is the lowest threshold at which dev-val subject-level specificity is at least "
    f"{TARGET_SPECIFICITY:.0%}; a subject's score is the mean probability over that subject's 90 s "
    "segments (ADR 0061, proposed)."
)
# §11.4 "The evidence gate (ML-6)": PPV and NPV at these hypothetical prevalences.
PREVALENCES = (0.05, 0.116, 0.20)
DEV_SPLITS = ("dev-train", "dev-val")
TABULAR = (*SHAPE_FEATURE_NAMES, *HR_SUMMARY_NAMES)
INPUT_COLUMNS = {"shapeFeatures": SHAPE_FEATURE_NAMES, "hrSummary": HR_SUMMARY_NAMES}
TABLE_COLUMNS = ("subject", "label", "split", "beat", *TABULAR)
DATASET = "vitaldb"
# Pinned by the export spec, so the table, the network, and the ONNX inputs cannot disagree on widths.
assert len(HR_SUMMARY_NAMES) == HR_SUMMARY == NETWORK.inputs["hrSummary"][1]
assert len(SHAPE_FEATURE_NAMES) == LOGISTIC.inputs["shapeFeatures"][1] == LGBM.inputs["shapeFeatures"][1]

log = logging.getLogger("train.diabetes")


class TrainConfig(NamedTuple):
    max_epochs: int = 100
    patience: int = 10
    batch_size: int = 128
    learning_rate: float = 1e-3
    seed: int = SEED


class SegmentSet(NamedTuple):
    # One row per 90 s segment: beats [N, 1, 256], tabular [N, 16] in TABULAR order with gaps filled.
    beats: np.ndarray
    tabular: np.ndarray
    is_diabetic: np.ndarray
    subjects: np.ndarray


def load_feature_table(
    path: Path, split_file: Path = SPLIT_FILE, dev_split_file: Path = DEV_SPLIT_FILE
) -> pd.DataFrame:
    # The input boundary: one row per 90 s segment with an averaged beat, built from the ADR 0047 cache
    # by whatever computes the 12 shape features and the HR summary with lumen_dsp.
    ensure_not_external(path, "train")
    table = pd.read_parquet(path)
    missing = [column for column in TABLE_COLUMNS if column not in table.columns]
    if missing:
        raise ValueError(f"{path} lacks columns {missing}")
    if not pd.api.types.is_integer_dtype(table["subject"]):
        raise ValueError("subject must hold integer VitalDB subject IDs")
    if not pd.api.types.is_bool_dtype(table["label"]):
        raise ValueError("label must be boolean (True for preop_dm == 1)")
    ensure_dev_only(table["subject"].tolist(), load_split(split_file))
    locked = load_dev_split(dev_split_file)
    misplaced = table["subject"].map(locked) != table["split"]
    if misplaced.any():
        examples = table.loc[misplaced, "subject"].unique()[:3].tolist()
        raise ValueError(
            f"{int(misplaced.sum())} segments are not in their locked {dev_split_file.name} split, e.g. "
            f"subjects {examples}"
        )
    mixed = table.groupby("subject")["label"].nunique() > 1
    if mixed.any():
        raise ValueError(f"subjects with both labels: {mixed[mixed].index[:3].tolist()}")
    beat_ok = table["beat"].map(
        lambda beat: beat is not None and len(beat) == BEAT and np.isfinite(beat).all()
    )
    if not beat_ok.all():
        raise ValueError(f"{int((~beat_ok).sum())} segments lack a finite {BEAT}-sample averaged beat")
    # Undefined features arrive as null and are filled; an infinity would pass the fill and reach the model.
    infinite = [name for name in TABULAR if np.isinf(table[name].astype(float)).any()]
    if infinite:
        raise ValueError(f"infinite values in {infinite}; undefined features must be null")
    return table


def fill_medians(table: pd.DataFrame) -> dict[str, float]:
    # Undefined features (no c/d/e wave, too few NN intervals) are filled with the dev-train median, which
    # the app applies too (order D.C_TASK-diabetes-shape-features: core returns null and never imputes).
    train = table[table["split"] == "dev-train"]
    medians = train[list(TABULAR)].astype(float).median()
    empty = medians[medians.isna()].index.tolist()
    if empty:
        raise ValueError(f"no dev-train value to fill from for {empty}")
    return {name: float(medians[name]) for name in TABULAR}


def segment_set(table: pd.DataFrame, split: str, medians: dict[str, float]) -> SegmentSet:
    rows = table[table["split"] == split]
    tabular = rows[list(TABULAR)].astype(float).fillna(medians).to_numpy(np.float32)
    return SegmentSet(
        np.stack(rows["beat"].to_numpy()).astype(np.float32)[:, None, :],
        tabular,
        rows["label"].to_numpy(bool),
        rows["subject"].to_numpy(np.int64),
    )


def _columns(names: tuple[str, ...]) -> list[int]:
    return [TABULAR.index(name) for name in names]


def shape_inputs(segments: SegmentSet) -> np.ndarray:
    return segments.tabular[:, _columns(SHAPE_FEATURE_NAMES)]


def hr_inputs(segments: SegmentSet) -> np.ndarray:
    return segments.tabular[:, _columns(HR_SUMMARY_NAMES)]


def sample_weights(segments: SegmentSet) -> np.ndarray:
    # Each label carries equal total weight and, within a label, each subject does, so a patient with many
    # segments counts once. Mean weight is 1.
    if segments.is_diabetic.all() or not segments.is_diabetic.any():
        raise ValueError("sample weights need both diabetic and control segments")
    frame = pd.DataFrame({"label": segments.is_diabetic, "subject": segments.subjects})
    per_subject = frame.groupby("subject")["label"].transform("size")
    subjects_per_label = frame.groupby("label")["subject"].transform("nunique")
    weights = 1.0 / (per_subject * subjects_per_label).to_numpy(float)
    return (weights / weights.mean()).astype(np.float32)


def _tensors(segments: SegmentSet) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    return (
        torch.from_numpy(segments.beats),
        torch.from_numpy(shape_inputs(segments)),
        torch.from_numpy(hr_inputs(segments)),
    )


def weighted_bce(logits: torch.Tensor, labels: torch.Tensor, weights: torch.Tensor) -> torch.Tensor:
    losses = nn.functional.binary_cross_entropy_with_logits(logits[:, 0], labels, reduction="none")
    return (losses * weights).sum() / weights.sum()


def initial_model(train: SegmentSet, seed: int) -> DiabetesNet:
    # As Rhythm-Net: the dev-train scaling is folded into the graph, so the app sends filled raw features.
    torch.manual_seed(seed)
    model = DiabetesNet()
    tabular = np.concatenate([shape_inputs(train), hr_inputs(train)], axis=1).astype(np.float64)
    spread = tabular.std(axis=0)
    constant = spread == 0
    if constant.any():
        log.info("constant dev-train features, ignored by the network: %s", np.asarray(TABULAR)[constant])
    pooled_width = model.head[0].in_features - len(TABULAR)
    with torch.no_grad():
        model.standardize.mean.copy_(torch.from_numpy(tabular.mean(axis=0)))
        model.standardize.std.copy_(torch.from_numpy(np.where(constant, 1.0, spread)))
        # A constant feature standardizes to 0 in training, so its zeroed weights stay 0 and whatever the
        # app sends there has no effect.
        model.head[0].weight[:, pooled_width:][:, torch.from_numpy(constant)] = 0.0
    return model


def _val_loss(model: DiabetesNet, val: SegmentSet) -> float:
    model.eval()
    with torch.no_grad():
        logits = head_logits(model, *_tensors(val))
        labels = torch.from_numpy(val.is_diabetic.astype(np.float32))
        return float(weighted_bce(logits, labels, torch.from_numpy(sample_weights(val))))


def train_network(train: SegmentSet, val: SegmentSet, config: TrainConfig) -> tuple[DiabetesNet, list[dict]]:
    # Minutes on a CPU for a few thousand segments, so unlike Rhythm-Net there are no resumable checkpoints.
    model = initial_model(train, config.seed)
    optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate)
    inputs = _tensors(train)
    labels = torch.from_numpy(train.is_diabetic.astype(np.float32))
    weights = torch.from_numpy(sample_weights(train))
    best_loss, best_state, bad_epochs, history = math.inf, None, 0, []
    for epoch in range(1, config.max_epochs + 1):
        started = time.perf_counter()
        order = torch.randperm(len(labels), generator=torch.Generator().manual_seed(config.seed + epoch))
        model.train()
        batch_losses = []
        for batch in order.split(config.batch_size):
            optimizer.zero_grad()
            loss = weighted_bce(
                head_logits(model, *(tensor[batch] for tensor in inputs)), labels[batch], weights[batch]
            )
            loss.backward()
            optimizer.step()
            batch_losses.append(loss.item())
        val_loss = _val_loss(model, val)
        history.append(
            {
                "epoch": epoch,
                "trainLoss": float(np.mean(batch_losses)),
                "valLoss": val_loss,
                "seconds": time.perf_counter() - started,
            }
        )
        log.info("epoch %d: train %.4f, dev-val %.4f", epoch, history[-1]["trainLoss"], val_loss)
        if val_loss < best_loss:
            best_loss, bad_epochs = val_loss, 0
            best_state = {name: tensor.detach().clone() for name, tensor in model.state_dict().items()}
            continue
        bad_epochs += 1
        if bad_epochs >= config.patience:
            break
    model.load_state_dict(best_state)
    return model.eval(), history


def network_scores(model: DiabetesNet, segments: SegmentSet) -> np.ndarray:
    with torch.no_grad():
        return model(*_tensors(segments)).numpy()[:, 0].astype(np.float64)


def class_labels(segments: SegmentSet) -> np.ndarray:
    # 0/1 rather than bool, so the ONNX converters see integer classes, as for the rhythm baselines.
    return segments.is_diabetic.astype(np.int64)


def fit_logistic(features: np.ndarray, train: SegmentSet) -> Pipeline:
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=5000)).fit(
        features, class_labels(train), logisticregression__sample_weight=sample_weights(train)
    )


def fit_lgbm(train: SegmentSet, val: SegmentSet, seed: int) -> LGBMClassifier:
    # Rhythm's tree settings: one tree per round here instead of three, so the 240-round cap stays near
    # 160 KB, under diabetes's §11.9 limit of 300 KB.
    params = {**LGBM_PARAMS, "random_state": seed}
    train_weights = sample_weights(train)
    probe = LGBMClassifier(**params).fit(
        shape_inputs(train),
        class_labels(train),
        sample_weight=train_weights,
        # eval_X / eval_y replace the deprecated eval_set in LightGBM 4.7
        # (https://lightgbm.readthedocs.io/en/stable/pythonapi/lightgbm.LGBMClassifier.html).
        eval_X=(shape_inputs(val),),
        eval_y=(class_labels(val),),
        eval_sample_weight=[sample_weights(val)],
        callbacks=[lightgbm.early_stopping(LGBM_EARLY_STOPPING_ROUNDS, verbose=False)],
    )
    # Refit with exactly the early-stopping round count, so predict_proba, the pickle, and the ONNX export
    # hold the same trees.
    return LGBMClassifier(**{**params, "n_estimators": probe.best_iteration_}).fit(
        shape_inputs(train), class_labels(train), sample_weight=train_weights
    )


def subject_units(scores: np.ndarray, segments: SegmentSet) -> Units:
    # The app averages a person's readings, so a subject's score is the mean over that subject's segments.
    frame = pd.DataFrame({"score": scores, "label": segments.is_diabetic, "subject": segments.subjects})
    grouped = frame.groupby("subject", sort=True).agg(score=("score", "mean"), label=("label", "first"))
    return Units(grouped["score"].to_numpy(), grouped["label"].to_numpy(bool), grouped.index.to_numpy())


def diabetes_threshold(subjects: Units) -> float:
    return threshold_for_specificity(subjects.scores[~subjects.is_af], TARGET_SPECIFICITY)


def evaluate(scores: np.ndarray, val: SegmentSet) -> dict:
    # Units.is_af holds "is diabetic" here: the rhythm helpers only read it as the positive class.
    subjects = subject_units(scores, val)
    tau = diabetes_threshold(subjects)
    specificity = specificity_at(tau)(subjects.is_af, subjects.scores)
    if specificity < TARGET_SPECIFICITY:
        raise ValueError(
            f"subject-level specificity {specificity:.4f} at τ_DM {tau} is below {TARGET_SPECIFICITY}"
        )
    metrics = {
        "subjectAuroc": with_ci(subjects, auroc),
        "subjectSensitivity": with_ci(subjects, sensitivity_at(tau)),
        "subjectSpecificity": with_ci(subjects, specificity_at(tau)),
        # A segment is a 90 s pseudo-reading, scored as the app scores one Full Scan.
        "readingAuroc": with_ci(Units(scores, val.is_diabetic, val.subjects), auroc),
    }
    for prevalence in PREVALENCES:
        for which in ("ppv", "npv"):
            metrics[f"subject{which.title()}At{prevalence * 100:g}PctPrevalence"] = with_ci(
                subjects, predictive_value_at(tau, prevalence, which)
            )
    undefined = sorted(name for name, value in metrics.items() if value is None)
    return {
        "tau": tau,
        "metrics": {name: value for name, value in metrics.items() if value is not None},
        "undefined": undefined,
        "subjects": subjects,
    }


def _formatted(metric: dict | None) -> str:
    if metric is None:
        return "undefined"
    return f"{metric['estimate']:.3f} ({metric['low']:.3f}-{metric['high']:.3f})"


def ship_decision(evaluations: dict[str, dict]) -> dict:
    # §11.4: diabetes-net ships only if it beats the best baseline on dev-val subjects. The criterion, fixed
    # before training, is subject-level AUROC; the paired difference shows how sure that is. The HR-only
    # ablation is not a baseline for this choice.
    baselines = [LOGISTIC.name, LGBM.name]
    best = max(baselines, key=lambda name: evaluations[name]["metrics"]["subjectAuroc"]["estimate"])
    network_units, baseline_units = evaluations[NETWORK.name]["subjects"], evaluations[best]["subjects"]
    paired = Units(
        np.column_stack([network_units.scores, baseline_units.scores]),
        network_units.is_af,
        network_units.subjects,
    )
    difference = with_ci(
        paired, lambda is_diabetic, both: auroc(is_diabetic, both[:, 0]) - auroc(is_diabetic, both[:, 1])
    )
    network_auroc = evaluations[NETWORK.name]["metrics"]["subjectAuroc"]["estimate"]
    return {
        "criterion": "subject-level AUROC for diabetic vs not on dev-val",
        "bestBaseline": best,
        "networkMinusBestBaselineAuroc": difference,
        "ships": NETWORK.name
        if network_auroc > evaluations[best]["metrics"]["subjectAuroc"]["estimate"]
        else best,
    }


MODEL_INPUTS = {
    NETWORK.name: "averaged beat, 12 shape features, HR summary",
    LOGISTIC.name: "12 shape features",
    LGBM.name: "12 shape features",
    HR_ONLY: "HR summary only (ablation, not exported)",
}


def ablation_rows(evaluations: dict[str, dict]) -> list[dict]:
    return [
        {
            "model": name,
            "inputs": MODEL_INPUTS[name],
            "subject AUROC (95% CI)": _formatted(evaluation["metrics"].get("subjectAuroc")),
            "subject sensitivity at τ_DM": _formatted(evaluation["metrics"].get("subjectSensitivity")),
            "subject specificity at τ_DM": _formatted(evaluation["metrics"].get("subjectSpecificity")),
            "reading AUROC": _formatted(evaluation["metrics"].get("readingAuroc")),
            "τ_DM": f"{evaluation['tau']:.4f}",
        }
        for name, evaluation in evaluations.items()
    ]


def calibration_summary(scores: np.ndarray, val: SegmentSet) -> dict:
    # Weighted like training (each label equal, then each subject), so observed shares hold for a 50%
    # balance, not for any real-world prevalence.
    rows, calibration_error = reliability(scores, val.is_diabetic, sample_weights(val).astype(np.float64))
    return {
        "method": "none: the model's own probabilities, not recalibrated",
        "unit": "dev-val 90 s segments (the 'windows' count in each row), weighted by label and subject",
        "segmentExpectedCalibrationErrorPattern": calibration_error,
        "reliabilityPattern": rows,
    }


def training_notes(table: pd.DataFrame, train: SegmentSet, val: SegmentSet, decision: dict) -> list[str]:
    def described(segments: SegmentSet) -> str:
        diabetic = len(set(segments.subjects[segments.is_diabetic].tolist()))
        control = len(set(segments.subjects[~segments.is_diabetic].tolist()))
        return f"{diabetic} diabetic and {control} control subjects, {len(segments.subjects)} segments"

    filled = {name: int(table[name].isna().sum()) for name in TABULAR if table[name].isna().any()}
    return [
        f"Data: VitalDB development patients (ADR 0047), 90 s PLETH segments with a DSP-14 averaged beat. "
        f"dev-train: {described(train)}; dev-val: {described(val)}. The locked holdout (ADR 0014) is never "
        "read.",
        "Missing shape or HR-summary values are filled with the dev-train median of that feature "
        f"(fillMedians); segments filled per feature, dev-train and dev-val together: {filled or 'none'}.",
        "Training, early stopping, and both baselines weight segments so each label carries equal weight and "
        "each subject equal weight within its label.",
        f"Threshold: {THRESHOLD_RULE}",
        "Dev-val numbers are optimistic: early stopping, model choice, and τ_DM were all chosen on dev-val. "
        "The locked VitalDB holdout is the unbiased check.",
        "The HR-summary-only model is in the ablation table to show how much heart rate and HRV alone "
        "separate the groups (ADR 0047).",
        f"Ship rule (§11.4, {decision['criterion']}): {decision['ships']} is the v1 diabetes model.",
    ]


def metrics_file(
    spec: ModelSpec,
    source: Path,
    evaluation: dict,
    val: SegmentSet,
    medians: dict,
    calibration: dict,
    shared: dict,
) -> dict:
    source_sha = sha256_of(source)
    order = {name: list(INPUT_COLUMNS[name]) for name in spec.inputs if name in INPUT_COLUMNS}
    return {
        "trainedOn": [DATASET],
        "threshold": {"pattern": evaluation["tau"]},
        "thresholdRule": THRESHOLD_RULE,
        "development": {
            "subjects": len(evaluation["subjects"].subjects),
            "diabeticSubjects": int(evaluation["subjects"].is_af.sum()),
            "segments": len(val.subjects),
            "metrics": evaluation["metrics"],
            "undefinedMetrics": evaluation["undefined"],
        },
        "sourceSha256": source_sha,
        "featureOrder": order,
        "fillMedians": {column: medians[column] for names in order.values() for column in names},
        # Keyed to the weights it measured, so write_manifest refuses it next to any other model file.
        "calibration": {"sourceSha256": source_sha, "measuredBy": "python -m train.diabetes", **calibration},
        **shared,
    }


def train_and_write(table: pd.DataFrame, runs_dir: Path, config: TrainConfig) -> dict:
    started = time.perf_counter()
    medians = fill_medians(table)
    train, val = (segment_set(table, split, medians) for split in DEV_SPLITS)
    model, history = train_network(train, val, config)
    logistic = fit_logistic(shape_inputs(train), train)
    lgbm = fit_lgbm(train, val, config.seed)
    hr_only = fit_logistic(hr_inputs(train), train)
    scores = {
        NETWORK.name: network_scores(model, val),
        LOGISTIC.name: logistic.predict_proba(shape_inputs(val))[:, 1].astype(np.float64),
        LGBM.name: lgbm.predict_proba(shape_inputs(val))[:, 1].astype(np.float64),
        HR_ONLY: hr_only.predict_proba(hr_inputs(val))[:, 1].astype(np.float64),
    }
    evaluations = {name: evaluate(model_scores, val) for name, model_scores in scores.items()}
    decision = ship_decision(evaluations)

    runs_dir.mkdir(parents=True, exist_ok=True)
    sources = {
        NETWORK.name: runs_dir / NETWORK.source_file,
        LOGISTIC.name: runs_dir / LOGISTIC.source_file,
        LGBM.name: runs_dir / LGBM.source_file,
    }
    torch.save(model.state_dict(), sources[NETWORK.name])
    sources[LOGISTIC.name].write_bytes(pickle.dumps(logistic))
    sources[LGBM.name].write_bytes(pickle.dumps(lgbm))
    shared = {
        "ablation": ablation_rows(evaluations),
        "shipDecision": decision,
        "notes": training_notes(table, train, val, decision),
        "processSeconds": time.perf_counter() - started,
        "networkEpochs": history,
    }
    for spec in (NETWORK, LOGISTIC, LGBM):
        metrics = metrics_file(
            spec,
            sources[spec.name],
            evaluations[spec.name],
            val,
            medians,
            calibration_summary(scores[spec.name], val),
            shared,
        )
        (runs_dir / f"{spec.file_stem}.json").write_text(
            json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    log.info(
        "ships: %s (subject AUROC, network minus %s: %s)",
        decision["ships"],
        decision["bestBaseline"],
        _formatted(decision["networkMinusBestBaselineAuroc"]),
    )
    return decision


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m train.diabetes", description="Train diabetes-net and baselines on development splits"
    )
    parser.add_argument("--features", type=Path, required=True, help="the segment feature table (parquet)")
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    parser.add_argument("--splits", type=Path, default=SPLIT_FILE, help="the locked holdout split")
    parser.add_argument("--dev-splits", type=Path, default=DEV_SPLIT_FILE)
    parser.add_argument("--max-epochs", type=int, default=TrainConfig().max_epochs)
    parser.add_argument("--patience", type=int, default=TrainConfig().patience)
    args = parser.parse_args(argv)
    args.runs_dir.mkdir(parents=True, exist_ok=True)
    # A background run is followed in this file, next to the models it writes.
    handler = logging.FileHandler(args.runs_dir / f"{NETWORK.file_stem}.train.log", encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        table = load_feature_table(args.features, args.splits, args.dev_splits)
        train_and_write(table, args.runs_dir, TrainConfig(max_epochs=args.max_epochs, patience=args.patience))
    finally:
        log.removeHandler(handler)
        handler.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    main()
