import json
from xml.etree import ElementTree
from dataclasses import replace

import pytest
import torch

from export import to_onnx, verify_onnx, write_manifest
from export.provenance import ALL_BAD_BASIS, ProvenanceError, load_metrics, sha256_of
from export import specs
from export.specs import MODELS_DIR, OPSET, SHIPPED, SPECS, ShipRuleError, shipped_per_family
from export.to_onnx import source_model
from export.write_manifest import EXTERNAL_NOT_RUN, NOT_MEASURED
from tests.training_artifacts import fit_baseline, save_trained

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
    ],
    ids=["another model's sha256", "tables without a sha256"],
)
def test_a_calibration_not_keyed_to_the_model_file_is_refused(trained, calibration):
    models_dir, runs_dir = trained
    _with_calibration(runs_dir, SPECS["rhythm-lgbm"], calibration)
    _assert_refused(models_dir, runs_dir, ProvenanceError, "calibration.sourceSha256")
