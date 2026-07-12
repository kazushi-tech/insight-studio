from __future__ import annotations

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.platform_db import (
    PlatformDatabaseUnavailable,
    assert_database_ready,
    get_platform_engine,
    reset_platform_engine_for_tests,
)


@pytest.fixture(autouse=True)
def _reset_engine():
    reset_platform_engine_for_tests()
    yield
    reset_platform_engine_for_tests()


def test_missing_database_has_no_file_fallback(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("DATA_ROOT", str(tmp_path))

    with pytest.raises(PlatformDatabaseUnavailable):
        assert_database_ready()
    assert list(tmp_path.iterdir()) == []


def test_production_rejects_sqlite(monkeypatch, tmp_path):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'platform.db'}")

    with pytest.raises(PlatformDatabaseUnavailable, match="PostgreSQL"):
        get_platform_engine()
    assert not (tmp_path / "platform.db").exists()


def test_production_rejects_postgres_without_tls(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://user:pass@db.example.invalid/app")
    monkeypatch.setenv("DATABASE_SSLMODE", "disable")

    with pytest.raises(PlatformDatabaseUnavailable, match="TLS"):
        get_platform_engine()


def test_local_sqlite_is_readiness_testable_without_create_all(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")

    assert_database_ready()
    assert get_platform_engine().dialect.name == "sqlite"
