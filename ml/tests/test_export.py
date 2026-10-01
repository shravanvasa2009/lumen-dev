import json
from dataclasses import replace

import numpy as np
import onnx
import onnxruntime as ort
import pytest
import torch
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression
from torch import nn

from export import to_onnx, verify_onnx
from export.provenance import SEEDED_INPUTS, TOLERANCE, ProvenanceError, entry_problems, sha256_of
from export.specs import MODELS_DIR, OPSET, SPECS
from export.to_onnx import export_classifier, export_model, export_torch, source_model
from export.verify_onnx import edge_cases, parity_entry, parity_report, seeded_inputs
from tests.training_artifacts import fit_baseline, save_trained

SEED = 11
BASELINES = sorted(name for name, spec in SPECS.items() if spec.kind == "classifier")
NETWORKS = sorted(name for name, spec in SPECS.items() if spec.kind == "torch")


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    out_dir = tmp_path_factory.mktemp("onnx")
    to_onnx.main(["--all", "--random-init", str(SEED), "--out-dir", str(out_dir), "--runs-dir", str(out_dir)])
    return out_dir


def _export(*args):
    to_onnx.main([*map(str, args)])


def _verify(*args):
    verify_onnx.main([*map(str, args)])


@pytest.mark.parametrize("name", NETWORKS)
def test_parity_on_seeded_and_edge_inputs(exported, name):
    spec = SPECS[name]
    entry = parity_entry(spec, source_model(spec, None, SEED), exported / f"{spec.file_stem}.onnx", None)
    assert entry_problems(name, entry) == []
    assert entry["nInputs"] == SEEDED_INPUTS + sum(
        len(next(iter(batch.values()))) for batch in edge_cases(spec)
    )


def test_sqi_parity_windows_are_z_scored_red_only():
    window = seeded_inputs(SPECS["sqi-finger"])["window"]
    assert window.shape == (SEEDED_INPUTS, 1, 256)
    assert np.allclose(window.mean(axis=-1), 0, atol=1e-5)
    assert np.allclose(window.std(axis=-1), 1, atol=1e-4)


@pytest.mark.parametrize("name", NETWORKS)
def test_onnx_file_is_within_its_size_budget(exported, name):
    spec = SPECS[name]
    assert (exported / f"{spec.file_stem}.onnx").stat().st_size < spec.size_budget_bytes


@pytest.mark.parametrize("name", BASELINES)
def test_oversized_baseline_is_refused_and_deleted(tmp_path, name):
    spec = replace(SPECS[name], size_budget_bytes=100)
    with pytest.raises(ValueError, match="limit is 100 "):
        export_model(spec, fit_baseline(spec), tmp_path)
    assert not (tmp_path / f"{spec.file_stem}.onnx").exists()


@pytest.mark.parametrize("name", NETWORKS)
def test_onnx_names_opset_and_batch_axis(exported, name):
    spec = SPECS[name]
    path = exported / f"{spec.file_stem}.onnx"
    model = onnx.load(str(path))
    assert [entry.version for entry in model.opset_import if entry.domain in ("", "ai.onnx")] == [OPSET]
    session = ort.InferenceSession(str(path))
    assert [node.name for node in session.get_inputs()] == list(spec.inputs)
    assert [node.name for node in session.get_outputs()] == list(spec.outputs)
    assert [node.shape[1:] for node in session.get_inputs()] == [shape[1:] for shape in spec.inputs.values()]
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
        assert entry_problems(spec.name, parity_entry(spec, model, path, None)) == []
    assert not np.allclose(outputs[0], outputs[1])


def test_verify_cli_records_files_inputs_and_diffs(exported):
    _verify("--all", "--random-init", SEED, "--models-dir", exported, "--runs-dir", exported)
    report = json.loads((exported / "parity.json").read_text(encoding="utf-8"))
    assert set(report["models"]) == set(NETWORKS)
    for name, entry in report["models"].items():
        assert entry["onnxSha256"] == sha256_of(exported / f"{SPECS[name].file_stem}.onnx")
        assert entry["sourceSha256"] is None
        assert entry["nInputs"] >= SEEDED_INPUTS
        assert entry["outputStd"] > 0
    assert (
        report["maxAbsDiff"] == max(entry["maxAbsDiff"] for entry in report["models"].values()) <= TOLERANCE
    )


