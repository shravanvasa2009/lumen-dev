import importlib.util
import json
import sys

import pytest

from eval import external
from eval.external_gate import ExternalTestRefusedError
from eval.external_mimic import DspNotMergedError
from tests.external_fixtures import (
    THRESHOLDS,
    install_fake_beats,
    write_diabetes_scores,
    write_mimic,
    write_models,
)

ALL_MODELS = ["rhythm-lgbm@1.0.0", "rhythm-net@1.0.0", "sqi-finger@1.0.0", "diabetes-net@1.0.0"]


@pytest.fixture(autouse=True)
def fewer_resamples(monkeypatch):
    # Speed only: the code path is the same; the real run uses train.rhythm's 2,000 resamples.
    monkeypatch.setattr("train.rhythm.BOOTSTRAP_RESAMPLES", 200)


@pytest.fixture
def setup(tmp_path, data_dir):
    manifest = write_models(tmp_path / "models")
    dataset_dir = data_dir / "external" / "mimic-perform-af"
    write_mimic(dataset_dir)
    return {
        "manifest": manifest,
        "models_dir": tmp_path / "models",
        "results_path": tmp_path / "models" / "external-test.json",
        "approval_path": tmp_path / "external-approval.json",
        "dataset_dir": dataset_dir,
        "diabetes_scores": write_diabetes_scores(tmp_path / "diabetes-scores.json", manifest),
    }


def approve(setup, request="H-031", models=ALL_MODELS):
    setup["approval_path"].write_text(json.dumps({"request": request, "models": models}), encoding="utf-8")


def run(setup, parts=external.PARTS):
    return external.run(
        parts,
        models_dir=setup["models_dir"],
        results_path=setup["results_path"],
        approval_path=setup["approval_path"],
        dataset_dir=setup["dataset_dir"],
        diabetes_scores=setup["diabetes_scores"],
        commit="0" * 40,
        now=lambda: "2026-10-20T10:00:00+00:00",
    )


def assert_m3_fields(results):
    # The same checks scripts/proof/m3.mjs makes on models/external-test.json.
    for field in ("sensitivity", "specificity", "auroc", "ci95", "ppvNpv"):
        assert results["rhythm"][field] is not None, field
    assert results["sqi"]["rhythmBiasGapPts"] <= 5
    for field in ("auroc", "sensitivity", "specificity", "ci95", "ppvNpv", "floorMet"):
        assert results["diabetes"][field] is not None, field


def test_refuses_without_approval_and_writes_nothing(setup, monkeypatch):
    install_fake_beats(monkeypatch)
    with pytest.raises(ExternalTestRefusedError, match="owner approves"):
        run(setup)
    assert not setup["results_path"].exists()
    assert not (setup["dataset_dir"] / "records").exists()


def test_missing_dsp7_mirror_stops_before_the_ledger_records_a_start(setup, monkeypatch):
    approve(setup)
    monkeypatch.setitem(sys.modules, "lumen_dsp.beats", None)
    with pytest.raises(DspNotMergedError):
        run(setup)
    assert not setup["results_path"].exists()


def test_refuses_a_model_without_a_frozen_threshold(setup, monkeypatch):
    install_fake_beats(monkeypatch)
    approve(setup)
    manifest_path = setup["models_dir"] / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["models"][0]["threshold"] = {"af": None}
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with pytest.raises(ExternalTestRefusedError, match="no frozen af threshold"):
        run(setup)
    assert not setup["results_path"].exists()


def test_full_run_writes_what_m3_reads_then_refuses_a_second_run(setup, monkeypatch):
    install_fake_beats(monkeypatch)
    approve(setup)
    results = run(setup)

    assert_m3_fields(results)
    assert json.loads(setup["results_path"].read_text(encoding="utf-8")) == results
    assert [(entry["model"], entry["status"]) for entry in results["runs"]] == [
        (model, "done") for model in ALL_MODELS
    ]
    # Every threshold is the frozen one from the manifest.
    assert results["rhythm"]["threshold"] == THRESHOLDS["rhythm-lgbm"]
    assert results["rhythm"]["models"]["rhythm-net"]["subject"]["threshold"] == THRESHOLDS["rhythm-net"]
    assert results["sqi"]["threshold"] == THRESHOLDS["sqi-finger"]
    assert results["diabetes"]["threshold"] == THRESHOLDS["diabetes-net"]

    rhythm = results["rhythm"]
    assert (rhythm["afSubjects"], rhythm["nonAfSubjects"]) == (2, 2)
    assert rhythm["model"] == "rhythm-lgbm@1.0.0"
    assert rhythm["sensitivity"] == 1.0 and rhythm["specificity"] == 1.0
    assert rhythm["outcome"] == "shipped-meets-floor"
    assert [row["prevalence"] for row in rhythm["ppvNpv"]] == [0.01, 0.05, 0.10]
    sqi = results["sqi"]
    assert sqi["status"] == "measured"
    assert sqi["breakdown"]["referenceCleanWindowsAf"] >= 200
    assert all(lag == pytest.approx(0.25, abs=0.02) for lag in sqi["lagSecondsBySubject"].values())
    diabetes = results["diabetes"]
    assert (diabetes["subjects"], diabetes["holdoutWithoutPleth"]) == (60, 3)
    assert [row["prevalence"] for row in diabetes["ppvNpv"]] == [0.05, 0.116, 0.20]

    approve(setup, request="H-032")
    with pytest.raises(ExternalTestRefusedError, match="already externally tested"):
        run(setup)
    assert json.loads(setup["results_path"].read_text(encoding="utf-8")) == results


def test_parts_run_separately_and_each_version_only_once(setup, monkeypatch):
    install_fake_beats(monkeypatch)
    approve(setup)
    run(setup, parts=("diabetes",))
    results = run(setup, parts=("rhythm",))
    assert {entry["model"] for entry in results["runs"]} == {"diabetes-net@1.0.0", *ALL_MODELS[:2]}
    assert "diabetes" in results and "rhythm" in results and "sqi" not in results
    with pytest.raises(ExternalTestRefusedError, match="diabetes-net@1.0.0 was already"):
        run(setup, parts=("diabetes",))


def test_a_bad_scores_file_after_the_start_needs_a_new_approval(setup, monkeypatch):
    approve(setup)
    scores = json.loads(setup["diabetes_scores"].read_text(encoding="utf-8"))
    scores["onnxSha256"] = "f" * 64
    setup["diabetes_scores"].write_text(json.dumps(scores), encoding="utf-8")
    with pytest.raises(ValueError, match="onnxSha256"):
        run(setup, parts=("diabetes",))
    with pytest.raises(ExternalTestRefusedError, match="new owner approval"):
        run(setup, parts=("diabetes",))


def test_scores_must_come_from_the_locked_holdout(setup):
    approve(setup)
    scores = json.loads(setup["diabetes_scores"].read_text(encoding="utf-8"))
    scores["subjects"][0]["subject"] = -1
    setup["diabetes_scores"].write_text(json.dumps(scores), encoding="utf-8")
    with pytest.raises(ValueError, match="locked holdout"):
        run(setup, parts=("diabetes",))


@pytest.mark.skipif(
    importlib.util.find_spec("lumen_dsp.beats") is None, reason="Track C's DSP-7/9 Python mirror not merged"
)
def test_real_dsp7_mirror_runs_on_synthetic_records(setup):
    approve(setup)
    results = run(setup, parts=("rhythm", "sqi"))
    assert results["rhythm"]["subjects"] == 4
    assert results["sqi"]["breakdown"]["referenceCleanWindowsNonAf"] > 0
