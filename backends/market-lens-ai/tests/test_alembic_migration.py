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


def _run_upgrade(cfg, destination="head"):
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
        return script._upgrade_revs(destination, revision)

    with EnvironmentContext(cfg, script, fn=do_upgrade, destination_rev=destination) as env_ctx:
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
    "app_users", "workspaces", "workspace_memberships", "projects",
    "project_memberships", "project_data_sources", "legacy_case_mappings",
    "report_runs", "report_snapshots", "report_messages", "report_share_links",
    "audit_events", "analysis_jobs", "analysis_job_artifacts",
    "analysis_worker_heartbeats",
    "workflow_step_executions", "rate_limit_buckets", "ai_budget_accounts",
    "ai_usage_ledger", "billing_customers", "subscriptions",
    "billing_webhook_events", "legal_document_versions", "legal_acceptances",
    "deletion_requests",
}

FORBIDDEN_SELF_AUTH_TABLES = {
    "users",
    "user_credentials",
    "auth_sessions",
    "auth_refresh_tokens",
    "password_reset_tokens",
    "email_verification_tokens",
    "trusted_devices",
    "legacy_case_credentials",
}


class TestAlembicUpgrade:
    def test_upgrade_creates_all_tables(self, alembic_cfg, alembic_engine):
        _run_upgrade(alembic_cfg)
        conn = alembic_cfg.attributes["connection"]
        inspector = inspect(conn)
        table_names = set(inspector.get_table_names())
        assert EXPECTED_TABLES.issubset(table_names), f"Missing: {EXPECTED_TABLES - table_names}"
        assert not FORBIDDEN_SELF_AUTH_TABLES & table_names

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

    def test_head_is_012_and_chain_is_linear(self, alembic_cfg):
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(alembic_cfg)
        head = script.get_current_head()
        assert head == "012"

        revisions = list(script.walk_revisions())
        revision_ids = [revision.revision for revision in revisions]
        assert revision_ids[:6] == ["012", "011", "010", "009", "008", "007"]
        for current, parent in zip(revisions, revisions[1:]):
            assert current.down_revision == parent.revision


