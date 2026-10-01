import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from torch import nn

from export.specs import MODELS_DIR, RUNS_DIR, SPECS, ModelSpec
from export.to_onnx import source_model

# ML-3: the PyTorch model and its ONNX file may differ by at most this much on any output.
TOLERANCE = 1e-4
SEEDED_INPUTS = 500
Batch = dict[str, np.ndarray]


def _rhythm_batch(rng: np.random.Generator, count: int) -> Batch:
    # RR intervals in seconds (40–200 bpm); most windows have their real intervals first and a masked
    # tail, as when a reading has fewer than 64 beats, and a few have scattered gaps.
    intervals = rng.uniform(0.3, 1.5, size=(count, 64))
    lengths = rng.integers(0, 65, size=count)
    mask = (np.arange(64) < lengths[:, None]).astype(np.float32)
    scattered = rng.random(count) < 0.2
    mask[scattered] = (rng.random((int(scattered.sum()), 64)) < 0.7).astype(np.float32)
    return {
        "intervals": intervals.astype(np.float32),
        "mask": mask,
        "features": rng.normal(0.0, 2.0, size=(count, 8)).astype(np.float32),
    }


def seeded_inputs(spec: ModelSpec, count: int = SEEDED_INPUTS, seed: int = 0) -> Batch:
    rng = np.random.default_rng(seed)
    if spec.name == "rhythm-net":
        return _rhythm_batch(rng, count)
    # Random per-row offset and scale: camera channels arrive un-normalized, and shape features span
    # several orders of magnitude.
    return {
        name: (
            rng.normal(size=(count, *shape[1:]))
            * rng.uniform(0.1, 50.0, size=(count,) + (1,) * (len(shape) - 1))
            + rng.normal(0.0, 10.0, size=(count,) + (1,) * (len(shape) - 1))
        ).astype(np.float32)
        for name, shape in spec.inputs.items()
    }


def edge_cases(spec: ModelSpec) -> list[Batch]:
    if spec.name == "rhythm-net":
        regular = np.full((1, 64), 0.8, dtype=np.float32)
        features = np.zeros((1, 8), dtype=np.float32)
        tail_masked = (np.arange(64) < 10).astype(np.float32)[None]
        garbage = regular.copy()
        garbage[0, 10:] = np.nan
        garbage[0, 20:30] = np.inf
        return [
            {"intervals": regular, "mask": np.zeros((1, 64), np.float32), "features": features},
            {"intervals": regular, "mask": np.ones((1, 64), np.float32), "features": features},
            {"intervals": regular, "mask": tail_masked, "features": features},
            {"intervals": garbage, "mask": tail_masked, "features": features},
            {
                "intervals": regular,
                "mask": (np.arange(64) == 0).astype(np.float32)[None],
                "features": features,
            },
            {
                "intervals": np.zeros((1, 64), np.float32),
                "mask": np.ones((1, 64), np.float32),
                "features": features,
            },
        ]
    constant = {name: np.zeros([1, *shape[1:]], np.float32) for name, shape in spec.inputs.items()}
    large = {name: np.full([1, *shape[1:]], 1e3, np.float32) for name, shape in spec.inputs.items()}
    return [constant, large]


def max_abs_diff(model: nn.Module, onnx_path: Path, batches: list[Batch]) -> float:
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    model.eval()
    worst = 0.0
    for batch in batches:
        with torch.no_grad():
            expected = model(*(torch.from_numpy(batch[name]) for name in batch)).numpy()
        (actual,) = session.run(None, batch)
        # A non-finite output on either side is a parity failure, not a value to skip.
        if not (np.isfinite(expected).all() and np.isfinite(actual).all()):
            return float("inf")
        worst = max(worst, float(np.abs(expected - actual).max()))
    return worst


def parity_report(diffs: dict[str, float]) -> dict:
    # JSON has no inf, and null would pass m3.mjs (null <= 1e-4 is true in JavaScript), so a non-finite
    # diff is written as a string, which fails that comparison and says why.
    def encode(diff: float) -> float | str:
        return diff if np.isfinite(diff) else "non-finite"

    return {
        "maxAbsDiff": encode(max(diffs.values())),
        "models": {name: encode(diff) for name, diff in diffs.items()},
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Check ONNX files against their PyTorch source (ML-3)")
    which = parser.add_mutually_exclusive_group(required=True)
    which.add_argument("--all", action="store_true")
    which.add_argument("--name", choices=sorted(SPECS))
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    parser.add_argument("--models-dir", type=Path, default=MODELS_DIR)
    parser.add_argument(
        "--random-init", type=int, metavar="SEED", help="the seed given to to_onnx --random-init"
    )
    args = parser.parse_args(argv)
    if args.random_init is not None and args.models_dir.resolve() == MODELS_DIR.resolve():
        parser.error("--random-init needs --models-dir outside models/: its parity.json must not ship")
    diffs = {}
    for name in sorted(SPECS) if args.all else [args.name]:
        spec = SPECS[name]
        model = source_model(spec, args.runs_dir, args.random_init)
        batches = [seeded_inputs(spec), *edge_cases(spec)]
        diffs[name] = max_abs_diff(model, args.models_dir / f"{spec.file_stem}.onnx", batches)
        print(f"{name}: max abs diff {diffs[name]:.3e}")
    worst = max(diffs.values())
    (args.models_dir / "parity.json").write_text(json.dumps(parity_report(diffs), indent=2) + "\n")
    if worst > TOLERANCE:
        sys.exit(f"ONNX parity {worst:.3e} exceeds {TOLERANCE:g} (ML-3)")


if __name__ == "__main__":
    main()
