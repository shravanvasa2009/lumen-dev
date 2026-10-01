import argparse
import functools
import hashlib
import json
import logging
import math
import pickle
import time
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

import numpy as np
import pandas as pd
import torch
from scipy.stats import skew
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from torch import nn

from datasets import paths
from eval.bootstrap import cluster_bootstrap_ci
from export.provenance import sha256_of
from export.specs import ML_ROOT, RUNS_DIR, SPECS
from lumen_dsp import config as dsp_config
from lumen_dsp.config import DSP_CONFIG
from lumen_dsp.filters import butter_bandpass, filter_zero_phase
from nets.sqi_net import SqiNet
from train import butppg, sqi_windows
from train.sqi_windows import (
    BAD_KINDS,
    CLEAN,
    CLEAN_KINDS,
    NATURAL,
    POOR_QUALITY,
    RATE_HZ,
    RHYTHMS,
    BuildPlan,
    PatternPool,
    WindowSet,
)

NETWORK = SPECS["sqi-finger"]
RULE = SPECS["sqi-rule"]
SEED = 20261026
SPLITS_PATH = ML_ROOT / "splits" / "sqi.json"
RHYTHM_SPLITS_PATH = ML_ROOT / "splits" / "rhythm.json"
# §11.2: the threshold is where precision on "clean" is at least 0.95 on development subjects.
TARGET_PRECISION = 0.95
# ML-2: accepted windows have heart-rate error ≤ 5 bpm in ≥ 95% of cases.
HR_TOLERANCE_BPM = 5.0
ML2_TARGET = 0.95
# ML-4: acceptance of AF windows within 5 percentage points of non-AF windows.
ML4_MAX_GAP_PTS = 5.0
# ADR 0028: fewer than 200 reference-clean windows in a group is "insufficient data".
ML4_MIN_WINDOWS = 200
BOOTSTRAP_RESAMPLES = 2000
# Zero-padding 256 samples to 8192 puts spectral bins 0.47 bpm apart at 64 Hz.
HR_FFT_POINTS = 8192
RULE_FEATURES = ("skewness", "hrInRange")
# Pinned by the export spec, so the app and this file cannot disagree on the rule's input width.
assert len(RULE_FEATURES) == RULE.inputs["features"][1]

log = logging.getLogger("train.sqi")


class TrainConfig(NamedTuple):
    max_epochs: int = 60
    patience: int = 8
    batch_size: int = 256
    learning_rate: float = 3e-4
    seed: int = SEED
    # Re-timed 10 s sequences per clean record and rhythm.
    retimed_train: int = 2
    retimed_val: int = 2


class WindowSets(NamedTuple):
    # Dev-train: natural clean, re-timed clean, their corruptions, and poor-quality records.
    train: WindowSet
    # Dev-val: natural clean, poor-quality records, and corruptions of the natural clean windows. Early
    # stopping and the ship decision use all of it; τ uses all but the poor-quality records.
    dev_val: WindowSet
    # Dev-val subjects' beats re-timed with dev-val rhythm patterns: the development ML-4 proxy only.
    retimed: WindowSet


Metric = Callable[[np.ndarray, np.ndarray], float]


def _digest(parts: list[str], files: list[Path]) -> str:
    digest = hashlib.sha256("\n".join(parts).encode())
    for source in files:
        digest.update(sha256_of(source).encode())
    return digest.hexdigest()[:16]


def data_files() -> list[Path]:
    base = butppg.butppg_dir()
    return [
        base / "quality-hr-ann.csv",
        base / "subject-info.csv",
        base / "RECORDS.txt",
        paths.derived_dir() / "intervals.parquet",
    ]


def windows_key(config: TrainConfig, splits: Path, rhythm_splits: Path) -> str:
    # Any change to the data, the splits, or the code that makes windows gives a new folder, so a resumed
    # run never mixes windows or checkpoints from different inputs.
    code = [
        Path(sqi_windows.__file__),
        Path(butppg.__file__),
        Path(dsp_config.__file__).with_name("resample.py"),
        Path(dsp_config.__file__).with_name("signals.py"),
        Path(dsp_config.__file__).with_name("filters.py"),
        dsp_config.CONFIG_PATH,
    ]
    settings = [str(config.seed), str(config.retimed_train), str(config.retimed_val)]
    return _digest(settings, [*data_files(), splits, rhythm_splits, *code])


