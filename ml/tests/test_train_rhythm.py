import json

import numpy as np
import pandas as pd
import pytest
import torch

from export import to_onnx, verify_onnx
from export.provenance import TOLERANCE, load_metrics, trained_source
from export.specs import SPECS
from nets.rhythm_net import LABELS
from train import rhythm
from train.rhythm import (
    TrainConfig,
    sample_weights,
    subject_units,
    threshold_for_specificity,
    train_network,
)
from train.rhythm_windows import WindowSet

AF, SINUS, OTHER = (LABELS.index(label) for label in ("af", "sinus", "other"))


def windows_for(rows):
    # rows: (label, subject, reading) per window; the inputs only need to be distinct and finite.
    rng = np.random.default_rng(0)
    count = len(rows)
    intervals = np.zeros((count, 64), np.float32)
    intervals[:, :32] = rng.uniform(0.5, 1.2, (count, 32))
    mask = np.zeros((count, 64), np.float32)
    mask[:, :32] = 1.0
    labels, subjects, readings = zip(*rows, strict=True)
    return WindowSet(
        intervals,
        mask,
        rng.normal(size=(count, 8)).astype(np.float32),
        np.asarray(labels, np.int64),
        np.asarray(subjects, str),
        np.asarray(readings, np.int64),
    )


def test_threshold_keeps_specificity_at_the_target():
    negatives = np.linspace(0.0, 0.95, 20)
    tau = threshold_for_specificity(negatives, 0.95)
    assert np.mean(negatives < tau) == pytest.approx(0.95)
    # The lowest such τ: anything lower calls a second negative positive.
    assert np.mean(negatives < np.nextafter(tau, -np.inf)) < 0.95


def test_threshold_with_few_negatives_calls_none_positive():
    assert threshold_for_specificity(np.array([0.2, 0.7, 0.4]), 0.95) > 0.7


def test_sample_weights_balance_labels_then_datasets_then_subjects():
    rows = (
        [(AF, "ltafdb:1", 0)] * 300
        + [(AF, "cinc2017:a", 1), (AF, "cinc2017:b", 2)]
        + [(SINUS, "afdb:2", 3)] * 10
        + [(OTHER, "mitdb:3", 4)] * 5
    )
    windows = windows_for(rows)
    weights = sample_weights(windows)
    assert weights.mean() == pytest.approx(1.0)
    totals = {label: weights[windows.labels == label].sum() for label in (AF, SINUS, OTHER)}
    assert totals[AF] == pytest.approx(totals[SINUS]) == pytest.approx(totals[OTHER])
    af = windows.labels == AF
    assert weights[windows.subjects == "ltafdb:1"].sum() == pytest.approx(totals[AF] / 2)
    assert weights[windows.subjects == "cinc2017:a"].sum() == pytest.approx(totals[AF] / 4)
    assert weights[af].sum() == pytest.approx(totals[AF])


def test_sample_weights_need_every_label():
    with pytest.raises(ValueError, match="other"):
        sample_weights(windows_for([(AF, "afdb:1", 0), (SINUS, "afdb:1", 1)]))


def test_subject_units_split_a_subject_into_af_and_non_af():
    windows = windows_for([(AF, "afdb:1", 0), (AF, "afdb:1", 0), (SINUS, "afdb:1", 1), (OTHER, "mitdb:2", 2)])
    units = subject_units(np.array([0.9, 0.7, 0.2, 0.4]), windows)
    assert list(units.subjects) == ["afdb:1", "afdb:1", "mitdb:2"]
    assert list(units.is_af) == [False, True, False]
    np.testing.assert_allclose(units.scores, [0.2, 0.8, 0.4])


def test_a_killed_run_resumes_to_the_same_weights(tmp_path):
    rows = [(index % 3, f"afdb:{index % 4}", index) for index in range(120)]
    train, val = windows_for(rows), windows_for(rows[:30])
    config = TrainConfig(max_epochs=3, patience=10, batch_size=32)
    train_network(train, val, tmp_path / "resumed", config._replace(max_epochs=1))
    resumed, history = train_network(train, val, tmp_path / "resumed", config)
    unbroken, _ = train_network(train, val, tmp_path / "unbroken", config)
    assert [entry["epoch"] for entry in history] == [1, 2, 3]
    assert len(list((tmp_path / "resumed").glob("epoch-*.pt"))) == 3
    for name, tensor in unbroken.state_dict().items():
        torch.testing.assert_close(resumed.state_dict()[name], tensor, rtol=0, atol=0)


