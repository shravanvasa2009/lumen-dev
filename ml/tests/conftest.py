import pytest


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMEN_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("LUMEN_EXTERNAL_APPROVED", raising=False)
    return tmp_path