def training_key(config: TrainConfig, windows: str) -> str:
    code = [Path(__file__), ML_ROOT / "nets" / "sqi_net.py", ML_ROOT / "nets" / "blocks.py"]
    return _digest([windows, repr(config)], code)


def window_sets(config: TrainConfig, splits: Path, rhythm_splits: Path, cache_dir: Path) -> WindowSets:
    assignment = json.loads(splits.read_text(encoding="utf-8"))["subjects"]
    rhythm_assignment = json.loads(rhythm_splits.read_text(encoding="utf-8"))["subjects"]

    # Loaded only when a cache file is missing, and once per split: dev-val and re-timed share recordings.
    @functools.cache
    def recordings(split: str) -> list[butppg.Recording]:
        return sqi_windows.load_recordings(assignment, split)

    @functools.cache
    def episodes() -> pd.DataFrame:
        return sqi_windows.load_episodes()

    def pools(split: str) -> dict[str, PatternPool]:
        return {rhythm: PatternPool(episodes(), rhythm_assignment, split, rhythm) for rhythm in RHYTHMS}

    plans = {
        "train": (
            "dev-train",
            BuildPlan(natural=True, retimed_per_rhythm=config.retimed_train, corrupt_retimed=True),
        ),
        "dev_val": ("dev-val", BuildPlan(natural=True, retimed_per_rhythm=0, corrupt_retimed=False)),
        "retimed": (
            "dev-val",
            BuildPlan(natural=False, retimed_per_rhythm=config.retimed_val, corrupt_retimed=False),
        ),
    }
    cache_dir.mkdir(parents=True, exist_ok=True)
    sets = {
        name: sqi_windows.cached(
            cache_dir / f"{name}.npz",
            lambda split=split, plan=plan: sqi_windows.build_window_set(
                recordings(split), pools(split) if plan.retimed_per_rhythm else {}, plan, config.seed
            ),
        )
        for name, (split, plan) in plans.items()
    }
    return WindowSets(**sets)


def sample_weights(windows: WindowSet) -> np.ndarray:
    # Clean and bad carry equal total weight. Clean kinds (natural and each re-timed rhythm) carry equal
    # weight, so irregular rhythms count as much as regular ones (§11.2's rhythm trap). Among bad kinds,
    # real poor-quality records carry half and the synthetic corruptions share the other half. Within a
    # kind, every subject carries equal weight. Mean weight is 1.
    labels, kinds, subjects = windows.labels, windows.kinds, windows.subjects
    weights = np.zeros(len(labels))
    for label in (0, 1):
        in_label = labels == label
        label_kinds = np.unique(kinds[in_label]).tolist()
        real = [kind for kind in label_kinds if kind == POOR_QUALITY]
        if label == CLEAN or not real or len(real) == len(label_kinds):
            groups = [label_kinds]
        else:
            groups = [real, [kind for kind in label_kinds if kind != POOR_QUALITY]]
        for group in groups:
            for kind in group:
                in_kind = in_label & (kinds == kind)
                kind_subjects = np.unique(subjects[in_kind])
                for subject in kind_subjects:
                    members = in_kind & (subjects == subject)
                    weights[members] = 1.0 / (len(groups) * len(group) * len(kind_subjects) * members.sum())
    if not (weights > 0).all():
        raise ValueError("every window needs a weight")
    return (weights / weights.mean()).astype(np.float32)


def head_logits(model: SqiNet, windows: torch.Tensor) -> torch.Tensor:
    # forward() ends in a sigmoid; the loss needs the head's raw output for a stable log-likelihood.
    captured = []
    handle = model.head.register_forward_hook(lambda _module, _inputs, output: captured.append(output))
    try:
        model(windows)
    finally:
        handle.remove()
    return captured[0][:, 0]


