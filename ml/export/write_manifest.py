import argparse
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import NamedTuple

import onnx
import onnxruntime
import torch
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

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
from export.to_onnx import source_model
from eval.external_gate import RESULTS_FILE, read_results

EXTERNAL_NOT_RUN = "Not run yet. Run once per model version, only after the owner approves (need-human)."
# Pass or fail facts eval.external writes next to the numbers (§11.5, ML-1, ML-4, ML-6). The role and the
# family outcome are shown with them, so an ablation model's own floorMet is never read as a pass (ADR 0045).
EXTERNAL_VERDICTS = ("role", "floorMet", "status", "passed", "outcome")
# §11.5's other units of analysis, as eval.external's rhythm_part scores them: no abstain or rhythm-card rule.
LEVEL_UNITS = {
    "reading": ("Reading level: each 90 s pseudo-reading's mean window P(AF) against τ", "pseudo-readings"),
    "window": ("Window level: each rhythm window's P(AF) against τ", "windows"),
}
# Where the spec states each family's "ship the network only if it beats the baselines" rule.
SHIP_RULE_SECTION = {"sqi": "§11.1", "rhythm": "§11.3", "diabetes": "§11.4"}
NOT_MEASURED = "Not measured yet: no training run is recorded for this model version."
# §11.10: when the rhythm model fails to load, the app runs this rule in code (@lumen/core) as "basic
# analysis", so its manifest entry carries every number the rule needs, read from the trained pickle.
CODED_FALLBACKS = ("rhythm-logistic",)
RULE_METHOD = "probs = softmax(coefficients · z + intercepts), z = (features[featureIndices] − mean) / scale"

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


def logistic_rule(pipeline: Pipeline, feature_order: list[str], labels: tuple[str, ...]) -> dict:
    # Only the shape train.rhythm.fit_logistic fits is accepted: anything else would need other math in
    # the app.
    columns, logistic = pipeline[0], pipeline[-1]
    if (
        len(pipeline) != 2
        or not isinstance(columns, ColumnTransformer)
        or not isinstance(logistic, LogisticRegression)
    ):
        raise ProvenanceError(f"not a column-selecting logistic rule: {pipeline}")
    (_, scaler, indices), *rest = columns.transformers_
    # The app computes z = (x - mean) / scale, so a scaler that skips either step would be misread.
    standardizes = isinstance(scaler, StandardScaler) and scaler.with_mean and scaler.with_std
    if not standardizes or any(transformer != "drop" for _, transformer, _ in rest):
        raise ProvenanceError(f"the rule must standardize one set of columns and drop the rest: {columns}")
    if logistic.classes_.tolist() != list(range(len(labels))):
        raise ProvenanceError(f"class indices {logistic.classes_.tolist()} do not match labels {labels}")
    return {
        "method": RULE_METHOD,
        "features": [feature_order[index] for index in indices],
        "featureIndices": [int(index) for index in indices],
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "classes": list(labels),
        # One row per class, in the order of "classes".
        "coefficients": logistic.coef_.tolist(),
        "intercepts": logistic.intercept_.tolist(),
    }


class ExternalRun(NamedTuple):
    # The ledger entry of eval.external's one run of this model version, and its numbers once it is done.
    run: dict
    report: dict | None


