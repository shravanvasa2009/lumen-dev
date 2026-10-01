import argparse
import hashlib
import json
import logging
import math
import pickle
import time
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

import lightgbm
import numpy as np
import pandas as pd
import torch
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline, make_pipeline
from sklearn.preprocessing import StandardScaler
from torch import nn

from datasets import augment, paths
from datasets.splits import ensure_not_external
from eval.bootstrap import cluster_bootstrap_ci, ppv_npv
from export.provenance import sha256_of
from export.specs import ML_ROOT, RUNS_DIR, SPECS
from lumen_dsp import config as dsp_config
from lumen_dsp import rhythm as dsp_rhythm
from nets.rhythm_net import LABELS, RhythmNet
from train import rhythm_windows
from train.rhythm_windows import (
    FEATURE_NAMES,
    JITTER_SD_RANGE_MS,
    READING_S,
    WINDOWS_PER_SUBJECT_LABEL,
    WindowSet,
    build_window_set,
    load_window_set,
    save_window_set,
)

NETWORK = SPECS["rhythm-net"]
LGBM = SPECS["rhythm-lgbm"]
# §11.1's fallback rule. export/specs.py has no entry for it, so it is trained and compared here but
# not exported.
LOGISTIC_NAME = "rhythm-logistic"
LOGISTIC_FEATURES = ("normalizedRmssd", "shannonEntropyBits", "turningPointRatio")
AF = LABELS.index("af")
SEED = 20261026
SPLITS_PATH = ML_ROOT / "splits" / "rhythm.json"
# §10.1: τ_AF gives at least 95% subject-level specificity on development subjects.
TARGET_SPECIFICITY = 0.95
PREVALENCES = (0.01, 0.05, 0.10)
RELIABILITY_BINS = 10
BOOTSTRAP_RESAMPLES = 2000
# Both tree settings come from the §11.9 file limit (500 KB), not from accuracy. Of num_leaves 7-12, 9
# gave the largest ONNX file under 450 KB on development data (early stopping at 220 rounds, 426 KB;
# the default 31 leaves gave 1.13 MB). The round cap keeps the worst case under the limit when early
# stopping does not trigger: 240 rounds x 3 classes x ~650 bytes per 9-leaf tree is about 470 KB.
LGBM_PARAMS = {
    "n_estimators": 240,
    "learning_rate": 0.05,
    "num_leaves": 9,
    "deterministic": True,
    "force_row_wise": True,
    "verbose": -1,
}
LGBM_EARLY_STOPPING_ROUNDS = 50

log = logging.getLogger("train.rhythm")


class TrainConfig(NamedTuple):
    max_epochs: int = 60
    patience: int = 8
    batch_size: int = 256
    learning_rate: float = 1e-3
    seed: int = SEED


class WindowSets(NamedTuple):
    train: WindowSet
    val: WindowSet
    # Augmented dev-val MIT-BIH Arrhythmia "other" readings with a premature beat (§11.3 failure mode).
    premature: WindowSet


class Units(NamedTuple):
    scores: np.ndarray
    is_af: np.ndarray
    subjects: np.ndarray


Metric = Callable[[np.ndarray, np.ndarray], float]


def load_episodes() -> pd.DataFrame:
    path = paths.derived_dir() / "intervals.parquet"
    ensure_not_external(path, "train")
    return pd.read_parquet(path)


def windows_key(parquet: Path, splits: Path, cap: int, seed: int) -> str:
    # Any change to the data, the split, or the code that turns them into windows starts a fresh run
    # folder, so a resumed run never mixes checkpoints trained on different windows.
    digest = hashlib.sha256(f"{cap}:{seed}".encode())
    for source in (
        parquet,
        splits,
        Path(rhythm_windows.__file__),
        Path(augment.__file__),
        Path(dsp_rhythm.__file__),
        dsp_config.CONFIG_PATH,
    ):
        digest.update(sha256_of(source).encode())
    return digest.hexdigest()[:16]


