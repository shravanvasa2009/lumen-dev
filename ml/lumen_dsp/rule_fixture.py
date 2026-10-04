import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.pipeline import Pipeline

from export.specs import SPECS
from export.verify_onnx import seeded_inputs
from export.write_manifest import logistic_rule
from lumen_dsp.rhythm_rule import rule_probs
from nets.rhythm_net import LABELS
from train.rhythm import LOGISTIC_FEATURES, fit_logistic
from train.rhythm_windows import FEATURE_NAMES, WindowSet

# Not protected (the golden folder is): the rule's parity fixture is regenerated whenever D's fit changes
# shape, and holds no trained numbers, so the app's real rule always comes from models/manifest.json.
FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "packages" / "core" / "test" / "fixtures" / "rhythm-logistic.json"
)
SPEC = SPECS["rhythm-logistic"]
TRAIN_WINDOWS = 600
SEEDED_WINDOWS = 64
SEED = 20261002
# z far beyond any real window, where exp() of the raw logits would overflow without the max shift.
EXTREME_FEATURE = 1e4


def fitted_rule() -> tuple[Pipeline, dict]:
    # train.rhythm's own fit on synthetic windows (no dataset is read), so the fixture has the rule's real
    # shape: labels depend on the three rule features, in the features input the app passes.
    rng = np.random.default_rng(SEED)
    features = rng.normal(size=(TRAIN_WINDOWS, len(FEATURE_NAMES))).astype(np.float32)
    columns = [FEATURE_NAMES.index(name) for name in LOGISTIC_FEATURES]
    score = features[:, columns] @ np.asarray([1.0, 0.7, -0.5]) + 0.5 * rng.normal(size=TRAIN_WINDOWS)
    labels = np.digitize(score, [-0.6, 0.6])
    empty = np.zeros((TRAIN_WINDOWS, 64), np.float32)
    subjects = np.asarray([f"afdb:{index % 20}" for index in range(TRAIN_WINDOWS)])
    windows = WindowSet(empty, empty, features, labels, subjects, np.arange(TRAIN_WINDOWS))
    pipeline = fit_logistic(windows)
    return pipeline, logistic_rule(pipeline, list(FEATURE_NAMES), LABELS)


def rule_fixture() -> dict:
    pipeline, rule = fitted_rule()
    feature_count = SPEC.inputs["features"][1]
    seeded = seeded_inputs(SPEC, count=SEEDED_WINDOWS, seed=SEED)["features"].astype(np.float64).tolist()
    edges = [
        [0.0] * feature_count,
        [EXTREME_FEATURE] * feature_count,
        [-EXTREME_FEATURE] * feature_count,
    ]
    features = seeded + edges
    probs = rule_probs(rule, features, feature_count)
    gap = float(np.abs(np.asarray(probs) - pipeline.predict_proba(np.asarray(features))).max())
    if gap > 1e-12:
        raise ValueError(f"the reference differs from predict_proba by {gap}")
    return {
        "source": "python -m lumen_dsp.rule_fixture: train.rhythm.fit_logistic on synthetic windows",
        "inputs": SPEC.inputs,
        "rule": rule,
        "features": features,
        "probs": probs,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Write the logistic rhythm rule parity fixture (§10.2).")
    parser.add_argument("--out", type=Path, default=FIXTURE_PATH)
    args = parser.parse_args(argv)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(rule_fixture(), separators=(",", ":"), allow_nan=False, ensure_ascii=False) + "\n"
    args.out.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
