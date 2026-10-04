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
# NHANES public-use files are US government works (https://www.cdc.gov/nchs/policy/data-release.html); CDC
# publishes no checksums, so the sha256 values are of the files fetched on 2026-10-04.
NHANES_BASE = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public"
NHANES_LICENSE = "Public domain (US government work)"
NHANES_CITATION = "CDC/NCHS. National Health and Nutrition Examination Survey data, 2011-2018. https://www.cdc.gov/nchs/nhanes/"
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
    Dataset(
        key="nhanes",
        title="NHANES 2011-2016 (cycles G, H, I), diabetes questionnaire training",
        use="train",
        method="url",
        files=(
            RemoteFile(
                url=f"{NHANES_BASE}/2011/DataFiles/BMX_G.xpt",
                sha256="4814bfc3047ed400b9d43d285f8c3ea7c940ac6489404a9b699579715d158ec3",
                size=1946720,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2013/DataFiles/BMX_H.xpt",
                sha256="fd5e9fc6e6aab0a4aee6e699f51497bbc9b62101f7f43aee924c473e38fd9442",
                size=2045520,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2015/DataFiles/BMX_I.xpt",
                sha256="d31da84e14212b4e58e8340598a5b8e2144fac83333563e966eb1b332e4141d6",
                size=1989600,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2011/DataFiles/BPQ_G.xpt",
                sha256="39c5a0ee1d76e6f3df867c0057986a21f4a028038002c43214c5af8bdec83cae",
                size=743920,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2013/DataFiles/BPQ_H.xpt",
                sha256="aa6ddeab80c73b074ccfd04ad010da404ecb91c048476a194594ce9552d03d49",
                size=726720,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2015/DataFiles/BPQ_I.xpt",
                sha256="7f7e51cd0497eb648f64eaafaf7ed07825d617c32b2cd6853ed249fce1143a38",
                size=559120,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2011/DataFiles/DEMO_G.xpt",
                sha256="eaf0525d1952626885af3e935415a1f66ad62c18698080e7354789c125af252d",
                size=3753760,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2013/DataFiles/DEMO_H.xpt",
                sha256="f8f0cbb3085a323d4cde22349b164878fea1e64dbc404e65b5815c7816b547d7",
                size=3833200,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2015/DataFiles/DEMO_I.xpt",
                sha256="c9297c6c37ae8f78f29be9568fa2a03cf3b112616a39afee04030fc775a66a0d",
                size=3756480,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2011/DataFiles/DIQ_G.xpt",
                sha256="a9d5475e0cd66d6a7bc30230345ed0172a9abcbc0a7a4145a35025c827a52a87",
                size=3978560,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2013/DataFiles/DIQ_H.xpt",
                sha256="c74c7ccef65e6997dfac1db1e73bc3f63dec67c70b2e322ffc14f14ce27429a9",
                size=4228960,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2015/DataFiles/DIQ_I.xpt",
                sha256="e87587479b29f175b63eee5dd40d582837e3e3fe2665503012085eefdb978e0d",
                size=4144720,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2011/DataFiles/GHB_G.xpt",
                sha256="8ff7cc95461fdfd47d2c9640b944a2bcd45926a3c0e64c98a09a4cef6c0f88d7",
                size=105840,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2013/DataFiles/GHB_H.xpt",
                sha256="0695894ad55ac96f315a8415401977b0856c402d16762115b534bcd5dfeae89e",
                size=112720,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2015/DataFiles/GHB_I.xpt",
                sha256="e4bc626cd12f6057c7806aef4f85874c9bf1407a7480d6621a4af142260addd2",
                size=108960,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2011/DataFiles/GLU_G.xpt",
                sha256="e9c3816dbdfc21cd53a23d63c3610d2550662ee41a21df0a5b72c4a16cd1a8fd",
                size=209200,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2013/DataFiles/GLU_H.xpt",
                sha256="8aa3a41a8135eea6ad761bf7711ec18b29698d76aca3ae8fe487ef89ec9631da",
                size=161440,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2015/DataFiles/GLU_I.xpt",
                sha256="3a52f14346060819c79faa8d646c1dfc33d5a85c1df13d23e10aa4fff0d1bb87",
                size=103440,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2011/DataFiles/MCQ_G.xpt",
                sha256="7538eb86c72b81fd5e76b56120fcb068ed38149d44650e9e750670ad58658d52",
                size=6905520,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2013/DataFiles/MCQ_H.xpt",
                sha256="5c83210e6e1fe929282621322ed0f94d95cdb0a37ccaff36f703ab0b2e7b9dc6",
                size=7439280,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2015/DataFiles/MCQ_I.xpt",
                sha256="8b2bd62f5bcd5820d6aac380e4bad233d22ecab42fcf4a3a9a023ffc6b9f4002",
                size=6907360,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2011/DataFiles/PAQ_G.xpt",
                sha256="6b56874f6c3af191aebcb10316c028bc1ae1d4f89d0aafc00cc080c9f533b32a",
                size=1533680,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2013/DataFiles/PAQ_H.xpt",
                sha256="fa35acbb489594e8e55350f7402a12b5a607805c28ec16246929d33237bd3269",
                size=7297920,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2015/DataFiles/PAQ_I.xpt",
                sha256="c508dc563a907b2fcd05048f37008197257a3e1c6eb64563623c60459c1afc9d",
                size=6973680,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2011/DataFiles/RHQ_G.xpt",
                sha256="2433723ab21c589d51a41811bde25723726c9e928f312505c4ffb06fa81281e0",
                size=1539200,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2013/DataFiles/RHQ_H.xpt",
                sha256="d8f2f2a8bacf3e8d260094ed5a4f974af05cd51865c2fffa1275d325ad46063d",
                size=1338640,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2015/DataFiles/RHQ_I.xpt",
                sha256="471c93fc2d27f8e9aad1a5a2ed235f43b02973cbc88fd2d0b058b2ee40ee317c",
                size=1284560,
            ),
        ),
        license=NHANES_LICENSE,
        citation=NHANES_CITATION,
    ),
    Dataset(
        key="nhanes-2017",
        title="NHANES 2017-2018 (cycle J), diabetes questionnaire held-out test",
        use="validation",
        method="url",
        files=(
            RemoteFile(
                url=f"{NHANES_BASE}/2017/DataFiles/BMX_J.xpt",
                sha256="8d675e42d8826ac98714b2c3dd4c5138a5e353fb4424f7eff5e6db4a01ce838a",
                size=1466000,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2017/DataFiles/BPQ_J.xpt",
                sha256="63cfe1c331a1e7d3534328ac86312a21ffee3e01aa189bc1f74d06855239e5aa",
                size=544560,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2017/DataFiles/DEMO_J.xpt",
                sha256="c0b46e0345ea19404928656277c8b0d10b0cca348a9b2fe4fc3c67e8b7ee73ec",
                size=3412720,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2017/DataFiles/DIQ_J.xpt",
                sha256="1ecbf5360dfc331d1efbf32198553dc30e9a1f4cff0a907ed30ca72bac797f89",
                size=3851840,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2017/DataFiles/GHB_J.xpt",
                sha256="35f07094573a0061a03ed609a5a363b34eb1b1c7065d1623b43d72e132a8a654",
                size=103520,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2017/DataFiles/GLU_J.xpt",
                sha256="5b38897d0d7bfbc69dd9ca74ffdaf2f6a9bed5a91d4a7bf46e07f1332cc3379e",
                size=98480,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2017/DataFiles/MCQ_J.xpt",
                sha256="79c50c805a377fcd61d44fae8b86a16af0a5741f8b1aeebda918d7d743c68f98",
                size=5420800,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2017/DataFiles/PAQ_J.xpt",
                sha256="048120aa3a5c8b5cd457ad3e13dfd62d728b12ea6644960e933ad374ec907e79",
                size=799600,
            ),
            RemoteFile(
                url=f"{NHANES_BASE}/2017/DataFiles/RHQ_J.xpt",
                sha256="c919896216154ea207470dd84e428f5fdd65ced39735148c78fb6032e0b77a7b",
                size=1242960,
            ),
        ),
        license=NHANES_LICENSE,
        citation=NHANES_CITATION,
    ),
)
