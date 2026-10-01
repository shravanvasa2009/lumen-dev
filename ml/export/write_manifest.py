import argparse
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import onnx
import onnxruntime
import torch

from export.provenance import (
    ALL_BAD_BASIS,
    ProvenanceError,
    check_parity,
    check_threshold_bases,
    load_metrics,
    sha256_of,
    threshold_approval,
    trained_source,
)
from export.specs import (
    MODELS_DIR,
    RUNS_DIR,
    ML2_TARGET,
    SHIPPED,
    ModelSpec,
    ShipRuleError,
    inside_models_dir,
    release_specs,
    shipped_per_family,
)

EXTERNAL_NOT_RUN = "Not run yet. Run once per model version, only after the owner approves (need-human)."
NOT_MEASURED = "Not measured yet: no training run is recorded for this model version."

# Fixed wording from §11.2–11.4 and §11.11. Every number in a card comes from the training metrics file.
CARD_TEXT = {
    "sqi": {
        "intended_use": (
            "Experimental. An extra, reject-only guard on each 4-second fingertip window during capture "
            "(owner decision H-024 option B): the rule-based checks, DSP-4 contact and exposure and the "
            "DSP-9 artifact rules, are the quality gate, and SQI-Net may only reject more windows; it "
            "never accepts a window the rules reject. The owner re-decides its role after the M2 team "
            "captures (hand-labeled clean and bad windows from the owner's phone), the data §11.2 asks "
            "for. Version 1 sees only the inverted red channel, z-scored per window (ADR 0023); green is "
            "added in version 2. Part of a screening prototype, not a diagnosis."
        ),
        "data": (
            "Only finger recordings are used; BUT PPG ear and front-camera recordings are excluded "
            "(ADR 0023). Clean windows: BUT PPG finger windows whose PPG heart rate matches the ECG "
            "reference; "
            "clean BUT PPG beats re-timed with real interval patterns from AF and premature-beat episodes "
            "(MIT-BIH AF, Long-Term AF, MIT-BIH Arrhythmia); team captures hand-labeled clean. Bad windows: "
            "synthetic motion, pressure, flicker, and dropout corruptions of clean windows, and team "
            "captures hand-labeled bad. MIMIC PERform AF is never used for training or tuning."
        ),
        "limitations": (
            "- If clean training windows were all regular, the model could reject AF windows as noisy. The "
            "rhythm-bias check (ML-4) on the external test measures this.\n"
            "- Trained mostly on public smartphone data; phones and skin tones outside it may behave "
            "differently."
        ),
        "abstain": (
            "A window that the rule checks or SQI-Net rejects is not used. The live check coaches the "
            "user (finger position, pressure, staying still) and capture continues. If the model fails to "
            'load, the rule-based quality checks run alone and the result card says "basic analysis."'
        ),
    },
    "rhythm": {
        "intended_use": (
            "Classifies 32-interval windows of pulse intervals from a fingertip reading as sinus, AF-like, "
            "or other. Part of a screening prototype, not a diagnosis; no emergency decision depends on "
            "this model alone."
        ),
        "data": (
            "Intervals from the MIT-BIH AF, Long-Term AF, and CinC 2017 databases (records labeled noisy "
            "excluded) and premature-beat episodes from MIT-BIH Arrhythmia (labeled other), made to look "
            "like phone intervals with per-beat timing jitter (the training notes say how its σ was set), "
            "merged and split beats, and dropped premature beats. MIMIC PERform AF is never used for "
            "training or tuning. Ectopic beats "
            "in MIT-BIH Arrhythmia and Long-Term AF sinus stretches are labeled other, but the MIT-BIH AF "
            "beat files mark every beat normal, so its sinus episodes may still contain unmarked premature "
            "beats (some ectopy-as-sinus label noise)."
        ),
        "limitations": (
            "- Frequent premature beats make intervals irregular in every reading, so they can trigger "
            "repeated false irregular results that the 2-of-3 rule does not catch.\n"
            "- Trained on ECG intervals adapted to look like phone intervals, not on phone recordings."
        ),
        "abstain": (
            "When the top probability is below the abstain threshold in the manifest (abstainBelow), the app "
            'shows "Couldn\'t tell — please retake." If the model fails to load, the classical baseline '
            'runs instead and the result card says "basic analysis."'
        ),
    },
    "diabetes": {
        "intended_use": (
            "Estimates whether the averaged fingertip pulse shape matches a pattern research has linked to "
            "diabetes. It is not a diabetes test, a glucose reading, or an A1c. Full tier (60 fps) only. "
            "Part of a screening prototype, not a diagnosis, and never part of emergency logic."
        ),
        "data": (
            "Public pulse-oximeter waveforms resampled to 256 Hz, band-limited to 0.5–8 Hz, and normalized "
            "per beat. The VitalDB holdout locked in ml/splits/diabetes.json (ADR 0014) is never used for "
            "training or tuning."
        ),
        "limitations": (
            "- Trained on clinical pulse-oximeter data; phone-camera pulses differ, and performance on the "
            "owner's phone captures is reported separately.\n"
            "- Small public datasets: if the ML-6 floor is not met, the output appears only as Experimental "
            "and is never flagged."
        ),
        "abstain": (
            'The result appears only as Experimental ("Experimental: pulse pattern linked to diabetes in '
            'research. Not a diabetes test.") unless the ML-6 floor is met. Phones below 60 fps show '
            '"Needs a phone that films at 60 frames per second."'
        ),
    },
}