def window_sets(
    episodes: pd.DataFrame, assignment: dict[str, str], cache_dir: Path, cap: int, seed: int
) -> WindowSets:
    premature_episodes = episodes[(episodes["dataset"] == "mitdb") & (episodes["label"] == "other")]
    builders = {
        "train": lambda: build_window_set(
            episodes, assignment, "dev-train", augment=True, seed=seed, cap=cap
        ),
        "val": lambda: build_window_set(episodes, assignment, "dev-val", augment=False, seed=seed, cap=cap),
        "premature": lambda: build_window_set(
            premature_episodes,
            assignment,
            "dev-val",
            augment=True,
            seed=seed + 1,
            cap=cap,
            premature_only=True,
        ),
    }
    cache_dir.mkdir(parents=True, exist_ok=True)
    sets = {}
    for name, build in builders.items():
        path = cache_dir / f"{name}.npz"
        if not path.exists():
            started = time.perf_counter()
            save_window_set(build(), path)
            log.info("%s windows built in %.0f s", name, time.perf_counter() - started)
        sets[name] = load_window_set(path)
    return WindowSets(**sets)


def _tensors(windows: WindowSet) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    return (
        torch.from_numpy(windows.intervals),
        torch.from_numpy(windows.mask),
        torch.from_numpy(windows.features),
    )


def head_logits(model: RhythmNet, *inputs: torch.Tensor) -> torch.Tensor:
    # forward() ends in softmax(head / temperature); training and temperature scaling need the head's
    # raw output, so it is read with a hook instead of duplicating forward().
    captured = []
    handle = model.head.register_forward_hook(lambda _module, _inputs, output: captured.append(output))
    try:
        model(*inputs)
    finally:
        handle.remove()
    return captured[0]


def datasets_of(subjects: np.ndarray) -> np.ndarray:
    return np.asarray([subject.split(":")[0] for subject in subjects], dtype=str)


def sample_weights(windows: WindowSet) -> np.ndarray:
    # Each label carries equal total weight; within a label each dataset does, and within a dataset and
    # label each subject does. Long-Term AF (most "other" episodes) and CinC 2017 (most subjects) then
    # count per dataset and per person, not per window or episode. Mean weight is 1.
    missing = sorted(set(range(len(LABELS))) - set(windows.labels.tolist()))
    if missing:
        raise ValueError(f"no windows for {[LABELS[index] for index in missing]}")
    frame = pd.DataFrame(
        {"label": windows.labels, "dataset": datasets_of(windows.subjects), "subject": windows.subjects}
    )
    per_subject = frame.groupby(["label", "dataset", "subject"])["label"].transform("size")
    subjects_per_dataset = frame.groupby(["label", "dataset"])["subject"].transform("nunique")
    datasets_per_label = frame.groupby("label")["dataset"].transform("nunique")
    weights = 1.0 / (per_subject * subjects_per_dataset * datasets_per_label).to_numpy(float)
    return (weights / weights.mean()).astype(np.float32)


def weighted_cross_entropy(logits: torch.Tensor, labels: torch.Tensor, weights: torch.Tensor) -> torch.Tensor:
    losses = nn.functional.cross_entropy(logits, labels, reduction="none")
    return (losses * weights).sum() / weights.sum()


def initial_model(train: WindowSet, seed: int) -> RhythmNet:
    torch.manual_seed(seed)
    model = RhythmNet()
    features = train.features.astype(np.float64)
    spread = features.std(axis=0)
    if (spread == 0).any():
        raise ValueError(
            f"constant dev-train features: {[FEATURE_NAMES[i] for i in np.flatnonzero(spread == 0)]}"
        )
    with torch.no_grad():
        model.standardize.mean.copy_(torch.from_numpy(features.mean(axis=0)))
        model.standardize.std.copy_(torch.from_numpy(spread))
    return model


