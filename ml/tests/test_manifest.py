import json
from xml.etree import ElementTree
from dataclasses import replace

import numpy as np
import onnxruntime as ort
import pytest
import torch
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from export import to_onnx, verify_onnx, write_manifest
from export.provenance import ALL_BAD_BASIS, TOLERANCE, ProvenanceError, load_metrics, sha256_of
from export import specs
from export.specs import MODELS_DIR, OPSET, SHIPPED, SPECS, ShipRuleError, shipped_per_family
from export.to_onnx import source_model
from export.verify_onnx import seeded_inputs
from eval.external import diabetes_part
from eval.external_stats import (
    RHYTHM_PREVALENCES,
    BiasWindows,
    binary_report,
    rhythm_bias_report,
)
from export.write_manifest import EXTERNAL_NOT_RUN, NOT_MEASURED, logistic_rule
from nets.rhythm_net import LABELS
from tests.training_artifacts import fit_baseline, save_trained
from train.rhythm import LOGISTIC_FEATURES, Units, sensitivity_at, specificity_at, with_ci
from train.rhythm_windows import FEATURE_NAMES

# scripts/proof/m3.mjs checks the first four; §11.9 and the track kickoff add the rest.
CARD_HEADINGS = [
    "## Intended use",
    "## Data",
    "## External test",
    "## Limitations",
    "## Development metrics",
    "## Ablation",
    "## Calibration",
    "## What the app shows when the model abstains",
]

NETWORKS = sorted(name for name, spec in SPECS.items() if spec.kind == "torch")


def ship_decision(ships):
    return {
        "criterion": "subject-level AUROC for AF vs not on dev-val",
        "bestBaseline": "rhythm-lgbm",
        "networkMinusBestBaselineAuroc": {"estimate": -0.0006, "low": -0.0161, "high": 0.0156},
        "ships": ships,
    }


RHYTHM_EXTRAS = {
    "metricsFormat": 2,
    "shipDecision": ship_decision("rhythm-lgbm"),
    "ablation": [{"model": "rhythm-net", "auroc": 0.5}, {"model": "lightgbm", "auroc": 0.25}],
    "calibration": {"method": "temperature scaling", "temperature": 1.5},
    "notes": ["Jitter sigma is an assumption."],
    "development": {
        "subjects": 4,
        "metrics": {
            "auroc": {"estimate": 0.5, "low": 0.25, "high": 0.75},
            "falseAfRatePrematureReadings": {"estimate": 0.301, "low": 0.085, "high": 0.612},
            "readingAbstainRate": {"estimate": 0.218, "low": 0.176, "high": 0.253},
        },
        "byDataset": [{"dataset": "afdb", "subject AUROC": "0.600 (0.400-0.800)"}],
        "prematureBeatSet": {"subjects": 8, "windows": 294},
    },
}


# A trained SQI model must record its threshold basis (export.provenance fails closed); "all-bad" is
# the basis that needs no owner decision, so these release tests are not about H-024.
SQI_EXTRAS = {"thresholdBasis": ALL_BAD_BASIS}


def _run(module, *args):
    module.main([*map(str, args)])


def _release(models_dir, runs_dir, *extra):
    _run(to_onnx, "--all", *extra, "--out-dir", models_dir, "--runs-dir", runs_dir)
    _run(verify_onnx, "--all", *extra, "--models-dir", models_dir, "--runs-dir", runs_dir)


def _manifest(models_dir, runs_dir):
    _run(write_manifest, "--models-dir", models_dir, "--runs-dir", runs_dir)
    manifest = json.loads((models_dir / "manifest.json").read_text(encoding="utf-8"))
    return {entry["name"]: entry for entry in manifest["models"]}


@pytest.fixture
def untrained(tmp_path):
    models_dir, runs_dir = tmp_path / "models", tmp_path / "runs"
    runs_dir.mkdir()
    # The shipped rhythm model is a trained classifier, so even an untrained pipeline check needs one.
    save_trained(SPECS["rhythm-lgbm"], runs_dir, fit_baseline(SPECS["rhythm-lgbm"]))
    _release(models_dir, runs_dir, "--random-init", 3)
    return models_dir, runs_dir


@pytest.fixture
def trained(tmp_path):
    models_dir, runs_dir = tmp_path / "models", tmp_path / "runs"
    for seed, name in enumerate(NETWORKS):
        extras = {"rhythm-net": RHYTHM_EXTRAS, "sqi-finger": SQI_EXTRAS}.get(name, {})
        save_trained(SPECS[name], runs_dir, source_model(SPECS[name], None, seed), extras)
    save_trained(SPECS["rhythm-lgbm"], runs_dir, fit_baseline(SPECS["rhythm-lgbm"]), RHYTHM_EXTRAS)
    _release(models_dir, runs_dir)
    return models_dir, runs_dir