def external_run(
    spec: ModelSpec, results: dict, onnx_sha256: str, metrics: dict | None
) -> ExternalRun | None:
    # ADR 0045: the ledger in models/external-test.json records each model version's one run; the family
    # block holds the numbers of the version that ran last.
    runs = [run for run in results.get("runs", []) if run["model"] == spec.file_stem]
    if not runs:
        return None
    # Started runs too: their data was seen, so new weights under the same version would hide that look.
    for run in runs:
        if run["onnxSha256"] != onnx_sha256:
            raise ProvenanceError(
                f"{spec.file_stem} was externally tested as ONNX {run['onnxSha256']}, but this release's "
                f"file is {onnx_sha256}"
            )
    done = [run for run in runs if run["status"] == "done"]
    if not done:
        # A run that started and crashed has read the external data, so the card says so (ADR 0045).
        return ExternalRun(runs[-1], None)
    if len(done) > 1:
        raise ProvenanceError(f"the ledger records {len(done)} finished external runs of {spec.file_stem}")
    (run,) = done
    block = results.get(spec.family) or {}
    report = (block.get("models") or {}).get(spec.name) if spec.family == "rhythm" else block
    if not report or report.get("model") != spec.file_stem:
        raise ProvenanceError(
            f"the ledger records a finished external run of {spec.file_stem}, but {RESULTS_FILE.name} has "
            f"no {spec.family} results for it"
        )
    if spec.family == "rhythm":
        # eval.external scores every rhythm model on the same subjects; the rest are each model's own.
        report = {
            "subjects": block["subjects"],
            **report["subject"],
            "role": report["role"],
            "floorMet": report["floorMet"],
            "outcome": block["outcome"],
            # §11.5 asks for window- and reading-level results next to the subject-level ones.
            "levels": {"reading": report["reading"], "window": report["window"]},
            "appReadings": report["appReadings"],
        }
    # §11.5: the numbers hold only at the threshold the run used; one chosen again after it would sit next
    # to results it was never tested at.
    (key,) = spec.threshold_keys
    frozen = (metrics or {}).get("threshold", {}).get(key)
    answered = report.get("appReadings", {}).get("answered")
    for scored in (report, *report.get("levels", {}).values(), *([answered] if answered else [])):
        if scored.get("threshold") != frozen:
            raise ProvenanceError(
                f"{spec.file_stem} was externally tested at {key} threshold {scored.get('threshold')}, but "
                f"its training metrics now say {frozen}"
            )
    missing = [field for field in spec.external_fields if field not in report]
    if missing:
        raise ProvenanceError(f"{spec.file_stem}'s external results lack {missing}")
    return ExternalRun(run, report)


def manifest_entry(
    spec: ModelSpec,
    models_dir: Path,
    metrics: dict | None,
    commit: str,
    date: str,
    rule: dict | None,
    external: ExternalRun | None,
) -> dict:
    path = models_dir / f"{spec.file_stem}.onnx"
    report = external.report if external else None
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
        "externalTest": {
            "dataset": spec.external_dataset,
            **{field: report[field] if report else None for field in spec.external_fields},
        },
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
        **({"rule": rule} if rule else {}),
        # ML-6: the app fills a missing diabetes feature with the dev-train median the model was trained with,
        # and must feed the features in this order; neither is inside the ONNX file. Diabetes only: rhythm and
        # SQI metrics also record a featureOrder (a list, for training), which the app never reads.
        **{
            key: metrics[key]
            for key in ("featureOrder", "fillMedians")
            if spec.family == "diabetes" and metrics and key in metrics
        },
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
                f"so it ships per {SHIP_RULE_SECTION[spec.family]} (ADR 0031)."
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


# train.rhythm's reliability tables: (key, what the x axis is, what "observed" counts, plot colour).
RELIABILITY_SERIES = (
    ("reliabilityAf", "P(AF)", "share of windows that are AF", "#c0392b"),
    ("reliabilityTop", "top-class probability", "share of windows whose top class is right", "#1f6f8b"),
)
# SVG user units: a square plot with room on the left and below for the axis labels.
PLOT_LEFT, PLOT_TOP, PLOT_SIZE = 60, 40, 320


def calibration_plot_name(spec: ModelSpec) -> str:
    return f"{spec.file_stem}.calibration.svg"


def _has_reliability(calibration: dict | None) -> bool:
    return any(key in (calibration or {}) for key, *_ in RELIABILITY_SERIES)


def _reliability_rows(rows: list[dict]) -> list[dict]:
    return [
        {
            "bin": f"{row['low']:.1f}-{row['high']:.1f}",
            "windows": row["windows"],
            "mean predicted": f"{row['predicted']:.3f}",
            "observed": f"{row['observed']:.3f}",
            "observed minus predicted": f"{row['observed'] - row['predicted']:+.3f}",
        }
        for row in rows
    ]


def _calibration_section(spec: ModelSpec, calibration: dict | None) -> str:
    if not calibration:
        return NOT_MEASURED
    facts = "\n".join(
        f"- {key}: {value}" for key, value in calibration.items() if not isinstance(value, list)
    )
    if not _has_reliability(calibration):
        return facts
    parts = [
        facts,
        f"![Reliability diagram, dev-val windows]({calibration_plot_name(spec)})",
        "Windows are weighted as in training (each label equal, then each dataset, then each subject), so "
        "the observed shares hold for that balance, not for any real-world prevalence. Points on the "
        "diagonal are calibrated; points above it mean the model is underconfident. The app abstains when "
        f"a reading's top-class probability is below {spec.abstain_below}.",
    ]
    parts += [
        f"{axis} ({observed}):\n\n{_table(_reliability_rows(calibration[key]))}"
        for key, axis, observed, _colour in RELIABILITY_SERIES
        if key in calibration
    ]
    return "\n\n".join(parts)