def _inputs(windows: WindowSet) -> torch.Tensor:
    return torch.from_numpy(windows.windows[:, None, :])


def weighted_bce(logits: torch.Tensor, labels: torch.Tensor, weights: torch.Tensor) -> torch.Tensor:
    losses = nn.functional.binary_cross_entropy_with_logits(logits, labels, reduction="none")
    return (losses * weights).sum() / weights.sum()


def _val_loss(model: SqiNet, dev_val: WindowSet) -> float:
    model.eval()
    with torch.no_grad():
        logits = head_logits(model, _inputs(dev_val))
    labels = torch.from_numpy(dev_val.labels.astype(np.float32))
    return float(weighted_bce(logits, labels, torch.from_numpy(sample_weights(dev_val))))


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
    train: WindowSet, dev_val: WindowSet, directory: Path, config: TrainConfig
) -> tuple[SqiNet, list]:
    directory.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(config.seed)
    model = SqiNet()
    optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate)
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
    inputs = _inputs(train)
    labels = torch.from_numpy(train.labels.astype(np.float32))
    weights = torch.from_numpy(sample_weights(train))
    while state["epoch"] < config.max_epochs and state["bad_epochs"] < config.patience:
        started = time.perf_counter()
        epoch = state["epoch"] + 1
        # Seeding the shuffle per epoch makes a resumed run take the same batches as an unbroken one.
        order = torch.randperm(len(labels), generator=torch.Generator().manual_seed(config.seed + epoch))
        model.train()
        batch_losses = []
        for batch in order.split(config.batch_size):
            optimizer.zero_grad()
            loss = weighted_bce(head_logits(model, inputs[batch]), labels[batch], weights[batch])
            loss.backward()
            optimizer.step()
            batch_losses.append(loss.item())
        val_loss = _val_loss(model, dev_val)
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


def network_scores(model: SqiNet, windows: WindowSet) -> np.ndarray:
    with torch.no_grad():
        return model(_inputs(windows)).numpy()[:, 0].astype(np.float64)


def spectral_hr_bpm(window: np.ndarray) -> float:
    # The window's heart rate as the highest spectral peak in the DSP-6 HR band (0.6–3.5 Hz).
    dsp6 = DSP_CONFIG["dsp6"]
    low, high = dsp6["hrBandHz"]
    band = filter_zero_phase(butter_bandpass(dsp6["hrOrder"], low, high, RATE_HZ), np.asarray(window, float))
    tapered = (band - band.mean()) * np.hanning(len(band))
    power = np.abs(np.fft.rfft(tapered, HR_FFT_POINTS))
    frequencies = np.fft.rfftfreq(HR_FFT_POINTS, 1.0 / RATE_HZ)
    in_band = (frequencies >= low) & (frequencies <= high)
    return float(60.0 * frequencies[in_band][np.argmax(power[in_band])])


def rule_features(windows: WindowSet) -> np.ndarray:
    # §11.1 rule SQI on the same z-scored window the network sees: skewness (population, as Elgendi 2016
    # used it) and whether the spectral-peak HR lies in the live-HR range (40–180 bpm, dsp_config liveHr).
    live = DSP_CONFIG["liveHr"]
    rates = np.array([spectral_hr_bpm(window) for window in windows.windows])
    in_range = (rates >= live["minBpm"]) & (rates <= live["maxBpm"])
    return np.column_stack([skew(windows.windows, axis=1), in_range]).astype(np.float32)


def fit_rule(train: WindowSet, features: np.ndarray) -> LogisticRegression:
    return LogisticRegression(max_iter=1000).fit(features, train.labels, sample_weight=sample_weights(train))


