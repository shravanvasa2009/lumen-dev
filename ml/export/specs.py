from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

from torch import nn

from nets.diabetes_net import BEAT, HR_SUMMARY, SHAPE_FEATURES, DiabetesNet
from nets.rhythm_net import FEATURES, INTERVALS, LABELS, RhythmNet
from nets.sqi_net import CHANNELS, WINDOW, SqiNet

OPSET = 17
ML_ROOT = Path(__file__).resolve().parents[1]
# The repo-root models/ folder the app bundles and scripts/proof/m3.mjs reads.
MODELS_DIR = ML_ROOT.parent / "models"
# Training writes the source model (<stem>.pt or <stem>.pkl) and <stem>.json (metrics) here.
RUNS_DIR = ML_ROOT / "runs"


@dataclass(frozen=True)
class ModelSpec:
    name: str
    version: str
    # "torch" sources are state_dicts for build(); "classifier" sources are fitted LightGBM or
    # scikit-learn baselines.
    kind: Literal["torch", "classifier"]
    build: Callable[[], nn.Module] | None
    # Ordered as forward() takes them; shapes use batch 1, as Appendix B records them.
    inputs: dict[str, list[int]]
    outputs: dict[str, list[int]]
    labels: tuple[str, ...]
    threshold_keys: tuple[str, ...]
    abstain_below: float | None
    external_dataset: str
    # Fields scripts/proof/m3.mjs and §11.5 need from the one external run, all null until then.
    external_fields: tuple[str, ...]
    size_budget_bytes: int
    # The neural model this classical baseline stands in for (§11.10 fallback); None for the networks.
    baseline_of: str | None = None

    @property
    def file_stem(self) -> str:
        return f"{self.name}@{self.version}"

    @property
    def source_file(self) -> str:
        return f"{self.file_stem}.pt" if self.kind == "torch" else f"{self.file_stem}.pkl"

    @property
    def family(self) -> str:
        return self.baseline_of or self.name


_SQI = ModelSpec(
    name="sqi-finger",
    version="1.0.0",
    kind="torch",
    build=SqiNet,
    inputs={"window": [1, CHANNELS, WINDOW]},
    outputs={"pClean": [1, 1]},
    labels=("clean",),
    threshold_keys=("clean",),
    abstain_below=None,
    external_dataset="mimic-perform-af",
    external_fields=("subjects", "rhythmBiasGapPts", "acceptRateAf", "acceptRateNonAf"),
    size_budget_bytes=200 * 1024,
)
_RHYTHM = ModelSpec(
    name="rhythm-net",
    version="1.0.0",
    kind="torch",
    build=RhythmNet,
    inputs={"intervals": [1, INTERVALS], "mask": [1, INTERVALS], "features": [1, FEATURES]},
    outputs={"probs": [1, len(LABELS)]},
    labels=LABELS,
    threshold_keys=("af",),
    abstain_below=0.6,
    external_dataset="mimic-perform-af",
    external_fields=("subjects", "auroc", "sensitivity", "specificity", "ci95", "ppvNpv"),
    size_budget_bytes=500 * 1024,
)
_DIABETES = ModelSpec(
    name="diabetes-net",
    version="1.0.0",
    kind="torch",
    build=DiabetesNet,
    inputs={"beat": [1, 1, BEAT], "shapeFeatures": [1, SHAPE_FEATURES], "hrSummary": [1, HR_SUMMARY]},
    outputs={"pPattern": [1, 1]},
    labels=("pattern",),
    threshold_keys=("pattern",),
    abstain_below=None,
    # ADR 0014: the locked VitalDB holdout in ml/splits/diabetes.json.
    external_dataset="vitaldb-holdout",
    external_fields=("subjects", "auroc", "sensitivity", "specificity", "ci95", "ppvNpv", "floorMet"),
    size_budget_bytes=300 * 1024,
)
# §11.3 and §11.4 baselines on the networks' feature inputs, with the same output names, so the app can
# swap one in without code changes. The rhythm logistic rule is not here yet: §11.1 gives it three
# named features, and DSP-15 has not fixed which feature columns they are.
_BASELINES = tuple(
    replace(network, name=name, kind="classifier", build=None, inputs=inputs, baseline_of=network.name)
    for network, name, inputs in (
        (_RHYTHM, "rhythm-lgbm", {"features": [1, FEATURES]}),
        (_DIABETES, "diabetes-lgbm", {"shapeFeatures": [1, SHAPE_FEATURES]}),
        (_DIABETES, "diabetes-logistic", {"shapeFeatures": [1, SHAPE_FEATURES]}),
    )
)
SPECS = {spec.name: spec for spec in (_SQI, _RHYTHM, _DIABETES, *_BASELINES)}
# The three models scripts/proof/m3.mjs requires; baselines ship only once trained.
REQUIRED = (_SQI.name, _RHYTHM.name, _DIABETES.name)


def release_specs(runs_dir: Path) -> list[ModelSpec]:
    # A baseline joins the release when training has produced it; the networks always belong.
    return [
        spec for spec in SPECS.values() if spec.name in REQUIRED or (runs_dir / spec.source_file).exists()
    ]


def inside_models_dir(path: Path) -> bool:
    # Covers subfolders such as models/staging, which path equality would miss.
    return Path(path).resolve().is_relative_to(MODELS_DIR.resolve())