def git_commit() -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=Path(__file__).parent, capture_output=True, text=True, check=True
    )
    return completed.stdout.strip()


def default_opset(path: Path) -> int:
    # Read from the file, not assumed: converters may declare a lower opset than requested when no
    # operator needs a newer one.
    return next(
        entry.version for entry in onnx.load(str(path)).opset_import if entry.domain in ("", "ai.onnx")
    )


def manifest_entry(spec: ModelSpec, models_dir: Path, metrics: dict | None, commit: str, date: str) -> dict:
    path = models_dir / f"{spec.file_stem}.onnx"
    return {
        "name": spec.name,
        "family": spec.family,
        "ships": spec.ships,
        "role": spec.role,
        "version": spec.version,
        "file": path.name,
        "sha256": sha256_of(path),
        "inputs": spec.inputs,
        "outputs": spec.outputs,
        "labels": list(spec.labels),
        "threshold": metrics["threshold"] if metrics else dict.fromkeys(spec.threshold_keys),
        "abstainBelow": spec.abstain_below,
        "externalTest": {"dataset": spec.external_dataset, **dict.fromkeys(spec.external_fields)},
        "trainedOn": metrics["trainedOn"] if metrics else [],
        # Copied verbatim so evidence.json can carry dev-val numbers §11.3 asks the app to show (the
        # premature-beat false-AF rate); ml/runs is not in the repo, so the manifest is their only source.
        "development": metrics["development"] if metrics else None,
        "opset": default_opset(path),
        "toolchain": {
            "torch": torch.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": onnxruntime.__version__,
        },
        "commit": commit,
        "date": date,
        "card": f"{spec.file_stem}.md",
    }


def _table(rows: list[dict]) -> str:
    columns = list(dict.fromkeys(key for row in rows for key in row))
    lines = ["| " + " | ".join(columns) + " |", "|" + "---|" * len(columns)]
    lines += ["| " + " | ".join(str(row.get(column, "")) for column in columns) + " |" for row in rows]
    return "\n".join(lines)


def _development_section(metrics: dict | None) -> str:
    development = (metrics or {}).get("development")
    if not development:
        return NOT_MEASURED
    rows = [
        {
            "metric": name,
            "estimate": value["estimate"],
            "95% CI low": value["low"],
            "95% CI high": value["high"],
        }
        for name, value in development["metrics"].items()
    ]
    header = (
        f"Development-validation subjects: {development['subjects']}. Confidence intervals resample subjects."
    )
    section = f"{header}\n\n{_table(rows)}"
    if development.get("undefinedMetrics"):
        undefined = ", ".join(development["undefinedMetrics"])
        section += f"\n\nUndefined on dev-val (no estimate): {undefined}."
    if development.get("byDataset"):
        section += f"\n\nBy dataset, at the same threshold:\n\n{_table(development['byDataset'])}"
    return section


