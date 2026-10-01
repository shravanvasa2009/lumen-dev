import json

import pytest
import torch

from export import to_onnx, verify_onnx, write_manifest
from export.provenance import ProvenanceError, load_metrics, sha256_of
from export.specs import MODELS_DIR, OPSET, REQUIRED, SPECS
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

RHYTHM_EXTRAS = {
    "ablation": [{"model": "rhythm-net", "auroc": 0.5}, {"model": "lightgbm", "auroc": 0.25}],
    "calibration": {"method": "temperature scaling", "temperature": 1.5},
    "notes": ["Jitter sigma is an assumption."],
    "development": {
        "subjects": 4,
        "metrics": {"auroc": {"estimate": 0.5, "low": 0.25, "high": 0.75}},
        "byDataset": [{"dataset": "afdb", "subject AUROC": "0.600 (0.400-0.800)"}],
    },
}


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
    _release(models_dir, runs_dir, "--random-init", 3)
    return models_dir, runs_dir


@pytest.fixture
def trained(tmp_path):
    models_dir, runs_dir = tmp_path / "models", tmp_path / "runs"
    for seed, name in enumerate(REQUIRED):
        extras = RHYTHM_EXTRAS if name == "rhythm-net" else {}
        save_trained(SPECS[name], runs_dir, source_model(SPECS[name], None, seed), extras)
    save_trained(SPECS["rhythm-lgbm"], runs_dir, fit_baseline(SPECS["rhythm-lgbm"]))
    _release(models_dir, runs_dir)
    return models_dir, runs_dir


def test_manifest_matches_the_files_and_appendix_b(untrained):
    models_dir, runs_dir = untrained
    entries = _manifest(models_dir, runs_dir)
    assert set(entries) == set(REQUIRED)
    for name, entry in entries.items():
        spec = SPECS[name]
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
        assert NOT_MEASURED in card.split("## Development metrics", 1)[1].split("\n## ", 1)[0]
    sqi_card = (models_dir / "sqi-finger@1.0.0.md").read_text(encoding="utf-8")
    assert "inverted red channel" in sqi_card and "finger recordings" in sqi_card


def test_trained_release_fills_metrics_and_lists_baselines(trained):
    models_dir, runs_dir = trained
    entries = _manifest(models_dir, runs_dir)
    assert set(entries) == {*REQUIRED, "rhythm-lgbm"}
    rhythm = entries["rhythm-net"]
    assert rhythm["threshold"] == {"af": 0.5}
    assert rhythm["trainedOn"] == ["afdb"]
    card = (models_dir / rhythm["card"]).read_text(encoding="utf-8")
    assert "| auroc | 0.5 | 0.25 | 0.75 |" in card
    assert "| lightgbm | 0.25 |" in card
    assert "- temperature: 1.5" in card
    assert "Training notes:\n\n- Jitter sigma is an assumption." in card
    assert "| afdb | 0.600 (0.400-0.800) |" in card
    assert "Trained on: afdb." in card
    baseline_card = (models_dir / entries["rhythm-lgbm"]["card"]).read_text(encoding="utf-8")
    assert "classical baseline for rhythm-net" in baseline_card
    assert entries["rhythm-lgbm"]["inputs"] == {"features": [1, 8]}


def _assert_refused(models_dir, runs_dir, error, match):
    with pytest.raises(error, match=match):
        _run(write_manifest, "--models-dir", models_dir, "--runs-dir", runs_dir)
    assert not (models_dir / "manifest.json").exists()


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
    save_trained(spec, runs_dir, source_model(spec, None, 9))
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
