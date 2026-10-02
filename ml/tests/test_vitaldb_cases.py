import hashlib
import json

import pandas as pd
import pytest

from datasets import download, vitaldb_cases
from datasets.vitaldb_cases import (
    HoldoutAccessError,
    HoldoutChangedError,
    eligible_cases,
    lock_holdout,
    select_dev_cases,
)


def clinical_table(patients: int = 400, diabetic_every: int = 8) -> pd.DataFrame:
    rows = []
    for subject in range(1, patients + 1):
        rows.append(
            {
                "caseid": subject,
                "subjectid": subject,
                "age": str(20 + subject % 60),
                "sex": "M" if subject % 2 else "F",
                "preop_dm": int(subject % diabetic_every == 0),
            }
        )
    return pd.DataFrame(rows)


def test_eligible_keeps_one_adult_case_per_patient():
    table = pd.concat(
        [
            clinical_table(10),
            pd.DataFrame(
                [
                    {"caseid": 99, "subjectid": 3, "age": "50", "sex": "M", "preop_dm": 0},
                    {"caseid": 100, "subjectid": 200, "age": "12", "sex": "F", "preop_dm": 0},
                    {"caseid": 101, "subjectid": 201, "age": None, "sex": "F", "preop_dm": 0},
                ]
            ),
        ]
    )
    eligible = eligible_cases(table)
    assert eligible["subjectid"].is_unique
    assert 200 not in set(eligible["subjectid"]) and 201 not in set(eligible["subjectid"])
    # The earliest surgery represents a patient seen twice.
    assert eligible.loc[eligible["subjectid"] == 3, "caseid"].item() == 3


def test_holdout_is_a_quarter_of_each_stratum_and_disjoint():
    cases = eligible_cases(clinical_table())
    split = lock_holdout(cases)
    holdout, dev = set(split["holdout"]), set(split["dev"])
    assert holdout.isdisjoint(dev)
    assert holdout | dev == set(cases["subjectid"])
    diabetic = set(cases.loc[cases["preop_dm"] == 1, "subjectid"])
    assert len(holdout & diabetic) == round(len(diabetic) * 0.25)
    assert len(holdout - diabetic) == round(len(set(cases["subjectid"]) - diabetic) * 0.25)


def test_holdout_is_deterministic():
    cases = eligible_cases(clinical_table())
    assert lock_holdout(cases) == lock_holdout(cases.sample(frac=1, random_state=3))


def test_dev_selection_never_touches_holdout_and_caps_controls():
    cases = eligible_cases(clinical_table())
    split = lock_holdout(cases)
    picked = select_dev_cases(cases, split["dev"])
    assert set(picked["subjectid"]).isdisjoint(split["holdout"])
    diabetic = picked[picked["preop_dm"] == 1]
    assert set(diabetic["subjectid"]) == set(cases.loc[cases["preop_dm"] == 1, "subjectid"]) & set(
        split["dev"]
    )
    assert (picked["preop_dm"] == 0).sum() <= vitaldb_cases.CONTROLS_PER_DIABETIC * len(diabetic)


def test_existing_split_file_must_match(tmp_path):
    cases = eligible_cases(clinical_table())
    split_file = tmp_path / "diabetes.json"
    vitaldb_cases.write_or_check_split(lock_holdout(cases), split_file)
    vitaldb_cases.write_or_check_split(lock_holdout(cases), split_file)
    tampered = json.loads(split_file.read_text(encoding="utf-8"))
    tampered["holdout"] = tampered["holdout"][1:]
    split_file.write_text(json.dumps(tampered), encoding="utf-8")
    with pytest.raises(HoldoutChangedError):
        vitaldb_cases.write_or_check_split(lock_holdout(cases), split_file)


def test_case_files_are_the_selected_cases_with_listed_checksums(tmp_path):
    body = b"vital file"
    listing = (
        f"{hashlib.sha256(body).hexdigest()} vital_files/0007.vital\n{'0' * 64} vital_files/0008.vital\n"
    )
    remotes = vitaldb_cases.case_files([7], listing, tmp_path)
    assert [remote.name for remote in remotes] == ["vital_files/0007.vital"]
    assert remotes[0].sha256 == hashlib.sha256(body).hexdigest()


def test_case_missing_from_listing_raises(tmp_path):
    with pytest.raises(KeyError):
        vitaldb_cases.case_files([9], f"{'0' * 64} vital_files/0008.vital\n", tmp_path)


def test_holdout_patients_are_refused():
    split = {"holdout": [5, 9], "dev": [1, 2]}
    vitaldb_cases.ensure_dev_only([1, 2], split)
    with pytest.raises(HoldoutAccessError):
        vitaldb_cases.ensure_dev_only([2, 9], split)


def test_load_split_requires_the_locked_file(tmp_path):
    with pytest.raises(FileNotFoundError):
        vitaldb_cases.load_split(tmp_path / "diabetes.json")
    split = {"holdout": [3], "dev": [4]}
    vitaldb_cases.write_or_check_split(split, tmp_path / "diabetes.json")
    assert vitaldb_cases.load_split(tmp_path / "diabetes.json") == split


def test_holdout_download_needs_the_owner_approval(data_dir):
    with pytest.raises(download.ExternalNotApprovedError):
        vitaldb_cases.main(["--download-holdout"])


def test_holdout_cases_map_by_the_eligible_case_rule():
    clinical = pd.DataFrame(
        {"caseid": [3, 1, 2], "subjectid": [10, 10, 20], "age": ["50", "50", "60"], "preop_dm": [0, 0, 1]}
    )
    # Subject 10 had two surgeries; the eligible-case rule keeps the first case.
    assert vitaldb_cases.holdout_caseids(clinical, [10, 20]) == {10: 1, 20: 2}
    with pytest.raises(vitaldb_cases.HoldoutChangedError):
        vitaldb_cases.holdout_caseids(clinical, [30])


def test_dev_split_is_by_patient_per_stratum_and_never_holds_holdout_patients():
    cases = eligible_cases(clinical_table(patients=800))
    split = lock_holdout(cases)
    picked = select_dev_cases(cases, split["dev"])
    document = vitaldb_cases.split_dev(picked)
    subjects = {int(subject): part for subject, part in document["subjects"].items()}
    assert set(subjects) == set(picked["subjectid"])
    assert set(subjects).isdisjoint(split["holdout"])
    for diabetic in (0, 1):
        stratum = picked.loc[picked["preop_dm"] == diabetic, "subjectid"]
        dev_val_count = sum(subjects[subject] == "dev-val" for subject in stratum)
        assert dev_val_count == round(len(stratum) * vitaldb_cases.DEV_VAL_FRACTION)


def test_dev_split_is_deterministic_and_round_trips(tmp_path):
    cases = eligible_cases(clinical_table())
    picked = select_dev_cases(cases, lock_holdout(cases)["dev"])
    document = vitaldb_cases.split_dev(picked)
    assert vitaldb_cases.split_dev(picked.sample(frac=1, random_state=5)) == document
    split_file = tmp_path / "diabetes-dev.json"
    with pytest.raises(FileNotFoundError):
        vitaldb_cases.load_dev_split(split_file)
    vitaldb_cases.write_or_check_split(document, split_file)
    loaded = vitaldb_cases.load_dev_split(split_file)
    assert loaded == {int(subject): part for subject, part in document["subjects"].items()}
