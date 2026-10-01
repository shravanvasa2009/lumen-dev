import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, get_args
from urllib.parse import urlparse

from datasets import paths

Use = Literal["train", "dev", "external", "validation"]
Method = Literal["physionet", "url"]

PHYSIONET_ORG = "https://physionet.org/files"
# PhysioNet's open-data mirror on AWS, listed on each project page as
# "aws s3 sync --no-sign-request s3://physionet-open/<slug>/<version>/". It served about 11.7 MB/s against
# about 56 KB/s from physionet.org on 2026-09-30; the owner approved using it the same day.
PHYSIONET_MIRROR = "https://physionet-open.s3.amazonaws.com"

VITALDB_BASE = f"{PHYSIONET_MIRROR}/vitaldb/1.0.0"

# Keys become folder names, so they must not contain separators or "..".
KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


@dataclass(frozen=True)
class RemoteFile:
    url: str
    sha256: str | None = None
    size: int | None = None
    # Figshare download URLs end in a numeric id, so the saved name can be set explicitly.
    filename: str | None = None
    # Tried only when url answers 404; the bytes are verified against the same sha256 or size.
    fallback_url: str | None = None

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
    # Not every project is mirrored (bidmc is missing from the AWS bucket), so the host is per dataset.
    physionet_base: str = PHYSIONET_MIRROR
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


ZENODO_MIMIC_PERFORM = "https://zenodo.org/records/15906524/files"
ODC_BY = "Open Data Commons Attribution License v1.0"
ODBL = "Open Database License (ODC-ODbL) v1.0"
MIMIC_PERFORM_CITATION = (
    "Charlton PH et al. Detecting beats in the photoplethysmogram: benchmarking open-source algorithms. "
    "Physiol Meas 2022. doi:10.1088/1361-6579/ac826d; dataset doi:10.5281/zenodo.15906524"
)

# An entry is added only after its license and URLs are checked (workspace ADR 0015, 2026-09-30).
# Verification is as strong as each source allows: PhysioNet releases with SHA256SUMS.txt get sha256 per
# file; challenge-2017 publishes no SHA256SUMS.txt and Zenodo publishes md5 only, so those files (and the
# VitalDB SHA256SUMS.txt itself) are checked by exact size.
DATASETS: tuple[Dataset, ...] = (
    Dataset(
        key="butppg",
        title="Brno University of Technology Smartphone PPG Database 2.0.0",
        use="train",
        method="physionet",
        physionet_slug="butppg",
        physionet_version="2.0.0",
        license="Creative Commons Attribution 4.0 International",
        citation="Nemcova A et al. BUT PPG (version 2.0.0). PhysioNet (2024). doi:10.13026/tn53-8153",
    ),
    Dataset(
        key="afdb",
        title="MIT-BIH Atrial Fibrillation Database 1.0.0",
        use="train",
        method="physionet",
        physionet_slug="afdb",
        physionet_version="1.0.0",
        license=ODC_BY,
        citation="Moody GB, Mark RG. Computers in Cardiology 10:227-230 (1983). doi:10.13026/C2MW2D",
    ),
    Dataset(
        key="ltafdb",
        title="Long-Term AF Database 1.0.0",
        use="train",
        method="physionet",
        physionet_slug="ltafdb",
        physionet_version="1.0.0",
        license=ODC_BY,
        citation="Petrutiu S, Sahakian AV, Swiryn S. Europace 9:466-470 (2007). PhysioNet",
    ),
    Dataset(
        key="mitdb",
        title="MIT-BIH Arrhythmia Database 1.0.0",
        use="train",
        method="physionet",
        physionet_slug="mitdb",
        physionet_version="1.0.0",
        license=ODC_BY,
        citation="Moody GB, Mark RG. IEEE Eng Med Biol 20(3):45-50 (2001). doi:10.13026/C2F305",
    ),
    # Only the training set and its final labels are needed, not the 1.4 GB project archive.
    Dataset(
        key="cinc2017",
        title="PhysioNet/CinC Challenge 2017 1.0.0",
        use="train",
        method="url",
        files=(
            RemoteFile(url=f"{PHYSIONET_MIRROR}/challenge-2017/1.0.0/training2017.zip", size=99226822),
            RemoteFile(url=f"{PHYSIONET_MIRROR}/challenge-2017/1.0.0/REFERENCE-v3.csv", size=76752),
        ),
        license=ODC_BY,
        citation="Clifford GD et al. CinC 2017. doi:10.22489/CinC.2017.065-469",
    ),
    Dataset(
        key="bidmc",
        title="BIDMC PPG and Respiration Dataset 1.0.0",
        use="validation",
        method="physionet",
        physionet_slug="bidmc",
        physionet_version="1.0.0",
        physionet_base=PHYSIONET_ORG,
        license=ODC_BY,
        citation="Pimentel MAF et al. IEEE TBME 64(8):1914-1923 (2016). doi:10.13026/C2208R",
    ),
    Dataset(
        key="mimic-perform-large-test",
        title="MIMIC PERform Large Testing (Zenodo 2.0)",
        use="validation",
        method="url",
        files=(RemoteFile(url=f"{ZENODO_MIMIC_PERFORM}/mimic_perform_large_test_a_data.mat", size=53055305),),
        license=ODBL,
        citation=MIMIC_PERFORM_CITATION,
    ),
    # Only the clinical tables here; the per-case .vital files are chosen from them, never the 94 GB set.
    Dataset(
        key="vitaldb",
        title="VitalDB 1.0.0 (PhysioNet mirror)",
        use="train",
        method="url",
        files=(
            RemoteFile(
                url=f"{VITALDB_BASE}/clinical_data.csv",
                sha256="7d6edb471e5eee3fde75e417084240c97bdbf6eff41cbd61e5dace44f1585ecf",
                size=2199588,
            ),
            RemoteFile(
                url=f"{VITALDB_BASE}/clinical_parameters.csv",
                sha256="3fd13678a26629df5f1352c2a3fa2951e731d3760b8fa47c06c9ac3fbcef2e35",
                size=3258,
            ),
            RemoteFile(
                url=f"{VITALDB_BASE}/track_names.csv",
                sha256="31c431642f91153461724375c05309d251ea63f206f3aeaed782ea4b9817400c",
                size=10440,
            ),
            RemoteFile(url=f"{VITALDB_BASE}/SHA256SUMS.txt", size=562636),
        ),
        license="Creative Commons Attribution 4.0 International",
        citation="Lee H-C, Jung C-W. VitalDB (version 1.0.0). PhysioNet (2022). doi:10.13026/czw8-9p62",
    ),
    Dataset(
        key="mimic-perform-af",
        title="MIMIC PERform AF (Zenodo 2.0), rhythm external test",
        use="external",
        method="url",
        files=(
            RemoteFile(url=f"{ZENODO_MIMIC_PERFORM}/mimic_perform_af_wfdb.zip", size=11874261),
            RemoteFile(url=f"{ZENODO_MIMIC_PERFORM}/mimic_perform_non_af_wfdb.zip", size=10176150),
        ),
        license=ODBL,
        citation=MIMIC_PERFORM_CITATION,
    ),
)
