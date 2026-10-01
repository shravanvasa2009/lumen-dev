import copy
import json
from dataclasses import replace

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
OPTION_B = {"basis": "synthetic-bad-only", "decision": "H-024 option B", "role": "guard"}


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
            "ml2HrWithin5BpmOfAccepted": interval(0.668, 0.4168, 0.811),
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


def card_metrics():
    return {"trainedOn": ["butppg"], "threshold": {"clean": 0.5958}, **copy.deepcopy(SQI_EXTRAS)}


def section(card, heading):
    return card.split(f"## {heading}", 1)[1].split("\n## ", 1)[0]


@pytest.fixture
def no_owner_decision(monkeypatch):
    # The state before H-024 was answered, so the refusal path stays tested.
    monkeypatch.setattr(provenance, "OWNER_APPROVED_THRESHOLD_BASES", {})


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


def test_the_specs_hold_exactly_the_option_b_approval():
    assert specs.OWNER_APPROVED_THRESHOLD_BASES == {"sqi-finger": OPTION_B}
    assert (SQI.role, RULE.role) == ("guard", "guard")
    assert {spec.role for spec in SPECS.values() if spec.family != "sqi"} == {"gate"}


def test_shipped_model_with_an_unapproved_basis_is_refused():
    with pytest.raises(ProvenanceError, match="has not approved") as refused:
        check_threshold_bases([SQI], {SQI.name: metrics_for("some-other-basis")})
    assert "H-024" in str(refused.value) and "ADR 0038" in str(refused.value)


def test_the_basis_is_refused_without_the_owner_decision(no_owner_decision):
    with pytest.raises(ProvenanceError, match="has not approved"):
        check_threshold_bases([SQI], {SQI.name: metrics_for("synthetic-bad-only")})


def test_shipped_sqi_model_whose_metrics_record_no_basis_is_refused():
    # Fails closed: a metrics file from before train.sqi recorded its basis, or one edited by hand, does
    # not ship.
    with pytest.raises(ProvenanceError, match="no threshold basis"):
        check_threshold_bases([SQI], {SQI.name: {"threshold": {"clean": 0.6}}})


@pytest.mark.parametrize(
    ("spec", "metrics"),
    [
        (SQI, metrics_for("all-bad")),
        # H-024 option B: the basis is approved for SQI-Net as a guard.
        (SQI, metrics_for("synthetic-bad-only")),
        (SQI, metrics_for("synthetic-bad-only", ownerApproval="H-024 option B")),
        # Not shipped: an ablation model never reaches the app, whatever its basis.
        (RULE, metrics_for("synthetic-bad-only")),
        (RULE, {}),
        # Rhythm thresholds are outside ADR 0038 and record no basis.
        (RHYTHM, copy.deepcopy(RHYTHM_EXTRAS)),
        # No metrics: an untrained pipeline check, which write_manifest allows only outside models/.
        (SQI, None),
    ],
)
def test_gate_passes_what_the_owner_decided_or_needs_no_decision(spec, metrics):
    check_threshold_bases([spec], {spec.name: metrics})


def test_owner_approval_in_the_specs_unlocks_only_that_basis(monkeypatch):
    monkeypatch.setattr(provenance, "OWNER_APPROVED_THRESHOLD_BASES", {"sqi-finger": OPTION_B})
    check_threshold_bases([SQI], {SQI.name: metrics_for("synthetic-bad-only")})
    with pytest.raises(ProvenanceError, match="has not approved"):
        check_threshold_bases([SQI], {SQI.name: metrics_for("some-other-basis")})


def test_option_b_cannot_make_sqi_net_the_gate():
    gate = replace(SQI, role="gate")
    with pytest.raises(
        ProvenanceError, match="approved that basis only for role 'guard' \\(H-024 option B\\)"
    ):
        check_threshold_bases([gate], {gate.name: metrics_for("synthetic-bad-only")})


@pytest.mark.parametrize(
    "approval", [{**OPTION_B, "role": "gate"}, {"basis": "synthetic-bad-only", "decision": "H-024"}]
)
def test_an_approval_for_another_role_or_no_role_is_refused(monkeypatch, approval):
    monkeypatch.setattr(provenance, "OWNER_APPROVED_THRESHOLD_BASES", {"sqi-finger": approval})
    with pytest.raises(ProvenanceError, match="ships as a guard"):
        check_threshold_bases([SQI], {SQI.name: metrics_for("synthetic-bad-only")})


def test_an_approval_claimed_only_in_the_metrics_file_is_refused(no_owner_decision):
    claimed = metrics_for("synthetic-bad-only", ownerApproval="H-024 option B")
    with pytest.raises(ProvenanceError, match="H-024"):
        check_threshold_bases([SQI], {SQI.name: claimed})


def test_a_claim_that_differs_from_the_specs_is_refused():
    claimed = metrics_for("synthetic-bad-only", ownerApproval="H-024 option A")
    with pytest.raises(ProvenanceError, match="records 'H-024 option B'"):
        check_threshold_bases([SQI], {SQI.name: claimed})


def _release_with_option_b_basis(tmp_path):
    models_dir, runs_dir = tmp_path / "models", tmp_path / "runs"
    for seed, name in enumerate(NETWORKS):
        extras = {"rhythm-net": RHYTHM_EXTRAS, "sqi-finger": SQI_EXTRAS}.get(name, {})
        save_trained(SPECS[name], runs_dir, source_model(SPECS[name], None, seed), extras)
    save_trained(RHYTHM, runs_dir, fit_baseline(RHYTHM), RHYTHM_EXTRAS)
    _release(models_dir, runs_dir)
    return models_dir, runs_dir