def threshold_for_precision(scores: np.ndarray, is_clean: np.ndarray, target: float) -> float | None:
    # The lowest τ (largest accepted share) with precision ≥ target when windows with score ≥ τ are
    # accepted. None if no τ reaches the target.
    order = np.argsort(-scores, kind="stable")
    ordered, hits = scores[order], is_clean[order].astype(float)
    precision = np.cumsum(hits) / np.arange(1, len(hits) + 1)
    # Only the last of tied scores is a real cut: accepting ≥ τ takes every tie.
    last_of_tie = np.r_[ordered[1:] != ordered[:-1], True]
    meeting = np.flatnonzero(last_of_tie & (precision >= target))
    if len(meeting) == 0:
        return None
    cut = meeting[-1]
    # Halfway to the next lower score accepts the same windows, but a window at τ no longer flips when
    # ONNX Runtime or the app computes its score with float32 rounding (~1e-6) instead of PyTorch.
    return float((ordered[cut] + ordered[cut + 1]) / 2) if cut + 1 < len(ordered) else float(ordered[cut])


def precision_at(tau: float) -> Metric:
    return lambda is_clean, scores: (
        float(np.mean(is_clean[scores >= tau])) if (scores >= tau).any() else math.nan
    )


def assert_precision(scores: np.ndarray, is_clean: np.ndarray, tau: float) -> None:
    # The threshold must give the §11.2 precision on exactly the windows and scores it was chosen from.
    achieved = precision_at(tau)(is_clean, scores)
    if not achieved >= TARGET_PRECISION:
        raise AssertionError(f"τ {tau} gives clean precision {achieved}, below {TARGET_PRECISION}")


def recall_at(tau: float) -> Metric:
    return lambda is_clean, scores: float(np.mean(scores[is_clean] >= tau)) if is_clean.any() else math.nan


def rejection_at(tau: float) -> Metric:
    return lambda is_clean, scores: float(np.mean(scores[~is_clean] < tau)) if (~is_clean).any() else math.nan


def auroc(is_clean: np.ndarray, scores: np.ndarray) -> float:
    return float(roc_auc_score(is_clean, scores)) if 0 < is_clean.sum() < len(is_clean) else math.nan


def with_ci(subjects: np.ndarray, flags: np.ndarray, scores: np.ndarray, metric: Metric) -> dict:
    interval = cluster_bootstrap_ci(
        subjects, flags, scores, metric, n_resamples=BOOTSTRAP_RESAMPLES, seed=SEED
    )
    return {
        "estimate": interval.estimate,
        "low": interval.low,
        "high": interval.high,
        "undefinedResamples": interval.undefined_resamples,
    }


def hr_errors_bpm(windows: WindowSet) -> np.ndarray:
    return np.abs(
        np.array([spectral_hr_bpm(window) for window in windows.windows]) - windows.reference_hr_bpm
    )


def ml2_proxy(scores: np.ndarray, dev_val: WindowSet, tau: float, errors: np.ndarray) -> dict:
    # ML-2 on held-out BUT PPG finger subjects: of the natural windows (good and poor records) the model
    # accepts, the share whose spectral-peak HR is within 5 bpm of the record's reference HR.
    natural = np.isin(dev_val.kinds, (NATURAL, POOR_QUALITY))
    within = errors[natural] <= HR_TOLERANCE_BPM

    def share(flags: np.ndarray, accepted_scores: np.ndarray) -> float:
        accepted = accepted_scores >= tau
        return float(np.mean(flags[accepted])) if accepted.any() else math.nan

    return with_ci(dev_val.subjects[natural], within, scores[natural], share)


def estimator_ceiling(dev_val: WindowSet, errors: np.ndarray) -> dict:
    natural = dev_val.kinds == NATURAL
    within = errors[natural] <= HR_TOLERANCE_BPM
    return with_ci(
        dev_val.subjects[natural], within, within.astype(float), lambda flags, _scores: float(np.mean(flags))
    )


def acceptance_gap_pts(is_af: np.ndarray, accepted: np.ndarray) -> float:
    if is_af.all() or not is_af.any():
        return math.nan
    return 100.0 * (float(np.mean(accepted[~is_af])) - float(np.mean(accepted[is_af])))