def test_verify_cli_fails_when_the_onnx_file_is_not_the_source_model(tmp_path):
    _export("--name", "sqi-finger", "--random-init", 1, "--out-dir", tmp_path)
    with pytest.raises(SystemExit) as exit_info:
        _verify("--name", "sqi-finger", "--random-init", 2, "--models-dir", tmp_path)
    assert exit_info.value.code != 0
    assert json.loads((tmp_path / "parity.json").read_text(encoding="utf-8"))["maxAbsDiff"].startswith(
        "failed"
    )


class _TwoColumns(nn.Module):
    def __init__(self, inner: nn.Module) -> None:
        super().__init__()
        self.inner = inner

    def forward(self, window: torch.Tensor) -> torch.Tensor:
        probability = self.inner(window)
        return torch.cat((probability, probability), dim=1)


def test_shape_mismatch_is_an_error_not_a_broadcast(exported):
    spec = SPECS["sqi-finger"]
    wider = _TwoColumns(source_model(spec, None, SEED)).eval()
    with pytest.raises(ValueError, match="source gives"):
        parity_entry(spec, wider, exported / f"{spec.file_stem}.onnx", None)


def test_saturated_model_fails_parity(tmp_path):
    spec = SPECS["sqi-finger"]
    model = source_model(spec, None, SEED)
    with torch.no_grad():
        model.head.weight.zero_()
    entry = parity_entry(spec, model, export_torch(spec, model, tmp_path), None)
    assert entry["maxAbsDiff"] <= TOLERANCE
    assert any("constant" in problem for problem in entry_problems(spec.name, entry))
    assert parity_report({spec.name: entry})["maxAbsDiff"].startswith("failed")


def test_non_finite_diff_is_written_so_m3_fails():
    finite = {"onnxSha256": "a", "sourceSha256": None, "nInputs": 508, "maxAbsDiff": 1e-7, "outputStd": 0.1}
    report = parity_report({"sqi-finger": finite, "rhythm-net": {**finite, "maxAbsDiff": float("inf")}})
    assert report["models"]["rhythm-net"]["maxAbsDiff"] == "non-finite"
    assert report["models"]["sqi-finger"]["maxAbsDiff"] == 1e-7
    assert isinstance(report["maxAbsDiff"], str)
    json.dumps(report, allow_nan=False)


@pytest.mark.parametrize("target", [MODELS_DIR, MODELS_DIR / "staging"])
@pytest.mark.parametrize(("module", "flag"), [(to_onnx, "--out-dir"), (verify_onnx, "--models-dir")])
def test_random_init_never_writes_into_models(module, flag, target):
    with pytest.raises(SystemExit):
        module.main(["--all", "--random-init", "1", flag, str(target)])


def test_single_model_parity_cannot_replace_models_parity_json():
    with pytest.raises(SystemExit):
        _verify("--name", "sqi-finger", "--models-dir", MODELS_DIR)


def test_trained_export_needs_a_checkpoint(tmp_path):
    with pytest.raises(FileNotFoundError, match="train sqi-finger first"):
        _export("--name", "sqi-finger", "--runs-dir", tmp_path, "--out-dir", tmp_path)


def test_trained_export_needs_the_metrics_file(tmp_path):
    spec = SPECS["sqi-finger"]
    torch.save(source_model(spec, None, 5).state_dict(), tmp_path / spec.source_file)
    with pytest.raises(FileNotFoundError, match="json not found"):
        _export("--name", "sqi-finger", "--runs-dir", tmp_path, "--out-dir", tmp_path)


