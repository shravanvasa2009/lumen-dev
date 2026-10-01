import pytest

from datasets import registry
from datasets.registry import Dataset, RemoteFile


def make(**overrides) -> Dataset:
    fields = {
        "key": "demo",
        "title": "Demo",
        "use": "train",
        "method": "url",
        "license": "test",
        "citation": "test",
        "files": (RemoteFile(url="https://example.test/a.zip"),),
    }
    fields.update(overrides)
    return Dataset(**fields)


def test_default_data_root_is_ml_data(monkeypatch):
    monkeypatch.delenv("LUMEN_DATA_DIR", raising=False)
    assert make().local_dir == registry.paths.ML_ROOT / "data" / "open" / "demo"


def test_open_and_external_resolve_to_separate_folders(data_dir):
    assert make(use="dev").local_dir == data_dir / "open" / "demo"
    assert make(use="validation").local_dir == data_dir / "open" / "demo"
    assert make(use="external").local_dir == data_dir / "external" / "demo"


@pytest.mark.parametrize(
    "overrides",
    [
        {"key": "../escape"},
        {"use": "test"},
        {"method": "ftp"},
        {"method": "physionet"},
        {"method": "physionet", "files": (), "physionet_slug": "afdb"},
        {"physionet_slug": "afdb", "physionet_version": "1.0.0"},
        {"files": ()},
        {"files": (RemoteFile(url="https://a.test/x.zip"), RemoteFile(url="https://b.test/x.zip"))},
    ],
)
def test_invalid_records_are_rejected(overrides):
    with pytest.raises(ValueError):
        make(**overrides)


def test_remote_file_name_comes_from_url_path_or_override():
    assert RemoteFile(url="https://zenodo.test/records/1/files/af.mat?download=1").name == "af.mat"
    assert RemoteFile(url="https://figshare.test/ndownloader/files/42", filename="ppg.zip").name == "ppg.zip"


def test_registry_keys_are_unique():
    keys = [dataset.key for dataset in registry.DATASETS]
    assert len(keys) == len(set(keys))


# §11.5: MIMIC PERform AF is the rhythm external test; it must never be reachable through --open.
def test_mimic_perform_af_is_external_only():
    by_key = {dataset.key: dataset for dataset in registry.DATASETS}
    assert by_key["mimic-perform-af"].use == "external"
    shared = [
        remote.url
        for dataset in registry.DATASETS
        if dataset.use != "external"
        for remote in dataset.files
        if "mimic_perform_af" in remote.url
    ]
    assert shared == []


def test_every_url_file_is_verified_by_size_or_sha256():
    unverified = [
        f"{dataset.key}/{remote.name}"
        for dataset in registry.DATASETS
        for remote in dataset.files
        if remote.size is None and remote.sha256 is None
    ]
    assert unverified == []