def test_manifest_matches_the_files_and_appendix_b(untrained):
    models_dir, runs_dir = untrained
    entries = _manifest(models_dir, runs_dir)
    assert set(entries) == {*NETWORKS, "rhythm-lgbm"}
    for name in NETWORKS:
        entry, spec = entries[name], SPECS[name]
        assert entry["sha256"] == sha256_of(models_dir / entry["file"])
        assert entry["file"] == f"{name}@{spec.version}.onnx"
        assert entry["card"] == f"{name}@{spec.version}.md"
        assert entry["inputs"] == spec.inputs and entry["outputs"] == spec.outputs
        assert entry["opset"] == OPSET
        assert len(entry["commit"]) == 40
        assert entry["trainedOn"] == []
        assert all(value is None for value in entry["threshold"].values())
        external = dict(entry["externalTest"])
        assert external.pop("dataset") == spec.external_dataset
        assert all(value is None for value in external.values())
    assert entries["sqi-finger"]["inputs"] == {"window": [1, 1, 256]}
    rhythm = entries["rhythm-net"]
    assert rhythm["inputs"] == {"intervals": [1, 64], "mask": [1, 64], "features": [1, 8]}
    assert rhythm["outputs"] == {"probs": [1, 3]}
    assert rhythm["labels"] == ["sinus", "af", "other"]
    assert rhythm["abstainBelow"] == 0.6
    assert set(rhythm["externalTest"]) >= {"auroc", "sensitivity", "specificity", "ci95"}


def test_cards_have_every_heading_and_no_external_numbers(untrained):
    models_dir, runs_dir = untrained
    for entry in _manifest(models_dir, runs_dir).values():
        card = (models_dir / entry["card"]).read_text(encoding="utf-8")
        assert all(heading in card for heading in CARD_HEADINGS)
        external = card.split("## External test", 1)[1].split("\n## ", 1)[0]
        assert EXTERNAL_NOT_RUN in external
        if not entry["trainedOn"]:
            assert NOT_MEASURED in card.split("## Development metrics", 1)[1].split("\n## ", 1)[0]
    sqi_card = (models_dir / "sqi-finger@1.0.0.md").read_text(encoding="utf-8")
    assert "inverted red channel" in sqi_card and "finger recordings" in sqi_card


def test_trained_release_fills_metrics_and_lists_baselines(trained):
    models_dir, runs_dir = trained
    entries = _manifest(models_dir, runs_dir)
    assert set(entries) == {*NETWORKS, "rhythm-lgbm"}
    rhythm = entries["rhythm-net"]
    assert rhythm["threshold"] == {"af": 0.5}
    assert rhythm["trainedOn"] == ["afdb"]
    card = (models_dir / rhythm["card"]).read_text(encoding="utf-8")
    assert "| auroc | 0.5 | 0.25 | 0.75 |" in card
    assert "| lightgbm | 0.25 |" in card
    assert "- temperature: 1.5" in card
    assert "Training notes, as written at training time:\n\n- Jitter sigma is an assumption." in card
    assert "| afdb | 0.600 (0.400-0.800) |" in card
    assert "Trained on: afdb." in card
    limitations = card.split("## Limitations", 1)[1].split("\n## ", 1)[0]
    assert (
        "- False-AF rate on augmented premature-beat readings (dev-val, 8 subjects, 294 windows): "
        "0.301 (95% CI 0.085-0.612)." in limitations
    )
    abstain = "- Reading abstain rate (top probability below 0.6) on dev-val: 0.218 (95% CI 0.176-0.253)."
    assert abstain in limitations
    assert "reported under Development metrics" not in card
    assert "(ablation model, not shipped)" in card and "the app loads rhythm-lgbm" in card
    shipped_card = (models_dir / entries["rhythm-lgbm"]["card"]).read_text(encoding="utf-8")
    assert shipped_card.startswith("# rhythm-lgbm 1.0.0 (shipped rhythm model)")
    assert "ships per §11.3 (ADR 0031)" in shipped_card
    assert entries["rhythm-lgbm"]["inputs"] == {"features": [1, 8]}


def test_entries_carry_the_development_metrics_verbatim(trained):
    models_dir, runs_dir = trained
    entries = _manifest(models_dir, runs_dir)
    assert entries["rhythm-lgbm"]["development"] == RHYTHM_EXTRAS["development"]


def test_an_untrained_entry_has_no_development_metrics(untrained):
    entries = _manifest(*untrained)
    assert all(entries[name]["development"] is None for name in NETWORKS)