def ml4_proxy(scores: np.ndarray, retimed: WindowSet, tau: float) -> dict:
    # ADR 0028's development proxy: acceptance of re-timed sinus minus re-timed AF windows, in points.
    # Both come from the same dev-val BUT PPG beats, so subjects are resampled together.
    accepted = (scores >= tau).astype(float)
    results = {}
    for rhythm in ("af", "premature"):
        keep = np.isin(retimed.kinds, (f"retimed-{rhythm}", "retimed-sinus"))
        is_rhythm = retimed.kinds[keep] == f"retimed-{rhythm}"
        results[rhythm] = with_ci(
            retimed.subjects[keep],
            is_rhythm,
            accepted[keep],
            acceptance_gap_pts,
        )
    return results


def evaluate(
    scores: np.ndarray, dev_val: WindowSet, retimed_scores: np.ndarray, retimed: WindowSet, errors
) -> dict:
    is_clean = dev_val.labels == CLEAN
    # §11.2's clean and bad windows: natural clean windows and their synthetic corruptions. Poor-quality
    # records are trained on and reported, but stay out of τ (ADR 0038): some have clean pulses at the
    # wrong rate from a phone timing fault that no window-level check can see.
    spec_set = dev_val.kinds != POOR_QUALITY
    subjects, flags, spec_scores = dev_val.subjects[spec_set], is_clean[spec_set], scores[spec_set]
    tau = threshold_for_precision(spec_scores, flags, TARGET_PRECISION)
    metrics = {"windowAuroc": with_ci(dev_val.subjects, is_clean, scores, auroc)}
    by_kind = []
    if tau is not None:
        assert_precision(spec_scores, flags, tau)
        metrics |= {
            "cleanPrecision": with_ci(subjects, flags, spec_scores, precision_at(tau)),
            "cleanRecall": with_ci(subjects, flags, spec_scores, recall_at(tau)),
            "corruptedRejected": with_ci(subjects, flags, spec_scores, rejection_at(tau)),
            "cleanPrecisionWithPoorQualityRecords": with_ci(
                dev_val.subjects, is_clean, scores, precision_at(tau)
            ),
            "ml2HrWithin5BpmOfAccepted": ml2_proxy(scores, dev_val, tau, errors),
            "spectralHrWithin5BpmOfAllNaturalClean": estimator_ceiling(dev_val, errors),
        }
        gaps = ml4_proxy(retimed_scores, retimed, tau)
        metrics["ml4GapSinusMinusAfPts"] = gaps["af"]
        metrics["gapSinusMinusPrematurePts"] = gaps["premature"]
        for windows, window_scores in ((dev_val, scores), (retimed, retimed_scores)):
            for kind in sorted(set(windows.kinds.tolist())):
                members = windows.kinds == kind
                accepted = with_ci(
                    windows.subjects[members],
                    np.ones(int(members.sum()), bool),
                    window_scores[members],
                    lambda _flags, kind_scores: float(np.mean(kind_scores >= tau)),
                )
                by_kind.append(
                    {
                        "kind": kind,
                        "clean": kind in CLEAN_KINDS,
                        "windows": int(members.sum()),
                        "subjects": len(set(windows.subjects[members].tolist())),
                        "accepted (95% CI)": _formatted(accepted),
                    }
                )
    return {"tau": tau, "metrics": metrics, "byKind": by_kind}


def _formatted(metric: dict) -> str:
    return f"{metric['estimate']:.3f} ({metric['low']:.3f}-{metric['high']:.3f})"


def ship_decision(scores: dict[str, np.ndarray], dev_val: WindowSet, evaluations: dict[str, dict]) -> dict:
    # Fixed before training (§11.1, ADR 0031 logic): SQI-Net ships only if its window-level AUROC for clean
    # vs bad on dev-val subjects beats the rule's. The paired difference shows how sure that is.
    is_clean = dev_val.labels == CLEAN
    paired = np.column_stack([scores[NETWORK.name], scores[RULE.name]])
    difference = with_ci(
        dev_val.subjects,
        is_clean,
        paired,
        lambda flags, both: auroc(flags, both[:, 0]) - auroc(flags, both[:, 1]),
    )
    network_wins = (
        evaluations[NETWORK.name]["metrics"]["windowAuroc"]["estimate"]
        > evaluations[RULE.name]["metrics"]["windowAuroc"]["estimate"]
    )
    return {
        "criterion": "window-level AUROC for clean vs bad on dev-val subjects",
        "networkMinusRuleAuroc": difference,
        "ships": NETWORK.name if network_wins else RULE.name,
    }


