import json
import pickle

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
    TARGET_SPECIFICITY,
    evaluate,
    latest_checkpoint,
    training_key,
    TrainConfig,
    sample_weights,
    subject_units,
    threshold_for_specificity,
    train_network,
)
from train.rhythm_windows import ATYPICAL_INDEX, NEUTRAL_ATYPICAL_FRACTION, WindowSet

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
    features = rng.normal(size=(count, 8)).astype(np.float32)
    features[:, ATYPICAL_INDEX] = NEUTRAL_ATYPICAL_FRACTION
    return WindowSet(
        intervals,
        mask,
        features,
        np.asarray(labels, np.int64),
        np.asarray(subjects, str),
        np.asarray(readings, np.int64),
    )


def test_threshold_keeps_specificity_at_the_target():
    negatives = np.linspace(0.0, 0.95, 20)
    tau = threshold_for_specificity(negatives, 0.95)
    assert np.mean(negatives < tau) == pytest.approx(0.95)
    # The lowest float32 τ: one float32 step lower calls a second negative positive.
    assert np.mean(negatives < np.nextafter(np.float32(tau), np.float32(-np.inf))) < 0.95


def test_threshold_holds_for_float32_scores_at_the_boundary():
    # Logistic regression and ONNX give float32 probabilities. NumPy 2 compares a float32 array with a
    # Python float in float32, so a τ one float64 step above a float32 score rounded back onto it and
    # let a 50th of 986 negatives through (specificity 0.9493, the PR #30 review finding).
    negatives = np.random.default_rng(5).random(986).astype(np.float32)
    tau = threshold_for_specificity(negatives, TARGET_SPECIFICITY)
    assert np.float32(tau) == tau
    assert np.mean(negatives < tau) >= TARGET_SPECIFICITY
    assert np.mean(negatives.astype(np.float64) < tau) >= TARGET_SPECIFICITY


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


def small_training_sets():
    rows = [(index % 3, f"afdb:{index % 4}", index) for index in range(120)]
    return windows_for(rows), windows_for(rows[:30])


class KilledError(Exception):
    pass


def test_a_killed_run_resumes_to_the_same_weights(tmp_path, monkeypatch):
    train, val = small_training_sets()
    config = TrainConfig(max_epochs=3, patience=10, batch_size=32)
    key = training_key("windows", config, cap=400)
    real_save = rhythm._save_checkpoint

    def save_then_die(directory, state):
        real_save(directory, state)
        if state["epoch"] == 1:
            raise KilledError

    monkeypatch.setattr(rhythm, "_save_checkpoint", save_then_die)
    with pytest.raises(KilledError):
        train_network(train, val, tmp_path / "resumed", config, key)
    monkeypatch.setattr(rhythm, "_save_checkpoint", real_save)
    resumed, history = train_network(train, val, tmp_path / "resumed", config, key)
    unbroken, _ = train_network(train, val, tmp_path / "unbroken", config, key)
    assert [entry["epoch"] for entry in history] == [1, 2, 3]
    assert len(list((tmp_path / "resumed").glob("epoch-*.pt"))) == 3
    for name, tensor in unbroken.state_dict().items():
        torch.testing.assert_close(resumed.state_dict()[name], tensor, rtol=0, atol=0)


@pytest.mark.parametrize(
    "change",
    [{"learning_rate": 3e-3}, {"patience": 2}, {"max_epochs": 4}, {"batch_size": 16}, {"seed": 7}],
    ids=str,
)
def test_a_changed_setting_never_reuses_a_finished_run(tmp_path, change):
    train, val = small_training_sets()
    finished = TrainConfig(max_epochs=3, patience=10, batch_size=32)
    changed = finished._replace(**change)
    old_key, new_key = training_key("windows", finished, 400), training_key("windows", changed, 400)
    assert old_key != new_key
    train_network(train, val, tmp_path / old_key, finished, old_key)
    # Pointed at the finished run's folder, the new settings are refused rather than resumed.
    with pytest.raises(ValueError, match="different code or settings"):
        train_network(train, val, tmp_path / old_key, changed, new_key)
    _, history = train_network(train, val, tmp_path / new_key, changed, new_key)
    # Trained from epoch 1 under the new key; whether the weights differ depends on the setting (a
    # patience that never triggers trains the same model, legitimately).
    assert history[0]["epoch"] == 1
    checkpoints = sorted((tmp_path / new_key).glob("epoch-*.pt"))
    assert checkpoints and all(torch.load(path, weights_only=True)["key"] == new_key for path in checkpoints)


def test_training_key_covers_the_window_cap_and_the_windows():
    config = TrainConfig()
    assert training_key("windows", config, 400) != training_key("windows", config, 300)
    assert training_key("windows", config, 400) != training_key("other-windows", config, 400)


