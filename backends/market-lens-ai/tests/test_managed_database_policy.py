from __future__ import annotations

import pytest
import sqlalchemy as sa
from types import SimpleNamespace
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from web.app.repositories.tenant_db_repository import (
    TenantRepositoryConfigurationError,
    create_tenant_repository_bundle,
)
from web.app.tenant_auth import (
    TenantAuthConfigurationError,
    _session_factory_for_url,
    get_managed_session_factory,
    validate_managed_database_url,
    validate_managed_session_factory,
)
from web.app import tenant_auth as tenant_auth_module


@pytest.fixture(autouse=True)
def _clear_factory_cache():
    _session_factory_for_url.cache_clear()
    yield
    _session_factory_for_url.cache_clear()


def _managed(monkeypatch, url: str, *, sslmode: str | None = None) -> None:
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("DATABASE_URL", url)
    if sslmode is None:
        monkeypatch.delenv("DATABASE_SSLMODE", raising=False)
    else:
        monkeypatch.setenv("DATABASE_SSLMODE", sslmode)


@pytest.mark.parametrize(
    "url",
    [
        "sqlite:///:memory:",
        "mysql+pymysql://user:pass@localhost/app",
    ],
)
def test_managed_identity_factory_rejects_non_postgresql_before_connect(monkeypatch, url):
    _managed(monkeypatch, url)
    with pytest.raises(TenantAuthConfigurationError, match="requires PostgreSQL"):
        get_managed_session_factory()


@pytest.mark.parametrize("sslmode", ["disable", "allow", "prefer"])
def test_managed_identity_factory_rejects_non_enforcing_tls(monkeypatch, sslmode):
    _managed(
        monkeypatch,
        f"postgresql+psycopg2://user:pass@localhost/app?sslmode={sslmode}",
    )
    with pytest.raises(TenantAuthConfigurationError, match="requires PostgreSQL TLS"):
        get_managed_session_factory()


@pytest.mark.parametrize("sslmode", ["require", "verify-ca", "verify-full"])
def test_managed_identity_factory_accepts_required_postgresql_tls(monkeypatch, sslmode):
    _managed(
        monkeypatch,
        f"postgresql+psycopg2://user:pass@localhost/app?sslmode={sslmode}",
    )
    assert validate_managed_database_url(
        f"postgresql+psycopg2://user:pass@localhost/app?sslmode={sslmode}",
        managed_runtime=True,
    ) == sslmode


def test_managed_identity_factory_applies_secure_default_connect_mode(monkeypatch):
    _managed(
        monkeypatch,
        "postgresql+psycopg2://user:pass@localhost/app",
        sslmode="require",
    )
    assert validate_managed_database_url(
        "postgresql+psycopg2://user:pass@localhost/app",
        managed_runtime=True,
    ) == "require"


def test_cached_local_sqlite_factory_cannot_cross_managed_boundary(monkeypatch):
    monkeypatch.delenv("RENDER", raising=False)
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    assert get_managed_session_factory().kw["bind"].dialect.name == "sqlite"

    monkeypatch.setenv("RENDER", "true")
    with pytest.raises(TenantAuthConfigurationError, match="requires PostgreSQL"):
        get_managed_session_factory()


def test_injected_sqlite_session_factory_is_rejected_even_without_probe(monkeypatch):
    _managed(monkeypatch, "postgresql+psycopg2://user:pass@localhost/app?sslmode=require")
    engine = sa.create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    factory = sessionmaker(bind=engine)

    with pytest.raises(
        TenantRepositoryConfigurationError,
        match="database repository is unavailable",
    ):
        create_tenant_repository_bundle(
            "db",
            session_factory=factory,
            verify_connection=False,
        )


def test_injected_postgresql_factory_must_declare_tls(monkeypatch):
    _managed(monkeypatch, "postgresql+psycopg2://user:pass@localhost/app?sslmode=require")
    class FakePostgresEngine:
        dialect = SimpleNamespace(name="postgresql")
        url = make_url(
            "postgresql+psycopg2://user:pass@localhost/app?sslmode=disable"
        )

    monkeypatch.setattr(tenant_auth_module, "Engine", FakePostgresEngine)
    insecure_factory = SimpleNamespace(
        kw={"bind": FakePostgresEngine()}
    )
    with pytest.raises(TenantAuthConfigurationError, match="requires PostgreSQL TLS"):
        validate_managed_session_factory(insecure_factory)


def test_injected_url_claim_alone_cannot_bypass_tls_policy(monkeypatch):
    _managed(monkeypatch, "postgresql+psycopg2://user:pass@localhost/app?sslmode=require")
    class FakePostgresEngine:
        dialect = SimpleNamespace(name="postgresql")
        url = make_url(
            "postgresql+psycopg2://user:pass@localhost/app?sslmode=verify-full"
        )

    monkeypatch.setattr(tenant_auth_module, "Engine", FakePostgresEngine)
    factory = SimpleNamespace(
        kw={"bind": FakePostgresEngine()}
    )
    with pytest.raises(TenantAuthConfigurationError, match="requires PostgreSQL TLS"):
        validate_managed_session_factory(factory)


def test_factory_marked_by_validated_builder_is_allowed_without_connect(monkeypatch):
    _managed(monkeypatch, "postgresql+psycopg2://user:pass@localhost/app?sslmode=require")

    class FakePostgresEngine:
        dialect = SimpleNamespace(name="postgresql")
        url = make_url(
            "postgresql+psycopg2://user:pass@localhost/app?sslmode=verify-full"
        )
        _insight_studio_tls_required = True

    monkeypatch.setattr(tenant_auth_module, "Engine", FakePostgresEngine)
    factory = SimpleNamespace(kw={"bind": FakePostgresEngine()})
    validate_managed_session_factory(factory)
    bundle = create_tenant_repository_bundle(
        "db",
        session_factory=factory,
        verify_connection=False,
    )
    assert bundle.backend == "db"
