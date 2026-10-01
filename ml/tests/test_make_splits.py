import json

import pandas as pd
import pytest

from datasets import make_splits
from datasets.splits import ExternalDataError


def write_intervals(path, subjects_by_dataset: dict[str, list[str]]):
    rows = [
        {"dataset": dataset, "subject": subject, "record": subject, "episode": episode}
        for dataset, subjects in subjects_by_dataset.items()
        for subject in subjects
        for episode in range(3)
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_parquet(path, index=False)


def test_every_dataset_appears_in_both_splits(data_dir, tmp_path):
    source = data_dir / "derived" / "intervals.parquet"
    write_intervals(
        source,
        {
            "afdb": [f"{number:05d}" for number in range(23)],
            "mitdb": [str(number) for number in range(100, 147)],
            "cinc2017": [f"A{number:05d}" for number in range(1, 501)],
        },
    )
    output = tmp_path / "splits" / "rhythm.json"
    make_splits.main(["--output", str(output)])
    written = json.loads(output.read_text(encoding="utf-8"))
    assert written["seed"] == make_splits.SEED
    assert written["val_fraction"] == 0.2
    subjects = written["subjects"]
    assert len(subjects) == 23 + 47 + 500
    for dataset, total in (("afdb", 23), ("mitdb", 47), ("cinc2017", 500)):
        names = [split for key, split in subjects.items() if key.startswith(f"{dataset}:")]
        assert names.count("dev-val") == round(total * 0.2)
        assert names.count("dev-train") == total - round(total * 0.2)
    assert list(subjects) == sorted(subjects)


def test_output_is_reproducible(data_dir, tmp_path):
    write_intervals(data_dir / "derived" / "intervals.parquet", {"mitdb": [str(n) for n in range(100, 147)]})
    first, second = tmp_path / "first.json", tmp_path / "second.json"
    make_splits.main(["--output", str(first)])
    make_splits.main(["--output", str(second)])
    assert first.read_bytes() == second.read_bytes()


def test_same_subject_id_in_two_datasets_stays_distinct(data_dir, tmp_path):
    write_intervals(
        data_dir / "derived" / "intervals.parquet",
        {"afdb": [str(n) for n in range(10)], "ltafdb": [str(n) for n in range(10)]},
    )
    output = tmp_path / "rhythm.json"
    make_splits.main(["--output", str(output)])
    assert len(json.loads(output.read_text(encoding="utf-8"))["subjects"]) == 20


def test_dataset_too_small_to_split_raises(data_dir, tmp_path):
    write_intervals(data_dir / "derived" / "intervals.parquet", {"afdb": ["04015", "04043"]})
    with pytest.raises(ValueError):
        make_splits.main(["--output", str(tmp_path / "rhythm.json")])


def test_intervals_under_external_are_refused(data_dir, tmp_path):
    leaked = data_dir / "external" / "derived" / "intervals.parquet"
    write_intervals(leaked, {"afdb": [str(n) for n in range(10)]})
    with pytest.raises(ExternalDataError):
        make_splits.main(["--intervals", str(leaked), "--output", str(tmp_path / "rhythm.json")])
