import hashlib
import json

import pytest
import requests

from datasets import download, registry
from datasets.download import (
    ChecksumMismatchError,
    ExternalNotApprovedError,
    PhysioNetVersionError,
    fetch_dataset,
)
from datasets.registry import Dataset, RemoteFile

PAYLOAD = bytes(range(256)) * 40
PAYLOAD_SHA = hashlib.sha256(PAYLOAD).hexdigest()
URL = "https://files.test/records/1/files/signals.zip"


class FakeResponse:
    def __init__(self, status_code: int, body: bytes):
        self.status_code = status_code
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code}")

    def iter_content(self, chunk_size):
        for start in range(0, len(self.body), 1000):
            yield self.body[start : start + 1000]


class FakeServer:
    def __init__(self, files: dict[str, bytes], honour_range: bool = True):
        self.files = files
        self.honour_range = honour_range
        self.requests: list[dict] = []

    def get(self, url, headers=None, stream=False, timeout=None):
        headers = headers or {}
        self.requests.append(headers)
        body = self.files[url]
        if "Range" in headers and self.honour_range:
            start = int(headers["Range"].removeprefix("bytes=").rstrip("-"))
            if start >= len(body):
                return FakeResponse(416, b"")
            return FakeResponse(206, body[start:])
        return FakeResponse(200, body)


class NoNetwork:
    def get(self, *args, **kwargs):
        raise AssertionError("no request expected")


def url_dataset(remote: RemoteFile, key: str = "demo-url", use: str = "train") -> Dataset:
    return Dataset(
        key=key, title="Demo", use=use, method="url", license="test", citation="test", files=(remote,)
    )


def physionet_dataset(key: str = "demo-pn", use: str = "train") -> Dataset:
    return Dataset(
        key=key,
        title="Demo PhysioNet",
        use=use,
        method="physionet",
        license="test",
        citation="test",
        physionet_slug="afdb",
        physionet_version="1.0.0",
    )


def test_fresh_download_verifies_and_writes_marker(data_dir):
    dataset = url_dataset(RemoteFile(url=URL, sha256=PAYLOAD_SHA, size=len(PAYLOAD)))
    server = FakeServer({URL: PAYLOAD})
    fetch_dataset(dataset, server)
    assert (dataset.local_dir / "signals.zip").read_bytes() == PAYLOAD
    assert not (dataset.local_dir / "signals.zip.part").exists()
    marker = json.loads((dataset.local_dir / download.MARKER_NAME).read_text(encoding="utf-8"))
    assert marker == download.fingerprint(dataset)
    assert server.requests == [{}]


def test_resume_requests_only_missing_bytes(data_dir):
    dataset = url_dataset(RemoteFile(url=URL, sha256=PAYLOAD_SHA))
    dataset.local_dir.mkdir(parents=True)
    (dataset.local_dir / "signals.zip.part").write_bytes(PAYLOAD[:3000])
    server = FakeServer({URL: PAYLOAD})
    fetch_dataset(dataset, server)
    assert server.requests == [{"Range": "bytes=3000-"}]
    assert (dataset.local_dir / "signals.zip").read_bytes() == PAYLOAD


def test_resume_restarts_when_server_ignores_range(data_dir):
    dataset = url_dataset(RemoteFile(url=URL, sha256=PAYLOAD_SHA))
    dataset.local_dir.mkdir(parents=True)
    (dataset.local_dir / "signals.zip.part").write_bytes(b"stale bytes")
    fetch_dataset(dataset, FakeServer({URL: PAYLOAD}, honour_range=False))
    assert (dataset.local_dir / "signals.zip").read_bytes() == PAYLOAD


def test_complete_partial_with_unknown_size_is_verified_after_416(data_dir):
    dataset = url_dataset(RemoteFile(url=URL, sha256=PAYLOAD_SHA))
    dataset.local_dir.mkdir(parents=True)
    (dataset.local_dir / "signals.zip.part").write_bytes(PAYLOAD)
    fetch_dataset(dataset, FakeServer({URL: PAYLOAD}))
    assert (dataset.local_dir / "signals.zip").read_bytes() == PAYLOAD


def test_partial_with_known_size_skips_request(data_dir):
    dataset = url_dataset(RemoteFile(url=URL, size=len(PAYLOAD)))
    dataset.local_dir.mkdir(parents=True)
    (dataset.local_dir / "signals.zip.part").write_bytes(PAYLOAD)
    fetch_dataset(dataset, NoNetwork())
    assert (dataset.local_dir / "signals.zip").read_bytes() == PAYLOAD


