import json

import numpy as np
import pandas as pd
import pytest

from datasets.vitaldb_cases import HoldoutAccessError
from export import to_onnx, verify_onnx, write_manifest
from export.provenance import ALL_BAD_BASIS, load_metrics
from export.specs import SPECS
from export.to_onnx import source_model
from nets.diabetes_net import BEAT, HR_SUMMARY_NAMES, SHAPE_FEATURE_NAMES
from tests.training_artifacts import fit_baseline, save_trained
from train import diabetes, rhythm
from train.diabetes import (
    EMPTY_COLUMN_FILL,
    HR_ONLY,
    TABULAR,
    TARGET_SPECIFICITY,
    THRESHOLD_RULE,
    SegmentSet,
    TrainConfig,
    diabetes_threshold,
    evaluate,
    fill_medians,
    load_feature_table,
    segment_set,
    ship_decision,
    subject_units,
)
from train.rhythm import Units, specificity_at

DIABETES_MODELS = ("diabetes-net", "diabetes-logistic", "diabetes-lgbm")
HOLDOUT = [9001, 9002]
SEGMENTS_PER_SUBJECT = 3
# The 2000 resamples of a real run take minutes here; the tests check what is reported, not the CI width.
TEST_RESAMPLES = 50


@pytest.fixture(autouse=True)
def few_resamples(monkeypatch):
    monkeypatch.setattr(rhythm, "BOOTSTRAP_RESAMPLES", TEST_RESAMPLES)


def synthetic_table(train_per_class: int = 24, val_per_class: int = 10, seed: int = 0) -> pd.DataFrame:
    # The diabetic label lives only in the averaged beat (a late bump), so the network can beat the
    # shape-feature baselines, whose inputs are noise. A few features are missing, as real ones are.
    rng = np.random.default_rng(seed)
    time = np.arange(BEAT)
    pulse = np.exp(-(((time - 60) / 18.0) ** 2))
    bump = np.exp(-(((time - 160) / 12.0) ** 2))
    rows = []
    subject = 1
    for split, per_class in (("dev-train", train_per_class), ("dev-val", val_per_class)):
        for diabetic in (False, True):
            for _ in range(per_class):
                for _ in range(SEGMENTS_PER_SUBJECT):
                    beat = pulse + (0.8 if diabetic else 0.0) * bump + rng.normal(0, 0.05, BEAT)
                    features = rng.normal(1.0, 0.5, len(TABULAR))
                    features[rng.random(len(TABULAR)) < 0.1] = np.nan
                    rows.append(
                        {
                            "subject": subject,
                            "label": diabetic,
                            "split": split,
                            "beat": beat.astype(np.float32).tolist(),
                            **dict(zip(TABULAR, features, strict=True)),
                        }
                    )
                subject += 1
    return pd.DataFrame(rows)


def write_inputs(directory, table):
    directory.mkdir(parents=True, exist_ok=True)
    features = directory / "features.parquet"
    table.to_parquet(features, index=False)
    holdout = directory / "diabetes.json"
    holdout.write_text(json.dumps({"holdout": HOLDOUT, "dev": sorted(set(table["subject"].tolist()))}))
    assignment = table.groupby("subject")["split"].first()
    dev = directory / "diabetes-dev.json"
    dev.write_text(json.dumps({"subjects": {str(key): value for key, value in assignment.items()}}))
    return features, holdout, dev


def segments_for(labels_by_subject: dict[int, bool], per_subject: int = 2) -> SegmentSet:
    subjects = np.repeat(list(labels_by_subject), per_subject)
    labels = np.repeat(list(labels_by_subject.values()), per_subject)
    count = len(subjects)
    return SegmentSet(
        np.zeros((count, 1, BEAT), np.float32), np.zeros((count, len(TABULAR)), np.float32), labels, subjects
    )


def test_loader_refuses_holdout_patients(tmp_path):
    table = synthetic_table(2, 2)
    table.loc[0, "subject"] = HOLDOUT[0]
    features, holdout, dev = write_inputs(tmp_path, table)
    with pytest.raises(HoldoutAccessError):
        load_feature_table(features, holdout, dev)


def test_loader_refuses_a_split_other_than_the_locked_one(tmp_path):
    table = synthetic_table(2, 2)
    features, holdout, dev = write_inputs(tmp_path, table)
    moved = table.assign(split=np.where(table["subject"] == 1, "dev-val", table["split"]))
    moved.to_parquet(features, index=False)
    with pytest.raises(ValueError, match="not in their locked"):
        load_feature_table(features, holdout, dev)


def test_loader_refuses_a_segment_without_a_beat(tmp_path):
    table = synthetic_table(2, 2)
    table.at[3, "beat"] = [0.0] * (BEAT - 1)
    with pytest.raises(ValueError, match="averaged beat"):
        load_feature_table(*write_inputs(tmp_path, table))


