import json
import pickle
from pathlib import Path

import numpy as np
import torch
from lightgbm import LGBMClassifier
from sklearn.linear_model import LogisticRegression

from export.provenance import sha256_of
from export.specs import ModelSpec
from export.to_onnx import SourceModel


def valid_metrics(spec: ModelSpec, source_sha: str) -> dict:
    # Shaped like the file training will write; the values only need to pass validation.
    return {
        "trainedOn": ["afdb"],
        "threshold": dict.fromkeys(spec.threshold_keys, 0.5),
        "development": {"subjects": 4, "metrics": {"auroc": {"estimate": 0.5, "low": 0.25, "high": 0.75}}},
        "sourceSha256": source_sha,
    }


def save_trained(spec: ModelSpec, runs_dir: Path, source: SourceModel, overrides: dict | None = None) -> dict:
    runs_dir.mkdir(parents=True, exist_ok=True)
    path = runs_dir / spec.source_file
    if spec.kind == "torch":
        torch.save(source.state_dict(), path)
    else:
        path.write_bytes(pickle.dumps(source))
    metrics = {**valid_metrics(spec, sha256_of(path)), **(overrides or {})}
    (runs_dir / f"{spec.file_stem}.json").write_text(json.dumps(metrics), encoding="utf-8")
    return metrics


def fit_baseline(spec: ModelSpec, seed: int = 4) -> SourceModel:
    ((_, shape),) = spec.inputs.items()
    rng = np.random.default_rng(seed)
    features = rng.normal(size=(400, shape[1])).astype(np.float32)
    edges = [-0.5, 0.5][: len(spec.labels) - 1] if len(spec.labels) > 1 else [0.0]
    labels = np.digitize(features[:, 0] + 0.5 * rng.normal(size=400), edges)
    if spec.name.endswith(("logistic", "rule")):
        return LogisticRegression(max_iter=500).fit(features, labels)
    return LGBMClassifier(n_estimators=30, verbose=-1).fit(features, labels)
