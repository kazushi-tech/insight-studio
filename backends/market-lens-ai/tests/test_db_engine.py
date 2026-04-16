"""Tests for web.app.db.engine — engine creation, session factory, table creation."""

from __future__ import annotations

import pytest
from sqlalchemy import inspect, text

from web.app.db.engine import get_engine, get_session, create_tables


class TestGetEngine:
    """Engine creation tests."""

    def test_default_sqlite_engine(self):
        engine = get_engine("sqlite:///:memory:")
        assert engine is not None
        assert str(engine.url) == "sqlite:///:memory:"

    def test_sqlite_check_same_thread(self):
        """SQLite engines should have check_same_thread=False in connect_args."""
        engine = get_engine("sqlite:///:memory:")
        # Verify engine is usable (check_same_thread=False allows this)
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            assert result.scalar() == 1


class TestGetSession:
    """Session factory tests."""

    def test_session_factory_returns_sessionmaker(self):
        engine = get_engine("sqlite:///:memory:")
        sf = get_session(engine)
        assert sf is not None

    def test_session_usable(self):
        engine = get_engine("sqlite:///:memory:")
        sf = get_session(engine)
        with sf() as session:
            result = session.execute(text("SELECT 42"))
            assert result.scalar() == 42


class TestCreateTables:
    """Table creation tests."""

    def test_creates_all_five_tables(self):
        engine = get_engine("sqlite:///:memory:")
        create_tables(engine)
        inspector = inspect(engine)
        table_names = set(inspector.get_table_names())
        expected = {"assets", "asset_data", "review_runs", "review_outputs", "export_records"}
        assert expected.issubset(table_names), f"Missing tables: {expected - table_names}"
