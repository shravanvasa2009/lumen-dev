import hashlib
import json

import pytest

from export import to_onnx, write_manifest
from export.specs import OPSET, SPECS
from export.write_manifest import EXTERNAL_NOT_RUN, NOT_MEASURED

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

RHYTHM_METRICS = {
    "trainedOn": ["afdb", "ltafdb"],
    "threshold": {"af": 0.42},
    "development": {"subjects": 7, "metrics": {"auroc": {"estimate": 0.5, "low": 0.25, "high": 0.75}}},
    "ablation": [{"model": "rhythm-net", "auroc": 0.5}, {"model": "lightgbm", "auroc": 0.25}],
    "calibration": {"method": "temperature scaling", "temperature": 1.5},
}


@pytest.fixture
def models_dir(tmp_path):
    to_onnx.main(["--all", "--random-init", "3", "--out-dir", str(tmp_path)])
    return tmp_path


def _manifest(models_dir, runs_dir):
    write_manifest.main(["--models-dir", str(models_dir), "--runs-dir", str(runs_dir)])
    return {
        entry["name"]: entry for entry in json.loads((models_dir / "manifest.json").read_text())["models"]
    }


def test_manifest_matches_the_files_and_appendix_b(models_dir, tmp_path_factory):
    entries = _manifest(models_dir, tmp_path_factory.mktemp("runs"))
    assert set(entries) == set(SPECS)
    for name, entry in entries.items():
        spec = SPECS[name]
        assert entry["sha256"] == hashlib.sha256((models_dir / entry["file"]).read_bytes()).hexdigest()
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
    rhythm = entries["rhythm-net"]
    assert rhythm["inputs"] == {"intervals": [1, 64], "mask": [1, 64], "features": [1, 8]}
    assert rhythm["outputs"] == {"probs": [1, 3]}
    assert rhythm["labels"] == ["sinus", "af", "other"]
    assert rhythm["abstainBelow"] == 0.6
    assert set(rhythm["externalTest"]) >= {"auroc", "sensitivity", "specificity", "ci95"}


def test_cards_have_every_heading_and_no_external_numbers(models_dir, tmp_path_factory):
    entries = _manifest(models_dir, tmp_path_factory.mktemp("runs"))
    for entry in entries.values():
        card = (models_dir / entry["card"]).read_text(encoding="utf-8")
        assert all(heading in card for heading in CARD_HEADINGS)
        external = card.split("## External test", 1)[1].split("\n## ", 1)[0]
        assert EXTERNAL_NOT_RUN in external
        assert NOT_MEASURED in card.split("## Development metrics", 1)[1].split("\n## ", 1)[0]


def test_metrics_file_fills_threshold_datasets_and_tables(models_dir, tmp_path):
    runs_dir = tmp_path / "runs"
    runs_dir.mkdir()
    (runs_dir / "rhythm-net@1.0.0.json").write_text(json.dumps(RHYTHM_METRICS))
    rhythm = _manifest(models_dir, runs_dir)["rhythm-net"]
    assert rhythm["threshold"] == {"af": 0.42}
    assert rhythm["trainedOn"] == ["afdb", "ltafdb"]
    card = (models_dir / rhythm["card"]).read_text(encoding="utf-8")
    assert "| auroc | 0.5 | 0.25 | 0.75 |" in card
    assert "| lightgbm | 0.25 |" in card
    assert "- temperature: 1.5" in card
    assert "Trained on: afdb, ltafdb." in card


def test_metrics_file_with_wrong_threshold_keys_is_rejected(models_dir, tmp_path):
    (tmp_path / "rhythm-net@1.0.0.json").write_text(
        json.dumps({**RHYTHM_METRICS, "threshold": {"sinus": 0.5}})
    )
    with pytest.raises(ValueError, match="threshold keys"):
        _manifest(models_dir, tmp_path)


def test_models_folder_needs_training_metrics(tmp_path):
    with pytest.raises(FileNotFoundError, match="train"):
        write_manifest.write_manifest(tmp_path, tmp_path, require_metrics=True)