def ablation_rows(evaluations: dict[str, dict]) -> list[dict]:
    rows = []
    for name, evaluation in evaluations.items():
        metrics = evaluation["metrics"]
        row = {"model": name, "window AUROC (95% CI)": _formatted(metrics["windowAuroc"])}
        if evaluation["tau"] is None:
            row["τ_clean"] = f"no threshold reaches {TARGET_PRECISION:.2f} clean precision"
        else:
            row |= {
                "τ_clean": f"{evaluation['tau']:.4f}",
                "clean precision": _formatted(metrics["cleanPrecision"]),
                "clean recall": _formatted(metrics["cleanRecall"]),
                "corrupted rejected": _formatted(metrics["corruptedRejected"]),
                "clean precision with poor-quality records": _formatted(
                    metrics["cleanPrecisionWithPoorQualityRecords"]
                ),
                "ML-2 proxy": _formatted(metrics["ml2HrWithin5BpmOfAccepted"]),
                "ML-4 proxy gap, points": _formatted(metrics["ml4GapSinusMinusAfPts"]),
            }
        rows.append(row)
    return rows


def window_counts(sets: WindowSets) -> list[dict]:
    rows = []
    for name, windows in sets._asdict().items():
        for kind in (*CLEAN_KINDS, *BAD_KINDS):
            members = windows.kinds == kind
            if members.any():
                rows.append(
                    {
                        "set": name,
                        "kind": kind,
                        "windows": int(members.sum()),
                        "records": len(set(windows.records[members].tolist())),
                        "subjects": len(set(windows.subjects[members].tolist())),
                    }
                )
    return rows


