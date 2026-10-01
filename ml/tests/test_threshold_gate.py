import copy

import numpy as np
import pytest

from export import provenance, specs, write_manifest
from export.provenance import ProvenanceError, check_threshold_bases, load_metrics
from export.specs import RUNS_DIR, SPECS
from export.to_onnx import source_model
from export.write_manifest import model_card
from tests.test_manifest import NETWORKS, RHYTHM_EXTRAS, _release, _run
from tests.test_train_sqi import evaluation_sets
from tests.training_artifacts import fit_baseline, save_trained
from train import sqi

SQI, RULE, RHYTHM = SPECS["sqi-finger"], SPECS["sqi-rule"], SPECS["rhythm-lgbm"]
PROPOSED = "PROPOSED, awaiting owner (H-024)"


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
            "acceptedAtTau": 20,
        },
        "designIterations": ["the reference check", "learning rate 3e-4"],
    },
    "labelCheck": {
        "dev-train": {
            "records": 1370,
            "removedRecords": 445,
            "subjects": 21,
            "subjectsAffected": 7,
            "subjectsFullyRemoved": 0,
        },
        "dev-val": {
            "records": 556,
            "removedRecords": 111,
            "subjects": 9,
            "subjectsAffected": 2,
            "subjectsFullyRemoved": 0,
        },
    },
}


def metrics_for(basis, **extra):
    return {"thresholdBasis": basis, **extra}


def produced_metrics(tmp_path):
    # Runs train.sqi's own evaluation, ship decision, notes, and metrics-file code on synthetic windows, so
    # the gate and the card are tested on the shape training writes, not only on a hand-built dict.
    rng = np.random.default_rng(3)
    dev_val, retimed, network_scores = evaluation_sets(rng)
    rule_scores = np.clip(network_scores + rng.normal(0, 0.3, size=len(network_scores)), 0, 1)
    retimed_scores = rng.uniform(size=len(retimed.labels))
    errors = np.where(dev_val.kinds == "poor-quality", 12.0, 1.0)
    sets = sqi.WindowSets(train=dev_val, dev_val=dev_val, retimed=retimed)
    scores = {SQI.name: network_scores, RULE.name: rule_scores}
    evaluations = {
        name: sqi.evaluate(model_scores, dev_val, retimed_scores, retimed, errors)
        for name, model_scores in scores.items()
    }
    decision = sqi.ship_decision(scores, dev_val, evaluations)
    shared = {"shipDecision": decision, "notes": sqi.training_notes(sets, decision, evaluations)}
    source = tmp_path / SQI.source_file
    source.write_bytes(b"weights")
    evaluation = evaluations[SQI.name]
    return sqi._metrics_file(source, evaluation, sets, shared, evaluation["tau"])


def test_shipped_model_with_a_proposed_basis_is_refused():
    with pytest.raises(ProvenanceError) as refused:
        check_threshold_bases([SQI], {SQI.name: metrics_for("synthetic-bad-only")})
    assert "H-024" in str(refused.value) and "ADR 0038" in str(refused.value)


def test_shipped_sqi_model_whose_metrics_record_no_basis_is_refused():
    # Fails closed: a metrics file from before train.sqi recorded its basis, or one edited by hand, does
    # not ship.
    with pytest.raises(ProvenanceError, match="no threshold basis"):
        check_threshold_bases([SQI], {SQI.name: {"threshold": {"clean": 0.6}}})


@pytest.mark.parametrize(
    ("spec", "metrics"),
    [
        (SQI, metrics_for("all-bad")),
        # Not shipped: an ablation model never reaches the app, whatever its basis.
        (RULE, metrics_for("synthetic-bad-only")),
        (RULE, {}),
        # Rhythm thresholds are outside ADR 0038 and record no basis.
        (RHYTHM, copy.deepcopy(RHYTHM_EXTRAS)),
        # No metrics: an untrained pipeline check, which write_manifest allows only outside models/.
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
    assert PROPOSED in card
    assert "0.951" in card and "0.663" in card
    assert "0.887" in card and "0.276" in card
    assert "has not been checked" in card and "20 of them are accepted" in card
    assert "same 9 dev-val subjects" in card
    assert "445 of 1370" in card and "111 of 556" in card and "2 of 9 subjects" in card


def test_card_lists_undefined_metrics():
    metrics = {"trainedOn": ["butppg"], "threshold": {"clean": 0.5958}, **copy.deepcopy(SQI_EXTRAS)}
    metrics["development"]["undefinedMetrics"] = ["gapSinusMinusPrematurePts"]
    card = model_card(SQI, metrics)
    assert "Undefined on dev-val (no estimate): gapSinusMinusPrematurePts." in card


def test_card_names_the_owner_decision_once_approved(monkeypatch):
    approval = {"sqi-finger": {"basis": "synthetic-bad-only", "decision": "H-024 option A"}}
    monkeypatch.setattr(provenance, "OWNER_APPROVED_THRESHOLD_BASES", approval)
    metrics = {"trainedOn": ["butppg"], "threshold": {"clean": 0.5958}, **copy.deepcopy(SQI_EXTRAS)}
    card = model_card(SQI, metrics)
    assert "PROPOSED" not in card and "H-024 option A" in card


def test_training_output_is_refused_and_its_card_shows_the_proposal(tmp_path):
    metrics = produced_metrics(tmp_path)
    assert metrics["thresholdBasis"] == sqi.THRESHOLD_BASIS
    with pytest.raises(ProvenanceError, match="has not approved"):
        check_threshold_bases([SQI], {SQI.name: metrics})
    card = model_card(SQI, metrics)
    measured = metrics["development"]["metrics"]
    assert PROPOSED in card
    assert f"{measured['poorQualityAccepted']['estimate']:.3f}" in card
    assert "highest-scoring quality-0 windows" in card
    # The ship note reads the same shipDecision keys as train.rhythm's (#53).
    assert f"network minus {sqi.RULE.name}:" in card
    (threshold_note,) = [note for note in metrics["notes"] if note.startswith("Threshold basis")]
    assert "is PROPOSED" in threshold_note and "is a hypothesis, not checked" in threshold_note


@pytest.mark.skipif(
    not (RUNS_DIR / f"{SQI.file_stem}.json").exists(),
    reason="ml/runs holds no sqi-finger training run (runs are not in git)",
)
def test_the_real_training_run_is_refused_and_its_card_shows_the_proposal():
    metrics = load_metrics(SQI, RUNS_DIR)
    with pytest.raises(ProvenanceError, match="H-024"):
        check_threshold_bases([SQI], {SQI.name: metrics})
    card = model_card(SQI, metrics)
    assert PROPOSED in card
    assert "## Threshold" in card and "Label check, dev-val" in card
    assert "The development ablation picked it" in card
    model_card(RULE, load_metrics(RULE, RUNS_DIR))
