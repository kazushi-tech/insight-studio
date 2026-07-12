"""Managed PostgreSQL access for tenant, reports, jobs, and billing.

This module is deliberately lazy: importing the FastAPI application never
creates tables and never writes a local fallback file. Production callers get
an explicit unavailable error when the managed database is missing or down.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Iterator

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


class PlatformDatabaseUnavailable(RuntimeError):
    pass


def _is_production() -> bool:
    return bool(os.getenv("VERCEL") or os.getenv("RENDER") or os.getenv("ENVIRONMENT") == "production")


def database_url() -> str:
    value = (os.getenv("DATABASE_URL") or "").strip()
    if not value:
        raise PlatformDatabaseUnavailable("managed database is not configured")
    return value


@lru_cache(maxsize=1)
def get_platform_engine() -> Engine:
    url = make_url(database_url())
    if _is_production() and url.get_backend_name() not in {"postgresql", "postgres"}:
        raise PlatformDatabaseUnavailable("production requires managed PostgreSQL")

    options: dict = {
        "pool_pre_ping": True,
        "pool_recycle": int(os.getenv("DATABASE_POOL_RECYCLE_SECONDS", "300")),
    }
    if url.get_backend_name() in {"postgresql", "postgres"}:
        sslmode = (os.getenv("DATABASE_SSLMODE") or "require").strip().lower()
        if _is_production() and sslmode not in {"require", "verify-ca", "verify-full"}:
            raise PlatformDatabaseUnavailable("production PostgreSQL requires TLS")
        options.update(
            pool_size=int(os.getenv("DATABASE_POOL_SIZE", "3")),
            max_overflow=int(os.getenv("DATABASE_MAX_OVERFLOW", "2")),
            pool_timeout=int(os.getenv("DATABASE_POOL_TIMEOUT_SECONDS", "5")),
            connect_args={
                "sslmode": sslmode,
                "connect_timeout": int(os.getenv("DATABASE_CONNECT_TIMEOUT_SECONDS", "5")),
            },
        )
    elif url.get_backend_name() == "sqlite":
        options["connect_args"] = {"check_same_thread": False}
        if url.database in {None, "", ":memory:"}:
            # Isolated tests may exercise sync repositories through Starlette's
            # threadpool.  A single in-memory connection keeps that test DB
            # consistent across worker threads; production rejects SQLite.
            options["poolclass"] = StaticPool
    return create_engine(url, **options)


@lru_cache(maxsize=1)
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_platform_engine(), expire_on_commit=False)


def platform_session() -> Iterator[Session]:
    """FastAPI dependency with rollback and no alternative persistence path."""
    try:
        session = _session_factory()()
    except (PlatformDatabaseUnavailable, SQLAlchemyError) as exc:
        raise PlatformDatabaseUnavailable("managed database is unavailable") from exc
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def assert_database_ready() -> None:
    try:
        with get_platform_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except (PlatformDatabaseUnavailable, SQLAlchemyError) as exc:
        raise PlatformDatabaseUnavailable("managed database is unavailable") from exc


def reset_platform_engine_for_tests() -> None:
    _session_factory.cache_clear()
    engine = get_platform_engine.cache_info()
    if engine.currsize:
        try:
            get_platform_engine().dispose()
        except Exception:
            pass
    get_platform_engine.cache_clear()
