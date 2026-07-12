"""SQLAlchemy Core tables used by Market Lens tenant enforcement.

The production schema is created exclusively by Alembic revisions 008-011.
``metadata.create_all`` is intentionally reserved for isolated tests; runtime
code must never use it as a migration or database fallback.
"""

from __future__ import annotations

import sqlalchemy as sa


metadata = sa.MetaData()


app_users = sa.Table(
    "app_users",
    metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("clerk_user_id", sa.String(255), nullable=False, unique=True),
    sa.Column("primary_email", sa.String(320)),
    sa.Column("display_name", sa.String(200)),
    sa.Column("platform_role", sa.String(32)),
    sa.Column("status", sa.String(32), nullable=False, server_default="active"),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("deleted_at", sa.DateTime(timezone=True)),
)

workspaces = sa.Table(
    "workspaces",
    metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("clerk_organization_id", sa.String(255), unique=True),
    sa.Column("slug", sa.String(100), nullable=False, unique=True),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("status", sa.String(32), nullable=False, server_default="active"),
    sa.Column("is_internal", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("deleted_at", sa.DateTime(timezone=True)),
)

workspace_memberships = sa.Table(
    "workspace_memberships",
    metadata,
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column(
        "app_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column("role", sa.String(32), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
)

projects = sa.Table(
    "projects",
    metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    ),
    sa.Column("slug", sa.String(100), nullable=False),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("description", sa.Text),
    sa.Column("status", sa.String(32), nullable=False, server_default="active"),
    sa.Column("is_internal", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("is_demo", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("deleted_at", sa.DateTime(timezone=True)),
    sa.UniqueConstraint("workspace_id", "id"),
    sa.UniqueConstraint("workspace_id", "slug"),
)

project_memberships = sa.Table(
    "project_memberships",
    metadata,
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), primary_key=True),
    sa.Column(
        "app_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column("role", sa.String(32), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        ondelete="CASCADE",
    ),
)

analysis_jobs = sa.Table(
    "analysis_jobs",
    metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id")),
    sa.Column("job_type", sa.String(64), nullable=False),
    sa.Column("status", sa.String(32), nullable=False, server_default="queued"),
    sa.Column("stage", sa.String(64)),
    sa.Column("progress_pct", sa.Integer, nullable=False, server_default="0"),
    sa.Column("idempotency_key", sa.String(255)),
    sa.Column("request_json", sa.JSON),
    sa.Column("result_summary_json", sa.JSON),
    sa.Column("error_json", sa.JSON),
    sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    sa.Column("heartbeat_at", sa.DateTime(timezone=True)),
    sa.Column("started_at", sa.DateTime(timezone=True)),
    sa.Column("completed_at", sa.DateTime(timezone=True)),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint("workspace_id", "project_id", "id"),
    sa.UniqueConstraint("workspace_id", "idempotency_key"),
)

analysis_job_artifacts = sa.Table(
    "analysis_job_artifacts",
    metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("analysis_job_id", sa.String(36), nullable=False),
    sa.Column("artifact_type", sa.String(64), nullable=False),
    sa.Column("storage_kind", sa.String(32), nullable=False),
    sa.Column("storage_ref", sa.String(1000), nullable=False),
    sa.Column("content_sha256", sa.String(64)),
    sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
    sa.Column("mime_type", sa.String(200)),
    sa.Column("metadata_json", sa.JSON),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id", "analysis_job_id"],
        ["analysis_jobs.workspace_id", "analysis_jobs.project_id", "analysis_jobs.id"],
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint("analysis_job_id", "artifact_type", "storage_ref"),
)

analysis_worker_heartbeats = sa.Table(
    "analysis_worker_heartbeats",
    metadata,
    sa.Column("worker_id", sa.String(100), primary_key=True),
    sa.Column("state", sa.String(16), nullable=False),
    sa.Column("active_jobs", sa.Integer, nullable=False, server_default="0"),
    sa.Column("processed_jobs", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("last_job_id", sa.String(36)),
    sa.Column("last_job_status", sa.String(16)),
    sa.Column("last_job_completed_at", sa.DateTime(timezone=True)),
    sa.Column("deployment_sha", sa.String(64)),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("stopped_at", sa.DateTime(timezone=True)),
    sa.Column(
        "updated_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    ),
    sa.CheckConstraint(
        "state IN ('starting', 'ready', 'busy', 'draining', 'stopped')",
        name="ck_analysis_worker_heartbeats_state",
    ),
    sa.CheckConstraint(
        "active_jobs >= 0 AND active_jobs <= 2",
        name="ck_analysis_worker_heartbeats_active_jobs",
    ),
    sa.CheckConstraint(
        "processed_jobs >= 0",
        name="ck_analysis_worker_heartbeats_processed_jobs",
    ),
    sa.CheckConstraint(
        "last_job_status IS NULL OR last_job_status IN ('succeeded', 'failed', 'canceled')",
        name="ck_analysis_worker_heartbeats_last_job_status",
    ),
)
sa.Index(
    "ix_analysis_worker_heartbeats_expiry",
    analysis_worker_heartbeats.c.state,
    analysis_worker_heartbeats.c.expires_at,
)


rate_limit_buckets = sa.Table(
    "rate_limit_buckets",
    metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id", ondelete="CASCADE")),
    sa.Column("subject_hash", sa.String(64), nullable=False),
    sa.Column("route_key", sa.String(200), nullable=False),
    sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
    sa.Column("window_seconds", sa.Integer, nullable=False),
    sa.Column("request_count", sa.Integer, nullable=False, server_default="0"),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint("window_seconds > 0", name="ck_rate_limit_buckets_window"),
    sa.CheckConstraint("request_count >= 0", name="ck_rate_limit_buckets_count"),
    sa.UniqueConstraint(
        "subject_hash", "route_key", "window_start", "window_seconds",
        name="uq_rate_limit_bucket_window",
    ),
)
sa.Index("ix_rate_limit_buckets_expiry", rate_limit_buckets.c.expires_at)


ai_budget_accounts = sa.Table(
    "ai_budget_accounts",
    metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
    sa.Column("project_id", sa.String(36)),
    sa.Column("scope_key", sa.String(100), nullable=False),
    sa.Column("provider", sa.String(64), nullable=False),
    sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
    sa.Column("monthly_limit_microunits", sa.BigInteger, nullable=False),
    sa.Column("warning_percent", sa.Integer, nullable=False, server_default="80"),
    sa.Column("hard_limit", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("period_timezone", sa.String(64), nullable=False, server_default="Asia/Tokyo"),
    sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint("monthly_limit_microunits >= 0", name="ck_ai_budget_accounts_limit"),
    sa.CheckConstraint(
        "warning_percent >= 0 AND warning_percent <= 100",
        name="ck_ai_budget_accounts_warning_percent",
    ),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        name="fk_ai_budget_accounts_workspace_project",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint(
        "workspace_id", "scope_key", "provider",
        name="uq_ai_budget_account_scope",
    ),
)


ai_usage_ledger = sa.Table(
    "ai_usage_ledger",
    metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("app_user_id", sa.String(36), sa.ForeignKey("app_users.id")),
    sa.Column("analysis_job_id", sa.String(36), sa.ForeignKey("analysis_jobs.id")),
    sa.Column("report_run_id", sa.String(36)),
    sa.Column("provider", sa.String(64), nullable=False),
    sa.Column("model", sa.String(128)),
    sa.Column("operation", sa.String(100), nullable=False),
    sa.Column("input_tokens", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("output_tokens", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("estimated_cost_microunits", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
    sa.Column("idempotency_key", sa.String(255), nullable=False, unique=True),
    sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        ondelete="CASCADE",
    ),
)

assets = sa.Table(
    "assets",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column("file_name", sa.String, nullable=False),
    sa.Column("mime_type", sa.String, nullable=False),
    sa.Column("size_bytes", sa.Integer, nullable=False),
    sa.Column("width", sa.Integer),
    sa.Column("height", sa.Integer),
    sa.Column("asset_type", sa.String(32), nullable=False, server_default="banner"),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id")),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        ondelete="CASCADE",
    ),
)

asset_data = sa.Table(
    "asset_data",
    metadata,
    sa.Column(
        "asset_id",
        sa.String(12),
        sa.ForeignKey("assets.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column("data", sa.LargeBinary, nullable=False),
)

review_runs = sa.Table(
    "review_runs",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column("asset_id", sa.String(12), sa.ForeignKey("assets.id"), nullable=False),
    sa.Column("review_type", sa.String(32), nullable=False),
    sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
    sa.Column("brand_info", sa.Text),
    sa.Column("operator_memo", sa.Text),
    sa.Column("model", sa.String(64)),
    sa.Column("lp_url", sa.String),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id")),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        ondelete="CASCADE",
    ),
)

review_outputs = sa.Table(
    "review_outputs",
    metadata,
    sa.Column(
        "run_id",
        sa.String(12),
        sa.ForeignKey("review_runs.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column("output_json", sa.Text, nullable=False),
    sa.Column("model_used", sa.String(64)),
    sa.Column("created_at", sa.DateTime(timezone=True)),
)

export_records = sa.Table(
    "export_records",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column(
        "run_id",
        sa.String(12),
        sa.ForeignKey("review_runs.id", ondelete="CASCADE"),
        nullable=False,
    ),
    sa.Column("format", sa.String(16), nullable=False),
    sa.Column("file_name", sa.String, nullable=False),
    sa.Column("file_size_bytes", sa.Integer),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)


# Operational persistence.  The parent records received tenant ownership in
# Alembic 011; child history rows are always read through a scoped parent join.
watchlists = sa.Table(
    "watchlists",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("description", sa.Text),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id")),
    sa.Column("legacy_project_ref", sa.String(64)),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        ondelete="CASCADE",
    ),
)

watchlist_entries = sa.Table(
    "watchlist_entries",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column(
        "watchlist_id",
        sa.String(12),
        sa.ForeignKey("watchlists.id", ondelete="CASCADE"),
    ),
    sa.Column("url", sa.String, nullable=False),
    sa.Column("label", sa.String),
    sa.Column("source_type", sa.String(32), nullable=False),
    sa.Column("check_interval_hours", sa.Integer, nullable=False),
    sa.Column("last_checked_at", sa.DateTime(timezone=True)),
    sa.Column("last_snapshot_hash", sa.String(64)),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id")),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        ondelete="CASCADE",
    ),
)

digest_reports = sa.Table(
    "digest_reports",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column(
        "entry_id",
        sa.String(12),
        sa.ForeignKey("watchlist_entries.id", ondelete="CASCADE"),
        nullable=False,
    ),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("changes_detected", sa.Integer, nullable=False),
    sa.Column("diff_json", sa.Text),
    sa.Column("summary", sa.Text),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)

jobs = sa.Table(
    "jobs",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column("job_type", sa.String(32), nullable=False),
    sa.Column("cron_expression", sa.String(64)),
    sa.Column("target_id", sa.String(12)),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("last_run_at", sa.DateTime(timezone=True)),
    sa.Column("next_run_at", sa.DateTime(timezone=True)),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id")),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        ondelete="CASCADE",
    ),
)

job_results = sa.Table(
    "job_results",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column(
        "job_id",
        sa.String(12),
        sa.ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
    ),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("completed_at", sa.DateTime(timezone=True)),
    sa.Column("result_json", sa.Text),
    sa.Column("error_message", sa.Text),
)

delivery_configs = sa.Table(
    "delivery_configs",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column("channel", sa.String(16), nullable=False),
    sa.Column("target", sa.String, nullable=False),
    sa.Column("enabled", sa.Integer, nullable=False),
    sa.Column("config_json", sa.Text),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("updated_at", sa.DateTime(timezone=True)),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("app_users.id")),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        ondelete="CASCADE",
    ),
)

delivery_logs = sa.Table(
    "delivery_logs",
    metadata,
    sa.Column("id", sa.String(12), primary_key=True),
    sa.Column(
        "config_id",
        sa.String(12),
        sa.ForeignKey("delivery_configs.id", ondelete="CASCADE"),
        nullable=False,
    ),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("digest_id", sa.String(12)),
    sa.Column("sent_at", sa.DateTime(timezone=True)),
    sa.Column("error_message", sa.Text),
)