def with_atypical(features, value):
    changed = features.copy()
    changed[:, ATYPICAL_INDEX] = value
    return changed


def test_trained_network_ignores_the_neutralized_feature(tmp_path):
    train, val = small_training_sets()
    config = TrainConfig(max_epochs=2, patience=10, batch_size=32)
    model, _ = train_network(train, val, tmp_path, config, training_key("windows", config, 400))
    inputs = rhythm._tensors(val)
    with torch.no_grad():
        neutral = model(*inputs)
        # 0.42 is the top of the atypical fraction Track C measured on sinus PPG.
        phone_like = model(inputs[0], inputs[1], torch.from_numpy(with_atypical(val.features, 0.42)))
    assert torch.equal(neutral, phone_like)


def test_temperature_stays_finite_for_a_confidently_wrong_model(tmp_path):
    # Wrong logits keep lowering the NLL as T grows; unbounded, the fit overflowed to NaN.
    train, val = small_training_sets()
    config = TrainConfig(max_epochs=3, patience=10, batch_size=32)
    model, _ = train_network(train, val, tmp_path, config, training_key("windows", config, 400))
    wrong = val._replace(labels=(val.labels + 1) % len(LABELS))
    temperature = rhythm.fit_temperature(model, wrong)
    low, high = rhythm.LOG_TEMPERATURE_BOUNDS
    assert np.exp(low) <= temperature <= np.exp(high) + 1e-6


def test_checkpoints_are_picked_by_epoch_number(tmp_path):
    for epoch in (2, 999, 1000):
        (tmp_path / f"epoch-{epoch:03d}.pt").write_bytes(b"")
    assert latest_checkpoint(tmp_path).name == "epoch-1000.pt"


def evaluation_sets(count=200):
    # Half the subjects have AF windows, every subject has non-AF windows; float32 probabilities like
    # the logistic baseline's.
    rng = np.random.default_rng(2)
    rows = [
        (label, f"cinc2017:{index}", 2 * index + (label == AF))
        for index in range(count)
        for label in (SINUS, AF)
        if label != AF or index % 2 == 0
    ]
    windows = windows_for(rows)
    probs = rng.dirichlet([1, 1, 1], size=len(rows)).astype(np.float32)
    probs[windows.labels == AF, AF] += 0.3
    premature = windows_for([(OTHER, "mitdb:1", 0), (OTHER, "mitdb:2", 1)])
    return probs, windows, rng.dirichlet([1, 1, 1], size=2).astype(np.float32), premature


def test_evaluate_keeps_subject_specificity_at_the_target_for_float32_probs(monkeypatch):
    monkeypatch.setattr(rhythm, "BOOTSTRAP_RESAMPLES", 20)
    evaluation = evaluate(*evaluation_sets())
    assert evaluation["metrics"]["subjectSpecificity"]["estimate"] >= TARGET_SPECIFICITY


def test_evaluate_refuses_a_threshold_below_the_target(monkeypatch):
    monkeypatch.setattr(rhythm, "BOOTSTRAP_RESAMPLES", 20)
    monkeypatch.setattr(rhythm, "threshold_for_specificity", lambda _scores, _target: 0.0)
    with pytest.raises(ValueError, match="subject-level specificity"):
        evaluate(*evaluation_sets())


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
    for metrics in (network, lgbm):
        assert metrics["development"]["metrics"]["subjectSpecificity"]["estimate"] >= TARGET_SPECIFICITY
    for row in network["ablation"]:
        assert float(row["subject specificity at τ_AF"].split()[0]) >= TARGET_SPECIFICITY
    assert any("atypical-beat fraction neutralized in v1" in note.lower() for note in network["notes"])
    state = torch.load(trained_run / "rhythm-net@1.0.0.pt", weights_only=True)
    assert float(state["temperature"]) == pytest.approx(network["calibration"]["temperature"])


def test_trained_lightgbm_ignores_the_neutralized_feature(trained_run):
    lgbm = pickle.loads((trained_run / "rhythm-lgbm@1.0.0.pkl").read_bytes())
    features = np.random.default_rng(3).normal(size=(50, 8)).astype(np.float32)
    np.testing.assert_array_equal(
        lgbm.predict_proba(with_atypical(features, 0.0)), lgbm.predict_proba(with_atypical(features, 0.42))
    )


def test_trained_models_export_within_parity(trained_run, tmp_path):
    out_dir = tmp_path / "onnx"
    for name in ("rhythm-net", "rhythm-lgbm"):
        to_onnx.main(["--name", name, "--runs-dir", str(trained_run), "--out-dir", str(out_dir)])
        verify_onnx.main(["--name", name, "--runs-dir", str(trained_run), "--models-dir", str(out_dir)])
        parity = json.loads((out_dir / "parity.json").read_text(encoding="utf-8"))
        assert parity["maxAbsDiff"] <= TOLERANCE