def _weighted_loss(model: RhythmNet, windows: WindowSet) -> float:
    model.eval()
    with torch.no_grad():
        logits = head_logits(model, *_tensors(windows))
        return float(
            weighted_cross_entropy(
                logits, torch.from_numpy(windows.labels), torch.from_numpy(sample_weights(windows))
            )
        )


def _snapshot(model: nn.Module) -> dict[str, torch.Tensor]:
    return {name: tensor.detach().clone() for name, tensor in model.state_dict().items()}


def latest_checkpoint(directory: Path) -> Path | None:
    found = sorted(directory.glob("epoch-*.pt"))
    return found[-1] if found else None


def _save_checkpoint(directory: Path, state: dict) -> None:
    path = directory / f"epoch-{state['epoch']:03d}.pt"
    partial = path.with_name(path.name + ".partial")
    torch.save(state, partial)
    # Replace is atomic, so a kill mid-save leaves the previous epoch as the latest checkpoint.
    partial.replace(path)


def train_network(
    train: WindowSet, val: WindowSet, directory: Path, config: TrainConfig
) -> tuple[RhythmNet, list[dict]]:
    directory.mkdir(parents=True, exist_ok=True)
    model = initial_model(train, config.seed)
    optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate)
    weights = torch.from_numpy(sample_weights(train))
    state = {
        "epoch": 0,
        "best_loss": math.inf,
        "best_model": _snapshot(model),
        "bad_epochs": 0,
        "history": [],
    }
    latest = latest_checkpoint(directory)
    if latest is not None:
        state = torch.load(latest, weights_only=True)
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        log.info("resuming after epoch %d from %s", state["epoch"], latest)
    inputs, labels = _tensors(train), torch.from_numpy(train.labels)
    while state["epoch"] < config.max_epochs and state["bad_epochs"] < config.patience:
        started = time.perf_counter()
        epoch = state["epoch"] + 1
        # Seeding the shuffle per epoch makes a resumed run take the same batches as an unbroken one.
        order = torch.randperm(len(labels), generator=torch.Generator().manual_seed(config.seed + epoch))
        model.train()
        batch_losses = []
        for batch in order.split(config.batch_size):
            optimizer.zero_grad()
            logits = head_logits(model, *(tensor[batch] for tensor in inputs))
            loss = weighted_cross_entropy(logits, labels[batch], weights[batch])
            loss.backward()
            optimizer.step()
            batch_losses.append(loss.item())
        val_loss = _weighted_loss(model, val)
        improved = val_loss < state["best_loss"]
        state = {
            "epoch": epoch,
            "model": _snapshot(model),
            "optimizer": optimizer.state_dict(),
            "best_loss": val_loss if improved else state["best_loss"],
            "best_model": _snapshot(model) if improved else state["best_model"],
            "bad_epochs": 0 if improved else state["bad_epochs"] + 1,
            "history": [
                *state["history"],
                {
                    "epoch": epoch,
                    "trainLoss": float(np.mean(batch_losses)),
                    "valLoss": val_loss,
                    "seconds": time.perf_counter() - started,
                },
            ],
        }
        _save_checkpoint(directory, state)
        log.info("epoch %d: train %.4f, dev-val %.4f", epoch, state["history"][-1]["trainLoss"], val_loss)
    model.load_state_dict(state["best_model"])
    return model.eval(), state["history"]


