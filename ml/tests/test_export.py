import json

import numpy as np
import onnx
import onnxruntime as ort
import pytest
import torch
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression

from export import to_onnx, verify_onnx
from export.specs import MODELS_DIR, OPSET, SPECS
from export.to_onnx import export_classifier, export_torch, source_model
from export.verify_onnx import TOLERANCE, edge_cases, max_abs_diff, parity_report, seeded_inputs

SEED = 11


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("onnx")
    to_onnx.main(["--all", "--random-init", str(SEED), "--out-dir", str(out_dir)])
    return out_dir


@pytest.mark.parametrize("name", sorted(SPECS))
def test_parity_on_seeded_and_edge_inputs(exported, name):
    spec = SPECS[name]
    batches = [seeded_inputs(spec), *edge_cases(spec)]
    assert len(batches[0][next(iter(spec.inputs))]) == 500
    assert (
        max_abs_diff(source_model(spec, None, SEED), exported / f"{spec.file_stem}.onnx", batches)
        <= TOLERANCE
    )


@pytest.mark.parametrize("name", sorted(SPECS))
def test_onnx_file_is_within_its_size_budget(exported, name):
    spec = SPECS[name]
    assert (exported / f"{spec.file_stem}.onnx").stat().st_size < spec.size_budget_bytes


@pytest.mark.parametrize("name", sorted(SPECS))
def test_onnx_names_opset_and_batch_axis(exported, name):
    spec = SPECS[name]
    path = exported / f"{spec.file_stem}.onnx"
    model = onnx.load(str(path))
    assert [entry.version for entry in model.opset_import if entry.domain in ("", "ai.onnx")] == [OPSET]
    session = ort.InferenceSession(str(path))
    assert [node.name for node in session.get_inputs()] == list(spec.inputs)
    assert [node.name for node in session.get_outputs()] == list(spec.outputs)
    assert all(node.type == "tensor(float)" for node in session.get_inputs())
    assert all(node.shape[0] == "batch" for node in (*session.get_inputs(), *session.get_outputs()))


def test_temperature_is_folded_into_the_graph(tmp_path):
    spec = SPECS["rhythm-net"]
    model = source_model(spec, None, SEED)
    batch = seeded_inputs(spec, count=20)
    outputs = []
    for temperature in (1.0, 3.0):
        model.temperature.fill_(temperature)
        path = export_torch(spec, model, tmp_path / str(temperature))
        outputs.append(ort.InferenceSession(str(path)).run(None, batch)[0])
        assert max_abs_diff(model, path, [batch]) <= TOLERANCE
    assert not np.allclose(outputs[0], outputs[1])


def test_verify_cli_writes_parity_json_for_m3(exported):
    verify_onnx.main(["--all", "--random-init", str(SEED), "--models-dir", str(exported)])
    report = json.loads((exported / "parity.json").read_text())
    assert set(report["models"]) == set(SPECS)
    assert report["maxAbsDiff"] == max(report["models"].values()) <= TOLERANCE


def test_verify_cli_fails_when_the_onnx_file_is_not_the_source_model(tmp_path):
    to_onnx.main(["--name", "sqi-finger", "--random-init", "1", "--out-dir", str(tmp_path)])
    with pytest.raises(SystemExit) as exit_info:
        verify_onnx.main(["--name", "sqi-finger", "--random-init", "2", "--models-dir", str(tmp_path)])
    assert exit_info.value.code != 0
    assert json.loads((tmp_path / "parity.json").read_text())["maxAbsDiff"] > TOLERANCE


def test_non_finite_diff_is_written_so_m3_fails():
    report = parity_report({"sqi-finger": 1e-7, "rhythm-net": float("inf")})
    assert report["maxAbsDiff"] == "non-finite"
    assert report["models"]["sqi-finger"] == 1e-7
    json.dumps(report, allow_nan=False)


@pytest.mark.parametrize("module", [to_onnx, verify_onnx])
def test_random_init_never_writes_into_models(module):
    flag = "--out-dir" if module is to_onnx else "--models-dir"
    with pytest.raises(SystemExit):
        module.main(["--all", "--random-init", "1", flag, str(MODELS_DIR)])


def test_trained_export_needs_a_checkpoint(tmp_path):
    with pytest.raises(FileNotFoundError, match="train sqi-finger first"):
        to_onnx.main(["--name", "sqi-finger", "--runs-dir", str(tmp_path), "--out-dir", str(tmp_path)])


def test_trained_export_loads_the_checkpoint(tmp_path):
    spec = SPECS["rhythm-net"]
    trained = source_model(spec, None, 5)
    torch.save(trained.state_dict(), tmp_path / f"{spec.file_stem}.pt")
    to_onnx.main(["--name", "rhythm-net", "--runs-dir", str(tmp_path), "--out-dir", str(tmp_path)])
    verify_onnx.main(["--name", "rhythm-net", "--runs-dir", str(tmp_path), "--models-dir", str(tmp_path)])
    assert json.loads((tmp_path / "parity.json").read_text())["maxAbsDiff"] <= TOLERANCE


def _baseline_data(classes: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(4)
    features = rng.normal(size=(400, 8)).astype(np.float32)
    labels = np.digitize(features[:, 0] + 0.5 * rng.normal(size=400), [-0.5, 0.5][: classes - 1])
    return features, labels


@pytest.mark.parametrize(
    "classifier", [LGBMClassifier(n_estimators=30, verbose=-1), LogisticRegression(max_iter=500)], ids=type
)
@pytest.mark.parametrize(("classes", "output_name"), [(3, "probs"), (2, "pPattern")])
def test_baseline_export_matches_predict_proba(tmp_path, classifier, classes, output_name):
    features, labels = _baseline_data(classes)
    classifier.fit(features, labels)
    path = export_classifier(classifier, "features", output_name, tmp_path / "baseline.onnx")
    session = ort.InferenceSession(str(path))
    assert [node.name for node in session.get_outputs()] == [output_name]
    (probabilities,) = session.run(None, {"features": features})
    expected = classifier.predict_proba(features)
    # Binary baselines expose only P(positive) as [N, 1], like the neural models.
    expected = expected[:, 1:] if classes == 2 else expected
    assert probabilities.shape == expected.shape
    assert np.abs(probabilities - expected).max() <= TOLERANCE
    domains = [entry.domain for entry in onnx.load(str(path)).opset_import]
    assert len(domains) == len(set(domains))
