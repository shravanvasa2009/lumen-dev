import inspect
import json

import numpy as np
import onnx
import pandas as pd
import pytest
from onnx import TensorProto, helper, numpy_helper

from datasets import download
from datasets.vitaldb_cases import holdout_case_path
from eval import external
from eval.external_gate import ExternalTestRefusedError
from export.provenance import sha256_of
from lumen_dsp.shape_features import SHAPE_FEATURE_NAMES
from nets.diabetes_net import BEAT, HR_SUMMARY_NAMES
from tests.external_fixtures import THRESHOLDS, write_models
from tests.test_diabetes_features import finger_pulse_codes
from tests.test_vitaldb_pleth import write_vital
from train import diabetes_features, diabetes_holdout
from train.diabetes import TABULAR, segment_set
from train.diabetes_features import extract_case_features, feature_table, segment_table
from train.diabetes_holdout import (
    NO_PLETH_TRACK,
    NO_SCORABLE_SEGMENT,
    NO_STABLE_WINDOW,
    case_segments,
    model_inputs,
    release_rhythm_model,
    score_holdout,
    shipped_rhythm_entry,
)
from train.vitaldb_pleth import PLETH_RATE_HZ, SEGMENT_S, extract_case

# Holdout patient -> (diabetic, PLETH codes or None for a case without the track). Diabetic patients get a
# faster pulse, which the test model below scores higher.
# Controls stay at 68 bpm or more: below that, DSP-7 takes this synthetic pulse's dicrotic wave for beats.
FLAT = np.full(SEGMENT_S * PLETH_RATE_HZ + 5, 500, dtype=np.int16)
PATIENTS = {
    101: (True, finger_pulse_codes(SEGMENT_S * 2 + 5, bpm=82)),
    102: (True, finger_pulse_codes(SEGMENT_S + 5, bpm=86, seed=2)),
    103: (False, finger_pulse_codes(SEGMENT_S + 5, bpm=68, seed=3)),
    104: (False, finger_pulse_codes(SEGMENT_S + 5, bpm=72, seed=4)),
    105: (False, None),
    106: (True, FLAT),
}
HOLDOUT = list(PATIENTS)
FILL_MEDIANS = {name: float(index) for index, name in enumerate(TABULAR)}


@pytest.fixture(autouse=True)
def fewer_resamples(monkeypatch):
    # Speed only: the real run uses train.rhythm's 2,000 resamples.
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)


def write_diabetes_model(path) -> None:
    # P(pattern) = sigmoid(0.2 × (HR − 70)); the beat and shape inputs pass through zero weights, so the
    # graph takes every input diabetes-net takes.
    hr = np.zeros((len(HR_SUMMARY_NAMES), 1), dtype=np.float32)
    hr[HR_SUMMARY_NAMES.index("hrBpm"), 0] = 0.2
    initializers = [
        numpy_helper.from_array(hr, "w_hr"),
        numpy_helper.from_array(np.zeros((len(SHAPE_FEATURE_NAMES), 1), np.float32), "w_shape"),
        numpy_helper.from_array(np.zeros((BEAT, 1), np.float32), "w_beat"),
        numpy_helper.from_array(np.array([-14.0], np.float32), "bias"),
    ]
    nodes = [
        helper.make_node("MatMul", ["hrSummary", "w_hr"], ["from_hr"]),
        helper.make_node("MatMul", ["shapeFeatures", "w_shape"], ["from_shape"]),
        helper.make_node("Flatten", ["beat"], ["flat_beat"]),
        helper.make_node("MatMul", ["flat_beat", "w_beat"], ["from_beat"]),
        helper.make_node("Sum", ["from_hr", "from_shape", "from_beat", "bias"], ["logit"]),
        helper.make_node("Sigmoid", ["logit"], ["pPattern"]),
    ]
    inputs = [
        helper.make_tensor_value_info("beat", TensorProto.FLOAT, [None, 1, BEAT]),
        helper.make_tensor_value_info("shapeFeatures", TensorProto.FLOAT, [None, len(SHAPE_FEATURE_NAMES)]),
        helper.make_tensor_value_info("hrSummary", TensorProto.FLOAT, [None, len(HR_SUMMARY_NAMES)]),
    ]
    output = helper.make_tensor_value_info("pPattern", TensorProto.FLOAT, [None, 1])
    graph = helper.make_graph(nodes, "diabetes", inputs, [output], initializer=initializers)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 8
    onnx.checker.check_model(model)
    path.write_bytes(model.SerializeToString())