def fit_temperature(model: RhythmNet, val: WindowSet) -> float:
    # Guo et al. 2017 temperature scaling: one scalar minimizing dev-val NLL, fitted on the head's
    # logits with the model's temperature still at 1. The NLL uses the training weights, so the
    # calibration target is the same label, dataset, and subject balance the model was trained for.
    if float(model.temperature) != 1.0:
        raise ValueError("fit_temperature needs an uncalibrated model (temperature 1)")
    with torch.no_grad():
        logits = head_logits(model, *_tensors(val))
    labels, weights = torch.from_numpy(val.labels), torch.from_numpy(sample_weights(val))
    log_temperature = torch.zeros((), requires_grad=True)
    optimizer = torch.optim.LBFGS([log_temperature], lr=0.1, max_iter=200)

    def nll() -> torch.Tensor:
        optimizer.zero_grad()
        loss = weighted_cross_entropy(logits / log_temperature.exp(), labels, weights)
        loss.backward()
        return loss

    optimizer.step(nll)
    return float(log_temperature.detach().exp())


def network_probs(model: RhythmNet, windows: WindowSet) -> np.ndarray:
    with torch.no_grad():
        return model(*_tensors(windows)).numpy().astype(np.float64)


def fit_lgbm(train: WindowSet, val: WindowSet, seed: int) -> LGBMClassifier:
    params = {**LGBM_PARAMS, "random_state": seed}
    train_weights = sample_weights(train)
    probe = LGBMClassifier(**params).fit(
        train.features,
        train.labels,
        sample_weight=train_weights,
        # eval_X / eval_y replace the deprecated eval_set in LightGBM 4.7
        # (https://lightgbm.readthedocs.io/en/stable/pythonapi/lightgbm.LGBMClassifier.html).
        eval_X=(val.features,),
        eval_y=(val.labels,),
        eval_sample_weight=[sample_weights(val)],
        callbacks=[lightgbm.early_stopping(LGBM_EARLY_STOPPING_ROUNDS, verbose=False)],
    )
    # Refit with exactly the early-stopping round count, so predict_proba, the pickle, and the ONNX
    # export hold the same trees however each one treats best_iteration_.
    return LGBMClassifier(**{**params, "n_estimators": probe.best_iteration_}).fit(
        train.features, train.labels, sample_weight=train_weights
    )


def _logistic_columns(windows: WindowSet) -> np.ndarray:
    return windows.features[:, [FEATURE_NAMES.index(name) for name in LOGISTIC_FEATURES]]


def fit_logistic(train: WindowSet) -> Pipeline:
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=5000)).fit(
        _logistic_columns(train), train.labels, logisticregression__sample_weight=sample_weights(train)
    )


def reading_units(scores: np.ndarray, windows: WindowSet) -> Units:
    # §10.1: a reading's score is the mean over its windows.
    frame = pd.DataFrame(
        {
            "score": scores,
            "is_af": windows.labels == AF,
            "subject": windows.subjects,
            "reading": windows.readings,
        }
    )
    grouped = frame.groupby("reading", sort=True).agg(
        score=("score", "mean"), is_af=("is_af", "first"), subject=("subject", "first")
    )
    return Units(
        grouped["score"].to_numpy(), grouped["is_af"].to_numpy(bool), grouped["subject"].to_numpy(str)
    )


def subject_units(scores: np.ndarray, windows: WindowSet) -> Units:
    # A subject with both AF and non-AF data (MIT-BIH AF, Long-Term AF) is one AF unit and one non-AF
    # unit, each the mean over that subject's windows of that kind; both resample together.
    frame = pd.DataFrame({"score": scores, "is_af": windows.labels == AF, "subject": windows.subjects})
    grouped = frame.groupby(["subject", "is_af"], sort=True)["score"].mean().reset_index()
    return Units(
        grouped["score"].to_numpy(), grouped["is_af"].to_numpy(bool), grouped["subject"].to_numpy(str)
    )


def threshold_for_specificity(negative_scores: np.ndarray, target: float) -> float:
    # The lowest τ that calls at most (1 − target) of the negatives positive (score ≥ τ). Ties at the
    # boundary fall below τ, so specificity is never under the target.
    ordered = np.sort(np.asarray(negative_scores, dtype=float))[::-1]
    allowed = math.floor((1 - target) * len(ordered) + 1e-9)
    if allowed >= len(ordered):
        raise ValueError(f"{len(ordered)} negatives cannot set a {target:.0%} specificity threshold")
    return float(np.nextafter(ordered[allowed], np.inf))


