import json

import pytest

from eval.external_gate import (
    Approval,
    ExternalTestRefusedError,
    check_gate,
    finish_runs,
    read_approval,
    read_results,
    start_runs,
    write_results,
)

MODEL = "rhythm-lgbm@1.0.0"


def write_approval(path, request="H-031", models=(MODEL,)):
    path.write_text(json.dumps({"request": request, "models": list(models)}), encoding="utf-8")
    return path


def test_refuses_without_an_approval_file(tmp_path):
    with pytest.raises(ExternalTestRefusedError, match="owner approves"):
        read_approval(tmp_path / "external-approval.json")


@pytest.mark.parametrize(
    "contents",
    [{"request": "yes", "models": [MODEL]}, {"request": "H-031", "models": []}, {"request": "H-031"}],
)
def test_refuses_a_malformed_approval(tmp_path, contents):
    path = tmp_path / "external-approval.json"
    path.write_text(json.dumps(contents), encoding="utf-8")
    with pytest.raises(ExternalTestRefusedError):
        read_approval(path)


def test_reads_an_owner_approval(tmp_path):
    approval = read_approval(write_approval(tmp_path / "a.json"))
    assert approval == Approval("H-031", frozenset({MODEL}))


def test_refuses_a_model_version_the_owner_did_not_approve():
    approval = Approval("H-031", frozenset({"rhythm-lgbm@1.0.0"}))
    with pytest.raises(ExternalTestRefusedError, match="not in the owner's approval"):
        check_gate(["rhythm-lgbm@1.1.0"], approval, {"runs": []})


def test_refuses_a_second_run_of_the_same_version():
    approval = Approval("H-040", frozenset({MODEL}))
    results = {"runs": [{"model": MODEL, "status": "done", "approval": "H-031"}]}
    with pytest.raises(ExternalTestRefusedError, match="already externally tested"):
        check_gate([MODEL], approval, results)


def test_a_crashed_run_needs_a_new_approval_to_retry():
    results = {"runs": [{"model": MODEL, "status": "started", "approval": "H-031"}]}
    with pytest.raises(ExternalTestRefusedError, match="new owner approval"):
        check_gate([MODEL], Approval("H-031", frozenset({MODEL})), results)
    check_gate([MODEL], Approval("H-035", frozenset({MODEL})), results)


def test_a_new_version_is_allowed_once_approved():
    results = {"runs": [{"model": MODEL, "status": "done", "approval": "H-031"}]}
    check_gate(["rhythm-lgbm@1.1.0"], Approval("H-040", frozenset({"rhythm-lgbm@1.1.0"})), results)


def test_ledger_records_start_then_done(tmp_path):
    path = tmp_path / "external-test.json"
    results = read_results(path)
    runs = [{"model": MODEL, "family": "rhythm", "approval": "H-031", "commit": "abc"}]
    start_runs(results, runs, "2026-10-20T10:00:00+00:00")
    write_results(path, results)
    assert read_results(path)["runs"][0]["status"] == "started"
    finish_runs(runs, "2026-10-20T10:05:00+00:00")
    write_results(path, results)
    (recorded,) = read_results(path)["runs"]
    assert recorded["status"] == "done"
    assert recorded["finishedAt"] == "2026-10-20T10:05:00+00:00"
    assert not (tmp_path / "external-test.json.partial").exists()
