"""Tests for Alembic migration — in-memory SQLite."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, inspect, text

from alembic.config import Config
from alembic.command import upgrade, downgrade
from alembic import command


@pytest.fixture()
def alembic_engine():
    """Create an in-memory SQLite engine for Alembic tests."""
    return create_engine("sqlite:///:memory:")


@pytest.fixture()
def alembic_cfg(alembic_engine):
    """Create Alembic config pointing at the in-memory engine."""
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", str(alembic_engine.url))
    # Provide the connection to avoid Alembic creating its own engine
    cfg.attributes["connection"] = alembic_engine.connect()
    return cfg


def _run_upgrade(cfg):
    """Run upgrade using the shared connection."""
    conn = cfg.attributes["connection"]
    from alembic import context as alembic_context

    # We need to use the raw alembic API with a provided connection
    from alembic.script import ScriptDirectory
    from alembic.runtime.migration import MigrationContext
    from alembic.runtime.environment import EnvironmentContext

    script = ScriptDirectory.from_config(cfg)
    migration_ctx = MigrationContext.configure(conn)

    def do_upgrade(revision, context):
        return script._upgrade_revs("head", revision)

    with EnvironmentContext(cfg, script, fn=do_upgrade, destination_rev="head") as env_ctx:
        env_ctx.configure(connection=conn, target_metadata=None)
        with env_ctx.begin_transaction():
            env_ctx.run_migrations()


def _run_downgrade(cfg):
    """Run downgrade using the shared connection."""
    conn = cfg.attributes["connection"]
    from alembic.script import ScriptDirectory
    from alembic.runtime.migration import MigrationContext
    from alembic.runtime.environment import EnvironmentContext

    script = ScriptDirectory.from_config(cfg)

    def do_downgrade(revision, context):
        return script._downgrade_revs("base", revision)

    with EnvironmentContext(cfg, script, fn=do_downgrade, destination_rev="base") as env_ctx:
        env_ctx.configure(connection=conn, target_metadata=None)
        with env_ctx.begin_transaction():
            env_ctx.run_migrations()


EXPECTED_TABLES = {
    "assets", "asset_data", "review_runs", "review_outputs", "export_records",
    "discovery_searches", "discovery_candidates", "library_items",
    "watchlist_entries", "digest_reports", "generated_assets",
    "watchlists", "watchlist_snapshots", "jobs", "job_results",
    "delivery_configs", "delivery_logs", "usage_events",
}


class TestAlembicUpgrade:
    def test_upgrade_creates_all_tables(self, alembic_cfg, alembic_engine):
        _run_upgrade(alembic_cfg)
        conn = alembic_cfg.attributes["connection"]
        inspector = inspect(conn)
        table_names = set(inspector.get_table_names())
        assert EXPECTED_TABLES.issubset(table_names), f"Missing: {EXPECTED_TABLES - table_names}"

    def test_upgrade_is_idempotent(self, alembic_cfg, alembic_engine):
        _run_upgrade(alembic_cfg)
        # Running again should not raise
        _run_upgrade(alembic_cfg)
        conn = alembic_cfg.attributes["connection"]
        inspector = inspect(conn)
        table_names = set(inspector.get_table_names())
        assert EXPECTED_TABLES.issubset(table_names)


class TestAlembicDowngrade:
    def test_downgrade_removes_tables(self, alembic_cfg, alembic_engine):
        _run_upgrade(alembic_cfg)
        _run_downgrade(alembic_cfg)
        conn = alembic_cfg.attributes["connection"]
        inspector = inspect(conn)
        table_names = set(inspector.get_table_names())
        # After downgrade, our 5 tables should be gone (alembic_version may remain)
        remaining = EXPECTED_TABLES & table_names
        assert remaining == set(), f"Tables not removed: {remaining}"


class TestAlembicMigrationVersions:
    def test_initial_revision_exists(self, alembic_cfg):
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(alembic_cfg)
        revisions = list(script.walk_revisions())
        assert len(revisions) >= 1
        assert revisions[-1].revision == "001"

    def test_head_is_006(self, alembic_cfg):
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(alembic_cfg)
        head = script.get_current_head()
        assert head == "007"
