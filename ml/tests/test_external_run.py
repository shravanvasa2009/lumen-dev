import importlib.util
import json
import sys

import pytest

from datasets.vitaldb_cases import holdout_case_path, load_split
from eval import external
from eval.external_gate import ExternalTestRefusedError
from eval.external_mimic import DspNotMergedError
from tests.external_fixtures import (
    THRESHOLDS,
    UNSCORED,
    holdout_scores,
    install_fake_beats,
    install_fake_scorer,
    write_holdout_files,
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
    write_models(tmp_path / "models")
    dataset_dir = data_dir / "external" / "mimic-perform-af"
    write_mimic(dataset_dir)
    write_holdout_files()
    return {
        "models_dir": tmp_path / "models",
        "results_path": tmp_path / "models" / "external-test.json",
        "approval_path": tmp_path / "external-approval.json",
        "dataset_dir": dataset_dir,
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
        commit="0" * 40,
        now=lambda: "2026-10-20T10:00:00+00:00",
    )


def edit_manifest(setup, name, change):
    path = setup["models_dir"] / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    change(next(entry for entry in manifest["models"] if entry["name"] == name))
    path.write_text(json.dumps(manifest), encoding="utf-8")


def assert_m3_fields(results):
    # What scripts/proof/m3.mjs reads, with ML-4 judged on |gap| and sqi.passed (D.E_TASK-m3-signed-ml4-gap).
    for field in ("sensitivity", "specificity", "auroc", "ci95", "ppvNpv"):
        assert results["rhythm"][field] is not None, field
    assert abs(results["sqi"]["rhythmBiasGapPts"]) <= 5
    assert results["sqi"]["passed"] is True
    for field in ("auroc", "sensitivity", "specificity", "ci95", "ppvNpv", "floorMet"):
        assert results["diabetes"][field] is not None, field


def test_refuses_without_approval_and_reads_nothing(setup, monkeypatch):
    install_fake_beats(monkeypatch)
    calls = install_fake_scorer(monkeypatch)
    with pytest.raises(ExternalTestRefusedError, match="owner approves"):
        run(setup)
    assert not setup["results_path"].exists()
    assert not (setup["dataset_dir"] / "records").exists()
    assert calls == []


def test_missing_dsp7_mirror_stops_before_the_ledger_records_a_start(setup, monkeypatch):
    approve(setup)
    install_fake_scorer(monkeypatch)
    monkeypatch.setitem(sys.modules, "lumen_dsp.beats", None)
    with pytest.raises(DspNotMergedError):
        run(setup)
    assert not setup["results_path"].exists()


def test_missing_holdout_scorer_stops_before_the_ledger_records_a_start(setup, monkeypatch):
    approve(setup)
    monkeypatch.setitem(sys.modules, "train.diabetes_holdout", None)
    with pytest.raises(ExternalTestRefusedError, match="holdout scorer"):
        run(setup, parts=("diabetes",))
    assert not setup["results_path"].exists()


def test_a_scorer_with_the_wrong_signature_is_refused_before_the_start(setup, monkeypatch):
    approve(setup)
    module = type(sys)("train.diabetes_holdout")
    module.score_holdout = lambda entry, holdout: {}
    monkeypatch.setitem(sys.modules, "train.diabetes_holdout", module)
    with pytest.raises(ExternalTestRefusedError, match="must take"):
        run(setup, parts=("diabetes",))
    assert not setup["results_path"].exists()


def test_a_scorer_without_its_release_check_is_refused_before_the_start(setup, monkeypatch):
    approve(setup)
    module = type(sys)("train.diabetes_holdout")
    module.score_holdout = lambda entry, models_dir, holdout: {}
    monkeypatch.setitem(sys.modules, "train.diabetes_holdout", module)
    with pytest.raises(ExternalTestRefusedError, match="check_release"):
        run(setup, parts=("diabetes",))
    assert not setup["results_path"].exists()


def test_a_release_the_scorer_refuses_stops_before_the_ledger_records_a_start(setup, monkeypatch):
    approve(setup)
    calls = install_fake_scorer(monkeypatch, release_problem="diabetes-net@1.0.0 has no fillMedians")
    with pytest.raises(ExternalTestRefusedError, match="no fillMedians"):
        run(setup, parts=("diabetes",))
    assert not setup["results_path"].exists()
    assert calls == []


def test_missing_holdout_case_files_are_refused_before_the_start(setup, monkeypatch):
    approve(setup)
    calls = install_fake_scorer(monkeypatch)
    holdout_case_path(1).unlink()
    with pytest.raises(ExternalTestRefusedError, match="1 of .* holdout .vital files are missing"):
        run(setup, parts=("diabetes",))
    assert not setup["results_path"].exists()
    assert calls == []


def test_scores_from_another_onnx_file_are_rejected(setup, monkeypatch):
    install_fake_scorer(monkeypatch, edit=lambda scored: {**scored, "onnxSha256": "f" * 64})
    approve(setup)
    with pytest.raises(ValueError, match="not the manifest's"):
        run(setup, parts=("diabetes",))


def test_wrong_external_dataset_is_refused_before_the_start(setup, monkeypatch):
    approve(setup)
    calls = install_fake_scorer(monkeypatch)
    edit_manifest(setup, "diabetes-net", lambda entry: entry.pop("externalTest"))
    with pytest.raises(ExternalTestRefusedError, match="external dataset"):
        run(setup, parts=("diabetes",))
    assert not setup["results_path"].exists()
    assert calls == []


def test_refuses_a_model_without_a_frozen_threshold(setup, monkeypatch):
    install_fake_beats(monkeypatch)
    approve(setup)
    edit_manifest(setup, "rhythm-lgbm", lambda entry: entry.update(threshold={"af": None}))
    with pytest.raises(ExternalTestRefusedError, match="no frozen af threshold"):
        run(setup)
    assert not setup["results_path"].exists()


def test_full_run_writes_what_m3_reads_then_refuses_a_second_run(setup, monkeypatch):
    install_fake_beats(monkeypatch)
    calls = install_fake_scorer(monkeypatch)
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
    # ADR 0031: Rhythm-Net is reported as the ablation and is never eligible for the ML-1 fallback.
    assert rhythm["models"]["rhythm-net"]["role"] == "ablation"
    assert rhythm["eligibleForFloor"] == ["rhythm-lgbm"]
    assert [row["prevalence"] for row in rhythm["ppvNpv"]] == [0.01, 0.05, 0.10]
    app = rhythm["models"]["rhythm-lgbm"]["appReadings"]
    # 240 s recordings: three 90 s readings per subject, each with a rhythm card.
    assert (app["readings"], app["readingsWithRhythmCard"]) == (12, 12)
    assert app["abstainRate"]["estimate"] == 0.0
    assert set(app["possibleAfSubjects"]) == {"subjects", "sensitivity", "specificity"}
    assert app["possibleAfSubjects"]["sensitivity"]["estimate"] == 1.0
    assert app["possibleAfSubjects"]["specificity"]["estimate"] == 1.0
    sqi = results["sqi"]
    assert sqi["status"] == "measured"
    assert sqi["breakdown"]["referenceCleanWindowsAf"] >= 200
    assert all(lag == pytest.approx(0.25, abs=0.02) for lag in sqi["lagSecondsBySubject"].values())
    diabetes = results["diabetes"]
    holdout = load_split()["holdout"]
    assert (diabetes["subjects"], diabetes["holdoutUnscored"]) == (len(holdout) - UNSCORED, 3)
    assert diabetes["holdoutUnscoredReasons"] == {
        "noPlethTrack": 2,
        "noStableWindow": 1,
        "noScorableSegment": 0,
    }
    assert [row["prevalence"] for row in diabetes["ppvNpv"]] == [0.05, 0.116, 0.20]
    assert calls == [("diabetes-net", len(holdout))]

    approve(setup, request="H-032")
    with pytest.raises(ExternalTestRefusedError, match="already externally tested"):
        run(setup)
    assert json.loads(setup["results_path"].read_text(encoding="utf-8")) == results
    assert len(calls) == 1


def test_parts_run_separately_and_each_version_only_once(setup, monkeypatch):
    install_fake_beats(monkeypatch)
    install_fake_scorer(monkeypatch)
    approve(setup)
    run(setup, parts=("diabetes",))
    results = run(setup, parts=("rhythm",))
    assert {entry["model"] for entry in results["runs"]} == {"diabetes-net@1.0.0", *ALL_MODELS[:2]}
    assert "diabetes" in results and "rhythm" in results and "sqi" not in results
    with pytest.raises(ExternalTestRefusedError, match="diabetes-net@1.0.0 was already"):
        run(setup, parts=("diabetes",))


def test_holdout_is_scored_only_after_the_ledger_records_the_start(setup, monkeypatch):
    approve(setup)
    seen = []

    def check_ledger(scored):
        (entry,) = json.loads(setup["results_path"].read_text(encoding="utf-8"))["runs"]
        seen.append(entry["status"])
        return scored

    install_fake_scorer(monkeypatch, edit=check_ledger)
    run(setup, parts=("diabetes",))
    assert seen == ["started"]


def test_an_incomplete_holdout_is_rejected_and_the_retry_needs_a_new_approval(setup, monkeypatch):
    def drop_one(scored):
        return {**scored, "subjects": scored["subjects"][1:]}

    install_fake_scorer(monkeypatch, edit=drop_one)
    approve(setup)
    with pytest.raises(ValueError, match="holdout patients"):
        run(setup, parts=("diabetes",))
    with pytest.raises(ExternalTestRefusedError, match="new owner approval"):
        run(setup, parts=("diabetes",))


def test_scores_must_come_from_the_locked_holdout(setup, monkeypatch):
    def swap_in_outsider(scored):
        scored["subjects"][0]["subject"] = -1
        return scored

    install_fake_scorer(monkeypatch, edit=swap_in_outsider)
    approve(setup)
    with pytest.raises(ValueError, match="locked holdout"):
        run(setup, parts=("diabetes",))


@pytest.mark.parametrize(
    ("reasons", "problem"),
    [
        (None, "must count each of"),
        ({"noPlethTrack": 2, "noStableWindow": 1}, "must count each of"),
        (
            {"noPlethTrack": 2, "noStableWindow": 1, "noScorableSegment": 0, "crashed": 0},
            "must count each of",
        ),
        ({"noPlethTrack": 4, "noStableWindow": -1, "noScorableSegment": 0}, "must count each of"),
        ({"noPlethTrack": 2.0, "noStableWindow": 1, "noScorableSegment": 0}, "must count each of"),
        ({"noPlethTrack": True, "noStableWindow": 2, "noScorableSegment": 0}, "must count each of"),
        ({"noPlethTrack": 1, "noStableWindow": 1, "noScorableSegment": 0}, "sum to 2, not holdoutUnscored 3"),
    ],
)
def test_unscored_reasons_must_be_adr_0069s_and_add_up(reasons, problem):
    holdout = list(range(1, 11))
    scored = {**holdout_scores(holdout), "onnxSha256": "a" * 64, "holdoutUnscoredReasons": reasons}
    with pytest.raises(ValueError, match=problem):
        external.holdout_units(scored, holdout, "a" * 64)
    valid = {**scored, "holdoutUnscoredReasons": holdout_scores(holdout)["holdoutUnscoredReasons"]}
    assert len(external.holdout_units(valid, holdout, "a" * 64).scores) == len(holdout) - UNSCORED


@pytest.mark.skipif(
    importlib.util.find_spec("lumen_dsp.beats") is None, reason="Track C's DSP-7/9 Python mirror not merged"
)
def test_real_dsp7_mirror_runs_on_synthetic_records(setup):
    approve(setup)
    results = run(setup, parts=("rhythm", "sqi"))
    assert results["rhythm"]["subjects"] == 4
    assert results["sqi"]["breakdown"]["referenceCleanWindowsNonAf"] > 0