@pytest.fixture
def models_dir(tmp_path):
    folder = tmp_path / "models"
    write_models(folder)
    write_diabetes_model(folder / "diabetes-net@1.0.0.onnx")
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = next(entry for entry in manifest["models"] if entry["name"] == "diabetes-net")
    entry |= {
        "inputs": {"beat": [1, 1, BEAT], "shapeFeatures": [1, 12], "hrSummary": [1, 4]},
        "sha256": sha256_of(folder / entry["file"]),
        "featureOrder": {"shapeFeatures": list(SHAPE_FEATURE_NAMES), "hrSummary": list(HR_SUMMARY_NAMES)},
        "fillMedians": FILL_MEDIANS,
    }
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return folder


def diabetes_entry(models_dir) -> dict:
    manifest = json.loads((models_dir / "manifest.json").read_text(encoding="utf-8"))
    return next(entry for entry in manifest["models"] if entry["name"] == "diabetes-net")


@pytest.fixture
def holdout_files(data_dir):
    # The open clinical table and one .vital file per holdout case, under the test's LUMEN_DATA_DIR.
    clinical = pd.DataFrame(
        {
            "caseid": range(1, len(HOLDOUT) + 1),
            "subjectid": HOLDOUT,
            "age": "60",
            "sex": "F",
            "preop_dm": [int(diabetic) for diabetic, _ in PATIENTS.values()],
        }
    )
    vitaldb = diabetes_holdout.VITALDB
    vitaldb.local_dir.mkdir(parents=True, exist_ok=True)
    clinical.to_csv(vitaldb.local_dir / "clinical_data.csv", index=False)
    download.write_marker(vitaldb)
    for caseid, (_, codes) in enumerate(PATIENTS.values(), start=1):
        path = holdout_case_path(caseid)
        path.parent.mkdir(parents=True, exist_ok=True)
        write_vital(path, codes)
    return data_dir


def test_the_signature_binds_as_preflight_requires(models_dir):
    inspect.signature(score_holdout).bind(diabetes_entry(models_dir), models_dir, HOLDOUT)


def test_an_onnx_file_that_is_not_the_manifests_is_refused_before_any_holdout_read(models_dir, data_dir):
    entry = diabetes_entry(models_dir) | {"sha256": "0" * 64}
    # No holdout file exists, so reaching one would raise something else.
    with pytest.raises(ExternalTestRefusedError, match="sha256"):
        score_holdout(entry, models_dir, HOLDOUT)


@pytest.mark.parametrize(
    "change",
    [
        lambda entry: entry.pop("fillMedians"),
        lambda entry: entry.pop("featureOrder"),
        lambda entry: entry["fillMedians"].pop("hrBpm"),
        lambda entry: entry["featureOrder"]["shapeFeatures"].pop(),
    ],
)
def test_a_model_without_its_fill_values_or_feature_order_is_refused(models_dir, data_dir, change):
    entry = diabetes_entry(models_dir)
    change(entry)
    with pytest.raises(ExternalTestRefusedError, match="featureOrder|fillMedians"):
        score_holdout(entry, models_dir, HOLDOUT)


def test_the_rhythm_label_comes_from_the_shipped_rhythm_lgbm_in_the_release(models_dir):
    entry = shipped_rhythm_entry(models_dir)
    assert (entry["name"], entry["file"]) == ("rhythm-lgbm", "rhythm-lgbm@1.0.0.onnx")
    (models_dir / entry["file"]).write_bytes(b"another model")
    with pytest.raises(ExternalTestRefusedError, match="sha256"):
        shipped_rhythm_entry(models_dir)