def _x(probability: float) -> float:
    return PLOT_LEFT + probability * PLOT_SIZE


def _y(probability: float) -> float:
    return PLOT_TOP + (1 - probability) * PLOT_SIZE


def reliability_svg(spec: ModelSpec, calibration: dict) -> str:
    bottom, right, middle = PLOT_TOP + PLOT_SIZE, PLOT_LEFT + PLOT_SIZE, PLOT_TOP + PLOT_SIZE / 2
    shapes = [
        f'<text x="{PLOT_LEFT}" y="22" font-size="14">{spec.name} {spec.version}: reliability on dev-val '
        "windows</text>",
        f'<rect x="{PLOT_LEFT}" y="{PLOT_TOP}" width="{PLOT_SIZE}" height="{PLOT_SIZE}" fill="none" '
        'stroke="#444"/>',
        f'<line x1="{PLOT_LEFT}" y1="{bottom}" x2="{right}" y2="{PLOT_TOP}" stroke="#999" '
        'stroke-dasharray="4 4"/>',
        f'<text x="{PLOT_LEFT + PLOT_SIZE / 2}" y="{bottom + 34}" font-size="12" text-anchor="middle">'
        "mean predicted probability</text>",
        f'<text x="16" y="{middle}" font-size="12" text-anchor="middle" transform="rotate(-90 16 {middle})">'
        "observed share (weighted)</text>",
    ]
    for tick in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0):
        shapes += [
            f'<text x="{_x(tick):.1f}" y="{bottom + 16}" font-size="11" text-anchor="middle">'
            f"{tick:.1f}</text>",
            f'<text x="{PLOT_LEFT - 6}" y="{_y(tick) + 4:.1f}" font-size="11" text-anchor="end">'
            f"{tick:.1f}</text>",
        ]
    if spec.abstain_below is not None:
        abstain = _x(spec.abstain_below)
        shapes += [
            f'<line x1="{abstain:.1f}" y1="{PLOT_TOP}" x2="{abstain:.1f}" y2="{bottom}" stroke="#777" '
            'stroke-dasharray="2 3"/>',
            f'<text x="{abstain + 4:.1f}" y="{bottom - 6}" font-size="10" fill="#555">abstain below '
            f"{spec.abstain_below}</text>",
        ]
    legend_y = PLOT_TOP + 14
    for key, axis, _observed, colour in RELIABILITY_SERIES:
        if not calibration.get(key):
            continue
        points = [(_x(row["predicted"]), _y(row["observed"])) for row in calibration[key]]
        shapes.append(
            f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in points)}" fill="none" '
            f'stroke="{colour}" stroke-width="2"/>'
        )
        shapes += [f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="{colour}"/>' for x, y in points]
        shapes += [
            f'<line x1="{PLOT_LEFT + 10}" y1="{legend_y - 4}" x2="{PLOT_LEFT + 30}" y2="{legend_y - 4}" '
            f'stroke="{colour}" stroke-width="2"/>',
            f'<text x="{PLOT_LEFT + 36}" y="{legend_y}" font-size="11">{axis}</text>',
        ]
        legend_y += 16
    width, height = right + 20, bottom + 50
    body = "\n".join(f"  {shape}" for shape in shapes)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" font-family="sans-serif">\n'
        f'  <rect width="{width}" height="{height}" fill="#fff"/>\n{body}\n</svg>\n'
    )


def _external_rows(report: dict, fields: list[str]) -> list[dict]:
    intervals = report.get("ci95")
    rows = []
    for field in fields:
        # Rhythm and diabetes give one interval per metric; ML-4's single interval is the gap's (ADR 0028).
        if isinstance(intervals, dict):
            interval = intervals.get(field)
        else:
            interval = intervals if field == "rhythmBiasGapPts" else None
        low, high = interval or ("", "")
        rows.append({"metric": field, "estimate": report[field], "95% CI low": low, "95% CI high": high})
    return rows


