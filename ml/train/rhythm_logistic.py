import argparse
import json
import pickle
from pathlib import Path

from export.provenance import ProvenanceError, load_metrics
from export.specs import RUNS_DIR
from export.to_onnx import source_model
from train.rhythm import (
    LGBM,
    LOGISTIC,
    UNCALIBRATED,
    WindowSets,
    ablation_rows,
    calibration_summary,
    evaluate,
    fit_logistic,
    metrics_file,
)
from train.rhythm_calibration import check_same_windows
from train.rhythm_windows import load_window_set

MEASURED_BY = "python -m train.rhythm_logistic, refitted on the window cache of the rhythm-lgbm run"
# Training writes these once for every rhythm model; the refitted rule takes them from rhythm-lgbm's file.
SHARED_KEYS = ("ablation", "shipDecision", "notes", "processSeconds", "networkEpochs")


def refit(runs_dir: Path, windows_dir: Path) -> tuple[Path, dict]:
    # Saves the logistic rule of a finished train.rhythm run that predates its export, without training
    # Rhythm-Net or LightGBM again. The fit is deterministic, so the refitted rule must reproduce the
    # run's own ablation row exactly; anything else means other windows or other code, and is refused.
    lgbm_metrics = load_metrics(LGBM, runs_dir)
    if lgbm_metrics is None:
        raise FileNotFoundError(f"{runs_dir / LGBM.file_stem}.json not found; train the rhythm models first")
    sets = WindowSets(**{name: load_window_set(windows_dir / f"{name}.npz") for name in WindowSets._fields})
    lgbm = source_model(LGBM, runs_dir, None)
    check_same_windows(LGBM, lgbm_metrics, lgbm.predict_proba(sets.val.features), sets.val)
    logistic = fit_logistic(sets.train)
    probs = logistic.predict_proba(sets.val.features)
    evaluation = evaluate(probs, sets.val, logistic.predict_proba(sets.premature.features), sets.premature)
    (row,) = ablation_rows({LOGISTIC.name: evaluation})
    recorded = [entry for entry in lgbm_metrics["ablation"] if entry["model"] == LOGISTIC.name]
    if recorded != [row]:
        raise ProvenanceError(f"the refitted rule gives {row}, but the run recorded {recorded}")
    path = runs_dir / LOGISTIC.source_file
    path.write_bytes(pickle.dumps(logistic))
    shared = {key: lgbm_metrics[key] for key in SHARED_KEYS}
    metrics = metrics_file(path, evaluation, sets, calibration_summary(probs, sets.val, UNCALIBRATED), shared)
    metrics["calibration"]["measuredBy"] = MEASURED_BY
    return path, metrics


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m train.rhythm_logistic",
        description=(
            "Save the logistic rhythm rule of a finished train.rhythm run, refitted on that run's window "
            "cache. Changes no other model or metrics file."
        ),
    )
    parser.add_argument(
        "--windows-dir",
        type=Path,
        required=True,
        help="the training run's window cache: runs/rhythm-net@<version>/<windows key>",
    )
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    args = parser.parse_args(argv)
    path, metrics = refit(args.runs_dir, args.windows_dir)
    metrics_path = args.runs_dir / f"{LOGISTIC.file_stem}.json"
    metrics_path.write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{path}\n{metrics_path}: τ_AF {metrics['threshold']['af']}")


if __name__ == "__main__":
    main()