def auroc(is_af: np.ndarray, scores: np.ndarray) -> float:
    return float(roc_auc_score(is_af, scores)) if 0 < is_af.sum() < len(is_af) else math.nan


def sensitivity_at(tau: float) -> Metric:
    return lambda is_af, scores: float(np.mean(scores[is_af] >= tau)) if is_af.any() else math.nan


def specificity_at(tau: float) -> Metric:
    return lambda is_af, scores: float(np.mean(scores[~is_af] < tau)) if (~is_af).any() else math.nan


def positive_rate_at(tau: float) -> Metric:
    return lambda _is_af, scores: float(np.mean(scores >= tau))


def predictive_value_at(tau: float, prevalence: float, which: str) -> Metric:
    def metric(is_af: np.ndarray, scores: np.ndarray) -> float:
        sensitivity, specificity = sensitivity_at(tau)(is_af, scores), specificity_at(tau)(is_af, scores)
        if math.isnan(sensitivity) or math.isnan(specificity):
            return math.nan
        called_positive = sensitivity * prevalence + (1 - specificity) * (1 - prevalence)
        called_negative = specificity * (1 - prevalence) + (1 - sensitivity) * prevalence
        # ppv_npv raises when nobody is called positive (or negative); in a resample that is undefined.
        if called_positive == 0 or called_negative == 0:
            return math.nan
        return getattr(ppv_npv(sensitivity, specificity, prevalence), which)

    return metric


def with_ci(units: Units, metric: Metric) -> dict:
    interval = cluster_bootstrap_ci(
        units.subjects, units.is_af, units.scores, metric, n_resamples=BOOTSTRAP_RESAMPLES, seed=SEED
    )
    return {
        "estimate": interval.estimate,
        "low": interval.low,
        "high": interval.high,
        "undefinedResamples": interval.undefined_resamples,
    }


def evaluate(probs: np.ndarray, val: WindowSet, premature_probs: np.ndarray, premature: WindowSet) -> dict:
    scores = probs[:, AF]
    subjects = subject_units(scores, val)
    tau = threshold_for_specificity(subjects.scores[~subjects.is_af], TARGET_SPECIFICITY)
    levels = {
        "window": Units(scores, val.labels == AF, val.subjects),
        "reading": reading_units(scores, val),
        "subject": subjects,
    }
    metrics = {}
    for level, units in levels.items():
        metrics[f"{level}Auroc"] = with_ci(units, auroc)
        metrics[f"{level}Sensitivity"] = with_ci(units, sensitivity_at(tau))
        metrics[f"{level}Specificity"] = with_ci(units, specificity_at(tau))
    for prevalence in PREVALENCES:
        percent = round(prevalence * 100)
        for which in ("ppv", "npv"):
            metrics[f"subject{which.title()}At{percent}PctPrevalence"] = with_ci(
                subjects, predictive_value_at(tau, prevalence, which)
            )
    # §11.11: the app abstains when the reading's top class probability is below 0.6.
    top = reading_units(probs.max(axis=1), val)
    abstain_below = NETWORK.abstain_below
    metrics["readingAbstainRate"] = with_ci(
        top, lambda _is_af, scores: float(np.mean(scores < abstain_below))
    )
    premature_scores = premature_probs[:, AF]
    metrics["falseAfRatePrematureReadings"] = with_ci(
        reading_units(premature_scores, premature), positive_rate_at(tau)
    )
    metrics["falseAfRatePrematureWindows"] = with_ci(
        Units(premature_scores, premature.labels == AF, premature.subjects), positive_rate_at(tau)
    )
    return {"tau": tau, "metrics": metrics, "byDataset": by_dataset(scores, val, tau)}