def test_every_entry_names_its_family_role_and_whether_it_ships(trained):
    models_dir, runs_dir = trained
    entries = _manifest(models_dir, runs_dir)
    described = {name: (entry["family"], entry["role"], entry["ships"]) for name, entry in entries.items()}
    # H-024 option B: SQI-Net only rejects more windows than the rule checks; it is not the gate.
    assert described == {
        "sqi-finger": ("sqi", "guard", True),
        "rhythm-net": ("rhythm", "gate", False),
        "rhythm-lgbm": ("rhythm", "gate", True),
        "diabetes-net": ("diabetes", "gate", True),
    }
    # The non-shipped ablation model is still parity-checked, for the exact file listed.
    parity = json.loads((models_dir / "parity.json").read_text(encoding="utf-8"))["models"]
    assert parity["rhythm-net"]["onnxSha256"] == entries["rhythm-net"]["sha256"]


def test_shipped_models_are_one_per_family_by_flag_not_by_name():
    assert SHIPPED == {"rhythm": "rhythm-lgbm", "sqi": "sqi-finger", "diabetes": "diabetes-net"}


def test_the_logistic_rule_is_a_rhythm_baseline_the_app_can_swap_in():
    rule, lgbm = SPECS["rhythm-logistic"], SPECS["rhythm-lgbm"]
    assert (rule.kind, rule.family, rule.ships, rule.role) == ("classifier", "rhythm", False, "gate")
    assert (rule.inputs, rule.outputs, rule.labels, rule.threshold_keys, rule.abstain_below) == (
        lgbm.inputs,
        lgbm.outputs,
        lgbm.labels,
        lgbm.threshold_keys,
        lgbm.abstain_below,
    )


@pytest.fixture
def with_rule(trained):
    models_dir, runs_dir = trained
    spec = SPECS["rhythm-logistic"]
    pipeline = fit_baseline(spec)
    save_trained(spec, runs_dir, pipeline, {**RHYTHM_EXTRAS, "featureOrder": list(FEATURE_NAMES)})
    _release(models_dir, runs_dir)
    return models_dir, runs_dir, pipeline


def test_the_logistic_rule_entry_carries_the_rule_for_the_app(with_rule):
    models_dir, runs_dir, pipeline = with_rule
    entries = _manifest(models_dir, runs_dir)
    assert [name for name, entry in entries.items() if "rule" in entry] == ["rhythm-logistic"]
    entry = entries["rhythm-logistic"]
    assert (entry["inputs"], entry["outputs"]) == (entries["rhythm-lgbm"]["inputs"], {"probs": [1, 3]})
    rule = entry["rule"]
    assert rule["features"] == list(LOGISTIC_FEATURES)
    assert rule["featureIndices"] == [FEATURE_NAMES.index(name) for name in LOGISTIC_FEATURES]
    assert rule["classes"] == list(LABELS) == entry["labels"]
    assert np.shape(rule["coefficients"]) == (3, 3) and len(rule["intercepts"]) == 3
    # The rule as @lumen/core runs it, from the manifest numbers alone.
    features = seeded_inputs(SPECS["rhythm-logistic"])["features"]
    standardized = (features[:, rule["featureIndices"]].astype(np.float64) - rule["mean"]) / rule["scale"]
    logits = standardized @ np.asarray(rule["coefficients"]).T + rule["intercepts"]
    probs = np.exp(logits - logits.max(axis=1, keepdims=True))
    probs /= probs.sum(axis=1, keepdims=True)
    # In float64 on both sides; the app's JavaScript doubles do the same.
    expected = pipeline.predict_proba(features.astype(np.float64))
    np.testing.assert_allclose(probs, expected, rtol=0, atol=1e-12)
    (onnx_probs,) = ort.InferenceSession(str(models_dir / entry["file"])).run(None, {"features": features})
    assert np.abs(probs - onnx_probs).max() <= TOLERANCE


def test_a_rule_without_column_selection_is_refused():
    spec = SPECS["rhythm-lgbm"]
    features = np.random.default_rng(2).normal(size=(90, 8))
    unselected = make_pipeline(StandardScaler(), LogisticRegression()).fit(features, np.arange(90) % 3)
    with pytest.raises(ProvenanceError, match="column-selecting"):
        logistic_rule(unselected, list(FEATURE_NAMES), spec.labels)


