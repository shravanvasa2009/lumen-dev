import hashlib
import json
import math
import re
from pathlib import Path

from export.specs import OWNER_APPROVED_THRESHOLD_BASES, ModelSpec

# ML-3: a source model and its ONNX file may differ by at most this much on any output.
TOLERANCE = 1e-4
SEEDED_INPUTS = 500
# Below this spread across the seeded inputs the outputs are effectively constant (a saturated or
# dead model), and a tiny diff between two constants proves nothing about the export.
MIN_OUTPUT_STD = 1e-6
_SHA256 = re.compile(r"[0-9a-f]{64}")


# The basis §11.2's threshold needs no owner decision for: every bad window is counted when τ is chosen.
ALL_BAD_BASIS = "all-bad"


class ProvenanceError(Exception):
    pass


def sha256_of(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _is_number(candidate: object) -> bool:
    return isinstance(candidate, int | float) and not isinstance(candidate, bool) and math.isfinite(candidate)


def _metrics_problems(spec: ModelSpec, metrics: dict) -> list[str]:
    problems = []
    trained_on = metrics.get("trainedOn")
    if not (isinstance(trained_on, list) and trained_on and all(isinstance(key, str) for key in trained_on)):
        problems.append("trainedOn must be a non-empty list of dataset keys")
    threshold = metrics.get("threshold")
    if not isinstance(threshold, dict) or set(threshold) != set(spec.threshold_keys):
        problems.append(f"threshold keys must be {list(spec.threshold_keys)}")
    elif not all(_is_number(value) for value in threshold.values()):
        problems.append("every threshold must be a finite number")
    development = metrics.get("development")
    if not (
        isinstance(development, dict)
        and isinstance(development.get("subjects"), int)
        and development["subjects"] > 0
        and isinstance(development.get("metrics"), dict)
        and development["metrics"]
        and all(
            isinstance(value, dict) and all(_is_number(value.get(key)) for key in ("estimate", "low", "high"))
            for value in development["metrics"].values()
        )
    ):
        problems.append("development needs subjects > 0 and metrics with numeric estimate, low, and high")
    if not (isinstance(metrics.get("sourceSha256"), str) and _SHA256.fullmatch(metrics["sourceSha256"])):
        problems.append(f"sourceSha256 must be the sha256 of {spec.source_file}")
    return problems


def load_metrics(spec: ModelSpec, runs_dir: Path) -> dict | None:
    path = Path(runs_dir) / f"{spec.file_stem}.json"
    if not path.exists():
        return None
    metrics = json.loads(path.read_text(encoding="utf-8"))
    problems = _metrics_problems(spec, metrics)
    if problems:
        raise ProvenanceError(f"{path}: " + "; ".join(problems))
    return metrics


def trained_source(spec: ModelSpec, runs_dir: Path) -> Path:
    # The metrics file records the sha256 of the exact weights it describes, so a stray or stale
    # .pt or .pkl cannot be exported or listed as trained.
    path = Path(runs_dir) / spec.source_file
    if not path.exists():
        raise FileNotFoundError(f"{path} not found; train {spec.name} first")
    metrics = load_metrics(spec, runs_dir)
    if metrics is None:
        raise FileNotFoundError(f"{Path(runs_dir) / spec.file_stem}.json not found; train {spec.name} first")
    if sha256_of(path) != metrics["sourceSha256"]:
        raise ProvenanceError(f"{path} is not the file its metrics describe (sha256 differs)")
    return path


def entry_problems(name: str, entry: dict) -> list[str]:
    diff = entry.get("maxAbsDiff")
    problems = []
    if not _is_number(diff):
        problems.append(f"{name}: max abs diff is {diff}")
    elif diff > TOLERANCE:
        problems.append(f"{name}: max abs diff {diff:.3e} exceeds {TOLERANCE:g}")
    if not (isinstance(entry.get("nInputs"), int) and entry["nInputs"] >= SEEDED_INPUTS):
        problems.append(f"{name}: checked {entry.get('nInputs')} inputs; need at least {SEEDED_INPUTS}")
    if not (_is_number(entry.get("outputStd")) and entry["outputStd"] >= MIN_OUTPUT_STD):
        problems.append(
            f"{name}: outputs are constant across the seeded inputs (std {entry.get('outputStd')}), "
            "so parity is not meaningful"
        )
    return problems


def check_parity(models_dir: Path, manifest_entries: list[dict], source_shas: dict[str, str | None]) -> None:
    # m3.mjs checks parity.maxAbsDiff and the shipped entry's onnxSha256 per family; ablation models
    # are not checked there, so the manifest writer checks that parity.json covers every listed model,
    # for these exact files.
    path = Path(models_dir) / "parity.json"
    if not path.exists():
        raise ProvenanceError(f"{path} not found; run python -m export.verify_onnx --all")
    parity_models = json.loads(path.read_text(encoding="utf-8")).get("models", {})
    expected = {entry["name"] for entry in manifest_entries}
    problems = []
    if set(parity_models) != expected:
        problems.append(f"parity covers {sorted(parity_models)}; the manifest lists {sorted(expected)}")
    for entry in manifest_entries:
        checked = parity_models.get(entry["name"])
        if checked is None:
            continue
        if checked.get("onnxSha256") != entry["sha256"]:
            problems.append(f"{entry['name']}: parity was run on a different {entry['file']}")
        source_sha = source_shas.get(entry["name"])
        if source_sha is not None and checked.get("sourceSha256") != source_sha:
            problems.append(f"{entry['name']}: parity was run on a different source model")
        problems += entry_problems(entry["name"], checked)
    if problems:
        raise ProvenanceError("ML-3 parity does not cover this release: " + "; ".join(problems))


def threshold_approval(spec: ModelSpec, basis: str | None) -> str | None:
    # The owner's recorded decision for this model's threshold basis in this model's role, or None. An
    # approval given for one role never unlocks another: H-024 option B accepts SQI-Net's basis for a
    # reject-only guard, so it cannot make SQI-Net the quality gate.
    approval = OWNER_APPROVED_THRESHOLD_BASES.get(spec.name)
    if approval and approval["basis"] == basis and approval.get("role") == spec.role:
        return approval["decision"]
    return None


def _unapproved_basis(spec: ModelSpec, basis: str) -> str:
    approval = OWNER_APPROVED_THRESHOLD_BASES.get(spec.name)
    if approval and approval["basis"] == basis:
        return (
            f"{spec.name} ships as a {spec.role} with threshold basis {basis!r}, but the owner approved that "
            f"basis only for role {approval.get('role')!r} ({approval['decision']})"
        )
    return f"{spec.name} ships with threshold basis {basis!r}, which the owner has not approved"


def check_threshold_bases(specs: list[ModelSpec], metrics_by_name: dict[str, dict | None]) -> None:
    # ADR 0038 item 7 (τ set without quality-0 windows) needs the owner's decision (HUMAN_STEPS H-024). A
    # shipped model may use a basis other than "all-bad" only once that decision is recorded in
    # export/specs.py for the same basis and the model's role; a metrics file claiming approval on its own
    # proves nothing. It fails closed: train.sqi always records its basis, so a shipped SQI model without
    # one is refused. Rhythm and diabetes thresholds are outside ADR 0038 and record no basis. No metrics
    # at all means an untrained pipeline check, which write_manifest allows only outside models/ and which
    # has no threshold.
    problems = []
    for spec in specs:
        metrics = metrics_by_name.get(spec.name)
        if not spec.ships or metrics is None:
            continue
        basis = metrics.get("thresholdBasis")
        if basis is None:
            if spec.family == "sqi":
                problems.append(f"{spec.name}'s metrics record no threshold basis")
            continue
        approved = threshold_approval(spec, basis)
        if basis != ALL_BAD_BASIS and approved is None:
            problems.append(_unapproved_basis(spec, basis))
        claimed = metrics.get("ownerApproval")
        if claimed is not None and claimed != approved:
            problems.append(
                f"{spec.name}'s metrics claim owner approval {claimed!r}, "
                f"but export/specs.py records {approved!r}"
            )
    if problems:
        raise ProvenanceError(
            "; ".join(problems) + ". The owner decides this in HUMAN_STEPS H-024 (ADR 0038); record the "
            "decision, with its basis and role, in OWNER_APPROVED_THRESHOLD_BASES in export/specs.py, or "
            "retrain with an all-bad basis."
        )
