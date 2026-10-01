from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from torch import nn

from nets.diabetes_net import BEAT, HR_SUMMARY, SHAPE_FEATURES, DiabetesNet
from nets.rhythm_net import FEATURES, INTERVALS, LABELS, RhythmNet
from nets.sqi_net import CHANNELS, WINDOW, SqiNet

OPSET = 17
ML_ROOT = Path(__file__).resolve().parents[1]
# The repo-root models/ folder the app bundles and scripts/proof/m3.mjs reads.
MODELS_DIR = ML_ROOT.parent / "models"
# Training writes <name>@<version>.pt (a state_dict) and <name>@<version>.json (metrics) here.
RUNS_DIR = ML_ROOT / "runs"


@dataclass(frozen=True)
class ModelSpec:
    name: str
    version: str
    build: Callable[[], nn.Module]
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

    @property
    def file_stem(self) -> str:
        return f"{self.name}@{self.version}"


SPECS = {
    spec.name: spec
    for spec in (
        ModelSpec(
            name="sqi-finger",
            version="1.0.0",
            build=SqiNet,
            inputs={"window": [1, CHANNELS, WINDOW]},
            outputs={"pClean": [1, 1]},
            labels=("clean",),
            threshold_keys=("clean",),
            abstain_below=None,
            external_dataset="mimic-perform-af",
            external_fields=("subjects", "rhythmBiasGapPts", "acceptRateAf", "acceptRateNonAf"),
            size_budget_bytes=200 * 1024,
        ),
        ModelSpec(
            name="rhythm-net",
            version="1.0.0",
            build=RhythmNet,
            inputs={"intervals": [1, INTERVALS], "mask": [1, INTERVALS], "features": [1, FEATURES]},
            outputs={"probs": [1, len(LABELS)]},
            labels=LABELS,
            threshold_keys=("af",),
            abstain_below=0.6,
            external_dataset="mimic-perform-af",
            external_fields=("subjects", "auroc", "sensitivity", "specificity", "ci95", "ppvNpv"),
            size_budget_bytes=500 * 1024,
        ),
        ModelSpec(
            name="diabetes-net",
            version="1.0.0",
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
        ),
    )
}
