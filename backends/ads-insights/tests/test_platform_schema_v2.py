from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.platform.schema import platform_metadata


EXPECTED_PLATFORM_TABLES = {
    "app_users",
    "workspaces",
    "workspace_memberships",
    "projects",
    "project_memberships",
    "project_data_sources",
    "legacy_case_mappings",
    "report_runs",
    "report_snapshots",
    "report_messages",
    "report_share_links",
    "audit_events",
    "analysis_jobs",
    "analysis_job_artifacts",
    "workflow_step_executions",
    "rate_limit_buckets",
    "ai_budget_accounts",
    "ai_usage_ledger",
    "billing_customers",
    "subscriptions",
    "billing_webhook_events",
    "legal_document_versions",
    "legal_acceptances",
    "deletion_requests",
    "privacy_export_artifacts",
}


def test_platform_metadata_matches_008_through_012_table_contract():
    assert set(platform_metadata.tables) == EXPECTED_PLATFORM_TABLES


def test_platform_metadata_create_all_is_test_only_and_contains_no_self_auth():
    engine = create_engine("sqlite:///:memory:")
    platform_metadata.create_all(engine)
    table_names = set(inspect(engine).get_table_names())
    assert table_names == EXPECTED_PLATFORM_TABLES
    assert not {
        "user_credentials",
        "auth_sessions",
        "password_reset_tokens",
        "legacy_case_credentials",
        "google_ads_tokens",
        "todokukun_jobs",
    } & table_names


def test_roles_and_clerk_identity_are_fixed_by_constraints():
    engine = create_engine("sqlite:///:memory:")
    platform_metadata.create_all(engine)
    inspector = inspect(engine)

    app_user_checks = " ".join(
        str(item.get("sqltext") or "")
        for item in inspector.get_check_constraints("app_users")
    )
    workspace_checks = " ".join(
        str(item.get("sqltext") or "")
        for item in inspector.get_check_constraints("workspace_memberships")
    )
    project_checks = " ".join(
        str(item.get("sqltext") or "")
        for item in inspector.get_check_constraints("project_memberships")
    )
    assert "platform_admin" in app_user_checks
    assert "workspace_owner" in workspace_checks
    assert "workspace_admin" in workspace_checks
    assert "project_editor" in project_checks
    assert "project_viewer" in project_checks

    app_user_columns = {column["name"] for column in inspector.get_columns("app_users")}
    workspace_columns = {column["name"] for column in inspector.get_columns("workspaces")}
    assert "clerk_user_id" in app_user_columns
    assert "clerk_organization_id" in workspace_columns
    assert not {"password_hash", "password", "refresh_token"} & app_user_columns