def test_loader_refuses_an_infinite_feature(tmp_path):
    table = synthetic_table(2, 2)
    table.loc[2, "cOverA"] = np.inf
    with pytest.raises(ValueError, match="cOverA"):
        load_feature_table(*write_inputs(tmp_path, table))


def test_fill_uses_dev_train_medians_only():
    table = synthetic_table(4, 4)
    in_dev_val = table["split"] == "dev-val"
    # Dev-val values far from dev-train must not move the fill value.
    table.loc[in_dev_val, "riseTime"] = 1000.0
    table.loc[table.index[in_dev_val][0], "areaRatio"] = np.nan
    medians = fill_medians(table)
    train = table[~in_dev_val]
    assert medians["riseTime"] == pytest.approx(train["riseTime"].median())
    assert medians["areaRatio"] == pytest.approx(train["areaRatio"].median())
    filled = segment_set(table, "dev-val", medians)
    assert filled.tabular[0, TABULAR.index("areaRatio")] == pytest.approx(medians["areaRatio"])
    assert np.isfinite(filled.tabular).all()


def test_a_feature_with_no_dev_train_value_is_filled_with_a_stored_constant():
    # SDNN on 90 s segments: DSP-12 never gives it, so the column is all null.
    table = synthetic_table(2, 2)
    table["sdnnMs"] = np.nan
    medians = fill_medians(table)
    assert medians["sdnnMs"] == EMPTY_COLUMN_FILL
    filled = segment_set(table, "dev-val", medians)
    assert (filled.tabular[:, TABULAR.index("sdnnMs")] == EMPTY_COLUMN_FILL).all()


def test_tau_is_the_lowest_threshold_with_85_percent_specificity():
    # 20 control subjects, scores exact in float32: at most 3 may score at or above τ, so τ sits just
    # above the 4th highest (16/32).
    controls = np.arange(20) / 32
    subjects = Units(np.concatenate([controls, [0.99]]), np.array([False] * 20 + [True]), np.arange(21))
    tau = diabetes_threshold(subjects)
    assert 16 / 32 < tau <= 17 / 32
    assert specificity_at(tau)(subjects.is_af, subjects.scores) == pytest.approx(TARGET_SPECIFICITY)
    lower = float(np.nextafter(np.float32(tau), np.float32(-np.inf)))
    assert specificity_at(lower)(subjects.is_af, subjects.scores) < TARGET_SPECIFICITY


def test_subject_score_is_the_mean_over_its_segments():
    segments = segments_for({7: True, 3: False}, per_subject=3)
    units = subject_units(np.array([0.9, 0.6, 0.3, 0.1, 0.2, 0.6]), segments)
    assert units.subjects.tolist() == [3, 7]
    assert units.scores == pytest.approx([0.3, 0.6])
    assert units.is_af.tolist() == [False, True]


@pytest.mark.parametrize("network_wins", [True, False])
def test_ship_decision_needs_the_network_to_beat_the_best_baseline(network_wins):
    labels = {subject: subject % 2 == 0 for subject in range(40)}
    segments = segments_for(labels)
    truth = segments.is_diabetic.astype(float)
    noise = np.random.default_rng(1).random(len(truth))
    good, fair, poor = truth + 0.5 * noise, truth + 2.0 * noise, noise
    scores = {
        "diabetes-net": good if network_wins else poor,
        "diabetes-logistic": fair,
        "diabetes-lgbm": poor if network_wins else good,
    }
    decision = ship_decision(
        {name: evaluate(model_scores, segments) for name, model_scores in scores.items()}
    )
    assert decision["ships"] == ("diabetes-net" if network_wins else "diabetes-lgbm")
    assert decision["bestBaseline"] == ("diabetes-logistic" if network_wins else "diabetes-lgbm")
    assert (decision["networkMinusBestBaselineAuroc"]["estimate"] > 0) == network_wins


def test_evaluate_reports_the_ml6_metrics_at_the_stated_prevalences():
    segments = segments_for({subject: subject < 12 for subject in range(40)})
    scores = segments.is_diabetic + np.random.default_rng(2).random(len(segments.subjects))
    metrics = evaluate(scores, segments)["metrics"]
    for name in ("subjectAuroc", "subjectSensitivity", "subjectSpecificity", "readingAuroc"):
        assert name in metrics
    for percent in ("5", "11.6", "20"):
        assert f"subjectPpvAt{percent}PctPrevalence" in metrics
        assert f"subjectNpvAt{percent}PctPrevalence" in metrics


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    root = tmp_path_factory.mktemp("diabetes")
    table = synthetic_table()
    features, holdout, dev = write_inputs(root / "inputs", table)
    runs_dir = root / "runs"
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(rhythm, "BOOTSTRAP_RESAMPLES", TEST_RESAMPLES)
        diabetes.main(
            [
                "--features", str(features),
                "--runs-dir", str(runs_dir),
                "--splits", str(holdout),
                "--dev-splits", str(dev),
                "--max-epochs", "40",
                "--patience", "8",
            ]
        )  # fmt: skip
    return table, runs_dir