def training_notes(sets: WindowSets, decision: dict, evaluations: dict[str, dict]) -> list[str]:
    retimed = np.char.startswith(sets.train.kinds, "retimed-")
    retimed_records = len(set(sets.train.records[retimed].tolist()))
    shipped = evaluations[decision["ships"]]["metrics"]
    gap, hr_share = shipped.get("ml4GapSinusMinusAfPts"), shipped.get("ml2HrWithin5BpmOfAccepted")
    retimed_af = int((sets.retimed.kinds == "retimed-af").sum())
    retimed_sinus = int((sets.retimed.kinds == "retimed-sinus").sum())
    enough = min(retimed_af, retimed_sinus) >= ML4_MIN_WINDOWS
    notes = [
        "Data: BUT PPG 2.0.0 finger recordings only (subject-info.csv 'Ear/finger' = 1; the dataset page "
        "says 'measurement spot: 0 (ear) or 1 (finger)', https://physionet.org/content/butppg/2.0.0/). "
        "Clean = quality 1, which the dataset defines as most annotators' PPG HR within 5 bpm of the ECG "
        "reference (§11.2's clean definition). Quality 0 records are bad.",
        "Windows: −R (DSP-3) at 30 fps, DSP-2 cubic spline to 64 Hz, 4 s windows every 1 s, z-scored by "
        "lumen_dsp sqi_model_input; flat windows are excluded, as the app never scores them.",
        "Re-timed clean windows (§11.2): clean records are cut into beats at ECG R-peaks plus a per-record "
        "lag (the foot of the record's mean pulse) and kept only if their beats correlate with their mean "
        f"(median r ≥ {sqi_windows.MIN_BEAT_CORRELATION}); {retimed_records} dev-train records qualified. "
        "Beats are laid out on real AF, premature-beat, and sinus intervals from MIT-BIH AF, Long-Term AF, "
        "and MIT-BIH Arrhythmia (dev-train subjects of ml/splits/rhythm.json for training, dev-val subjects "
        "for the ML-4 proxy), with systole kept and diastole stretched, each pulse scaled by its preceding "
        "interval over the median (clamped to 0.4–1.2), on the record's own DC level.",
        "Bad windows: one corrupted copy of every dev-train clean window (natural and re-timed) and of every "
        "dev-val natural clean window: band-limited 0.5–5 Hz motion bursts at 1–5× the window SD, pressure "
        "(80% AC loss, then clipping), 1–2% ambient flicker at 0.5–14.5 Hz on the camera frames, or a "
        "dropout (frozen frames or a level step). Burst and dropout lengths are assumptions.",
        "Training, early stopping, and the rule's logistic fit weight windows so clean and bad carry equal "
        "weight; clean kinds (natural and each re-timed rhythm) carry equal weight; among bad kinds, "
        "poor-quality records carry half and the corruptions share the other half; within a kind, every "
        "subject carries equal weight.",
        "Records whose quality-hr-ann.csv HR differs by more than 5 bpm from 60 / median R-R of their own "
        "verified .qrs beats are left out, since quality is defined against that HR (ADR 0038); this "
        "removes most records of subjects 142–149.",
        "Design changes made after earlier dev-val runs in which no τ reached 0.95: the reference check "
        "above, poor-quality records weighted as half of the bad side (was one kind of five), learning rate "
        "3e-4 with patience 8 (was 1e-3, 6), and keeping poor-quality records out of τ. A run that also "
        "gave natural clean windows half of the clean side failed the ML-4 proxy, so clean kinds stay "
        "equal (ADR 0028: the proxy informs training against the rhythm trap).",
        f"Threshold: the lowest τ with clean precision ≥ {TARGET_PRECISION} over §11.2's dev-val windows "
        "(natural clean windows and one synthetic corruption of each), checked by assert_precision on the "
        "same scores. Poor-quality records stay out of τ (ADR 0038): with them counted as bad, no τ reached "
        "0.95, and the windows ranked highest were clean pulses from three subject-149 records whose pulse "
        "rate disagrees with the ECG (a phone frame-timing fault; the app uses real frame times). Precision "
        "with poor-quality records counted as bad is reported at the same τ. Precision depends on the mix "
        "of clean and bad windows; real captures will have a different mix.",
        "spectralHrWithin5BpmOfAllNaturalClean is the ML-2 proxy's ceiling: the share of all dev-val natural "
        "clean windows whose spectral-peak HR is within 5 bpm, whatever the model accepts. Much of the "
        "proxy's shortfall from 95% is the 4 s spectral estimator, not the quality check.",
        "Dev-val numbers are optimistic: early stopping and τ were chosen on dev-val. MIMIC PERform AF "
        "(ML-4) is the external check and has not been run.",
        "ML-2 proxy: HR is the window's spectral peak in 0.6–3.5 Hz, compared with the record's reference "
        "HR (the 10 s record's ECG HR from quality-hr-ann.csv). The app's HR uses beats over a "
        "whole reading.",
        "ML-4 proxy (ADR 0028): acceptance of re-timed sinus minus re-timed AF windows, with "
        f"{retimed_af} AF and {retimed_sinus} sinus windows"
        + ("." if enough else f"; fewer than {ML4_MIN_WINDOWS} in a group is insufficient data."),
        f"Ship rule ({decision['criterion']}): {decision['ships']} ships.",
        "The rule baseline (sqi-rule) leaves out §11.1's acquisition checks (DSP-4 contact, clipping, "
        "exposure), which need camera frames that BUT PPG does not have.",
    ]
    if gap is not None and abs(gap["estimate"]) > ML4_MAX_GAP_PTS:
        notes.append(
            f"The shipped model's ML-4 proxy gap is {gap['estimate']:.1f} points, above {ML4_MAX_GAP_PTS}."
        )
    if hr_share is not None and hr_share["estimate"] < ML2_TARGET:
        notes.append(f"The shipped model's ML-2 proxy is below the {ML2_TARGET:.0%} that ML-2 requires.")
    return notes