@pytest.mark.parametrize("scaler", [StandardScaler(with_mean=False), StandardScaler(with_std=False)])
def test_a_rule_that_does_not_fully_standardize_is_refused(scaler):
    spec = SPECS["rhythm-lgbm"]
    features = np.random.default_rng(2).normal(size=(90, 8))
    columns = ColumnTransformer([("rule", scaler, [0, 1, 2])], remainder="drop")
    rule = make_pipeline(columns, LogisticRegression()).fit(features, np.arange(90) % 3)
    with pytest.raises(ProvenanceError, match="must standardize"):
        logistic_rule(rule, list(FEATURE_NAMES), spec.labels)


@pytest.mark.parametrize(
    ("rhythm_ships", "match"), [((False, False), "rhythm: none"), ((True, True), r"rhythm: \['rhythm-net'")]
)
def test_ship_rule_needs_exactly_one_per_family(rhythm_ships, match):
    entries = [
        {"name": "rhythm-net", "family": "rhythm", "ships": rhythm_ships[0]},
        {"name": "rhythm-lgbm", "family": "rhythm", "ships": rhythm_ships[1]},
        {"name": "sqi-finger", "family": "sqi", "ships": True},
        {"name": "diabetes-net", "family": "diabetes", "ships": True},
    ]
    with pytest.raises(ShipRuleError, match=match):
        shipped_per_family(entries)


def test_manifest_with_two_shipped_rhythm_models_is_refused(trained, monkeypatch):
    models_dir, runs_dir = trained
    monkeypatch.setitem(specs.SPECS, "rhythm-net", replace(SPECS["rhythm-net"], ships=True))
    _assert_refused(models_dir, runs_dir, ShipRuleError, "rhythm")
    assert not list(models_dir.glob("*.md"))


def test_manifest_without_the_shipped_rhythm_model_is_refused(tmp_path):
    models_dir, runs_dir = tmp_path / "models", tmp_path / "runs"
    runs_dir.mkdir()
    # Networks only: --random-init has no trained rhythm-lgbm to export, so no rhythm model ships.
    _release(models_dir, runs_dir, "--random-init", 3)
    _assert_refused(models_dir, runs_dir, ShipRuleError, "rhythm: none")


def test_untrained_ablation_model_is_left_out_of_a_release(tmp_path):
    runs_dir = tmp_path / "runs"
    save_trained(SPECS["rhythm-lgbm"], runs_dir, fit_baseline(SPECS["rhythm-lgbm"]))
    released = {spec.name for spec in specs.release_specs(runs_dir)}
    assert released == {"sqi-finger", "rhythm-lgbm", "diabetes-net"}


def _assert_refused(models_dir, runs_dir, error, match):
    with pytest.raises(error, match=match):
        _run(write_manifest, "--models-dir", models_dir, "--runs-dir", runs_dir)
    assert not (models_dir / "manifest.json").exists()
    assert not list(models_dir.glob("*.md"))


def test_shipped_card_renders_the_ship_reason_from_the_metrics(trained):
    models_dir, runs_dir = trained
    entries = _manifest(models_dir, runs_dir)
    shipped_card = (models_dir / entries["rhythm-lgbm"]["card"]).read_text(encoding="utf-8")
    assert (
        "The development ablation picked it (subject-level AUROC for AF vs not on dev-val; network minus "
        "rhythm-lgbm: -0.0006, 95% CI -0.0161 to 0.0156), so it ships per §11.3 (ADR 0031)." in shipped_card
    )


def test_refuses_when_the_metrics_pick_another_shipped_model(trained):
    models_dir, runs_dir = trained
    spec = SPECS["rhythm-net"]
    save_trained(
        spec,
        runs_dir,
        source_model(spec, None, 0),
        {**RHYTHM_EXTRAS, "shipDecision": ship_decision("rhythm-net")},
    )
    _assert_refused(models_dir, runs_dir, ShipRuleError, r"rhythm-net.*owner decides.*ADR 0031")


def test_ship_decision_guard_covers_every_family(trained):
    models_dir, runs_dir = trained
    spec = SPECS["sqi-finger"]
    decision = {**ship_decision("sqi-baseline"), "bestBaseline": "sqi-baseline"}
    save_trained(spec, runs_dir, source_model(spec, None, 0), {"shipDecision": decision})
    _assert_refused(models_dir, runs_dir, ShipRuleError, "sqi-baseline.*sqi-finger")


def test_new_metrics_files_must_carry_the_premature_beat_counts(trained):
    models_dir, runs_dir = trained
    development = {
        key: value for key, value in RHYTHM_EXTRAS["development"].items() if key != "prematureBeatSet"
    }
    save_trained(
        SPECS["rhythm-lgbm"],
        runs_dir,
        fit_baseline(SPECS["rhythm-lgbm"]),
        {**RHYTHM_EXTRAS, "development": development},
    )
    _assert_refused(models_dir, runs_dir, ProvenanceError, "prematureBeatSet")