def test_trained_export_refuses_weights_the_metrics_do_not_describe(tmp_path):
    spec = SPECS["sqi-finger"]
    save_trained(spec, tmp_path, source_model(spec, None, 5))
    torch.save(source_model(spec, None, 6).state_dict(), tmp_path / spec.source_file)
    with pytest.raises(ProvenanceError, match="sha256 differs"):
        _export("--name", "sqi-finger", "--runs-dir", tmp_path, "--out-dir", tmp_path)


def test_trained_export_and_parity_record_the_source_hash(tmp_path):
    spec = SPECS["rhythm-net"]
    metrics = save_trained(spec, tmp_path, source_model(spec, None, 5))
    _export("--name", "rhythm-net", "--runs-dir", tmp_path, "--out-dir", tmp_path)
    _verify("--name", "rhythm-net", "--runs-dir", tmp_path, "--models-dir", tmp_path)
    entry = json.loads((tmp_path / "parity.json").read_text(encoding="utf-8"))["models"]["rhythm-net"]
    assert entry["sourceSha256"] == metrics["sourceSha256"]
    assert entry_problems("rhythm-net", entry) == []


@pytest.mark.parametrize("name", BASELINES)
def test_baseline_parity_goes_through_the_cli(tmp_path, name):
    spec = SPECS[name]
    metrics = save_trained(spec, tmp_path, fit_baseline(spec))
    _export("--name", name, "--runs-dir", tmp_path, "--out-dir", tmp_path)
    _verify("--name", name, "--runs-dir", tmp_path, "--models-dir", tmp_path)
    entry = json.loads((tmp_path / "parity.json").read_text(encoding="utf-8"))["models"][name]
    assert entry["sourceSha256"] == metrics["sourceSha256"]
    assert entry_problems(name, entry) == []
    session = ort.InferenceSession(str(tmp_path / f"{spec.file_stem}.onnx"))
    assert [node.name for node in session.get_inputs()] == list(spec.inputs)
    assert [node.name for node in session.get_outputs()] == list(spec.outputs)


def test_all_includes_trained_baselines(tmp_path):
    spec = SPECS["rhythm-lgbm"]
    save_trained(spec, tmp_path, fit_baseline(spec))
    _export("--all", "--random-init", 1, "--runs-dir", tmp_path, "--out-dir", tmp_path)
    _verify("--all", "--random-init", 1, "--runs-dir", tmp_path, "--models-dir", tmp_path)
    report = json.loads((tmp_path / "parity.json").read_text(encoding="utf-8"))
    assert set(report["models"]) == {*NETWORKS, "rhythm-lgbm"}
    assert report["maxAbsDiff"] <= TOLERANCE


def test_baseline_fitted_on_the_wrong_features_is_refused(tmp_path):
    spec = SPECS["rhythm-lgbm"]
    wrong = fit_baseline(SPECS["diabetes-lgbm"])
    with pytest.raises(ValueError, match="fitted on 12 features"):
        export_model(spec, wrong, tmp_path)


@pytest.mark.parametrize(
    "classifier", [LGBMClassifier(n_estimators=30, verbose=-1), LogisticRegression(max_iter=500)], ids=type
)
@pytest.mark.parametrize(("classes", "output_name"), [(3, "probs"), (2, "pPattern")])
def test_baseline_export_matches_predict_proba(tmp_path, classifier, classes, output_name):
    rng = np.random.default_rng(4)
    features = rng.normal(size=(400, 8)).astype(np.float32)
    labels = np.digitize(features[:, 0] + 0.5 * rng.normal(size=400), [-0.5, 0.5][: classes - 1])
    classifier.fit(features, labels)
    path = export_classifier(classifier, "features", output_name, tmp_path / "baseline.onnx")
    session = ort.InferenceSession(str(path))
    assert [node.name for node in session.get_outputs()] == [output_name]
    (probabilities,) = session.run(None, {"features": features})
    expected = classifier.predict_proba(features)
    expected = expected[:, 1:] if classes == 2 else expected
    assert probabilities.shape == expected.shape
    assert np.abs(probabilities - expected).max() <= TOLERANCE
    domains = [entry.domain for entry in onnx.load(str(path)).opset_import]
    assert len(domains) == len(set(domains))
