"""SQLAlchemy engine and session factory for Market Lens AI."""

from __future__ import annotations

import os

from sqlalchemy import create_engine, Engine
from sqlalchemy.orm import Session, sessionmaker

_DEFAULT_URL = "sqlite:///data/market_lens.db"


def get_engine(url: str | None = None) -> Engine:
    """Create and return a SQLAlchemy engine.

    Args:
        url: Database URL. Falls back to DATABASE_URL env var, then SQLite default.
    """
    db_url = url or os.getenv("DATABASE_URL", _DEFAULT_URL)
    connect_args: dict = {}
    if db_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    return create_engine(db_url, connect_args=connect_args)


def get_session(engine: Engine | None = None) -> sessionmaker[Session]:
    """Return a session factory bound to the given (or default) engine."""
    if engine is None:
        engine = get_engine()
    return sessionmaker(bind=engine)


def create_tables(engine: Engine) -> None:
    """Create all tables defined in tables.py metadata."""
    from .tables import metadata

    metadata.create_all(engine)
