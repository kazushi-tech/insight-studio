from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy.exc import OperationalError

from web.app import main
from web.app.shared_rate_limits import (
    RateLimitUnavailable,
    SharedRateLimitStore,
    hash_rate_limit_subject,
)
from web.app.tenant_auth import get_managed_session_factory
from web.app.tenant_schema import rate_limit_buckets


NOW = datetime(2026, 7, 12, 6, 0, 30, tzinfo=timezone.utc)


def _engine():
    return get_managed_session_factory().kw["bind"]


def test_counter_survives_new_store_instances() -> None:
    engine = _engine()
    subject_hash = hash_rate_limit_subject("socket:203.0.113.1")
    first = SharedRateLimitStore(engine_provider=lambda: engine, now_provider=lambda: NOW)
    cold = SharedRateLimitStore(engine_provider=lambda: engine, now_provider=lambda: NOW)
    assert first.consume(
        subject_hash=subject_hash,
        route_key="POST:/api/scan",
        limit=2,
        window_seconds=60,
    ).request_count == 1
    assert cold.consume(
        subject_hash=subject_hash,
        route_key="POST:/api/scan",
        limit=2,
        window_seconds=60,
    ).request_count == 2
    blocked = first.consume(
        subject_hash=subject_hash,
        route_key="POST:/api/scan",
        limit=2,
        window_seconds=60,
    )
    assert blocked.allowed is False
    assert blocked.retry_after_seconds == 30


def test_subject_is_hmaced_and_parallel_upsert_is_atomic() -> None:
    engine = _engine()
    raw = "socket:198.51.100.44"
    subject_hash = hash_rate_limit_subject(raw)

    def consume(_: int) -> int:
        store = SharedRateLimitStore(engine_provider=lambda: engine, now_provider=lambda: NOW)
        return store.consume(
            subject_hash=subject_hash,
            route_key="POST:/api/discovery",
            limit=4,
            window_seconds=60,
        ).request_count

    with ThreadPoolExecutor(max_workers=8) as executor:
        counts = list(executor.map(consume, range(8)))
    assert sorted(counts) == list(range(1, 9))
    with engine.connect() as connection:
        row = connection.execute(sa.select(rate_limit_buckets)).mappings().one()
    assert row["subject_hash"] == subject_hash
    assert raw not in str(row)
    assert row["request_count"] == 8


def test_database_failure_is_fail_closed() -> None:
    def unavailable():
        raise OperationalError("SELECT", {}, RuntimeError("secret host"))

    store = SharedRateLimitStore(engine_provider=unavailable)
    with pytest.raises(RateLimitUnavailable, match="database is unavailable"):
        store.consume(
            subject_hash="a" * 64,
            route_key="POST:/api/scan",
            limit=1,
            window_seconds=60,
        )


@pytest.mark.anyio
async def test_middleware_returns_safe_503_when_shared_store_is_down(monkeypatch) -> None:
    def unavailable(**_kwargs):
        raise RateLimitUnavailable("postgres password and host must not leak")

    monkeypatch.setattr(main, "consume_rate_limit", unavailable)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app),
        base_url="http://test",
    ) as client:
        response = await client.post("/api/scan", json={})
    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "rate_limit_unavailable"
    assert body["error"]["retryable"] is True
    assert "password" not in response.text.lower()
    assert "postgres" not in response.text.lower()