def _metrics_file(source: Path, evaluation: dict, sets: WindowSets, shared: dict, tau: float) -> dict:
    return {
        "trainedOn": ["butppg", *sorted(sqi_windows.PATTERN_DATASETS)],
        "threshold": {"clean": tau},
        "development": {
            "subjects": len(set(sets.dev_val.subjects.tolist())),
            "metrics": {
                name: value
                for name, value in evaluation["metrics"].items()
                if all(math.isfinite(value[key]) for key in ("estimate", "low", "high"))
            },
            "byKind": evaluation["byKind"],
        },
        "sourceSha256": sha256_of(source),
        **shared,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m train.sqi", description="Train SQI-Net and the rule SQI")
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    parser.add_argument("--splits", type=Path, default=SPLITS_PATH)
    parser.add_argument("--rhythm-splits", type=Path, default=RHYTHM_SPLITS_PATH)
    parser.add_argument("--max-epochs", type=int, default=TrainConfig().max_epochs)
    args = parser.parse_args(argv)
    config = TrainConfig(max_epochs=args.max_epochs)
    started = time.perf_counter()

    windows = windows_key(config, args.splits, args.rhythm_splits)
    window_dir = args.runs_dir / NETWORK.file_stem / f"windows-{windows}"
    sets = window_sets(config, args.splits, args.rhythm_splits, window_dir)
    model, history = train_network(
        sets.train, sets.dev_val, window_dir / f"train-{training_key(config, windows)}", config
    )

    train_features, val_features, retimed_features = (
        rule_features(windows) for windows in (sets.train, sets.dev_val, sets.retimed)
    )
    rule = fit_rule(sets.train, train_features)
    scores = {
        NETWORK.name: (network_scores(model, sets.dev_val), network_scores(model, sets.retimed)),
        RULE.name: (rule.predict_proba(val_features)[:, 1], rule.predict_proba(retimed_features)[:, 1]),
    }
    errors = hr_errors_bpm(sets.dev_val)
    evaluations = {
        name: evaluate(val_scores, sets.dev_val, retimed_scores, sets.retimed, errors)
        for name, (val_scores, retimed_scores) in scores.items()
    }
    decision = ship_decision({name: pair[0] for name, pair in scores.items()}, sets.dev_val, evaluations)
    shipped_tau = evaluations[decision["ships"]]["tau"]
    if shipped_tau is None:
        raise ValueError(
            f"{decision['ships']} ships but no threshold reaches {TARGET_PRECISION} clean precision"
        )

    args.runs_dir.mkdir(parents=True, exist_ok=True)
    network_path = args.runs_dir / NETWORK.source_file
    torch.save(model.state_dict(), network_path)
    rule_path = args.runs_dir / RULE.source_file
    rule_path.write_bytes(pickle.dumps(rule))
    shared = {
        "ablation": ablation_rows(evaluations),
        "shipDecision": decision,
        "notes": training_notes(sets, decision, evaluations),
        "windowCounts": window_counts(sets),
        # This process only; a resumed run's earlier epochs are timed in networkEpochs.
        "processSeconds": time.perf_counter() - started,
        "networkEpochs": history,
    }
    for spec, path in ((NETWORK, network_path), (RULE, rule_path)):
        evaluation = evaluations[spec.name]
        # A model with no threshold meeting the target accepts nothing (τ above every score), and says so.
        tau = evaluation["tau"] if evaluation["tau"] is not None else float(np.nextafter(1.0, 2.0))
        metrics = _metrics_file(path, evaluation, sets, shared, tau)
        if spec is RULE:
            metrics["featureOrder"] = list(RULE_FEATURES)
        (args.runs_dir / f"{spec.file_stem}.json").write_text(
            json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
        )
    log.info(
        "ships: %s; AUROC network minus rule %s",
        decision["ships"],
        _formatted(decision["networkMinusRuleAuroc"]),
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    main()
