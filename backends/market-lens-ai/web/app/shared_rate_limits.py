"""PostgreSQL-shared fixed-window limits for Market Lens mutations.

Raw identities and socket addresses are never persisted: callers pass trusted
subject material which is HMAC-SHA256'd before the atomic upsert.  SQLite is
supported only for tests/local verification; managed runtimes fail closed
unless the shared database is PostgreSQL.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import uuid
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Callable

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from .tenant_auth import (
    TenantAuthConfigurationError,
    TenantDatabaseUnavailableError,
    get_managed_session_factory,
)
from .tenant_schema import rate_limit_buckets


class RateLimitUnavailable(RuntimeError):
    """The shared database could not make a durable limit decision."""


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    request_count: int
    limit: int
    retry_after_seconds: int
    window_start: datetime
    expires_at: datetime


_SQLITE_TEST_LOCK = RLock()


def _is_managed_runtime() -> bool:
    return bool(
        os.getenv("VERCEL")
        or os.getenv("RENDER")
        or str(os.getenv("ENVIRONMENT", "")).strip().lower() in {"prod", "production", "staging"}
    )


def _hash_secret() -> bytes:
    value = str(
        os.getenv("RATE_LIMIT_HASH_SECRET")
        or os.getenv("JWT_SECRET")
        or ""
    ).strip()
    if not value:
        raise RateLimitUnavailable("rate-limit hash secret is not configured")
    if _is_managed_runtime() and len(value) < 32:
        raise RateLimitUnavailable("rate-limit hash secret is too short")
    return value.encode("utf-8")


def hash_rate_limit_subject(subject_material: str) -> str:
    normalized = str(subject_material or "").strip()
    if not normalized:
        raise RateLimitUnavailable("rate-limit subject is empty")
    return hmac.new(
        _hash_secret(), normalized.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def _managed_engine() -> Engine:
    try:
        engine = get_managed_session_factory().kw.get("bind")
    except (
        TenantAuthConfigurationError,
        TenantDatabaseUnavailableError,
        SQLAlchemyError,
        ValueError,
    ) as exc:
        raise RateLimitUnavailable("shared rate-limit database is unavailable") from exc
    if not isinstance(engine, Engine):
        raise RateLimitUnavailable("shared rate-limit database is unavailable")
    return engine


def _window_bounds(now: datetime, window_seconds: int) -> tuple[datetime, datetime]:
    normalized = now.astimezone(timezone.utc)
    epoch = int(normalized.timestamp())
    start_epoch = epoch - (epoch % window_seconds)
    start = datetime.fromtimestamp(start_epoch, tz=timezone.utc)
    return start, start + timedelta(seconds=window_seconds)


class SharedRateLimitStore:
    def __init__(
        self,
        *,
        engine_provider: Callable[[], Engine] = _managed_engine,
        now_provider: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._engine_provider = engine_provider
        self._now_provider = now_provider

    def consume(
        self,
        *,
        subject_hash: str,
        route_key: str,
        limit: int,
        window_seconds: int,
        workspace_id: str | None = None,
    ) -> RateLimitDecision:
        if limit <= 0 or window_seconds <= 0:
            raise RateLimitUnavailable("rate-limit configuration is invalid")
        if len(subject_hash) != 64 or not route_key or len(route_key) > 200:
            raise RateLimitUnavailable("rate-limit key is invalid")
        try:
            engine = self._engine_provider()
            if engine.dialect.name not in {"postgresql", "sqlite"}:
                raise RateLimitUnavailable("shared rate limits require PostgreSQL")
            if _is_managed_runtime() and engine.dialect.name != "postgresql":
                raise RateLimitUnavailable("managed rate limits require PostgreSQL")
            now = self._now_provider().astimezone(timezone.utc)
            window_start, expires_at = _window_bounds(now, window_seconds)
            values = {
                "id": str(uuid.uuid4()),
                "workspace_id": workspace_id,
                "subject_hash": subject_hash,
                "route_key": route_key,
                "window_start": window_start,
                "window_seconds": window_seconds,
                "request_count": 1,
                "expires_at": expires_at,
                "updated_at": now,
            }
            statement = (
                postgresql_insert(rate_limit_buckets)
                if engine.dialect.name == "postgresql"
                else sqlite_insert(rate_limit_buckets)
            ).values(**values)
            statement = statement.on_conflict_do_update(
                index_elements=[
                    rate_limit_buckets.c.subject_hash,
                    rate_limit_buckets.c.route_key,
                    rate_limit_buckets.c.window_start,
                    rate_limit_buckets.c.window_seconds,
                ],
                set_={
                    "request_count": rate_limit_buckets.c.request_count + 1,
                    "expires_at": expires_at,
                    "updated_at": now,
                },
            ).returning(rate_limit_buckets.c.request_count)
            lock = _SQLITE_TEST_LOCK if engine.dialect.name == "sqlite" else nullcontext()
            with lock, engine.begin() as connection:
                connection.execute(
                    sa.delete(rate_limit_buckets).where(
                        rate_limit_buckets.c.expires_at <= now
                    )
                )
                count = int(connection.execute(statement).scalar_one())
        except RateLimitUnavailable:
            raise
        except (
            TenantAuthConfigurationError,
            TenantDatabaseUnavailableError,
            SQLAlchemyError,
            ValueError,
        ) as exc:
            raise RateLimitUnavailable("shared rate-limit database is unavailable") from exc

        retry_after = max(1, math_ceil_seconds(expires_at - now))
        return RateLimitDecision(
            allowed=count <= limit,
            request_count=count,
            limit=limit,
            retry_after_seconds=retry_after,
            window_start=window_start,
            expires_at=expires_at,
        )

    def clear_all(self) -> None:
        try:
            engine = self._engine_provider()
            with engine.begin() as connection:
                connection.execute(sa.delete(rate_limit_buckets))
        except (SQLAlchemyError, ValueError) as exc:
            raise RateLimitUnavailable("shared rate-limit database is unavailable") from exc


def math_ceil_seconds(delta: timedelta) -> int:
    seconds = delta.total_seconds()
    return int(seconds) if seconds == int(seconds) else int(seconds) + 1


_shared_store = SharedRateLimitStore()


def consume_rate_limit(
    *, subject_material: str, route_key: str, limit: int, window_seconds: int
) -> RateLimitDecision:
    return _shared_store.consume(
        subject_hash=hash_rate_limit_subject(subject_material),
        route_key=route_key,
        limit=limit,
        window_seconds=window_seconds,
    )


def clear_rate_limit_buckets() -> None:
    _shared_store.clear_all()
