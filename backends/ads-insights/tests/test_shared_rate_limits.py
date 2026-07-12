from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from starlette.requests import Request


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("APP_PASSWORD", "test-secret-pw-42")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx")
os.environ.setdefault("DATA_PROVIDER", "mock")
os.environ.setdefault(
    "RATE_LIMIT_HASH_SECRET",
    "rate-limit-test-secret-longer-than-thirty-two-bytes",
)

from web.app import backend_api as api  # noqa: E402
from web.app.platform.rate_limits import (  # noqa: E402
    RateLimitUnavailable,
    SharedRateLimitStore,
    hash_rate_limit_subject,
)
from web.app.platform.schema import rate_limit_buckets  # noqa: E402
from web.app.platform_db import PlatformDatabaseUnavailable  # noqa: E402


NOW = datetime(2026, 7, 12, 6, 0, 30, tzinfo=timezone.utc)


@pytest.fixture()
def rate_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    rate_limit_buckets.create(engine)
    yield engine
    engine.dispose()


def _store(engine, now: datetime = NOW) -> SharedRateLimitStore:
    return SharedRateLimitStore(
        engine_provider=lambda: engine,
        now_provider=lambda: now,
    )


def test_fixed_window_is_shared_across_store_instances_and_cold_starts(rate_engine):
    subject_hash = hash_rate_limit_subject("case:customer-a")
    first_instance = _store(rate_engine)
    cold_started_instance = _store(rate_engine)

    first = first_instance.consume(
        subject_hash=subject_hash,
        route_key="POST:/api/bq/generate",
        limit=2,
        window_seconds=60,
    )
    second = cold_started_instance.consume(
        subject_hash=subject_hash,
        route_key="POST:/api/bq/generate",
        limit=2,
        window_seconds=60,
    )
    blocked = first_instance.consume(
        subject_hash=subject_hash,
        route_key="POST:/api/bq/generate",
        limit=2,
        window_seconds=60,
    )

    assert first.request_count == 1 and first.allowed is True
    assert second.request_count == 2 and second.allowed is True
    assert blocked.request_count == 3 and blocked.allowed is False
    assert blocked.retry_after_seconds == 30


def test_routes_have_independent_atomic_counters(rate_engine):
    store = _store(rate_engine)
    subject_hash = hash_rate_limit_subject("clerk:user-a:org-a")

    generate = store.consume(
        subject_hash=subject_hash,
        route_key="POST:/api/bq/generate",
        limit=1,
        window_seconds=60,
    )
    batch = store.consume(
        subject_hash=subject_hash,
        route_key="POST:/api/bq/generate_batch",
        limit=1,
        window_seconds=60,
    )

    assert generate.allowed is True
    assert batch.allowed is True


def test_subject_is_hmaced_before_persistence(rate_engine):
    raw_subject = "ip:203.0.113.42"
    subject_hash = hash_rate_limit_subject(raw_subject)
    _store(rate_engine).consume(
        subject_hash=subject_hash,
        route_key="POST:/api/cases/login",
        limit=5,
        window_seconds=60,
    )

    with rate_engine.connect() as connection:
        stored = connection.execute(
            sa.select(rate_limit_buckets.c.subject_hash)
        ).scalar_one()

    assert stored == subject_hash
    assert len(stored) == 64
    assert raw_subject not in stored


def test_expired_buckets_are_cleaned_during_next_atomic_consume(rate_engine):
    expired_at = NOW - timedelta(seconds=1)
    with rate_engine.begin() as connection:
        connection.execute(
            sa.insert(rate_limit_buckets).values(
                id="expired",
                workspace_id=None,
                subject_hash="a" * 64,
                route_key="POST:/api/old",
                window_start=NOW - timedelta(minutes=2),
                window_seconds=60,
                request_count=9,
                expires_at=expired_at,
                updated_at=expired_at,
            )
        )

    _store(rate_engine).consume(
        subject_hash="b" * 64,
        route_key="POST:/api/new",
        limit=5,
        window_seconds=60,
    )

    with rate_engine.connect() as connection:
        route_keys = set(connection.execute(
            sa.select(rate_limit_buckets.c.route_key)
        ).scalars())
    assert route_keys == {"POST:/api/new"}


