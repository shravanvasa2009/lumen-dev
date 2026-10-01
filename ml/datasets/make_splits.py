import argparse
import json
import logging
from collections.abc import Sequence
from pathlib import Path

import pandas as pd

from datasets import paths
from datasets.splits import assign_splits, ensure_not_external

SEED = 20261026
VALIDATION_FRACTION = 0.2
DEFAULT_OUTPUT = paths.ML_ROOT / "splits" / "rhythm.json"

log = logging.getLogger("datasets.make_splits")


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m datasets.make_splits")
    parser.add_argument("--intervals", type=Path, default=None, help="defaults to derived/intervals.parquet")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    source = args.intervals or paths.derived_dir() / "intervals.parquet"
    ensure_not_external(source, "train")

    episodes = pd.read_parquet(source, columns=["dataset", "subject"])
    subjects: dict[str, str] = {}
    # Splitting each dataset separately keeps every dataset in both dev-train and dev-val. Keys carry
    # the dataset because record numbers repeat across PhysioNet databases.
    for dataset, group in episodes.groupby("dataset"):
        split = assign_splits(group["subject"].astype(str), VALIDATION_FRACTION, SEED)
        subjects |= {f"{dataset}:{subject}": name for subject, name in split.items()}
        log.info("%s: %d subjects", dataset, len(split))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    document = {"seed": SEED, "val_fraction": VALIDATION_FRACTION, "subjects": dict(sorted(subjects.items()))}
    args.output.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
    log.info("wrote %s", args.output)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