def synthetic_episodes(seed=0):
    rng = np.random.default_rng(seed)

    def row(dataset, subject, label, count, number=0):
        intervals = rng.uniform(380, 1100, count) if label == "af" else 850 + rng.normal(0, 15, count)
        premature = np.zeros(count, dtype=bool)
        if label == "other":
            # Every fifth beat early, then a compensatory pause, as in MIT-BIH Arrhythmia ectopy.
            premature[3::5] = True
            intervals[3::5] = 480
            intervals[4::5] = 1220
        return {
            "dataset": dataset,
            "subject": subject,
            "record": subject,
            "episode": number,
            "label": label,
            "intervals_ms": intervals.tolist(),
            "premature": premature.tolist(),
            "r_peak_sample_rate": 250.0,
        }

    rows = []
    for index in range(6):
        rows += [row("afdb", f"a{index}", "af", 260), row("afdb", f"a{index}", "sinus", 260, 1)]
        rows += [row("mitdb", f"m{index}", "other", 200), row("mitdb", f"m{index}", "sinus", 120, 1)]
    for index in range(30):
        rows.append(row("cinc2017", f"c{index}", ("sinus", "af", "other")[index % 3], 45))
    return pd.DataFrame(rows)


@pytest.fixture
def trained_run(data_dir, tmp_path, monkeypatch):
    episodes = synthetic_episodes()
    (data_dir / "derived").mkdir()
    episodes.to_parquet(data_dir / "derived" / "intervals.parquet")
    keys = sorted(set(episodes["dataset"] + ":" + episodes["subject"]))
    # Every third subject is dev-val, which puts two MIT-BIH Arrhythmia subjects there.
    assignment = {key: "dev-val" if index % 3 == 0 else "dev-train" for index, key in enumerate(keys)}
    splits = tmp_path / "rhythm.json"
    splits.write_text(json.dumps({"seed": 1, "val_fraction": 0.33, "subjects": assignment}), encoding="utf-8")
    # A small bootstrap keeps the test fast; the real run uses the default.
    monkeypatch.setattr(rhythm, "BOOTSTRAP_RESAMPLES", 50)
    runs_dir = tmp_path / "runs"
    rhythm.main(["--runs-dir", str(runs_dir), "--splits", str(splits), "--max-epochs", "3"])
    return runs_dir


def test_training_writes_metrics_the_manifest_accepts(trained_run):
    network = load_metrics(SPECS["rhythm-net"], trained_run)
    lgbm = load_metrics(SPECS["rhythm-lgbm"], trained_run)
    trained_source(SPECS["rhythm-net"], trained_run)
    trained_source(SPECS["rhythm-lgbm"], trained_run)
    assert network["trainedOn"] == ["afdb", "cinc2017", "mitdb"]
    assert 0 < network["threshold"]["af"] <= 1
    assert {row["model"] for row in network["ablation"]} == {"rhythm-net", "rhythm-lgbm", "rhythm-logistic"}
    assert network["shipDecision"]["ships"] in {"rhythm-net", "rhythm-lgbm", "rhythm-logistic"}
    assert {row["dataset"] for row in network["development"]["byDataset"]} == {"afdb", "cinc2017", "mitdb"}
    for key in ("subjectAuroc", "subjectSpecificity", "falseAfRatePrematureReadings"):
        assert key in network["development"]["metrics"] and key in lgbm["development"]["metrics"]
    assert network["development"]["metrics"]["subjectSpecificity"]["estimate"] >= 0.95
    state = torch.load(trained_run / "rhythm-net@1.0.0.pt", weights_only=True)
    assert float(state["temperature"]) == pytest.approx(network["calibration"]["temperature"])


def test_trained_models_export_within_parity(trained_run, tmp_path):
    out_dir = tmp_path / "onnx"
    for name in ("rhythm-net", "rhythm-lgbm"):
        to_onnx.main(["--name", name, "--runs-dir", str(trained_run), "--out-dir", str(out_dir)])
        verify_onnx.main(["--name", name, "--runs-dir", str(trained_run), "--models-dir", str(out_dir)])
        parity = json.loads((out_dir / "parity.json").read_text(encoding="utf-8"))
        assert parity["maxAbsDiff"] <= TOLERANCE
