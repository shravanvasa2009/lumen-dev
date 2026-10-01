import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

from export.provenance import SEEDED_INPUTS, entry_problems, sha256_of
from export.specs import MODELS_DIR, RUNS_DIR, SPECS, ModelSpec, inside_models_dir, release_specs
from export.to_onnx import SourceModel, source_model

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


def _seeded_input(rng: np.random.Generator, name: str, shape: list[int], count: int) -> np.ndarray:
    if name == "window":
        # ADR 0023: lumen_dsp z-scores each 4 s window, so the parity windows are z-scored too. A random
        # walk gives them slow structure, as a pulse wave has, rather than white noise.
        walk = rng.normal(size=(count, *shape[1:])).cumsum(axis=-1)
        return ((walk - walk.mean(axis=-1, keepdims=True)) / walk.std(axis=-1, keepdims=True)).astype(
            np.float32
        )
    if name == "features":
        return rng.normal(0.0, 2.0, size=(count, *shape[1:])).astype(np.float32)
    # Random per-row offset and scale: averaged beats and shape features are not z-scored, and the
    # features span several orders of magnitude.
    row = (count,) + (1,) * (len(shape) - 1)
    values = rng.normal(size=(count, *shape[1:])) * rng.uniform(0.1, 50.0, size=row) + rng.normal(
        0.0, 10.0, size=row
    )
    return values.astype(np.float32)


def seeded_inputs(spec: ModelSpec, count: int = SEEDED_INPUTS, seed: int = 0) -> Batch:
    rng = np.random.default_rng(seed)
    if "intervals" in spec.inputs:
        return _rhythm_batch(rng, count)
    return {name: _seeded_input(rng, name, shape, count) for name, shape in spec.inputs.items()}


def edge_cases(spec: ModelSpec) -> list[Batch]:
    if "intervals" in spec.inputs:
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


def predict(spec: ModelSpec, source: SourceModel, batch: Batch) -> np.ndarray:
    if spec.kind == "torch":
        with torch.no_grad():
            return source(*(torch.from_numpy(batch[name]) for name in spec.inputs)).numpy()
    (input_name,) = spec.inputs
    probabilities = source.predict_proba(batch[input_name])
    # Binary baselines are exported as P(positive) only, [N, 1], like the neural models.
    return probabilities[:, 1:] if probabilities.shape[1] == 2 else probabilities


def parity_entry(spec: ModelSpec, source: SourceModel, onnx_path: Path, source_sha: str | None) -> dict:
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    seeded = seeded_inputs(spec)
    worst, checked, spread = 0.0, 0, 0.0
    for batch in [seeded, *edge_cases(spec)]:
        expected = predict(spec, source, batch)
        (actual,) = session.run(None, batch)
        # Broadcasting would let [N, 1] against [N, 3] produce a diff, so a shape mismatch is an error.
        if expected.shape != actual.shape:
            raise ValueError(f"{spec.name}: source gives {expected.shape}, ONNX gives {actual.shape}")
        if batch is seeded:
            spread = float(expected.std(axis=0).max())
        checked += len(expected)
        # A non-finite output on either side is a parity failure, not a value to skip.
        if not (np.isfinite(expected).all() and np.isfinite(actual).all()):
            worst = float("inf")
        else:
            worst = max(worst, float(np.abs(expected - actual).max()))
    return {
        "onnxSha256": sha256_of(onnx_path),
        "sourceSha256": source_sha,
        "nInputs": checked,
        "maxAbsDiff": worst,
        "outputStd": spread,
    }


def parity_report(entries: dict[str, dict]) -> dict:
    problems = [problem for name, entry in entries.items() for problem in entry_problems(name, entry)]
    # JSON has no inf, and null would pass m3.mjs (null <= 1e-4 is true in JavaScript). m3.mjs reads only
    # the top-level maxAbsDiff, so any failed check turns it into a string, which fails that comparison
    # and says why.
    models = {
        name: {
            **entry,
            **{
                key: entry[key] if np.isfinite(entry[key]) else "non-finite"
                for key in ("maxAbsDiff", "outputStd")
            },
        }
        for name, entry in entries.items()
    }
    top = (
        max(entry["maxAbsDiff"] for entry in entries.values())
        if not problems
        else "failed: " + "; ".join(problems)
    )
    return {"maxAbsDiff": top, "models": models}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Check ONNX files against their source models (ML-3)")
    which = parser.add_mutually_exclusive_group(required=True)
    which.add_argument("--all", action="store_true", help="every network plus each trained baseline")
    which.add_argument("--name", choices=sorted(SPECS))
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    parser.add_argument("--models-dir", type=Path, default=MODELS_DIR)
    parser.add_argument(
        "--random-init", type=int, metavar="SEED", help="the seed given to to_onnx --random-init"
    )
    args = parser.parse_args(argv)
    if inside_models_dir(args.models_dir):
        if args.random_init is not None:
            parser.error("--random-init needs --models-dir outside models/: its parity.json must not ship")
        if args.name:
            parser.error("models/parity.json must cover every model; use --all")
    entries = {}
    for spec in release_specs(args.runs_dir) if args.all else [SPECS[args.name]]:
        source = source_model(spec, args.runs_dir, args.random_init)
        from_file = args.random_init is None or spec.kind == "classifier"
        source_sha = sha256_of(args.runs_dir / spec.source_file) if from_file else None
        entries[spec.name] = parity_entry(
            spec, source, args.models_dir / f"{spec.file_stem}.onnx", source_sha
        )
        print(f"{spec.name}: max abs diff {entries[spec.name]['maxAbsDiff']:.3e}")
    report = parity_report(entries)
    (args.models_dir / "parity.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if isinstance(report["maxAbsDiff"], str):
        sys.exit(f"ONNX parity {report['maxAbsDiff']} (ML-3)")


if __name__ == "__main__":
    main()
