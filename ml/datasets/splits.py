from collections.abc import Iterable
from pathlib import Path
from typing import Literal

import numpy as np

from datasets import paths

Split = Literal["dev-train", "dev-val"]
Purpose = Literal["train", "tune"]


class ExternalDataError(Exception):
    pass


def assign_splits(subject_ids: Iterable[str], val_fraction: float, seed: int) -> dict[str, Split]:
    if not 0 < val_fraction < 1:
        raise ValueError(f"val_fraction must be between 0 and 1, got {val_fraction}")
    # Sorting first makes the split depend only on the set of subjects, not on record order.
    subjects = sorted(set(subject_ids))
    val_count = round(len(subjects) * val_fraction)
    if val_count == 0 or val_count == len(subjects):
        raise ValueError(
            f"{len(subjects)} subjects at val_fraction {val_fraction} leaves dev-train or dev-val empty"
        )
    order = np.random.default_rng(seed).permutation(len(subjects))
    val_positions = set(order[:val_count].tolist())
    return {
        subject: ("dev-val" if position in val_positions else "dev-train")
        for position, subject in enumerate(subjects)
    }


def ensure_not_external(path: Path, purpose: Purpose) -> None:
    # resolve() follows symlinks and "..", so a link into external/ is caught too.
    if Path(path).resolve().is_relative_to(paths.external_dir().resolve()):
        raise ExternalDataError(
            f"{path} is an external test file and must never be used to {purpose} a model"
        )