def _subset(windows: WindowSet, keep: np.ndarray) -> WindowSet:
    return WindowSet(*(field[keep] for field in windows))


def by_dataset(scores: np.ndarray, val: WindowSet, tau: float) -> list[dict]:
    # Subject-level numbers are dominated by CinC 2017's one-recording subjects, so each source is also
    # reported alone at the overall τ_AF. "undefined" means that dataset's dev-val lacks AF or non-AF.
    datasets = datasets_of(val.subjects)
    rows = []
    for dataset in sorted(set(datasets)):
        keep = datasets == dataset
        part = _subset(val, keep)
        subjects = subject_units(scores[keep], part)
        windows = Units(scores[keep], part.labels == AF, part.subjects)
        row: dict[str, str | int] = {
            "dataset": dataset,
            "AF subjects": int(subjects.is_af.sum()),
            "non-AF subjects": int((~subjects.is_af).sum()),
        }
        for column, units, metric in (
            ("subject AUROC", subjects, auroc),
            ("subject sensitivity at τ_AF", subjects, sensitivity_at(tau)),
            ("subject specificity at τ_AF", subjects, specificity_at(tau)),
            ("window AUROC", windows, auroc),
        ):
            defined = not math.isnan(metric(units.is_af, units.scores))
            row[column] = _formatted(with_ci(units, metric)) if defined else "undefined"
        rows.append(row)
    return rows


def _weighted_nll(probs: np.ndarray, labels: np.ndarray, weights: np.ndarray) -> float:
    picked = np.clip(probs[np.arange(len(labels)), labels], 1e-12, None)
    return float(-np.average(np.log(picked), weights=weights))


def calibration_summary(raw_probs: np.ndarray, probs: np.ndarray, val: WindowSet, temperature: float) -> dict:
    # Weighted like training and temperature scaling: equal labels, then datasets, then subjects.
    weights = sample_weights(val).astype(np.float64)
    is_af = val.labels == AF
    scores = probs[:, AF]
    bins = np.clip((scores * RELIABILITY_BINS).astype(int), 0, RELIABILITY_BINS - 1)
    summary: dict[str, float | str] = {
        "method": "temperature scaling on dev-val windows, weighted by label, dataset, and subject",
        "temperature": temperature,
        "devValWeightedNllBefore": _weighted_nll(raw_probs, val.labels, weights),
        "devValWeightedNllAfter": _weighted_nll(probs, val.labels, weights),
    }
    calibration_error = 0.0
    for index in range(RELIABILITY_BINS):
        members = bins == index
        if not members.any():
            continue
        predicted = float(np.average(scores[members], weights=weights[members]))
        observed = float(np.average(is_af[members], weights=weights[members]))
        calibration_error += weights[members].sum() / weights.sum() * abs(predicted - observed)
        summary[f"P(AF) {index / RELIABILITY_BINS:.1f}-{(index + 1) / RELIABILITY_BINS:.1f}"] = (
            f"{int(members.sum())} windows, mean predicted {predicted:.3f}, observed AF {observed:.3f}"
        )
    summary["windowExpectedCalibrationErrorAf"] = calibration_error
    return summary


def _formatted(metric: dict) -> str:
    return f"{metric['estimate']:.3f} ({metric['low']:.3f}-{metric['high']:.3f})"


def ablation_rows(evaluations: dict[str, dict]) -> list[dict]:
    return [
        {
            "model": name,
            "subject AUROC (95% CI)": _formatted(evaluation["metrics"]["subjectAuroc"]),
            "subject sensitivity at τ_AF": _formatted(evaluation["metrics"]["subjectSensitivity"]),
            "subject specificity at τ_AF": _formatted(evaluation["metrics"]["subjectSpecificity"]),
            "window AUROC": _formatted(evaluation["metrics"]["windowAuroc"]),
            "τ_AF": f"{evaluation['tau']:.4f}",
            "false AF, premature-beat readings": _formatted(
                evaluation["metrics"]["falseAfRatePrematureReadings"]
            ),
        }
        for name, evaluation in evaluations.items()
    ]