def test_older_metrics_files_without_the_counts_still_render(trained):
    models_dir, runs_dir = trained
    development = {
        key: value for key, value in RHYTHM_EXTRAS["development"].items() if key != "prematureBeatSet"
    }
    older = {key: value for key, value in RHYTHM_EXTRAS.items() if key != "metricsFormat"}
    lgbm = SPECS["rhythm-lgbm"]
    save_trained(lgbm, runs_dir, fit_baseline(lgbm), {**older, "development": development})
    _release(models_dir, runs_dir)
    card = (models_dir / _manifest(models_dir, runs_dir)["rhythm-lgbm"]["card"]).read_text(encoding="utf-8")
    assert "premature-beat readings (dev-val): 0.301 (95% CI 0.085-0.612)." in card


def test_refuses_without_parity_json(untrained):
    models_dir, runs_dir = untrained
    (models_dir / "parity.json").unlink()
    _assert_refused(models_dir, runs_dir, ProvenanceError, "not found")


def test_refuses_parity_that_covers_only_one_model(untrained):
    models_dir, runs_dir = untrained
    _run(verify_onnx, "--name", "sqi-finger", "--random-init", 3, "--models-dir", models_dir)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "parity covers")


def test_refuses_parity_run_on_a_different_onnx_file(untrained):
    models_dir, runs_dir = untrained
    _run(to_onnx, "--name", "diabetes-net", "--random-init", 4, "--out-dir", models_dir)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "different diabetes-net@1.0.0.onnx")


def test_refuses_parity_above_tolerance(untrained):
    models_dir, runs_dir = untrained
    path = models_dir / "parity.json"
    report = json.loads(path.read_text(encoding="utf-8"))
    report["models"]["rhythm-net"]["maxAbsDiff"] = 2e-4
    path.write_text(json.dumps(report), encoding="utf-8")
    _assert_refused(models_dir, runs_dir, ProvenanceError, "exceeds")


def test_refuses_parity_run_on_a_different_source_model(trained):
    models_dir, runs_dir = trained
    spec = SPECS["sqi-finger"]
    save_trained(spec, runs_dir, source_model(spec, None, 9), SQI_EXTRAS)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "different source model")


def test_refuses_weights_changed_after_training(trained):
    models_dir, runs_dir = trained
    spec = SPECS["diabetes-net"]
    torch.save(source_model(spec, None, 9).state_dict(), runs_dir / spec.source_file)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "sha256 differs")


@pytest.mark.parametrize(
    ("override", "match"),
    [
        ({"trainedOn": []}, "trainedOn"),
        ({"threshold": {"af": None}}, "finite number"),
        ({"threshold": {"sinus": 0.5}}, "threshold keys"),
        ({"development": None}, "development"),
        ({"development": {"subjects": 3, "metrics": {}}}, "development"),
        ({"sourceSha256": "abc"}, "sourceSha256"),
    ],
)
def test_metrics_file_is_validated(tmp_path, override, match):
    spec = SPECS["rhythm-net"]
    save_trained(spec, tmp_path, source_model(spec, None, 1), override)
    with pytest.raises(ProvenanceError, match=match):
        load_metrics(spec, tmp_path)


@pytest.mark.parametrize("target", [MODELS_DIR, MODELS_DIR / "staging"])
def test_models_folder_needs_training_metrics(tmp_path, target):
    existed = target.exists()
    with pytest.raises(FileNotFoundError, match="train"):
        _run(write_manifest, "--models-dir", target, "--runs-dir", tmp_path)
    assert target.exists() == existed


RELIABILITY = {
    "method": "none: the model's own class probabilities, not recalibrated",
    "windowExpectedCalibrationErrorAf": 0.035,
    "reliabilityAf": [
        {"low": 0.0, "high": 0.1, "windows": 90, "predicted": 0.02, "observed": 0.03},
        {"low": 0.3, "high": 0.4, "windows": 10, "predicted": 0.35, "observed": 0.61},
    ],
    "reliabilityTop": [{"low": 0.5, "high": 0.6, "windows": 100, "predicted": 0.55, "observed": 0.6}],
}


def _with_calibration(runs_dir, spec, calibration):
    path = runs_dir / f"{spec.file_stem}.json"
    metrics = json.loads(path.read_text(encoding="utf-8"))
    metrics["calibration"] = calibration(metrics["sourceSha256"])
    path.write_text(json.dumps(metrics), encoding="utf-8")


