import argparse
import json
import logging
from collections.abc import Sequence
from pathlib import Path

from datasets import paths
from datasets.splits import assign_splits
from train import butppg

SEED = 20261026
# 30 subjects have finger recordings; 0.3 holds out 9, enough for subject-resampled intervals while
# leaving 21 to train on.
VALIDATION_FRACTION = 0.3
# BUT PPG's first release (subjects 100–111, 4 short-format records each) and the second (from 112, about
# 108 records each, other phones) are split separately, so dev-val holds people from both.
SECOND_RELEASE_FROM = "112"
DEFAULT_OUTPUT = paths.ML_ROOT / "splits" / "sqi.json"

log = logging.getLogger("train.sqi_split")


def split_subjects(subjects: Sequence[str]) -> dict[str, str]:
    assignment: dict[str, str] = {}
    for release in (
        [subject for subject in subjects if subject < SECOND_RELEASE_FROM],
        [subject for subject in subjects if subject >= SECOND_RELEASE_FROM],
    ):
        assignment |= assign_splits(release, VALIDATION_FRACTION, SEED)
    return dict(sorted(assignment.items()))


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m train.sqi_split")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    subjects = sorted(set(butppg.finger_records()["subject"]))
    assignment = split_subjects(subjects)
    document = {
        "seed": SEED,
        "val_fraction": VALIDATION_FRACTION,
        "dataset": "butppg",
        "subjects": assignment,
    }
    args.output.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8", newline="\n")
    log.info("%d finger subjects, %d dev-val", len(assignment), list(assignment.values()).count("dev-val"))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