def ship_decision(evaluations: dict[str, dict], scores: dict[str, np.ndarray], val: WindowSet) -> dict:
    # §11.3: the network ships only if it beats the best baseline on dev-val subjects. The criterion,
    # fixed before training, is subject-level AUROC; the paired difference shows how sure that is.
    baselines = [name for name in evaluations if name != NETWORK.name]
    best = max(baselines, key=lambda name: evaluations[name]["metrics"]["subjectAuroc"]["estimate"])
    network_units, baseline_units = subject_units(scores[NETWORK.name], val), subject_units(scores[best], val)
    paired = Units(
        np.column_stack([network_units.scores, baseline_units.scores]),
        network_units.is_af,
        network_units.subjects,
    )
    difference = with_ci(paired, lambda is_af, both: auroc(is_af, both[:, 0]) - auroc(is_af, both[:, 1]))
    network_auroc = evaluations[NETWORK.name]["metrics"]["subjectAuroc"]["estimate"]
    return {
        "criterion": "subject-level AUROC for AF vs not on dev-val",
        "bestBaseline": best,
        "networkMinusBestBaselineAuroc": difference,
        "ships": NETWORK.name
        if network_auroc > evaluations[best]["metrics"]["subjectAuroc"]["estimate"]
        else best,
    }


def training_notes(sets: WindowSets, cap: int, seed: int, decision: dict) -> list[str]:
    low, high = JITTER_SD_RANGE_MS
    val_subjects = set(sets.val.subjects.tolist())
    cinc_subjects = sum(1 for subject in val_subjects if subject.startswith("cinc2017:"))
    return [
        f"Windows: DSP-15 windows from {READING_S:.0f} s readings; at most {cap} windows per subject and "
        f"label, chosen as whole readings with seed {seed}. {len(sets.train.labels)} dev-train, "
        f"{len(sets.val.labels)} dev-val, and {len(sets.premature.labels)} premature-beat windows.",
        f"Augmentation (dev-train only): augment_intervals (§11.3) with timing jitter σ drawn per reading "
        f"uniformly from {low:.0f}-{high:.0f} ms. This σ is an assumption, not a measurement; it is "
        "replaced once BUT PPG timing jitter is estimated.",
        "Augmented intervals outside the DSP-9 range count as artifact spans, and windows are cut around "
        "them as the app would.",
        "Training, early stopping, temperature scaling, and the LightGBM and logistic baselines weight "
        "windows so each label carries equal weight, each dataset equal weight within a label, and each "
        "subject equal weight within a dataset and label.",
        "Subject-level scores average P(AF) over a subject's windows, separately for its AF and non-AF "
        "windows. CinC 2017 has no subject IDs, so each recording counts as a subject.",
        "Dev-val numbers are optimistic: early stopping, temperature scaling, and τ_AF were all chosen on "
        "dev-val. The external test is the unbiased check.",
        f"CinC 2017 makes up {cinc_subjects} of the {len(val_subjects)} dev-val subjects, so it dominates "
        "the subject-level numbers and τ_AF; the by-dataset table shows each source alone.",
        f"LightGBM tree settings (num_leaves {LGBM_PARAMS['num_leaves']}) were set by the §11.9 500 KB file "
        "limit, not by accuracy.",
        f"Ship rule (§11.3, {decision['criterion']}): {decision['ships']} is the v1 rhythm model. Rhythm-Net "
        "and the logistic rule stay in the ablation table.",
        "False AF on premature beats: augmented dev-val MIT-BIH Arrhythmia 'other' readings with at least "
        "one premature beat, called AF when the mean P(AF) is at least τ_AF.",
    ]


