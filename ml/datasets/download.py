import argparse
import hashlib
import json
import logging
import os
from collections.abc import Sequence
from pathlib import Path

import requests

from datasets import registry
from datasets.registry import Dataset, RemoteFile

MARKER_NAME = ".lumen-download.json"
PHYSIONET_FILES = "https://physionet.org/files"
CHUNK_BYTES = 1 << 20
# (connect, read) seconds; read is per chunk, not per file.
TIMEOUT_SECONDS = (10, 60)

log = logging.getLogger("datasets.download")


class ChecksumMismatchError(Exception):
    pass


class UnsafeListingError(Exception):
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
        log.info("%s already present", target.name)
        return
    target.parent.mkdir(parents=True, exist_ok=True)

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


# Each PhysioNet release publishes SHA256SUMS.txt listing every file it contains. Using it as the file
# list fetches label CSVs that wfdb.dl_database skips, pins the release through the versioned URL, and
# lets every file be checked by sha256 rather than size alone.
def physionet_listing(dataset: Dataset, session: requests.Session) -> list[RemoteFile]:
    base = f"{PHYSIONET_FILES}/{dataset.physionet_slug}/{dataset.physionet_version}"
    with session.get(f"{base}/SHA256SUMS.txt", timeout=TIMEOUT_SECONDS) as response:
        response.raise_for_status()
        listing = b"".join(response.iter_content(chunk_size=CHUNK_BYTES)).decode("utf-8")
    remotes = []
    for line in listing.splitlines():
        if not line.strip():
            continue
        sha256, listed = line.split(maxsplit=1)
        # sha256sum's binary mode writes "<sha> *<path>"; the star is a flag, not part of the name.
        relative = listed.removeprefix("*")
        # Checked on the resolved local path, so Windows separators ("..\x") and drive letters are caught.
        if not (dataset.local_dir / relative).resolve().is_relative_to(dataset.local_dir.resolve()):
            raise UnsafeListingError(f"{dataset.key}: SHA256SUMS.txt lists {relative!r} outside the dataset")
        remotes.append(RemoteFile(url=f"{base}/{relative}", sha256=sha256, filename=relative))
    return remotes


def fetch_dataset(dataset: Dataset, session: requests.Session) -> None:
    if is_complete(dataset):
        log.info("%s: completed earlier with the same registry entry, skipping", dataset.key)
        return
    dataset.local_dir.mkdir(parents=True, exist_ok=True)
    log.info("%s: downloading into %s", dataset.key, dataset.local_dir)
    remotes = physionet_listing(dataset, session) if dataset.method == "physionet" else dataset.files
    for remote in remotes:
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

    # A deliberate speed bump, not access control: the owner approves each external test through
    # need-human, and only then does a session set this variable.
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