def test_database_failure_is_not_replaced_by_memory_or_file_fallback():
    def unavailable_engine():
        raise PlatformDatabaseUnavailable("do not expose this detail")

    store = SharedRateLimitStore(engine_provider=unavailable_engine)
    with pytest.raises(RateLimitUnavailable, match="database is unavailable"):
        store.consume(
            subject_hash="a" * 64,
            route_key="POST:/api/cases/login",
            limit=1,
            window_seconds=60,
        )


def _request(*, token: str = "", client: str = "203.0.113.8", client_id: str = "") -> Request:
    headers = []
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode("ascii")))
    if client_id:
        headers.append((b"x-client-id", client_id.encode("ascii")))
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/api/bq/generate",
        "headers": headers,
        "client": (client, 12345),
        "server": ("test", 80),
        "scheme": "http",
        "query_string": b"",
    })


def test_legacy_and_clerk_subjects_ignore_client_controlled_id(monkeypatch):
    token = api._generate_case_auth_token({
        "case_id": "case-a",
        "dataset_id": "dataset-a",
    })
    assert api._get_rate_limit_subject(
        _request(token=token, client_id="rotated-a")
    ) == api._get_rate_limit_subject(
        _request(token=token, client_id="rotated-b")
    ) == "case:case-a"

    monkeypatch.setattr(
        api,
        "verified_clerk_subject_material",
        lambda value: "clerk:user-a:org-a" if value == "clerk-token" else None,
    )
    assert api._get_rate_limit_subject(
        _request(token="clerk-token", client_id="attacker")
    ) == "clerk:user-a:org-a"


@pytest.mark.anyio
async def test_legacy_login_uses_its_bounded_local_limiter_without_platform_database(monkeypatch):
    def unavailable(**_kwargs):
        raise RateLimitUnavailable("postgres host and password must not leak")

    monkeypatch.setattr(api, "consume_rate_limit", unavailable)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/api/auth/login",
            json={"password": os.environ["APP_PASSWORD"]},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["token"]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/projects/project-a/members"),
        ("POST", "/api/projects/project-a/invite"),
        ("POST", "/api/projects/project-a/reports"),
        ("POST", "/api/projects/project-a/reports/import"),
        ("POST", "/api/projects/project-a/reports/report-a/questions"),
        ("POST", "/api/projects/project-a/reports/report-a/shares"),
        ("POST", "/api/billing/checkout-sessions"),
        ("POST", "/api/billing/portal-sessions"),
        ("POST", "/api/legal/data-exports"),
        ("POST", "/api/legal/deletion-requests"),
    ],
)
def test_commercial_mutations_are_in_shared_limit_scope(method, path):
    assert api._is_shared_rate_limited_request(method, path) is True


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/projects"),
        ("POST", "/api/auth/login"),
        ("POST", "/api/cases/login"),
        ("POST", "/api/webhooks/clerk"),
        ("POST", "/api/billing/webhooks/stripe"),
    ],
)
def test_reads_and_signed_provider_webhooks_are_not_in_customer_bucket(method, path):
    assert api._is_shared_rate_limited_request(method, path) is False


@pytest.mark.anyio
@pytest.mark.parametrize(
    "path",
    [
        "/api/projects/project-a/members",
        "/api/billing/checkout-sessions",
    ],
)
async def test_invitation_and_checkout_fail_closed_before_route(monkeypatch, path):
    def unavailable(**_kwargs):
        raise RateLimitUnavailable("private database detail")

    monkeypatch.setattr(api, "consume_rate_limit", unavailable)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=api.app),
        base_url="http://test",
    ) as client:
        response = await client.post(path, json={})

    assert response.status_code == 503
    payload = response.json()
    assert payload["error"]["code"] == "rate_limit_unavailable"
    assert "database" not in response.text.lower()
