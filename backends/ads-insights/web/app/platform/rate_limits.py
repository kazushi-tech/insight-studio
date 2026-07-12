"""PostgreSQL-backed fixed-window rate limits for customer-facing APIs.

The database is the only source of truth.  Subject material is HMACed before
it reaches persistence, so a database reader cannot recover user, project, or
IP identifiers by inspecting ``rate_limit_buckets``.  SQLite support exists
solely for isolated tests; production database policy is enforced by
``platform_db.get_platform_engine``.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Callable

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from ..platform_db import PlatformDatabaseUnavailable, get_platform_engine
from .auth import AuthenticationError, ClerkJWTVerifier, PlatformConfigurationError
from .schema import rate_limit_buckets


class RateLimitUnavailable(RuntimeError):
    """Raised when the shared limiter cannot make a durable decision."""


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    request_count: int
    limit: int
    retry_after_seconds: int
    window_start: datetime
    expires_at: datetime


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_secret() -> bytes:
    # JWT_SECRET is retained only for the hybrid authentication window.  A
    # dedicated secret lets operators rotate/remove the legacy JWT secret
    # without changing rate-limit identities.
    value = (os.getenv("RATE_LIMIT_HASH_SECRET") or os.getenv("JWT_SECRET") or "").strip()
    if not value:
        raise RateLimitUnavailable("rate-limit hash secret is not configured")
    if bool(os.getenv("VERCEL") or os.getenv("RENDER") or os.getenv("ENVIRONMENT") == "production") and len(value) < 32:
        raise RateLimitUnavailable("rate-limit hash secret is too short")
    return value.encode("utf-8")


def hash_rate_limit_subject(subject_material: str) -> str:
    """Return a stable, non-reversible key suitable for database storage."""

    normalized = str(subject_material or "").strip()
    if not normalized:
        raise RateLimitUnavailable("rate-limit subject is empty")
    return hmac.new(
        _hash_secret(),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


@lru_cache(maxsize=1)
def _clerk_verifier() -> ClerkJWTVerifier:
    return ClerkJWTVerifier.from_env()


def verified_clerk_subject_material(token: str) -> str | None:
    """Resolve a signed Clerk subject without trusting token payload text."""

    try:
        principal = _clerk_verifier().verify(token)
    except (AuthenticationError, PlatformConfigurationError):
        return None
    return (
        f"clerk:{principal.clerk_user_id}:"
        f"{principal.clerk_organization_id}"
    )


def _window_bounds(now: datetime, window_seconds: int) -> tuple[datetime, datetime]:
    normalized_now = now.astimezone(timezone.utc)
    epoch_seconds = int(normalized_now.timestamp())
    start_epoch = epoch_seconds - (epoch_seconds % window_seconds)
    start = datetime.fromtimestamp(start_epoch, tz=timezone.utc)
    return start, start + timedelta(seconds=window_seconds)


class SharedRateLimitStore:
    """Atomically consumes rate-limit capacity from the managed database."""

    def __init__(
        self,
        *,
        engine_provider: Callable[[], Engine] = get_platform_engine,
        now_provider: Callable[[], datetime] = _utc_now,
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
        normalized_hash = str(subject_hash or "").strip()
        normalized_route = str(route_key or "").strip()
        if len(normalized_hash) != 64 or not normalized_route or len(normalized_route) > 200:
            raise RateLimitUnavailable("rate-limit key is invalid")

        now = self._now_provider().astimezone(timezone.utc)
        window_start, expires_at = _window_bounds(now, window_seconds)
        values = {
            "id": str(uuid.uuid4()),
            "workspace_id": workspace_id,
            "subject_hash": normalized_hash,
            "route_key": normalized_route,
            "window_start": window_start,
            "window_seconds": window_seconds,
            "request_count": 1,
            "expires_at": expires_at,
            "updated_at": now,
        }

        try:
            engine = self._engine_provider()
            dialect = engine.dialect.name
            if dialect == "postgresql":
                statement = postgresql_insert(rate_limit_buckets).values(**values)
            elif dialect == "sqlite":
                # Test-only. platform_db rejects SQLite in production.
                statement = sqlite_insert(rate_limit_buckets).values(**values)
            else:
                raise RateLimitUnavailable("shared rate limits require PostgreSQL")

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

            with engine.begin() as connection:
                # The indexed expiry predicate keeps cleanup bounded to stale
                # rows and means no separate scheduler or local file is needed.
                connection.execute(
                    sa.delete(rate_limit_buckets).where(
                        rate_limit_buckets.c.expires_at <= now
                    )
                )
                count = int(connection.execute(statement).scalar_one())
        except RateLimitUnavailable:
            raise
        except (PlatformDatabaseUnavailable, SQLAlchemyError) as exc:
            raise RateLimitUnavailable("shared rate-limit database is unavailable") from exc

        retry_after = max(1, int((expires_at - now).total_seconds() + 0.999))
        return RateLimitDecision(
            allowed=count <= limit,
            request_count=count,
            limit=limit,
            retry_after_seconds=retry_after,
            window_start=window_start,
            expires_at=expires_at,
        )

    def clear_all(self) -> None:
        """Test/operations helper; never falls back when the DB is unavailable."""

        try:
            with self._engine_provider().begin() as connection:
                connection.execute(sa.delete(rate_limit_buckets))
        except (PlatformDatabaseUnavailable, SQLAlchemyError) as exc:
            raise RateLimitUnavailable("shared rate-limit database is unavailable") from exc


_shared_store = SharedRateLimitStore()


def consume_rate_limit(
    *,
    subject_material: str,
    route_key: str,
    limit: int,
    window_seconds: int,
) -> RateLimitDecision:
    """Hash a trusted subject and consume one shared request slot."""

    return _shared_store.consume(
        subject_hash=hash_rate_limit_subject(subject_material),
        route_key=route_key,
        limit=limit,
        window_seconds=window_seconds,
    )


def clear_rate_limit_buckets() -> None:
    _shared_store.clear_all()