def test_reliability_tables_get_a_plot_next_to_the_card(trained):
    models_dir, runs_dir = trained
    lgbm = SPECS["rhythm-lgbm"]
    _with_calibration(runs_dir, lgbm, lambda sha: {"sourceSha256": sha, **RELIABILITY})
    card = (models_dir / _manifest(models_dir, runs_dir)["rhythm-lgbm"]["card"]).read_text(encoding="utf-8")
    calibration = card.split("## Calibration", 1)[1].split("\n## ", 1)[0]
    assert "![Reliability diagram, dev-val windows](rhythm-lgbm@1.0.0.calibration.svg)" in calibration
    assert "| 0.3-0.4 | 10 | 0.350 | 0.610 | +0.260 |" in calibration
    assert "| 0.5-0.6 | 100 | 0.550 | 0.600 | +0.050 |" in calibration
    assert "- windowExpectedCalibrationErrorAf: 0.035" in calibration
    svg = ElementTree.parse(models_dir / "rhythm-lgbm@1.0.0.calibration.svg").getroot()
    namespace = "{http://www.w3.org/2000/svg}"
    assert len(svg.findall(f"{namespace}polyline")) == 2
    assert len(svg.findall(f"{namespace}circle")) == 3
    # The abstain line sits at the manifest's abstainBelow on the 0-1 axis.
    assert any(
        line.get("x1")
        == line.get("x2")
        == f"{write_manifest.PLOT_LEFT + lgbm.abstain_below * write_manifest.PLOT_SIZE:.1f}"
        for line in svg.findall(f"{namespace}line")
    )


def test_a_model_without_tables_gets_no_plot_and_loses_a_stale_one(trained):
    models_dir, runs_dir = trained
    stale = models_dir / "rhythm-net@1.0.0.calibration.svg"
    stale.write_text("<svg/>", encoding="utf-8")
    card = (models_dir / _manifest(models_dir, runs_dir)["rhythm-net"]["card"]).read_text(encoding="utf-8")
    assert "- temperature: 1.5" in card and ".calibration.svg" not in card
    assert not stale.exists()


@pytest.mark.parametrize(
    "calibration",
    [
        lambda _sha: {"sourceSha256": "0" * 64, **RELIABILITY},
        lambda _sha: RELIABILITY,
        lambda _sha: {key: value for key, value in RELIABILITY.items() if key != "reliabilityAf"},
    ],
    ids=["another model's sha256", "tables without a sha256", "top-class table only, without a sha256"],
)
def test_a_calibration_not_keyed_to_the_model_file_is_refused(trained, calibration):
    models_dir, runs_dir = trained
    _with_calibration(runs_dir, SPECS["rhythm-lgbm"], calibration)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "calibration.sourceSha256")


def test_the_reliability_plot_is_byte_for_byte_reproducible(trained):
    models_dir, runs_dir = trained
    _with_calibration(runs_dir, SPECS["rhythm-lgbm"], lambda sha: {"sourceSha256": sha, **RELIABILITY})
    plot = models_dir / "rhythm-lgbm@1.0.0.calibration.svg"
    _manifest(models_dir, runs_dir)
    first = plot.read_bytes()
    plot.unlink()
    _manifest(models_dir, runs_dir)
    assert plot.read_bytes() == first


EXTERNALLY_TESTED = ("rhythm-lgbm", "rhythm-net", "sqi-finger", "diabetes-net")


def _units(seed):
    rng = np.random.default_rng(seed)
    is_positive = np.arange(40) % 2 == 0
    scores = np.clip(0.5 + np.where(is_positive, 0.3, -0.3) + rng.normal(0, 0.2, 40), 0, 1)
    return Units(scores, is_positive, np.array([f"s{index}" for index in range(40)]))