def _ci(metric: dict) -> str:
    return f"{metric['estimate']:.3f} (95% CI {metric['low']:.3f}-{metric['high']:.3f})"


def _approved_status(spec: ModelSpec, approval: str, metrics: dict) -> str:
    role = (
        "an Experimental, reject-only guard; the rule-based checks (DSP-4, DSP-9) are the quality gate"
        if spec.role == "guard"
        else "the quality gate"
    )
    facts = [f"approved by the owner ({approval}) only for {role}"]
    measured = metrics["development"]["metrics"]
    all_bad = measured.get("cleanPrecisionWithPoorQualityRecords")
    if all_bad:
        facts.append(
            "on dev-val at τ, clean precision with every bad window counted (quality-0 records included) "
            f"is {_ci(all_bad)}"
        )
    best = metrics.get("thresholdEvidence", {}).get("bestPrecisionAllBad")
    if best:
        facts.append(f"the best any τ reaches with every bad window counted is {best['precision']:.3f}")
    ml2 = measured.get("ml2HrWithin5BpmOfAccepted")
    if ml2 is None:
        facts.append("the ML-2 proxy was not measured, so ML-2 is not shown to be met")
    elif ml2["estimate"] < ML2_TARGET:
        facts.append(
            f"the ML-2 proxy (accepted windows with spectral HR within 5 bpm) is {_ci(ml2)}, below the "
            f"{ML2_TARGET:.0%} floor, so ML-2 is not met"
        )
    else:
        facts.append(
            f"the ML-2 proxy (accepted windows with spectral HR within 5 bpm) is {_ci(ml2)}, at or "
            f"above the {ML2_TARGET:.0%} floor on the dev-val subjects τ was chosen on, so it is optimistic"
        )
    return "; ".join(facts)


def _threshold_section(spec: ModelSpec, metrics: dict | None) -> str | None:
    # ADR 0038 item 7: the threshold's basis, the owner's decision on it (H-024), and both precisions side
    # by side. Every number comes from the training metrics file. The status comes from export/specs.py,
    # not from the training notes, which may predate the decision.
    basis = (metrics or {}).get("thresholdBasis")
    if basis is None:
        return None
    approval = threshold_approval(spec, basis)
    if basis == ALL_BAD_BASIS:
        status = "every bad window, including quality-0 records, counted when τ was chosen (§11.2)"
    elif approval:
        status = _approved_status(spec, approval, metrics)
    else:
        status = "PROPOSED, awaiting owner (H-024). ADR 0038 item 7; nothing ships on this basis until then"
    paragraphs = [f"Threshold basis: {basis}. Status: {status}."]
    measured = metrics["development"]["metrics"]
    if "cleanPrecision" in measured:
        at_tau = [
            f"- clean precision {_ci(measured['cleanPrecision'])} with only synthetic corruptions counted "
            "as bad;",
            f"- clean precision {_ci(measured['cleanPrecisionWithPoorQualityRecords'])} with quality-0 BUT "
            "PPG windows also counted as bad;",
        ]
        if "poorQualityAccepted" in measured:
            at_tau.append(f"- share of quality-0 windows accepted: {_ci(measured['poorQualityAccepted'])}.")
        paragraphs.append(f"At τ_clean = {metrics['threshold']['clean']:.4f}:\n\n" + "\n".join(at_tau))
    evidence = metrics.get("thresholdEvidence", {})
    best = evidence.get("bestPrecisionAllBad")
    if best:
        reached = "some τ reaches" if evidence["anyTauReachesTargetAllBad"] else "no τ reaches"
        paragraphs.append(
            "With quality-0 counted as bad, the best precision any τ reaches while accepting at least "
            f"{best['minCleanRecall']:.0%} of natural clean windows is {best['precision']:.3f} (clean "
            f"recall {best['cleanRecall']:.3f}); {reached} 0.95."
        )
    if evidence.get("designIterations"):
        paragraphs.append(
            f"These numbers follow design iteration on the same {metrics['development']['subjects']} "
            f"dev-val subjects ({'; '.join(evidence['designIterations'])}), so they are optimistic."
        )
    top = evidence.get("highestScoringPoorQuality")
    if top:
        paragraphs.append(
            f"Hypothesis, not verified: the {top['windows']} highest-scoring quality-0 windows come from "
            f"records {', '.join(top['records'])}; {top['acceptedAtTau']} of them are accepted at τ_clean, "
            f"and their spectral-peak HR is a median {top['medianHrErrorBpm']:.1f} bpm from the record's "
            "reference HR. A phone frame-timing fault in those recordings may explain this; it has not "
            "been checked. The app's real frame timestamps (DSP-1) are expected to prevent such a fault, "
            "but that has not been verified."
        )
    for split, counts in (metrics.get("labelCheck") or {}).items():
        paragraphs.append(
            f"Label check, {split}: {counts['removedRecords']} of {counts['records']} finger records "
            "removed (CSV reference HR more than 5 bpm from the record's own .qrs beats); "
            f"{counts['subjectsAffected']} of {counts['subjects']} subjects lost records, "
            f"{counts['subjectsFullyRemoved']} lost all of them."
        )
    return "## Threshold\n\n" + "\n\n".join(paragraphs)


