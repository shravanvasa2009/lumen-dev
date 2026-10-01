import argparse
import json
import logging
import os
from collections.abc import Iterable, Sequence
from pathlib import Path

import pandas as pd
import requests

from datasets import download, paths, registry
from datasets.registry import RemoteFile
from datasets.splits import Split, assign_splits

# ADR 0014: a quarter of patients, per diabetes stratum, is locked away before any diabetes-net work.
HOLDOUT_FRACTION = 0.25
# More controls than this add little for a ~600-patient positive class and cost ~15 MB per case.
CONTROLS_PER_DIABETIC = 3
SEED = 20260930
SPLIT_FILE = paths.ML_ROOT / "splits" / "diabetes.json"
# §11.4: development patients split again by patient, per diabetes stratum, into dev-train and dev-val
# (threshold, early stopping, model choice). Same share as the rhythm and SQI splits.
DEV_VAL_FRACTION = 0.2
DEV_SEED = SEED + 2
DEV_SPLIT_FILE = paths.ML_ROOT / "splits" / "diabetes-dev.json"
CASE_FILE = "vital_files/{caseid:04d}.vital"
# ADR 0014 amendment: holdout .vital files live under external/, where ensure_not_external blocks every
# training and tuning loader, and are downloaded only in the owner's approval step (ADR 0045).
HOLDOUT_KEY = "vitaldb-holdout"

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


def split_dev(picked: pd.DataFrame) -> dict:
    subjects: dict[str, Split] = {}
    for diabetic, stratum in picked.groupby("preop_dm"):
        subjects |= assign_splits(
            stratum["subjectid"].astype(str), DEV_VAL_FRACTION, DEV_SEED + int(diabetic)
        )
    ordered = dict(sorted(subjects.items(), key=lambda item: int(item[0])))
    return {"seed": DEV_SEED, "val_fraction": DEV_VAL_FRACTION, "subjects": ordered}


def write_or_check_split(split: dict, split_file: Path) -> None:
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


def holdout_caseids(clinical: pd.DataFrame, holdout: Sequence[int]) -> dict[int, int]:
    # Subject to case by the same one-surgery-per-patient rule that locked the holdout; no label value is
    # used or returned.
    cases = eligible_cases(clinical)
    by_subject = dict(zip(cases["subjectid"].astype(int), cases["caseid"].astype(int), strict=True))
    missing = [subject for subject in holdout if subject not in by_subject]
    if missing:
        raise HoldoutChangedError(
            f"{len(missing)} holdout patients have no eligible case, e.g. {missing[:3]}"
        )
    return {subject: by_subject[subject] for subject in holdout}


def holdout_case_path(caseid: int) -> Path:
    return paths.external_dir() / HOLDOUT_KEY / CASE_FILE.format(caseid=caseid)


def load_dev_split(split_file: Path = DEV_SPLIT_FILE) -> dict[int, Split]:
    if not split_file.exists():
        raise FileNotFoundError(f"{split_file} is missing; run python -m datasets.vitaldb_cases first")
    subjects = json.loads(split_file.read_text(encoding="utf-8"))["subjects"]
    return {int(subject): part for subject, part in subjects.items()}


def case_files(caseids: Sequence[int], listing: str, local_dir: Path) -> list[RemoteFile]:
    by_name = {
        remote.name: remote for remote in download.parse_sha256sums(listing, registry.VITALDB_BASE, local_dir)
    }
    return [by_name[CASE_FILE.format(caseid=caseid)] for caseid in caseids]


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m datasets.vitaldb_cases")
    parser.add_argument("--download", action="store_true", help="fetch the selected development cases")
    parser.add_argument(
        "--download-holdout", action="store_true", help="fetch the locked holdout cases (owner, ADR 0045)"
    )
    args = parser.parse_args(argv)
    # The same speed bump as datasets.download --external: only after the owner approves the external test.
    if args.download_holdout and os.environ.get("LUMEN_EXTERNAL_APPROVED") != "1":
        raise download.ExternalNotApprovedError(
            "the holdout needs the owner's approval: set LUMEN_EXTERNAL_APPROVED=1 after need-human"
        )

    vitaldb = next(dataset for dataset in registry.DATASETS if dataset.key == "vitaldb")
    if not download.is_complete(vitaldb):
        raise FileNotFoundError("download the vitaldb tables first: python -m datasets.download --open")
    cases = eligible_cases(pd.read_csv(vitaldb.local_dir / "clinical_data.csv"))
    split = lock_holdout(cases)
    write_or_check_split(split, SPLIT_FILE)
    if args.download_holdout:
        listing = (vitaldb.local_dir / "SHA256SUMS.txt").read_text(encoding="utf-8")
        target = paths.external_dir() / HOLDOUT_KEY
        caseids = list(holdout_caseids(cases, split["holdout"]).values())
        with requests.Session() as http:
            for remote in case_files(caseids, listing, target):
                download.stream_file(remote, target / remote.name, http)
        return
    picked = select_dev_cases(cases, split["dev"])
    ensure_dev_only(picked["subjectid"], split)
    write_or_check_split(split_dev(picked), DEV_SPLIT_FILE)
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