def _external_results(models_dir, runs_dir, status="done"):
    # The diabetes block, the per-model reports and the ML-4 report come from eval.external's own
    # functions, so a change to their output fails here; the rhythm and sqi family layouts around them
    # are written out by hand, since building them needs ONNX scoring of MIMIC recordings.
    def frozen(name):
        (threshold,) = load_metrics(SPECS[name], runs_dir)["threshold"].values()
        return threshold

    def ledger(name):
        return {
            "model": f"{name}@1.0.0",
            "family": SPECS[name].family,
            "approval": "H-050",
            "commit": "0" * 40,
            "onnxSha256": sha256_of(models_dir / f"{name}@1.0.0.onnx"),
            "status": status,
            "startedAt": "2026-10-20T10:00:00+00:00",
            "finishedAt": "2026-10-20T11:00:00+00:00" if status == "done" else None,
        }

    results = {"format": 1, "runs": [ledger(name) for name in EXTERNALLY_TESTED]}
    if status != "done":
        return results
    reports = {
        name: {
            "model": f"{name}@1.0.0",
            "role": "shipped" if seed == 0 else "ablation",
            "subject": binary_report(_units(seed), frozen(name), RHYTHM_PREVALENCES),
            "reading": binary_report(_units(seed + 10), frozen(name), ()),
            "window": binary_report(_units(seed + 20), frozen(name), ()),
            "appReadings": {
                "readings": 48,
                "readingsWithRhythmCard": 40,
                "abstainRate": with_ci(
                    _units(seed + 30), lambda _is_af, scores: float(np.mean(scores < 0.6))
                ),
                "answered": binary_report(_units(seed + 40), frozen(name), ()),
                "possibleAfSubjects": {
                    "subjects": 40,
                    "sensitivity": with_ci(_units(seed + 50), sensitivity_at(0.5)),
                    "specificity": with_ci(_units(seed + 50), specificity_at(0.5)),
                },
            },
            "floorMet": True,
        }
        for seed, name in enumerate(("rhythm-lgbm", "rhythm-net"))
    }
    rng = np.random.default_rng(7)
    is_af = np.repeat([True, False], 300)
    subjects = np.where(is_af, "af", "sinus") + (np.arange(600) % 3).astype(str)
    windows = BiasWindows(subjects, is_af, rng.random(600) < 0.9, rng.uniform(50, 110, 600))
    results["rhythm"] = {
        "model": "rhythm-lgbm@1.0.0",
        "subjects": 40,
        "outcome": "shipped-meets-floor",
        "models": reports,
    }
    results["sqi"] = {
        "model": "sqi-finger@1.0.0",
        "role": "guard",
        "threshold": frozen("sqi-finger"),
        "subjects": 6,
        **rhythm_bias_report(windows, ["af0", "af1", "af2"], ["sinus0", "sinus1", "sinus2"]),
    }
    entry = {"name": "diabetes-net", "version": "1.0.0", "threshold": {"pattern": frozen("diabetes-net")}}
    results["diabetes"] = diabetes_part(entry, _units(2), {"holdoutWithoutPleth": 3})
    return results


def _write_external(models_dir, results):
    (models_dir / "external-test.json").write_text(json.dumps(results), encoding="utf-8")


def _external_card(models_dir, entry):
    card = (models_dir / entry["card"]).read_text(encoding="utf-8")
    return card.split("## External test", 1)[1].split("\n## ", 1)[0]


def test_a_finished_external_run_fills_the_entry_and_the_card(trained, monkeypatch):
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)
    models_dir, runs_dir = trained
    results = _external_results(models_dir, runs_dir)
    _write_external(models_dir, results)
    entries = _manifest(models_dir, runs_dir)

    subject = results["rhythm"]["models"]["rhythm-net"]["subject"]
    assert entries["rhythm-net"]["externalTest"] == {
        "dataset": "mimic-perform-af",
        "subjects": 40,
        **{key: subject[key] for key in ("auroc", "sensitivity", "specificity", "ci95", "ppvNpv")},
    }
    sqi = entries["sqi-finger"]["externalTest"]
    assert sqi["rhythmBiasGapPts"] == results["sqi"]["rhythmBiasGapPts"] is not None
    assert entries["diabetes-net"]["externalTest"]["floorMet"] == results["diabetes"]["floorMet"]
    for name in EXTERNALLY_TESTED:
        card = _external_card(models_dir, entries[name])
        assert EXTERNAL_NOT_RUN not in card
        assert "under the owner's approval H-050" in card
    rhythm_card = _external_card(models_dir, entries["rhythm-lgbm"])
    shipped = results["rhythm"]["models"]["rhythm-lgbm"]["subject"]
    low, high = shipped["ci95"]["auroc"]
    assert f"| auroc | {shipped['auroc']} | {low} | {high} |" in rhythm_card
    assert "- floorMet: True" in rhythm_card and "PPV and NPV" in rhythm_card
    assert "- outcome: shipped-meets-floor" in rhythm_card
    assert "- role: ablation" in _external_card(models_dir, entries["rhythm-net"])
    reading = results["rhythm"]["models"]["rhythm-lgbm"]["reading"]
    low, high = reading["ci95"]["sensitivity"]
    levels = rhythm_card.split("Reading level", 1)[1]
    assert (
        f"| sensitivity | {reading['sensitivity']} | {low} | {high} |" in levels.split("Window level", 1)[0]
    )
    assert "(40 units; intervals resample subjects)" in levels
    app = results["rhythm"]["models"]["rhythm-lgbm"]["appReadings"]
    abstain = app["abstainRate"]
    assert "48 readings, 40 with a rhythm card" in rhythm_card
    assert (
        f"| abstain rate (readings with a rhythm card) | {abstain['estimate']} | {abstain['low']} | "
        f"{abstain['high']} |" in rhythm_card
    )
    assert "Reading level" not in _external_card(models_dir, entries["diabetes-net"])
    sqi_low, sqi_high = results["sqi"]["ci95"]
    assert f"| {sqi_low} | {sqi_high} |" in _external_card(models_dir, entries["sqi-finger"])
    assert "- passed: " in _external_card(models_dir, entries["sqi-finger"])


