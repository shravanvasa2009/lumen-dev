import os

import pytest

from datasets.splits import ExternalDataError, assign_splits, ensure_not_external

SUBJECTS = [f"s{number:03d}" for number in range(50)]


def test_split_is_deterministic_and_order_independent():
    first = assign_splits(SUBJECTS, val_fraction=0.2, seed=7)
    again = assign_splits(list(reversed(SUBJECTS)) + SUBJECTS[:5], val_fraction=0.2, seed=7)
    assert first == again


def test_split_covers_every_subject_once_with_requested_size():
    split = assign_splits(SUBJECTS + SUBJECTS, val_fraction=0.2, seed=7)
    assert sorted(split) == SUBJECTS
    validation = {subject for subject, name in split.items() if name == "dev-val"}
    train = {subject for subject, name in split.items() if name == "dev-train"}
    assert len(validation) == 10
    assert validation.isdisjoint(train)
    assert validation | train == set(SUBJECTS)


def test_different_seed_changes_split():
    assert assign_splits(SUBJECTS, 0.2, seed=1) != assign_splits(SUBJECTS, 0.2, seed=2)


@pytest.mark.parametrize("fraction", [0.0, 1.0, -0.1, 0.01])
def test_split_refuses_empty_side(fraction):
    with pytest.raises(ValueError):
        assign_splits(SUBJECTS, val_fraction=fraction, seed=0)


def test_guard_rejects_external_paths(data_dir):
    external_file = data_dir / "external" / "mimic-af" / "p01.csv"
    with pytest.raises(ExternalDataError):
        ensure_not_external(external_file, "train")
    sneaky = data_dir / "open" / ".." / "external" / "mimic-af" / "p01.csv"
    with pytest.raises(ExternalDataError):
        ensure_not_external(sneaky, "tune")


@pytest.mark.skipif(os.name != "nt", reason="Windows paths are case-insensitive")
def test_guard_ignores_case_on_windows(data_dir):
    with pytest.raises(ExternalDataError):
        ensure_not_external(data_dir / "EXTERNAL" / "x.csv", "train")


def test_guard_allows_open_paths(data_dir):
    ensure_not_external(data_dir / "open" / "afdb" / "04015.dat", "train")
    ensure_not_external(data_dir / "external-notes.txt", "tune")
