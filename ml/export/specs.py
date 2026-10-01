from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Literal

from torch import nn

from nets.diabetes_net import BEAT, HR_SUMMARY, SHAPE_FEATURES, DiabetesNet
from nets.rhythm_net import FEATURES, INTERVALS, LABELS, RhythmNet
from nets.sqi_net import CHANNELS, WINDOW, SqiNet

OPSET = 17
SQI_RULE_FEATURES = 2
ML_ROOT = Path(__file__).resolve().parents[1]
# The repo-root models/ folder the app bundles and scripts/proof/m3.mjs reads.
MODELS_DIR = ML_ROOT.parent / "models"
# Training writes the source model (<stem>.pt or <stem>.pkl) and <stem>.json (metrics) here.
RUNS_DIR = ML_ROOT / "runs"
# A threshold basis other than "all-bad" (every bad window counted when τ is chosen) changes how a spec
# threshold is met, so only the owner can accept it. Each entry records the owner's decision as
# {model name: {"basis": ..., "decision": "<HUMAN_STEPS id and option>"}}. Empty until the owner answers
# H-024 (ADR 0038); export.provenance.check_threshold_bases refuses to ship without it.
OWNER_APPROVED_THRESHOLD_BASES: dict[str, dict[str, str]] = {}
Family = Literal["rhythm", "sqi", "diabetes"]
FAMILIES: tuple[Family, ...] = ("rhythm", "sqi", "diabetes")


class ShipRuleError(Exception):
    pass


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
    family: Family
    # ADR 0031: the app loads only the one shipped model per family; the rest are ablation models.
    ships: bool

    @property
    def file_stem(self) -> str:
        return f"{self.name}@{self.version}"

    @property
    def source_file(self) -> str:
        return f"{self.file_stem}.pt" if self.kind == "torch" else f"{self.file_stem}.pkl"


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
    family="sqi",
    # train.sqi: SQI-Net beat sqi-rule on dev-val AUROC. Diabetes is decided when it trains.
    ships=True,
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
    family="rhythm",
    # ADR 0031: Rhythm-Net did not beat rhythm-lgbm on development subjects; it is the ablation model.
    ships=False,
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
    family="diabetes",
    ships=True,
)
# §11.1–11.4 baselines on the networks' feature inputs, with the same output names, so the app can
# swap one in without code changes. The rhythm logistic rule has no entry: it is compared in training
# (train.rhythm) but never exported. sqi-rule is §11.1's rule SQI without the acquisition checks, which
# need camera frames: a logistic regression on the window's skewness and whether its spectral-peak heart
# rate is in range (train/sqi.py, RULE_FEATURES).
_BASELINES = tuple(
    replace(network, name=name, kind="classifier", build=None, inputs=inputs, ships=ships)
    for network, name, inputs, ships in (
        # SQI-Net beat sqi-rule on development subjects (train.sqi); its threshold basis still waits
        # for the owner (ADR 0038, H-024), which export.provenance enforces.
        (_SQI, "sqi-rule", {"features": [1, SQI_RULE_FEATURES]}, False),
        # ADR 0031: rhythm-lgbm beat Rhythm-Net on development subjects, so it is the v1 rhythm model.
        (_RHYTHM, "rhythm-lgbm", {"features": [1, FEATURES]}, True),
        (_DIABETES, "diabetes-lgbm", {"shapeFeatures": [1, SHAPE_FEATURES]}, False),
        (_DIABETES, "diabetes-logistic", {"shapeFeatures": [1, SHAPE_FEATURES]}, False),
    )
)
SPECS = {spec.name: spec for spec in (_SQI, _RHYTHM, _DIABETES, *_BASELINES)}


def shipped_per_family(models: Iterable[Mapping]) -> dict[str, str]:
    # ADR 0031: exactly one model per family ships. Takes manifest entries or spec summaries with
    # "name", "family", and "ships", and returns family -> shipped model name.
    listed = list(models)
    shipped = {
        family: [entry["name"] for entry in listed if entry["family"] == family and entry["ships"]]
        for family in FAMILIES
    }
    problems = [f"{family}: {names or 'none'}" for family, names in shipped.items() if len(names) != 1]
    if problems:
        raise ShipRuleError("each family needs exactly one shipped model; " + "; ".join(problems))
    return {family: names[0] for family, names in shipped.items()}


# Checked at import, so a spec table that breaks the rule can never be exported.
SHIPPED = shipped_per_family(
    {"name": spec.name, "family": spec.family, "ships": spec.ships} for spec in SPECS.values()
)


def release_specs(runs_dir: Path, untrained_networks: bool = False) -> list[ModelSpec]:
    # A release holds every shipped model plus any other model training has produced (ablations). An
    # untrained pipeline check (--random-init, outside models/) instead takes every network, which needs
    # no training, plus whichever classifiers are trained.
    def belongs(spec: ModelSpec) -> bool:
        if (runs_dir / spec.source_file).exists():
            return True
        return spec.kind == "torch" if untrained_networks else spec.ships

    return [spec for spec in SPECS.values() if belongs(spec)]


def inside_models_dir(path: Path) -> bool:
    # Covers subfolders such as models/staging, which path equality would miss.
    return Path(path).resolve().is_relative_to(MODELS_DIR.resolve())
