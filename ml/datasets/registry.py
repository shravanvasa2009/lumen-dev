import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, get_args
from urllib.parse import urlparse

from datasets import paths

Use = Literal["train", "dev", "external", "validation"]
Method = Literal["physionet", "url"]

# Keys become folder names, so they must not contain separators or "..".
KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


@dataclass(frozen=True)
class RemoteFile:
    url: str
    sha256: str | None = None
    size: int | None = None
    # Figshare download URLs end in a numeric id, so the saved name can be set explicitly.
    filename: str | None = None

    @property
    def name(self) -> str:
        return self.filename or Path(urlparse(self.url).path).name


@dataclass(frozen=True)
class Dataset:
    key: str
    title: str
    use: Use
    method: Method
    license: str
    citation: str
    physionet_slug: str | None = None
    physionet_version: str | None = None
    files: tuple[RemoteFile, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not KEY_PATTERN.match(self.key):
            raise ValueError(f"dataset key {self.key!r} must match {KEY_PATTERN.pattern}")
        if self.use not in get_args(Use):
            raise ValueError(f"{self.key}: use {self.use!r} is not one of {get_args(Use)}")
        if self.method == "physionet":
            if not (self.physionet_slug and self.physionet_version) or self.files:
                raise ValueError(f"{self.key}: physionet datasets need a slug and version and no files")
        elif self.method == "url":
            if not self.files or self.physionet_slug or self.physionet_version:
                raise ValueError(f"{self.key}: url datasets need files and no PhysioNet slug")
            names = [remote.name for remote in self.files]
            if len(set(names)) != len(names) or not all(names):
                raise ValueError(f"{self.key}: every file needs a distinct, non-empty name")
        else:
            raise ValueError(f"{self.key}: method {self.method!r} is not one of {get_args(Method)}")

    @property
    def local_dir(self) -> Path:
        parent = paths.external_dir() if self.use == "external" else paths.open_dir()
        return parent / self.key


# An entry is added only after its license and URLs are checked (workspace ADR 0015).
DATASETS: tuple[Dataset, ...] = ()