def _ship_note(spec: ModelSpec, metrics: dict | None) -> str:
    # ADR 0031: the app loads only the shipped model of each family; if it fails to load, the app runs
    # the classical rule in code (§11.10 "basic analysis"), not another model file.
    if spec.ships:
        decision = (metrics or {}).get("shipDecision")
        why = ""
        if decision:
            # Rendered from the training run's own decision; check_ship_decisions has already refused a
            # decision that names another model.
            difference = decision["networkMinusBestBaselineAuroc"]
            why = (
                f" The development ablation picked it ({decision['criterion']}; network minus "
                f"{decision['bestBaseline']}: {difference['estimate']:.4f}, "
                f"95% CI {difference['low']:.4f} to {difference['high']:.4f}), "
                "so it ships per §11.3 (ADR 0031)."
            )
        return f"\n\nThis is the shipped {spec.family} model: the app loads it.{why}"
    decision = (metrics or {}).get("shipDecision")
    lost = (
        f" On development subjects it did not beat {decision['ships']} ({decision['criterion']})."
        if decision and decision["ships"] != spec.name
        else ""
    )
    return (
        f"\n\nThis is an ablation model and does not ship; the app loads {SHIPPED[spec.family]} for the "
        f"{spec.family} family (ADR 0031).{lost}"
    )


def _measured_limits(spec: ModelSpec, metrics: dict | None) -> str:
    # §11.3 asks for the false-AF rate on premature beats to be stated, so the card prints the generated
    # numbers next to the limitation rather than pointing elsewhere.
    development = (metrics or {}).get("development") or {}
    measured = development.get("metrics", {})
    lines = []
    false_af = measured.get("falseAfRatePrematureReadings")
    if false_af:
        sample = development.get("prematureBeatSet")
        # Format 2 files (train.rhythm since PR #49) always record the sample size, so a missing one
        # means a broken file; older files predate the field and render without it.
        if sample is None and metrics.get("metricsFormat", 1) >= 2:
            raise ProvenanceError(f"{spec.name} metrics lack development.prematureBeatSet")
        size = f", {sample['subjects']} subjects, {sample['windows']} windows" if sample else ""
        lines.append(
            f"- False-AF rate on augmented premature-beat readings (dev-val{size}): {_ci(false_af)}."
        )
    abstain = measured.get("readingAbstainRate")
    if abstain:
        lines.append(
            f"- Reading abstain rate (top probability below {spec.abstain_below}) on dev-val: {_ci(abstain)}."
        )
    return "".join(f"\n{line}" for line in lines)