def test_sha256_mismatch_raises_and_drops_partial(data_dir):
    dataset = url_dataset(RemoteFile(url=URL, sha256="0" * 64))
    with pytest.raises(ChecksumMismatchError, match="sha256"):
        fetch_dataset(dataset, FakeServer({URL: PAYLOAD}))
    assert not (dataset.local_dir / "signals.zip").exists()
    assert not (dataset.local_dir / "signals.zip.part").exists()
    assert not (dataset.local_dir / download.MARKER_NAME).exists()


def test_size_mismatch_raises(data_dir):
    dataset = url_dataset(RemoteFile(url=URL, size=len(PAYLOAD) + 1))
    with pytest.raises(ChecksumMismatchError, match="size"):
        fetch_dataset(dataset, FakeServer({URL: PAYLOAD}))


def test_http_error_propagates(data_dir):
    class Failing:
        def get(self, *args, **kwargs):
            return FakeResponse(503, b"")

    with pytest.raises(requests.HTTPError):
        fetch_dataset(url_dataset(RemoteFile(url=URL)), Failing())


def test_completed_dataset_is_skipped(data_dir):
    dataset = url_dataset(RemoteFile(url=URL, sha256=PAYLOAD_SHA))
    fetch_dataset(dataset, FakeServer({URL: PAYLOAD}))
    fetch_dataset(dataset, NoNetwork())


def test_changed_registry_entry_downloads_again(data_dir):
    fetch_dataset(url_dataset(RemoteFile(url=URL)), FakeServer({URL: PAYLOAD}))
    renamed = FakeServer({URL + "?v=2": PAYLOAD})
    fetch_dataset(url_dataset(RemoteFile(url=URL + "?v=2", filename="signals-v2.zip")), renamed)
    assert len(renamed.requests) == 1


def test_physionet_uses_wfdb_into_dataset_dir(data_dir, monkeypatch):
    calls = []
    monkeypatch.setattr(download.wfdb.io.download, "get_version", lambda slug: "1.0.0")
    monkeypatch.setattr(download.wfdb, "dl_database", lambda *args, **kwargs: calls.append((args, kwargs)))
    dataset = physionet_dataset()
    fetch_dataset(dataset, NoNetwork())
    assert calls == [(("afdb", str(data_dir / "open" / "demo-pn")), {"overwrite": False})]
    assert download.is_complete(dataset)


def test_physionet_version_mismatch_raises_before_download(data_dir, monkeypatch):
    monkeypatch.setattr(download.wfdb.io.download, "get_version", lambda slug: "1.0.1")

    def forbidden(*args, **kwargs):
        raise AssertionError("dl_database must not run")

    monkeypatch.setattr(download.wfdb, "dl_database", forbidden)
    with pytest.raises(PhysioNetVersionError):
        fetch_dataset(physionet_dataset(), NoNetwork())


@pytest.fixture
def mixed_registry(monkeypatch):
    entries = (
        url_dataset(RemoteFile(url=URL), key="open-a"),
        url_dataset(RemoteFile(url=URL), key="open-b", use="validation"),
        url_dataset(RemoteFile(url=URL), key="held-out", use="external"),
    )
    monkeypatch.setattr(registry, "DATASETS", entries)
    fetched = []
    monkeypatch.setattr(download, "fetch_dataset", lambda dataset, http: fetched.append(dataset.key))
    return fetched


def test_open_downloads_only_non_external(data_dir, mixed_registry):
    download.main(["--open"])
    assert mixed_registry == ["open-a", "open-b"]


def test_open_only_limits_keys(data_dir, mixed_registry):
    download.main(["--open", "--only", "open-b"])
    assert mixed_registry == ["open-b"]


def test_open_refuses_external_key(data_dir, mixed_registry):
    with pytest.raises(ValueError, match="--external"):
        download.main(["--open", "--only", "held-out"])
    assert mixed_registry == []


def test_unknown_key_raises(data_dir, mixed_registry):
    with pytest.raises(KeyError):
        download.main(["--open", "--only", "nope"])


@pytest.mark.parametrize("approval", [None, "0", "yes"])
def test_external_refuses_without_approval(data_dir, mixed_registry, monkeypatch, approval):
    if approval is not None:
        monkeypatch.setenv("LUMEN_EXTERNAL_APPROVED", approval)
    with pytest.raises(ExternalNotApprovedError):
        download.main(["--external"])
    assert mixed_registry == []


def test_external_runs_with_approval_into_external_dir(data_dir, mixed_registry, monkeypatch):
    monkeypatch.setenv("LUMEN_EXTERNAL_APPROVED", "1")
    download.main(["--external"])
    assert mixed_registry == ["held-out"]
    held_out = next(dataset for dataset in registry.DATASETS if dataset.key == "held-out")
    assert held_out.local_dir == data_dir / "external" / "held-out"


def test_a_mode_flag_is_required(data_dir, mixed_registry):
    with pytest.raises(SystemExit):
        download.main([])