def _metrics_file(source: Path, evaluation: dict, sets: WindowSets, shared: dict) -> dict:
    trained_on = sorted({subject.split(":")[0] for subject in sets.train.subjects})
    return {
        "trainedOn": trained_on,
        "threshold": {"af": evaluation["tau"]},
        "development": {
            "subjects": len(set(sets.val.subjects)),
            "metrics": evaluation["metrics"],
            "byDataset": evaluation["byDataset"],
        },
        "sourceSha256": sha256_of(source),
        "featureOrder": list(FEATURE_NAMES),
        **shared,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m train.rhythm", description="Train Rhythm-Net and baselines"
    )
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    parser.add_argument("--splits", type=Path, default=SPLITS_PATH)
    parser.add_argument(
        "--cap", type=int, default=WINDOWS_PER_SUBJECT_LABEL, help="windows per subject and label"
    )
    parser.add_argument("--max-epochs", type=int, default=TrainConfig().max_epochs)
    parser.add_argument("--patience", type=int, default=TrainConfig().patience)
    args = parser.parse_args(argv)
    config = TrainConfig(max_epochs=args.max_epochs, patience=args.patience)
    started = time.perf_counter()

    episodes = load_episodes()
    assignment = json.loads(args.splits.read_text(encoding="utf-8"))["subjects"]
    key = windows_key(paths.derived_dir() / "intervals.parquet", args.splits, args.cap, config.seed)
    run_dir = args.runs_dir / NETWORK.file_stem / key
    sets = window_sets(episodes, assignment, run_dir, args.cap, config.seed)

    model, history = train_network(sets.train, sets.val, run_dir, config)
    raw_probs = network_probs(model, sets.val)
    temperature = fit_temperature(model, sets.val)
    with torch.no_grad():
        model.temperature.fill_(temperature)
    lgbm = fit_lgbm(sets.train, sets.val, config.seed)
    logistic = fit_logistic(sets.train)

    probs = {
        NETWORK.name: (network_probs(model, sets.val), network_probs(model, sets.premature)),
        LGBM.name: (lgbm.predict_proba(sets.val.features), lgbm.predict_proba(sets.premature.features)),
        LOGISTIC_NAME: (
            logistic.predict_proba(_logistic_columns(sets.val)),
            logistic.predict_proba(_logistic_columns(sets.premature)),
        ),
    }
    evaluations = {
        name: evaluate(val_probs, sets.val, premature_probs, sets.premature)
        for name, (val_probs, premature_probs) in probs.items()
    }
    decision = ship_decision(evaluations, {name: pair[0][:, AF] for name, pair in probs.items()}, sets.val)

    args.runs_dir.mkdir(parents=True, exist_ok=True)
    network_path = args.runs_dir / NETWORK.source_file
    torch.save(model.state_dict(), network_path)
    lgbm_path = args.runs_dir / LGBM.source_file
    lgbm_path.write_bytes(pickle.dumps(lgbm))
    shared = {
        "ablation": ablation_rows(evaluations),
        "shipDecision": decision,
        "notes": training_notes(sets, args.cap, config.seed, decision),
        # This process only; a resumed run's earlier epochs are timed in networkEpochs.
        "processSeconds": time.perf_counter() - started,
        "networkEpochs": history,
    }
    outputs = [
        (
            NETWORK,
            _metrics_file(
                network_path,
                evaluations[NETWORK.name],
                sets,
                {
                    **shared,
                    "calibration": calibration_summary(
                        raw_probs, probs[NETWORK.name][0], sets.val, temperature
                    ),
                },
            ),
        ),
        (LGBM, _metrics_file(lgbm_path, evaluations[LGBM.name], sets, shared)),
    ]
    for spec, metrics in outputs:
        (args.runs_dir / f"{spec.file_stem}.json").write_text(
            json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    log.info(
        "ships: %s (subject AUROC, network minus %s: %s)",
        decision["ships"],
        decision["bestBaseline"],
        _formatted(decision["networkMinusBestBaselineAuroc"]),
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    main()
