import argparse
import hashlib
import json
import logging
import os
from collections.abc import Sequence
from pathlib import Path

import requests
import wfdb
import wfdb.io.download

from datasets import registry
from datasets.registry import Dataset, RemoteFile

MARKER_NAME = ".lumen-download.json"
CHUNK_BYTES = 1 << 20
# (connect, read) seconds; read is per chunk, not per file.
TIMEOUT_SECONDS = (10, 60)

log = logging.getLogger("datasets.download")


class ChecksumMismatchError(Exception):
    pass


class PhysioNetVersionError(Exception):
    pass


class ExternalNotApprovedError(Exception):
    pass


# The marker stores this, so editing a registry entry (new version, new checksum) forces a fresh download.
def fingerprint(dataset: Dataset) -> dict:
    return {
        "key": dataset.key,
        "method": dataset.method,
        "physionet_slug": dataset.physionet_slug,
        "physionet_version": dataset.physionet_version,
        "files": [
            {"url": remote.url, "name": remote.name, "sha256": remote.sha256, "size": remote.size}
            for remote in dataset.files
        ],
    }


def is_complete(dataset: Dataset) -> bool:
    marker = dataset.local_dir / MARKER_NAME
    if not marker.is_file():
        return False
    return json.loads(marker.read_text(encoding="utf-8")) == fingerprint(dataset)


def write_marker(dataset: Dataset) -> None:
    marker = dataset.local_dir / MARKER_NAME
    marker.write_text(json.dumps(fingerprint(dataset), indent=2), encoding="utf-8")


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(path: Path, remote: RemoteFile) -> None:
    actual_size = path.stat().st_size
    if remote.size is not None and actual_size != remote.size:
        raise ChecksumMismatchError(f"{path.name}: size {actual_size} bytes, expected {remote.size}")
    if remote.sha256 is not None:
        actual_sha = sha256_of(path)
        if actual_sha != remote.sha256.lower():
            raise ChecksumMismatchError(f"{path.name}: sha256 {actual_sha}, expected {remote.sha256}")


def stream_file(remote: RemoteFile, target: Path, session: requests.Session) -> None:
    if target.exists():
        verify_file(target, remote)
        log.info("%s already present and verified", target.name)
        return

    partial = target.with_name(target.name + ".part")
    have = partial.stat().st_size if partial.exists() else 0
    if remote.size is None or have < remote.size:
        headers = {"Range": f"bytes={have}-"} if have else {}
        with session.get(remote.url, headers=headers, stream=True, timeout=TIMEOUT_SECONDS) as response:
            # 416 on a resume means the partial file already holds every byte; verification decides.
            if not (have and response.status_code == 416):
                response.raise_for_status()
                # 206 means the server honoured the Range header; a 200 is the whole file, so start over.
                mode = "ab" if have and response.status_code == 206 else "wb"
                with partial.open(mode) as sink:
                    for chunk in response.iter_content(chunk_size=CHUNK_BYTES):
                        sink.write(chunk)

    if remote.sha256 is None and remote.size is None:
        log.warning("%s has no sha256 or size in the registry; it is not verified", target.name)
    try:
        verify_file(partial, remote)
    except ChecksumMismatchError:
        # A corrupt partial file would be resumed forever, so drop it before reporting the mismatch.
        partial.unlink()
        raise
    partial.replace(target)


def fetch_physionet(dataset: Dataset) -> None:
    # wfdb.dl_database has no version argument: it always fetches the latest release. Refuse to run
    # when that is not the version the license review covered.
    latest = wfdb.io.download.get_version(dataset.physionet_slug)
    if latest != dataset.physionet_version:
        raise PhysioNetVersionError(
            f"{dataset.key}: PhysioNet serves {dataset.physionet_slug} {latest}, "
            f"registry pins {dataset.physionet_version}"
        )
    # With overwrite=False, wfdb skips same-size files and resumes smaller ones.
    wfdb.dl_database(dataset.physionet_slug, str(dataset.local_dir), overwrite=False)


def fetch_dataset(dataset: Dataset, session: requests.Session) -> None:
    if is_complete(dataset):
        log.info("%s: already downloaded and verified, skipping", dataset.key)
        return
    dataset.local_dir.mkdir(parents=True, exist_ok=True)
    log.info("%s: downloading into %s", dataset.key, dataset.local_dir)
    if dataset.method == "physionet":
        fetch_physionet(dataset)
    else:
        for remote in dataset.files:
            stream_file(remote, dataset.local_dir / remote.name, session)
    write_marker(dataset)


def select(external: bool, only: Sequence[str] | None) -> list[Dataset]:
    candidates = [dataset for dataset in registry.DATASETS if (dataset.use == "external") == external]
    if not only:
        return candidates
    by_key = {dataset.key: dataset for dataset in registry.DATASETS}
    unknown = [key for key in only if key not in by_key]
    if unknown:
        raise KeyError(f"unknown dataset keys: {', '.join(unknown)}")
    wrong_group = [key for key in only if by_key[key] not in candidates]
    if wrong_group:
        flag = "--open" if external else "--external"
        raise ValueError(f"{', '.join(wrong_group)} must be downloaded with {flag}")
    return [by_key[key] for key in only]


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m datasets.download")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--open", action="store_true", help="download train, dev, and validation sets")
    group.add_argument("--external", action="store_true", help="download external test sets (owner only)")
    parser.add_argument("--only", nargs="+", metavar="KEY", help="limit to these dataset keys")
    args = parser.parse_args(argv)

    # External test sets are seen once per model version; the owner approves that through need-human.
    if args.external and os.environ.get("LUMEN_EXTERNAL_APPROVED") != "1":
        raise ExternalNotApprovedError(
            "external test sets need the owner's approval: set LUMEN_EXTERNAL_APPROVED=1 after need-human"
        )

    chosen = select(external=args.external, only=args.only)
    if not chosen:
        log.warning("no datasets selected; the registry has %d entries", len(registry.DATASETS))
    with requests.Session() as http:
        for dataset in chosen:
            fetch_dataset(dataset, http)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