def test_a_started_run_that_never_finished_says_the_data_was_seen(trained):
    models_dir, runs_dir = trained
    _write_external(models_dir, _external_results(models_dir, runs_dir, status="started"))
    entries = _manifest(models_dir, runs_dir)
    for name in EXTERNALLY_TESTED:
        external = dict(entries[name]["externalTest"])
        external.pop("dataset")
        assert all(value is None for value in external.values())
        card = _external_card(models_dir, entries[name])
        assert "did not finish" in card and "new owner approval" in card


def test_an_untested_model_keeps_the_not_run_card(trained, monkeypatch):
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)
    models_dir, runs_dir = trained
    results = _external_results(models_dir, runs_dir)
    results["runs"] = [run for run in results["runs"] if run["family"] != "diabetes"]
    del results["diabetes"]
    _write_external(models_dir, results)
    entries = _manifest(models_dir, runs_dir)
    assert EXTERNAL_NOT_RUN in _external_card(models_dir, entries["diabetes-net"])
    assert entries["diabetes-net"]["externalTest"]["auroc"] is None


def test_refuses_an_external_run_of_a_different_onnx_file(trained, monkeypatch):
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)
    models_dir, runs_dir = trained
    results = _external_results(models_dir, runs_dir)
    results["runs"][1]["onnxSha256"] = "f" * 64
    _write_external(models_dir, results)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "rhythm-net@1.0.0 was externally tested as ONNX")


@pytest.mark.parametrize(
    ("break_results", "match"),
    [
        (lambda results: results.pop("diabetes"), "has no diabetes results"),
        (lambda results: results["rhythm"]["models"].pop("rhythm-net"), "has no rhythm results"),
        (lambda results: results["sqi"].update(model="sqi-finger@0.9.0"), "has no sqi results"),
        (lambda results: results["sqi"].pop("acceptRateAf"), r"lack \['acceptRateAf'\]"),
    ],
    ids=["family block missing", "rhythm model missing", "another version's numbers", "field missing"],
)
def test_refuses_a_finished_run_without_matching_numbers(trained, monkeypatch, break_results, match):
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)
    models_dir, runs_dir = trained
    results = _external_results(models_dir, runs_dir)
    break_results(results)
    _write_external(models_dir, results)
    _assert_refused(models_dir, runs_dir, ProvenanceError, match)


def test_refuses_external_numbers_at_another_threshold(trained, monkeypatch):
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)
    models_dir, runs_dir = trained
    results = _external_results(models_dir, runs_dir)
    results["diabetes"]["threshold"] = 0.31
    _write_external(models_dir, results)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "tested at pattern threshold 0.31")


def test_refuses_rhythm_numbers_at_another_threshold(trained, monkeypatch):
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)
    models_dir, runs_dir = trained
    results = _external_results(models_dir, runs_dir)
    results["rhythm"]["models"]["rhythm-net"]["subject"]["threshold"] = 0.77
    _write_external(models_dir, results)
    _assert_refused(
        models_dir, runs_dir, ProvenanceError, "rhythm-net@1.0.0 was externally tested at af threshold 0.77"
    )


def test_refuses_two_finished_runs_of_one_version(trained, monkeypatch):
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)
    models_dir, runs_dir = trained
    results = _external_results(models_dir, runs_dir)
    results["runs"].append(dict(results["runs"][0]))
    _write_external(models_dir, results)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "2 finished external runs of rhythm-lgbm")


def test_refuses_a_started_run_of_a_different_onnx_file(trained):
    models_dir, runs_dir = trained
    results = _external_results(models_dir, runs_dir, status="started")
    results["runs"][2]["onnxSha256"] = "f" * 64
    _write_external(models_dir, results)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "sqi-finger@1.0.0 was externally tested as ONNX")


def test_refuses_reading_level_numbers_at_another_threshold(trained, monkeypatch):
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)
    models_dir, runs_dir = trained
    results = _external_results(models_dir, runs_dir)
    results["rhythm"]["models"]["rhythm-lgbm"]["reading"]["threshold"] = 0.66
    _write_external(models_dir, results)
    _assert_refused(
        models_dir, runs_dir, ProvenanceError, "rhythm-lgbm@1.0.0 was externally tested at af threshold 0.66"
    )
