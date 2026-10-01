import argparse
import json
import logging
from collections.abc import Iterable, Sequence
from pathlib import Path

import pandas as pd
import requests

from datasets import download, paths, registry
from datasets.registry import RemoteFile
from datasets.splits import assign_splits

# ADR 0014: a quarter of patients, per diabetes stratum, is locked away before any diabetes-net work.
HOLDOUT_FRACTION = 0.25
# More controls than this add little for a ~600-patient positive class and cost ~15 MB per case.
CONTROLS_PER_DIABETIC = 3
SEED = 20260930
SPLIT_FILE = paths.ML_ROOT / "splits" / "diabetes.json"
CASE_FILE = "vital_files/{caseid:04d}.vital"

log = logging.getLogger("datasets.vitaldb_cases")


class HoldoutChangedError(Exception):
    pass


class HoldoutAccessError(Exception):
    pass


def eligible_cases(clinical: pd.DataFrame) -> pd.DataFrame:
    # VitalDB writes ages as text (">89" for the oldest); the digits are enough for an adult cut.
    age_years = pd.to_numeric(clinical["age"].astype("string").str.extract(r"(\d+)")[0], errors="coerce")
    adults = clinical.assign(age_years=age_years)
    adults = adults[(adults["age_years"] >= 18) & adults["preop_dm"].isin([0, 1])]
    # One surgery per patient, so a person can never sit in both the holdout and development sets.
    return adults.sort_values("caseid").drop_duplicates("subjectid").reset_index(drop=True)


def lock_holdout(cases: pd.DataFrame) -> dict[str, list[int]]:
    holdout: list[int] = []
    dev: list[int] = []
    for diabetic, stratum in cases.groupby("preop_dm"):
        split = assign_splits(stratum["subjectid"].astype(str), HOLDOUT_FRACTION, SEED + int(diabetic))
        # assign_splits names its smaller share "dev-val"; here that share is the locked holdout.
        holdout += [int(subject) for subject, part in split.items() if part == "dev-val"]
        dev += [int(subject) for subject, part in split.items() if part == "dev-train"]
    return {"holdout": sorted(holdout), "dev": sorted(dev)}


def select_dev_cases(cases: pd.DataFrame, dev_subjects: Iterable[int]) -> pd.DataFrame:
    dev = cases[cases["subjectid"].isin(set(dev_subjects))]
    # Controls are matched on sex and age decade, so the model can't separate classes by age alone.
    stratum = dev["sex"].astype(str) + (dev["age_years"] // 10).astype(int).astype(str)
    picked = []
    for _, group in dev.groupby(stratum):
        diabetic = group[group["preop_dm"] == 1]
        controls = group[group["preop_dm"] == 0]
        count = min(len(controls), CONTROLS_PER_DIABETIC * len(diabetic))
        picked += [diabetic, controls.sample(count, random_state=SEED)]
    return pd.concat(picked).sort_values("caseid").reset_index(drop=True)


def write_or_check_split(split: dict[str, list[int]], split_file: Path) -> None:
    if split_file.exists():
        locked = json.loads(split_file.read_text(encoding="utf-8"))
        if locked != split:
            raise HoldoutChangedError(f"{split_file} is locked and differs from a fresh computation")
        return
    split_file.parent.mkdir(parents=True, exist_ok=True)
    split_file.write_text(json.dumps(split, indent=1) + "\n", encoding="utf-8")


def ensure_dev_only(subject_ids: Iterable[int], split: dict[str, list[int]]) -> None:
    # The holdout's labels share clinical_data.csv with everyone else, so every reader of VitalDB
    # waveforms or labels for diabetes-net passes through this check (ADR 0014).
    leaked = sorted(set(subject_ids) & set(split["holdout"]))
    if leaked:
        raise HoldoutAccessError(f"{len(leaked)} holdout patients requested, e.g. {leaked[:3]}")


def load_split(split_file: Path = SPLIT_FILE) -> dict[str, list[int]]:
    if not split_file.exists():
        raise FileNotFoundError(f"{split_file} is missing; run python -m datasets.vitaldb_cases first")
    return json.loads(split_file.read_text(encoding="utf-8"))


def case_files(caseids: Sequence[int], listing: str, local_dir: Path) -> list[RemoteFile]:
    by_name = {
        remote.name: remote for remote in download.parse_sha256sums(listing, registry.VITALDB_BASE, local_dir)
    }
    return [by_name[CASE_FILE.format(caseid=caseid)] for caseid in caseids]


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m datasets.vitaldb_cases")
    parser.add_argument("--download", action="store_true", help="fetch the selected development cases")
    args = parser.parse_args(argv)

    vitaldb = next(dataset for dataset in registry.DATASETS if dataset.key == "vitaldb")
    if not download.is_complete(vitaldb):
        raise FileNotFoundError("download the vitaldb tables first: python -m datasets.download --open")
    cases = eligible_cases(pd.read_csv(vitaldb.local_dir / "clinical_data.csv"))
    split = lock_holdout(cases)
    write_or_check_split(split, SPLIT_FILE)
    picked = select_dev_cases(cases, split["dev"])
    ensure_dev_only(picked["subjectid"], split)
    log.info(
        "%d eligible patients; holdout %d; development cases picked: %d diabetic, %d controls",
        len(cases),
        len(split["holdout"]),
        int((picked["preop_dm"] == 1).sum()),
        int((picked["preop_dm"] == 0).sum()),
    )
    if not args.download:
        return
    listing = (vitaldb.local_dir / "SHA256SUMS.txt").read_text(encoding="utf-8")
    with requests.Session() as http:
        for remote in case_files(picked["caseid"].tolist(), listing, vitaldb.local_dir):
            download.stream_file(remote, vitaldb.local_dir / remote.name, http)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