def _external_section(spec: ModelSpec, external: ExternalRun | None) -> str:
    header = f"Dataset: {spec.external_dataset}."
    if external is None:
        return f"{header} {EXTERNAL_NOT_RUN}"
    run, report = external
    if report is None:
        return (
            f"{header} Started {run['startedAt']} under the owner's approval {run['approval']} and did not "
            "finish, so no numbers were recorded. The data has been seen: a retry needs a new owner approval "
            "(ADR 0045)."
        )
    fields = [field for field in spec.external_fields if field not in ("ci95", "ppvNpv", *EXTERNAL_VERDICTS)]
    parts = [
        f"{header} Run once, finished {run['finishedAt']}, under the owner's approval {run['approval']} at "
        f"commit {run['commit']}, at the threshold frozen in the manifest. Confidence intervals resample "
        "subjects.",
        _table(_external_rows(report, fields)),
    ]
    verdicts = [f"- {key}: {report[key]}" for key in EXTERNAL_VERDICTS if key in report]
    if verdicts:
        parts.append("\n".join(verdicts))
    if report.get("ppvNpv"):
        parts.append(f"PPV and NPV at the stated prevalences:\n\n{_table(report['ppvNpv'])}")
    for level, (label, noun) in LEVEL_UNITS.items():
        if level in report.get("levels", {}):
            scored = report["levels"][level]
            rows = _external_rows(scored, ["auroc", "sensitivity", "specificity"])
            parts.append(
                f"{label} ({scored['units']} {noun}; intervals resample subjects):\n\n{_table(rows)}"
            )
    if "appReadings" in report:
        parts.append(_app_readings_section(report["appReadings"]))
    return "\n\n".join(parts)


def _app_readings_section(app: dict) -> str:
    # ADR 0041: eval.external's app_readings applies the rhythm-card rule, abstainBelow and the 2-of-3 rule.
    def interval_row(metric: str, value: dict | None) -> dict:
        if value is None:
            return {"metric": metric, "estimate": "undefined", "95% CI low": "", "95% CI high": ""}
        return {
            "metric": metric,
            "estimate": value["estimate"],
            "95% CI low": value["low"],
            "95% CI high": value["high"],
        }

    subjects = app["possibleAfSubjects"]
    rows = [
        interval_row("abstain rate (readings with a rhythm card)", app["abstainRate"]),
        *_external_rows(app["answered"], ["auroc", "sensitivity", "specificity"]),
        interval_row("possible-AF subjects: sensitivity", subjects["sensitivity"]),
        interval_row("possible-AF subjects: specificity", subjects["specificity"]),
    ]
    return (
        f"Scored like the app scores a reading (ADR 0041): {app['readings']} readings, "
        f"{app['readingsWithRhythmCard']} with a rhythm card. The answered readings' rows come from readings "
        f"that did not abstain; the last two rows score {subjects['subjects']} subjects by the 2-of-3 "
        f"possible-AF rule. Not applied: the 60 clean-second floor and card confidence, which need camera "
        f"coverage and SQI. Intervals resample subjects.\n\n{_table(rows)}"
    )


def model_card(spec: ModelSpec, metrics: dict | None, external: ExternalRun | None = None) -> str:
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
        f"## Calibration\n\n{_calibration_section(spec, calibration)}",
        f"## External test\n\n{_external_section(spec, external)}",
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
    rules = {
        spec.name: logistic_rule(
            source_model(spec, runs_dir, None), metrics_by_name[spec.name]["featureOrder"], spec.labels
        )
        for spec in specs
        if spec.name in CODED_FALLBACKS and metrics_by_name[spec.name]
    }
    results = read_results(models_dir / RESULTS_FILE.name)
    externals = {
        spec.name: external_run(
            spec, results, sha256_of(models_dir / f"{spec.file_stem}.onnx"), metrics_by_name[spec.name]
        )
        for spec in specs
    }
    entries = [
        manifest_entry(
            spec,
            models_dir,
            metrics_by_name[spec.name],
            commit,
            date,
            rules.get(spec.name),
            externals[spec.name],
        )
        for spec in specs
    ]
    shipped_per_family(entries)
    check_ship_decisions(specs, metrics_by_name)
    check_threshold_bases(specs, metrics_by_name)
    check_parity(models_dir, entries, source_shas)
    # Every check, and every card render, happens before anything is written, so a failure leaves no
    # manifest or cards behind.
    cards = {
        spec.file_stem: model_card(spec, metrics_by_name[spec.name], externals[spec.name]) for spec in specs
    }
    plots: dict[str, str | None] = {}
    for spec in specs:
        calibration = (metrics_by_name[spec.name] or {}).get("calibration")
        plots[calibration_plot_name(spec)] = (
            reliability_svg(spec, calibration) if _has_reliability(calibration) else None
        )
    for stem, card in cards.items():
        (models_dir / f"{stem}.md").write_text(card, encoding="utf-8")
    for name, plot in plots.items():
        # A model whose metrics no longer carry tables keeps no plot from an earlier release.
        if plot is None:
            (models_dir / name).unlink(missing_ok=True)
        else:
            (models_dir / name).write_text(plot, encoding="utf-8")
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
