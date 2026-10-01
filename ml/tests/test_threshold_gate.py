import copy

import pytest

from export import provenance, specs, write_manifest
from export.provenance import ProvenanceError, check_threshold_bases
from export.specs import SPECS
from export.to_onnx import source_model
from export.write_manifest import model_card
from tests.test_manifest import NETWORKS, RHYTHM_EXTRAS, _release, _run
from tests.training_artifacts import fit_baseline, save_trained

SQI, RULE, RHYTHM = SPECS["sqi-finger"], SPECS["sqi-rule"], SPECS["rhythm-lgbm"]


def interval(estimate, low, high):
    return {"estimate": estimate, "low": low, "high": high}


# Shaped like train.sqi's output; the values only need to be recognizable in the card.
SQI_EXTRAS = {
    "thresholdBasis": "synthetic-bad-only",
    "shipDecision": {
        "criterion": "window-level AUROC for clean vs bad on dev-val subjects",
        "bestBaseline": "sqi-rule",
        "networkMinusBestBaselineAuroc": interval(0.297, 0.24, 0.338),
        "ships": "sqi-finger",
    },
    "development": {
        "subjects": 9,
        "metrics": {
            "windowAuroc": interval(0.839, 0.775, 0.891),
            "cleanPrecision": interval(0.9507, 0.9328, 0.975),
            "cleanPrecisionWithPoorQualityRecords": interval(0.6635, 0.4464, 0.8156),
            "poorQualityAccepted": interval(0.276, 0.204, 0.359),
        },
        "undefinedMetrics": [],
    },
    "thresholdEvidence": {
        "bestPrecisionAllBad": {
            "precision": 0.8871,
            "cleanRecall": 0.1359,
            "tau": 0.97,
            "minCleanRecall": 0.1,
        },
        "anyTauReachesTargetAllBad": False,
        "highestScoringPoorQuality": {
            "windows": 20,
            "records": ["149073", "149074"],
            "medianHrErrorBpm": 17.2,
        },
        "designIterations": ["the reference check", "learning rate 3e-4"],
    },
    "labelCheck": {
        "dev-train": {
            "records": 1370,
            "removedRecords": 445,
            "subjectsAffected": 7,
            "subjectsFullyRemoved": 0,
        },
        "dev-val": {"records": 556, "removedRecords": 111, "subjectsAffected": 2, "subjectsFullyRemoved": 0},
    },
}


def metrics_for(basis, **extra):
    return {"thresholdBasis": basis, **extra}


def test_shipped_model_with_a_proposed_basis_is_refused():
    with pytest.raises(ProvenanceError) as refused:
        check_threshold_bases([SQI], {SQI.name: metrics_for("synthetic-bad-only")})
    assert "H-024" in str(refused.value) and "ADR 0038" in str(refused.value)


@pytest.mark.parametrize(
    ("spec", "metrics"),
    [
        (SQI, metrics_for("all-bad")),
        # Not shipped: an ablation model never reaches the app, whatever its basis.
        (RULE, metrics_for("synthetic-bad-only")),
        # Models whose training records no basis (rhythm) are not SQI thresholds.
        (RHYTHM, {}),
        (SQI, None),
    ],
)
def test_gate_passes_what_needs_no_owner_decision(spec, metrics):
    check_threshold_bases([spec], {spec.name: metrics})


def test_owner_approval_in_the_specs_unlocks_only_that_basis(monkeypatch):
    approval = {"sqi-finger": {"basis": "synthetic-bad-only", "decision": "H-024 option A"}}
    monkeypatch.setattr(provenance, "OWNER_APPROVED_THRESHOLD_BASES", approval)
    check_threshold_bases([SQI], {SQI.name: metrics_for("synthetic-bad-only")})
    with pytest.raises(ProvenanceError):
        check_threshold_bases([SQI], {SQI.name: metrics_for("some-other-basis")})


def test_an_approval_claimed_only_in_the_metrics_file_is_refused():
    claimed = metrics_for("synthetic-bad-only", ownerApproval="H-024 option A")
    with pytest.raises(ProvenanceError, match="H-024"):
        check_threshold_bases([SQI], {SQI.name: claimed})


def test_the_specs_hold_no_approval_until_the_owner_decides():
    assert specs.OWNER_APPROVED_THRESHOLD_BASES == {}


def test_write_manifest_refuses_the_proposed_basis_and_writes_nothing(tmp_path):
    models_dir, runs_dir = tmp_path / "models", tmp_path / "runs"
    for seed, name in enumerate(NETWORKS):
        extras = {"rhythm-net": RHYTHM_EXTRAS, "sqi-finger": SQI_EXTRAS}.get(name, {})
        save_trained(SPECS[name], runs_dir, source_model(SPECS[name], None, seed), extras)
    save_trained(RHYTHM, runs_dir, fit_baseline(RHYTHM), RHYTHM_EXTRAS)
    _release(models_dir, runs_dir)
    with pytest.raises(ProvenanceError, match="H-024"):
        _run(write_manifest, "--models-dir", models_dir, "--runs-dir", runs_dir)
    assert not (models_dir / "manifest.json").exists()
    assert not list(models_dir.glob("*.md"))


def test_card_shows_the_proposed_threshold_and_its_evidence():
    metrics = {"trainedOn": ["butppg"], "threshold": {"clean": 0.5958}, **copy.deepcopy(SQI_EXTRAS)}
    card = model_card(SQI, metrics)
    assert "PROPOSED, awaiting owner (H-024)" in card
    assert "0.951" in card and "0.663" in card
    assert "0.887" in card and "0.276" in card
    assert "Hypothesis, not verified" in card
    assert "same 9 dev-val subjects" in card
    assert "445 of 1370" in card and "111 of 556" in card


def test_card_names_the_owner_decision_once_approved(monkeypatch):
    approval = {"sqi-finger": {"basis": "synthetic-bad-only", "decision": "H-024 option A"}}
    monkeypatch.setattr(provenance, "OWNER_APPROVED_THRESHOLD_BASES", approval)
    metrics = {"trainedOn": ["butppg"], "threshold": {"clean": 0.5958}, **copy.deepcopy(SQI_EXTRAS)}
    card = model_card(SQI, metrics)
    assert "PROPOSED" not in card and "H-024 option A" in card
