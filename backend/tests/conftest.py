import pytest


@pytest.fixture(autouse=True)
def _no_real_mongo(monkeypatch):
    """Tests must never reach a real MongoDB, whatever the developer's shell has exported."""
    monkeypatch.delenv("MONGODB_URI", raising=False)
    monkeypatch.delenv("MONGODB_DB", raising=False)