def test_write_manifest_refuses_the_basis_without_a_decision_and_writes_nothing(tmp_path, no_owner_decision):
    models_dir, runs_dir = _release_with_option_b_basis(tmp_path)
    with pytest.raises(ProvenanceError, match="H-024"):
        _run(write_manifest, "--models-dir", models_dir, "--runs-dir", runs_dir)
    assert not (models_dir / "manifest.json").exists()
    assert not list(models_dir.glob("*.md"))


def test_write_manifest_ships_sqi_net_as_a_guard(tmp_path):
    models_dir, runs_dir = _release_with_option_b_basis(tmp_path)
    _run(write_manifest, "--models-dir", models_dir, "--runs-dir", runs_dir)
    manifest = json.loads((models_dir / "manifest.json").read_text(encoding="utf-8"))
    entry = next(entry for entry in manifest["models"] if entry["name"] == SQI.name)
    assert (entry["role"], entry["ships"]) == ("guard", True)
    card = (models_dir / entry["card"]).read_text(encoding="utf-8")
    assert card.startswith("# sqi-finger 1.0.0 (shipped sqi model, Experimental reject-only guard)")


def test_card_shows_the_proposed_threshold_and_its_evidence(no_owner_decision):
    card = model_card(SQI, card_metrics())
    assert PROPOSED in card
    assert "0.951" in card and "0.663" in card
    assert "0.887" in card and "0.276" in card
    assert "has not been checked" in card and "20 of them are accepted" in card
    assert "same 9 dev-val subjects" in card
    assert "445 of 1370" in card and "111 of 556" in card and "2 of 9 subjects" in card


def test_card_lists_undefined_metrics():
    metrics = card_metrics()
    metrics["development"]["undefinedMetrics"] = ["gapSinusMinusPrematurePts"]
    card = model_card(SQI, metrics)
    assert "Undefined on dev-val (no estimate): gapSinusMinusPrematurePts." in card


def test_card_names_option_b_as_an_experimental_guard_and_states_ml2_unmet():
    card = model_card(SQI, card_metrics())
    assert "PROPOSED" not in card
    intended_use = section(card, "Intended use")
    assert intended_use.startswith("\n\nExperimental.") and "reject-only guard" in intended_use
    assert "DSP-4" in intended_use and "DSP-9" in intended_use and "M2 team captures" in intended_use
    status = section(card, "Threshold").split("\n\n")[1]
    assert "approved by the owner (H-024 option B) only for an Experimental, reject-only guard" in status
    assert "every bad window counted (quality-0 records included) is 0.663 (95% CI 0.446-0.816)" in status
    assert "the best any τ reaches with every bad window counted is 0.887" in status
    assert "ML-2 proxy" in status and "0.668 (95% CI 0.417-0.811), below the 95% floor" in status
    assert "ML-2 is not met" in status


def test_card_does_not_call_ml2_unmet_when_the_proxy_reaches_the_floor():
    metrics = card_metrics()
    metrics["development"]["metrics"]["ml2HrWithin5BpmOfAccepted"] = interval(0.96, 0.95, 0.97)
    status = section(model_card(SQI, metrics), "Threshold")
    assert "at or above the 95% floor" in status and "optimistic" in status and "not met" not in status


def test_training_output_passes_the_gate_as_a_guard_and_its_card_shows_option_b(tmp_path):
    metrics = produced_metrics(tmp_path)
    assert metrics["thresholdBasis"] == sqi.THRESHOLD_BASIS
    check_threshold_bases([SQI], {SQI.name: metrics})
    card = model_card(SQI, metrics)
    measured = metrics["development"]["metrics"]
    assert "PROPOSED" not in card and "H-024 option B" in card
    assert "Experimental" in card and "guard" in card
    assert f"{measured['poorQualityAccepted']['estimate']:.3f}" in card
    assert "highest-scoring quality-0 windows" in card
    # The ship note reads the same shipDecision keys as train.rhythm's (#53).
    assert f"network minus {sqi.RULE.name}:" in card
    (threshold_note,) = [note for note in metrics["notes"] if note.startswith("Threshold basis")]
    assert "H-024 option B" in threshold_note and "reject-only guard" in threshold_note
    assert "is a hypothesis, not checked" in threshold_note


def test_training_output_is_refused_without_the_owner_decision(tmp_path, no_owner_decision):
    metrics = produced_metrics(tmp_path)
    with pytest.raises(ProvenanceError, match="has not approved"):
        check_threshold_bases([SQI], {SQI.name: metrics})
    assert PROPOSED in model_card(SQI, metrics)


@pytest.mark.skipif(
    not (RUNS_DIR / f"{SQI.file_stem}.json").exists(),
    reason="ml/runs holds no sqi-finger training run (runs are not in git)",
)
def test_the_real_training_run_passes_the_gate_as_a_guard():
    metrics = load_metrics(SQI, RUNS_DIR)
    check_threshold_bases([SQI], {SQI.name: metrics})
    card = model_card(SQI, metrics)
    measured = metrics["development"]["metrics"]
    threshold = section(card, "Threshold")
    # The status comes from export/specs.py. This run was trained before H-024 was answered, so its own
    # training note may still call the basis proposed; that note stays as written, under Training notes.
    assert "PROPOSED" not in threshold and "H-024 option B" in threshold
    assert "PROPOSED" not in card.replace(section(card, "Data"), "")
    assert "Experimental" in section(card, "Intended use")
    assert (
        f"{measured['ml2HrWithin5BpmOfAccepted']['estimate']:.3f}" in threshold
        and "ML-2 is not met" in threshold
    )
    assert f"{metrics['thresholdEvidence']['bestPrecisionAllBad']['precision']:.3f}" in threshold
    assert "Label check, dev-val" in threshold
    assert "The development ablation picked it" in card
    model_card(RULE, load_metrics(RULE, RUNS_DIR))
