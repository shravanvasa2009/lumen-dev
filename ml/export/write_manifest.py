import argparse
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import onnx
import onnxruntime
import torch

from export.provenance import check_parity, load_metrics, sha256_of, trained_source
from export.specs import MODELS_DIR, RUNS_DIR, ModelSpec, inside_models_dir, release_specs

EXTERNAL_NOT_RUN = "Not run yet. Run once per model version, only after the owner approves (need-human)."
NOT_MEASURED = "Not measured yet: no training run is recorded for this model version."

# Fixed wording from §11.2–11.4 and §11.11. Every number in a card comes from the training metrics file.
CARD_TEXT = {
    "sqi-finger": {
        "intended_use": (
            "Accepts or rejects each 4-second fingertip window during capture, whatever the rhythm, so "
            "that only clean signal reaches heart-rate, rhythm, and pulse-shape analysis. Version 1 sees "
            "only the inverted red channel, z-scored per window (ADR 0023); green is added in version 2. "
            "Part of a screening prototype, not a diagnosis."
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
            "A rejected window is not used. The live check coaches the user (finger position, pressure, "
            "staying still) and capture continues. If the model fails to load, the rule-based quality "
            'check runs instead and the result card says "basic analysis."'
        ),
    },
    "rhythm-net": {
        "intended_use": (
            "Classifies 32-interval windows of pulse intervals from a fingertip reading as sinus, AF-like, "
            "or other. Part of a screening prototype, not a diagnosis; no emergency decision depends on "
            "this model alone."
        ),
        "data": (
            "Intervals from the MIT-BIH AF, Long-Term AF, and CinC 2017 databases (records labeled noisy "
            "excluded) and premature-beat episodes from MIT-BIH Arrhythmia (labeled other), made to look "
            "like phone intervals with timing jitter estimated from BUT PPG, merged and split beats, and "
            "dropped premature beats. MIMIC PERform AF is never used for training or tuning."
        ),
        "limitations": (
            "- Frequent premature beats make intervals irregular in every reading, so they can trigger "
            "repeated false irregular results that the 2-of-3 rule does not catch. The false-AF rate on "
            "augmented premature-beat sequences is reported under Development metrics.\n"
            "- Trained on ECG intervals adapted to look like phone intervals, not on phone recordings."
        ),
        "abstain": (
            "When the top probability is below the abstain threshold in the manifest (abstainBelow), the app "
            'shows "Couldn\'t tell — please retake." If the model fails to load, the classical baseline '
            'runs instead and the result card says "basic analysis."'
        ),
    },
    "diabetes-net": {
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
    return f"{header}\n\n{_table(rows)}"


def _baseline_note(spec: ModelSpec) -> str:
    if spec.baseline_of is None:
        return ""
    return (
        f"\n\nThis file is a classical baseline for {spec.baseline_of}. It ships in place of the network if "
        "it wins the ablation, and the app falls back to it if the network fails to load."
    )


def model_card(spec: ModelSpec, metrics: dict | None) -> str:
    text = CARD_TEXT[spec.family]
    trained_on = ", ".join(metrics["trainedOn"]) if metrics else "no training run yet"
    ablation = (metrics or {}).get("ablation")
    calibration = (metrics or {}).get("calibration")
    sections = [
        f"# {spec.name} {spec.version}",
        "Lumen is a screening prototype, not a diagnosis.",
        f"## Intended use\n\n{text['intended_use']}{_baseline_note(spec)}",
        f"## Data\n\n{text['data']}\n\nTrained on: {trained_on}. Splits are by subject: no person appears in "
        "both development-train and development-validation.",
        f"## Development metrics\n\n{_development_section(metrics)}",
        "## Ablation\n\nThe neural model ships only if it beats its classical baseline on held-out "
        "subjects.\n\n" + (_table(ablation) if ablation else NOT_MEASURED),
        "## Calibration\n\n"
        + (
            "\n".join(f"- {key}: {value}" for key, value in calibration.items())
            if calibration
            else NOT_MEASURED
        ),
        f"## External test\n\nDataset: {spec.external_dataset}. {EXTERNAL_NOT_RUN}",
        f"## Limitations\n\n{text['limitations']}",
        f"## What the app shows when the model abstains\n\n{text['abstain']}",
    ]
    return "\n\n".join(sections) + "\n"


def write_manifest(models_dir: Path, runs_dir: Path, require_metrics: bool) -> Path:
    commit = git_commit()
    date = datetime.now(UTC).date().isoformat()
    specs = release_specs(runs_dir)
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
    # Checked before anything is written, so a failed check leaves no manifest or cards behind.
    check_parity(models_dir, entries, source_shas)
    for spec in specs:
        card = model_card(spec, metrics_by_name[spec.name])
        (models_dir / f"{spec.file_stem}.md").write_text(card, encoding="utf-8")
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