def test_metrics_files_pass_provenance_and_record_the_fill_and_rule(trained):
    table, runs_dir = trained
    medians = fill_medians(table)
    for name in DIABETES_MODELS:
        metrics = load_metrics(SPECS[name], runs_dir)
        assert metrics["thresholdRule"] == THRESHOLD_RULE
        assert set(metrics["threshold"]) == {"pattern"}
        assert metrics["development"]["subjects"] == 20
        assert metrics["calibration"]["sourceSha256"] == metrics["sourceSha256"]
        assert {row["model"] for row in metrics["ablation"]} == {*DIABETES_MODELS, HR_ONLY}
        expected = list(SHAPE_FEATURE_NAMES) + (list(HR_SUMMARY_NAMES) if name == "diabetes-net" else [])
        assert list(metrics["fillMedians"]) == expected
        assert metrics["fillMedians"] == pytest.approx({column: medians[column] for column in expected})
    assert (runs_dir / "diabetes-net@1.0.0.train.log").read_text(encoding="utf-8").count("epoch") > 1


def test_the_network_standardizes_with_dev_train_statistics(trained):
    table, runs_dir = trained
    model = source_model(SPECS["diabetes-net"], runs_dir, None)
    train = segment_set(table, "dev-train", fill_medians(table))
    expected = np.concatenate([diabetes.shape_inputs(train), diabetes.hr_inputs(train)], axis=1).mean(axis=0)
    assert model.standardize.mean.numpy() == pytest.approx(expected, rel=1e-5)


def test_trained_models_export_verify_and_reach_the_manifest(trained, tmp_path):
    _, trained_runs = trained
    runs_dir, models_dir = tmp_path / "runs", tmp_path / "models"
    runs_dir.mkdir()
    for name in DIABETES_MODELS:
        for suffix in (SPECS[name].source_file, f"{SPECS[name].file_stem}.json"):
            (runs_dir / suffix).write_bytes((trained_runs / suffix).read_bytes())
    # The other families' shipped models, as test_manifest's trained release has them.
    for seed, name in enumerate(("sqi-finger", "rhythm-net")):
        extras = {"thresholdBasis": ALL_BAD_BASIS} if name == "sqi-finger" else {}
        save_trained(SPECS[name], runs_dir, source_model(SPECS[name], None, seed), extras)
    save_trained(SPECS["rhythm-lgbm"], runs_dir, fit_baseline(SPECS["rhythm-lgbm"]))
    for module, directory in ((to_onnx, "--out-dir"), (verify_onnx, "--models-dir")):
        module.main(["--all", directory, str(models_dir), "--runs-dir", str(runs_dir)])
    write_manifest.main(["--models-dir", str(models_dir), "--runs-dir", str(runs_dir)])
    manifest = json.loads((models_dir / "manifest.json").read_text(encoding="utf-8"))
    entries = {entry["name"]: entry for entry in manifest["models"]}
    assert set(DIABETES_MODELS) <= set(entries)
    for name in DIABETES_MODELS:
        metrics = load_metrics(SPECS[name], runs_dir)
        entry = entries[name]
        assert entry["threshold"] == metrics["threshold"]
        assert entry["development"] == metrics["development"]
        assert entry["trainedOn"] == ["vitaldb"]
        assert entry["fillMedians"] == metrics["fillMedians"]
        assert entry["featureOrder"] == metrics["featureOrder"]
        card = (models_dir / entry["card"]).read_text(encoding="utf-8")
        ablation = card.split("## Ablation", 1)[1].split("\n## ", 1)[0]
        assert all(f"| {model} |" in ablation for model in (*DIABETES_MODELS, HR_ONLY))
        assert THRESHOLD_RULE in card
    assert entries["diabetes-net"]["ships"] is True
    assert "ships per §11.4" in (models_dir / entries["diabetes-net"]["card"]).read_text(encoding="utf-8")


def test_training_is_repeatable(trained):
    table, _ = trained
    medians = fill_medians(table)
    train, val = segment_set(table, "dev-train", medians), segment_set(table, "dev-val", medians)
    config = TrainConfig(max_epochs=3, patience=8)
    first, _ = diabetes.train_network(train, val, config)
    second, _ = diabetes.train_network(train, val, config)
    assert diabetes.network_scores(first, val) == pytest.approx(diabetes.network_scores(second, val))