def model_card(spec: ModelSpec, metrics: dict | None) -> str:
    text = CARD_TEXT[spec.family]
    if not spec.ships:
        role = "ablation model, not shipped"
    elif spec.role == "guard":
        role = f"shipped {spec.family} model, Experimental reject-only guard"
    else:
        role = f"shipped {spec.family} model"
    trained_on = ", ".join(metrics["trainedOn"]) if metrics else "no training run yet"
    notes = "".join(f"\n- {note}" for note in (metrics or {}).get("notes", []))
    # Notes are as the training run wrote them; the Threshold section gives the owner's current decision.
    training_notes = f"\n\nTraining notes, as written at training time:\n{notes}" if notes else ""
    ablation = (metrics or {}).get("ablation")
    calibration = (metrics or {}).get("calibration")
    sections = [
        f"# {spec.name} {spec.version} ({role})",
        "Lumen is a screening prototype, not a diagnosis.",
        f"## Intended use\n\n{text['intended_use']}{_ship_note(spec, metrics)}",
        f"## Data\n\n{text['data']}\n\nTrained on: {trained_on}. Splits are by subject: no person appears in "
        "both development-train and development-validation." + training_notes,
        f"## Development metrics\n\n{_development_section(metrics)}",
        *filter(None, [_threshold_section(spec, metrics)]),
        "## Ablation\n\nThe neural model ships only if it beats its classical baseline on held-out "
        "subjects.\n\n" + (_table(ablation) if ablation else NOT_MEASURED),
        "## Calibration\n\n"
        + (
            "\n".join(f"- {key}: {value}" for key, value in calibration.items())
            if calibration
            else NOT_MEASURED
        ),
        f"## External test\n\nDataset: {spec.external_dataset}. {EXTERNAL_NOT_RUN}",
        f"## Limitations\n\n{text['limitations']}{_measured_limits(spec, metrics)}",
        f"## What the app shows when the model abstains\n\n{text['abstain']}",
    ]
    return "\n\n".join(sections) + "\n"


def check_ship_decisions(specs: list[ModelSpec], metrics_by_name: dict[str, dict | None]) -> None:
    # A training run's shipDecision must agree with the ships flags in export/specs.py. Which model
    # ships is the owner's decision (ADR 0031), so a disagreement is never resolved here.
    shipped = {spec.family: spec.name for spec in specs if spec.ships}
    problems = sorted(
        {
            f"{spec.name}'s metrics pick {decision['ships']} for {spec.family}, but the specs ship "
            f"{shipped.get(spec.family)}"
            for spec in specs
            if (decision := (metrics_by_name[spec.name] or {}).get("shipDecision"))
            and decision["ships"] != shipped.get(spec.family)
        }
    )
    if problems:
        raise ShipRuleError(
            "; ".join(problems) + ". The owner decides which model ships (ADR 0031): ask the owner "
            "before changing ships in export/specs.py or retraining."
        )


def write_manifest(models_dir: Path, runs_dir: Path, require_metrics: bool) -> Path:
    commit = git_commit()
    date = datetime.now(UTC).date().isoformat()
    # Outside models/ the manifest may describe an untrained pipeline check, which includes every network.
    specs = release_specs(runs_dir, untrained_networks=not require_metrics)
    metrics_by_name, source_shas = {}, {}
    for spec in specs:
        metrics = load_metrics(spec, runs_dir)
        if metrics is None and require_metrics:
            raise FileNotFoundError(f"{runs_dir / spec.file_stem}.json not found; train {spec.name} first")
        if metrics is not None:
            # Raises unless the weights in runs/ are the exact file these metrics describe.
            trained_source(spec, runs_dir)
        metrics_by_name[spec.name] = metrics
        source_shas[spec.name] = metrics["sourceSha256"] if metrics else None
    entries = [manifest_entry(spec, models_dir, metrics_by_name[spec.name], commit, date) for spec in specs]
    shipped_per_family(entries)
    check_ship_decisions(specs, metrics_by_name)
    check_threshold_bases(specs, metrics_by_name)
    check_parity(models_dir, entries, source_shas)
    # Every check, and every card render, happens before anything is written, so a failure leaves no
    # manifest or cards behind.
    cards = {spec.file_stem: model_card(spec, metrics_by_name[spec.name]) for spec in specs}
    for stem, card in cards.items():
        (models_dir / f"{stem}.md").write_text(card, encoding="utf-8")
    path = models_dir / "manifest.json"
    path.write_text(json.dumps({"models": entries}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Write models/manifest.json and a model card per model")
    parser.add_argument("--models-dir", type=Path, default=MODELS_DIR)
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    args = parser.parse_args(argv)
    # Only trained models may reach models/, and training always writes a metrics file.
    require_metrics = inside_models_dir(args.models_dir)
    print(write_manifest(args.models_dir, args.runs_dir, require_metrics))


if __name__ == "__main__":
    main()
