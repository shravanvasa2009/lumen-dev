import os
from pathlib import Path

ML_ROOT = Path(__file__).resolve().parents[1]


def data_root() -> Path:
    # Read on every call so a changed LUMEN_DATA_DIR (or a test's monkeypatch) takes effect.
    configured = os.environ.get("LUMEN_DATA_DIR")
    return Path(configured) if configured else ML_ROOT / "data"


def open_dir() -> Path:
    return data_root() / "open"


def external_dir() -> Path:
    return data_root() / "external"