def test_holdout_features_are_the_dev_caches_for_the_same_signal(models_dir, holdout_files, tmp_path):
    # One pipeline: patient 101's PLETH through the dev cache (vitaldb_pleth, then diabetes_features, then
    # train.diabetes's input conversion) and through the holdout scorer give the same model inputs.
    rhythm_entry = shipped_rhythm_entry(models_dir)
    entry = diabetes_entry(models_dir)
    holdout = case_segments(1, rhythm_entry, models_dir)
    assert holdout.dropped is None and len(holdout.segments) == 2

    _, codes = PATIENTS[101]
    write_vital(tmp_path / "0001.vital", codes)
    extract_case(1, 101, tmp_path / "0001.vital", tmp_path / "pleth")
    rhythm_model = release_rhythm_model(rhythm_entry, models_dir)
    extract_case_features(1, 101, tmp_path / "pleth", tmp_path / "features", rhythm_model)
    cases = pd.DataFrame({"caseid": [1], "subjectid": [101], "preop_dm": [1]})
    dev = feature_table(segment_table(tmp_path / "features", cases, {101: "dev-train"}))

    pd.testing.assert_frame_equal(
        holdout.segments[list(TABULAR)].astype(float), dev[list(TABULAR)].astype(float), check_exact=True
    )
    dev_inputs = segment_set(dev, "dev-train", FILL_MEDIANS)
    holdout_inputs = model_inputs(entry, holdout.segments)
    np.testing.assert_array_equal(holdout_inputs["beat"], dev_inputs.beats)
    np.testing.assert_array_equal(
        np.concatenate([holdout_inputs["shapeFeatures"], holdout_inputs["hrSummary"]], axis=1),
        dev_inputs.tabular,
    )
    # SDNN needs 300 clean seconds, so every 90 s segment takes the fill value, as in training.
    assert (holdout_inputs["hrSummary"][:, HR_SUMMARY_NAMES.index("sdnnMs")] == FILL_MEDIANS["sdnnMs"]).all()


def test_cases_without_a_usable_pleth_segment_say_why(models_dir, holdout_files, monkeypatch):
    rhythm_entry = shipped_rhythm_entry(models_dir)
    assert case_segments(5, rhythm_entry, models_dir).dropped == NO_PLETH_TRACK
    assert case_segments(6, rhythm_entry, models_dir).dropped == NO_STABLE_WINDOW
    # A stable window whose beats give no averaged beat is not scored, as it never reached training.
    real = diabetes_features.segment_features
    monkeypatch.setattr(
        diabetes_features,
        "segment_features",
        lambda bands, model: ({**real(bands, model)[0], "hasShape": False}, None),
    )
    assert case_segments(1, rhythm_entry, models_dir).dropped == NO_SCORABLE_SEGMENT


def test_the_holdout_reader_takes_only_locked_holdout_files(tmp_path, data_dir):
    write_vital(tmp_path / "0001.vital", FLAT)
    with pytest.raises(ValueError, match="not a locked holdout case"):
        diabetes_holdout.vitaldb_pleth.read_holdout_pleth(tmp_path / "0001.vital")


def approved_run(models_dir, data_dir, monkeypatch) -> dict:
    # eval.external's diabetes part on the six-patient holdout, with the real scorer.
    monkeypatch.setattr(external, "load_split", lambda: {"holdout": HOLDOUT, "dev": [1, 2]})
    approval = data_dir / "external-approval.json"
    approval.write_text(json.dumps({"request": "H-031", "models": ["diabetes-net@1.0.0"]}), encoding="utf-8")
    return external.run(
        ("diabetes",),
        models_dir=models_dir,
        results_path=models_dir / "external-test.json",
        approval_path=approval,
        dataset_dir=data_dir / "external" / "mimic-perform-af",
        commit="0" * 40,
        now=lambda: "2026-10-20T10:00:00+00:00",
    )


def test_preflight_refuses_a_release_the_real_scorer_cannot_score(models_dir, holdout_files, monkeypatch):
    manifest_path = models_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    next(entry for entry in manifest["models"] if entry["name"] == "diabetes-net").pop("fillMedians")
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ExternalTestRefusedError, match="fillMedians"):
        approved_run(models_dir, holdout_files, monkeypatch)
    # The ledger never recorded a start, so the owner's approval is unused.
    assert not (models_dir / "external-test.json").exists()


def test_an_approved_run_scores_the_holdout_with_the_real_scorer(models_dir, holdout_files, monkeypatch):
    # Four patients scored, two without a usable PLETH segment.
    results = approved_run(models_dir, holdout_files, monkeypatch)
    diabetes = results["diabetes"]
    assert (diabetes["subjects"], diabetes["diabeticSubjects"], diabetes["holdoutWithoutPleth"]) == (4, 2, 2)
    assert diabetes["holdoutWithoutPlethReasons"] == {NO_PLETH_TRACK: 1, NO_STABLE_WINDOW: 1}
    assert diabetes["threshold"] == THRESHOLDS["diabetes-net"]
    # Faster pulses score higher, and the diabetic patients have them.
    assert diabetes["auroc"] == 1.0
    assert [run["status"] for run in results["runs"]] == ["done"]
