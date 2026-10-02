import argparse
import json
import math
from pathlib import Path

import numpy as np
import torch

from export.provenance import ProvenanceError, load_metrics, sha256_of
from export.specs import RUNS_DIR, SPECS, ModelSpec
from export.to_onnx import SourceModel, source_model
from train.rhythm import (
    AF,
    UNCALIBRATED,
    af_threshold,
    calibration_summary,
    network_probs,
    subject_units,
    temperature_record,
)
from train.rhythm_windows import WindowSet, load_window_set

RHYTHM = tuple(name for name, spec in SPECS.items() if spec.family == "rhythm")
MEASURED_BY = "python -m train.rhythm_calibration, after training, from the frozen model"
# The temperature and ECEs of an earlier record must agree to rounding error. τ_AF is still compared
# bit for bit (_check_same_windows), so a rerun whose math libraries round differently, e.g. on
# another machine, fails closed there rather than passing.
SAME_RECORD_TOLERANCE = 1e-9


def _probs(spec: ModelSpec, model: SourceModel, dev_val: WindowSet) -> tuple[np.ndarray, dict]:
    # Probabilities exactly as train.rhythm scored them, and how they were recalibrated.
    if spec.kind == "classifier":
        return model.predict_proba(dev_val.features), UNCALIBRATED
    temperature = float(model.temperature)
    probs = network_probs(model, dev_val)
    with torch.no_grad():
        model.temperature.fill_(1.0)
    return probs, temperature_record(network_probs(model, dev_val), dev_val, temperature)


def _check_same_windows(spec: ModelSpec, metrics: dict, probs: np.ndarray, dev_val: WindowSet) -> None:
    # τ_AF comes from the non-AF dev-val subjects' mean scores, so getting it bit for bit with the same
    # subject count is strong evidence these are the windows the metrics were scored on, not another
    # split or window cache.
    subjects = subject_units(probs.astype(np.float64)[:, AF], dev_val)
    tau = af_threshold(subjects)
    counted = len(set(dev_val.subjects.tolist()))
    if tau != metrics["threshold"]["af"] or counted != metrics["development"]["subjects"]:
        raise ProvenanceError(
            f"{spec.name}: these windows give τ_AF {tau} over {counted} subjects, but its metrics record "
            f"{metrics['threshold']['af']} over {metrics['development']['subjects']}; pass the dev-val "
            "window cache of the run that trained this model"
        )


def _check_earlier_record(spec: ModelSpec, earlier: dict | None, measured: dict) -> None:
    for key in ("temperature", "windowExpectedCalibrationErrorAf", "windowExpectedCalibrationErrorTop"):
        if (
            earlier
            and key in earlier
            and not math.isclose(earlier[key], measured[key], rel_tol=0.0, abs_tol=SAME_RECORD_TOLERANCE)
        ):
            raise ProvenanceError(
                f"{spec.name}: recorded {key} {earlier[key]} but measured {measured[key]} on the same windows"
            )


def measure(spec: ModelSpec, runs_dir: Path, windows: Path) -> dict:
    metrics = load_metrics(spec, runs_dir)
    if metrics is None:
        raise FileNotFoundError(f"{runs_dir / spec.file_stem}.json not found; train {spec.name} first")
    # source_model refuses a .pt or .pkl whose sha256 differs from the metrics file's sourceSha256.
    model = source_model(spec, runs_dir, None)
    dev_val = load_window_set(windows)
    probs, recalibration = _probs(spec, model, dev_val)
    _check_same_windows(spec, metrics, probs, dev_val)
    measured = {
        "sourceSha256": metrics["sourceSha256"],
        "measuredBy": MEASURED_BY,
        "devValWindowsSha256": sha256_of(windows),
        **calibration_summary(probs, dev_val, recalibration),
    }
    _check_earlier_record(spec, metrics.get("calibration"), measured)
    return {**metrics, "calibration": measured}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m train.rhythm_calibration",
        description=(
            "Measure dev-val calibration of trained rhythm models and write it into their metrics files. "
            "Changes no model, threshold, or temperature."
        ),
    )
    parser.add_argument(
        "--windows",
        type=Path,
        required=True,
        help="the training run's dev-val window cache: runs/rhythm-net@<version>/<windows key>/val.npz",
    )
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    parser.add_argument("--name", choices=RHYTHM, action="append", help="default: every rhythm model")
    args = parser.parse_args(argv)
    # Every model is measured and checked before any file is written, so a refusal changes nothing.
    updated = {name: measure(SPECS[name], args.runs_dir, args.windows) for name in args.name or RHYTHM}
    for name, metrics in updated.items():
        path = args.runs_dir / f"{SPECS[name].file_stem}.json"
        path.write_text(json.dumps(metrics, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        calibration = metrics["calibration"]
        print(
            f"{path}: ECE P(AF) {calibration['windowExpectedCalibrationErrorAf']:.4f}, "
            f"top class {calibration['windowExpectedCalibrationErrorTop']:.4f}"
        )


if __name__ == "__main__":
    main()
