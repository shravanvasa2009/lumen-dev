import json
import re
from collections.abc import Iterable
from pathlib import Path
from typing import NamedTuple

from export.specs import ML_ROOT, MODELS_DIR

# ADR 0045: the owner writes this file (gitignored) to approve one external run of named model versions.
APPROVAL_FILE = ML_ROOT / "external-approval.json"
RESULTS_FILE = MODELS_DIR / "external-test.json"
REQUEST_ID = re.compile(r"H-\d{3,}")
RESULTS_FORMAT = 1


class ExternalTestRefusedError(Exception):
    pass


class Approval(NamedTuple):
    request: str
    models: frozenset[str]


def read_approval(path: Path) -> Approval:
    if not path.is_file():
        raise ExternalTestRefusedError(
            f"{path} not found. The external test runs only after the owner approves it through need-human "
            "and writes this file (ADR 0045)."
        )
    approval = json.loads(path.read_text(encoding="utf-8"))
    request, models = approval.get("request"), approval.get("models")
    if not (isinstance(request, str) and REQUEST_ID.fullmatch(request)):
        raise ExternalTestRefusedError(f"{path}: request must be a HUMAN_STEPS id such as H-031")
    if not (isinstance(models, list) and models and all(isinstance(model, str) for model in models)):
        raise ExternalTestRefusedError(f"{path}: models must list name@version strings")
    return Approval(request, frozenset(models))


def read_results(path: Path) -> dict:
    if not path.exists():
        return {"format": RESULTS_FORMAT, "runs": []}
    return json.loads(path.read_text(encoding="utf-8"))


def write_results(path: Path, results: dict) -> None:
    # Written whole and renamed into place, so a crash never leaves a half-written ledger.
    partial = path.with_name(path.name + ".partial")
    partial.write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    partial.replace(path)


def check_gate(models: Iterable[str], approval: Approval, results: dict) -> None:
    # §11.5: each model version meets the external set once. A run that started and crashed has already
    # read the data, so retrying it needs a new owner approval (a different request id).
    problems = []
    for model in models:
        if model not in approval.models:
            problems.append(f"{model} is not in the owner's approval {approval.request}")
        for run in results.get("runs", []):
            if run["model"] != model:
                continue
            if run["status"] == "done":
                problems.append(f"{model} was already externally tested under {run['approval']}")
            elif run["approval"] == approval.request:
                problems.append(
                    f"{model} already started under {approval.request} and did not finish; a retry needs "
                    "a new owner approval"
                )
    if problems:
        raise ExternalTestRefusedError("; ".join(sorted(set(problems))))


def start_runs(results: dict, runs: list[dict], timestamp: str) -> None:
    # Recorded before any external file is read, so a crash still counts as the one look.
    for run in runs:
        run.update(status="started", startedAt=timestamp, finishedAt=None)
        results["runs"].append(run)


def finish_runs(runs: list[dict], timestamp: str) -> None:
    for run in runs:
        run.update(status="done", finishedAt=timestamp)