class TestPlatformMigrationContract:
    def test_upgrade_from_007_backfills_internal_scope(self, alembic_cfg):
        _run_upgrade(alembic_cfg, "007")
        conn = alembic_cfg.attributes["connection"]
        conn.execute(text(
            "INSERT INTO assets "
            "(id, file_name, mime_type, size_bytes, asset_type, created_at) "
            "VALUES ('asset-old', 'old.png', 'image/png', 10, 'banner', CURRENT_TIMESTAMP)"
        ))
        conn.execute(text(
            "INSERT INTO watchlists "
            "(id, name, project_id, created_at) "
            "VALUES ('watch-old', 'Legacy', 'legacy-project', CURRENT_TIMESTAMP)"
        ))
        conn.execute(text(
            "INSERT INTO usage_events "
            "(id, event_type, workspace_id, created_at) "
            "VALUES ('usage-old', 'scan', 'legacy-workspace', CURRENT_TIMESTAMP)"
        ))

        _run_upgrade(alembic_cfg, "head")

        asset_scope = conn.execute(text(
            "SELECT workspace_id, project_id FROM assets WHERE id = 'asset-old'"
        )).one()
        watchlist_scope = conn.execute(text(
            "SELECT workspace_id, project_id, legacy_project_ref "
            "FROM watchlists WHERE id = 'watch-old'"
        )).one()
        usage_scope = conn.execute(text(
            "SELECT workspace_id, project_id, legacy_workspace_ref "
            "FROM usage_events WHERE id = 'usage-old'"
        )).one()

        internal_workspace = "00000000-0000-0000-0000-000000000001"
        internal_project = "00000000-0000-0000-0000-000000000002"
        assert tuple(asset_scope) == (internal_workspace, internal_project)
        assert tuple(watchlist_scope) == (
            internal_workspace,
            internal_project,
            "legacy-project",
        )
        assert tuple(usage_scope) == (
            internal_workspace,
            internal_project,
            "legacy-workspace",
        )

    def test_platform_constraints_and_security_columns(self, alembic_cfg):
        _run_upgrade(alembic_cfg)
        conn = alembic_cfg.attributes["connection"]
        inspector = inspect(conn)

        user_uniques = {
            tuple(constraint["column_names"])
            for constraint in inspector.get_unique_constraints("app_users")
        }
        assert ("clerk_user_id",) in user_uniques

        app_user_columns = {
            column["name"] for column in inspector.get_columns("app_users")
        }
        assert "platform_role" in app_user_columns
        assert not {"password_hash", "totp_secret", "refresh_token"} & app_user_columns

        project_uniques = {
            tuple(constraint["column_names"])
            for constraint in inspector.get_unique_constraints("projects")
        }
        assert ("workspace_id", "slug") in project_uniques
        assert ("workspace_id", "id") in project_uniques

        report_uniques = {
            tuple(constraint["column_names"])
            for constraint in inspector.get_unique_constraints("report_runs")
        }
        assert ("project_id", "client_run_id") in report_uniques

        share_columns = {
            column["name"] for column in inspector.get_columns("report_share_links")
        }
        assert "token_hash" in share_columns
        assert "token" not in share_columns

        source_columns = {
            column["name"] for column in inspector.get_columns("project_data_sources")
        }
        assert {"gcp_project_id", "dataset_id", "safe_config"}.issubset(source_columns)
        assert not {"credentials", "client_secret", "refresh_token"} & source_columns

        all_table_names = set(inspector.get_table_names())
        assert not {"google_ads_tokens", "todokukun_jobs", "todokukun_accounts"} & all_table_names

    def test_internal_scope_is_seeded_and_ml_roots_are_owned(self, alembic_cfg):
        _run_upgrade(alembic_cfg)
        conn = alembic_cfg.attributes["connection"]
        inspector = inspect(conn)

        workspace_count = conn.execute(
            text(
                "SELECT COUNT(*) FROM workspaces "
                "WHERE id = '00000000-0000-0000-0000-000000000001' "
                "AND is_internal = 1"
            )
        ).scalar_one()
        project_count = conn.execute(
            text(
                "SELECT COUNT(*) FROM projects "
                "WHERE id = '00000000-0000-0000-0000-000000000002' "
                "AND workspace_id = '00000000-0000-0000-0000-000000000001'"
            )
        ).scalar_one()
        assert workspace_count == 1
        assert project_count == 1

        tenant_roots = {
            "assets",
            "review_runs",
            "discovery_searches",
            "library_items",
            "watchlists",
            "watchlist_entries",
            "jobs",
            "delivery_configs",
            "usage_events",
            "generated_assets",
        }
        for table_name in tenant_roots:
            columns = {
                column["name"]: column
                for column in inspector.get_columns(table_name)
            }
            assert columns["workspace_id"]["nullable"] is False
            assert columns["project_id"]["nullable"] is False
            assert "created_by_user_id" in columns

    def test_tenant_foreign_keys_are_present(self, alembic_cfg):
        _run_upgrade(alembic_cfg)
        conn = alembic_cfg.attributes["connection"]
        inspector = inspect(conn)

        snapshot_foreign_keys = {
            tuple(foreign_key["constrained_columns"]): foreign_key["referred_table"]
            for foreign_key in inspector.get_foreign_keys("report_snapshots")
        }
        assert snapshot_foreign_keys[
            ("workspace_id", "project_id", "report_run_id")
        ] == "report_runs"

        artifact_foreign_keys = {
            tuple(foreign_key["constrained_columns"]): foreign_key["referred_table"]
            for foreign_key in inspector.get_foreign_keys("analysis_job_artifacts")
        }
        assert artifact_foreign_keys[
            ("workspace_id", "project_id", "analysis_job_id")
        ] == "analysis_jobs"

        subscription_foreign_keys = {
            tuple(foreign_key["constrained_columns"]): foreign_key["referred_table"]
            for foreign_key in inspector.get_foreign_keys("subscriptions")
        }
        assert subscription_foreign_keys[("workspace_id",)] == "workspaces"
