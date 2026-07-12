"""SQLAlchemy Core mirror of platform migrations 008 through 012.

Runtime code never calls ``create_all``.  Tests may create this metadata in an
isolated SQLite database; managed environments are migrated only by Alembic.
"""

from __future__ import annotations

import sqlalchemy as sa


platform_metadata = sa.MetaData()


app_users = sa.Table(
    "app_users",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("clerk_user_id", sa.String(255), nullable=False),
    sa.Column("primary_email", sa.String(320), nullable=True),
    sa.Column("display_name", sa.String(200), nullable=True),
    sa.Column("platform_role", sa.String(32), nullable=True),
    sa.Column("status", sa.String(32), nullable=False, server_default="active"),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint(
        "platform_role IS NULL OR platform_role = 'platform_admin'",
        name="ck_app_users_platform_role",
    ),
    sa.CheckConstraint(
        "status IN ('active', 'suspended', 'deleted')",
        name="ck_app_users_status",
    ),
    sa.UniqueConstraint("clerk_user_id", name="uq_app_users_clerk_user_id"),
)
sa.Index("ix_app_users_status", app_users.c.status)


workspaces = sa.Table(
    "workspaces",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("clerk_organization_id", sa.String(255), nullable=True),
    sa.Column("slug", sa.String(100), nullable=False),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("status", sa.String(32), nullable=False, server_default="active"),
    sa.Column("is_internal", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint(
        "status IN ('active', 'suspended', 'deleted')",
        name="ck_workspaces_status",
    ),
    sa.UniqueConstraint("clerk_organization_id", name="uq_workspaces_clerk_org_id"),
    sa.UniqueConstraint("slug", name="uq_workspaces_slug"),
)
sa.Index("ix_workspaces_status", workspaces.c.status)


workspace_memberships = sa.Table(
    "workspace_memberships",
    platform_metadata,
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
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint(
        "role IN ('workspace_owner', 'workspace_admin')",
        name="ck_workspace_memberships_role",
    ),
)
sa.Index(
    "ix_workspace_memberships_user",
    workspace_memberships.c.app_user_id,
    workspace_memberships.c.role,
)


projects = sa.Table(
    "projects",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    ),
    sa.Column("slug", sa.String(100), nullable=False),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("description", sa.Text, nullable=True),
    sa.Column("status", sa.String(32), nullable=False, server_default="active"),
    sa.Column("is_internal", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("is_demo", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint(
        "status IN ('active', 'inactive', 'archived', 'deleted')",
        name="ck_projects_status",
    ),
    sa.CheckConstraint("version >= 1", name="ck_projects_version"),
    sa.UniqueConstraint("workspace_id", "id", name="uq_projects_workspace_id_id"),
    sa.UniqueConstraint("workspace_id", "slug", name="uq_projects_workspace_slug"),
)
sa.Index("ix_projects_workspace_status", projects.c.workspace_id, projects.c.status)


project_memberships = sa.Table(
    "project_memberships",
    platform_metadata,
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), primary_key=True),
    sa.Column(
        "app_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column("role", sa.String(32), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint(
        "role IN ('project_editor', 'project_viewer')",
        name="ck_project_memberships_role",
    ),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        name="fk_project_memberships_workspace_project",
        ondelete="CASCADE",
    ),
)
sa.Index(
    "ix_project_memberships_user",
    project_memberships.c.app_user_id,
    project_memberships.c.workspace_id,
    project_memberships.c.role,
)


project_data_sources = sa.Table(
    "project_data_sources",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("source_type", sa.String(32), nullable=False),
    sa.Column("gcp_project_id", sa.String(128), nullable=False),
    sa.Column("dataset_id", sa.String(128), nullable=False),
    sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
    sa.Column("scope_kind", sa.String(32), nullable=False, server_default="customer"),
    sa.Column("safe_config", sa.JSON, nullable=True),
    sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint(
        "status IN ('pending', 'active', 'error', 'disabled')",
        name="ck_project_data_sources_status",
    ),
    sa.CheckConstraint(
        "scope_kind IN ('customer', 'internal_alias', 'demo')",
        name="ck_project_data_sources_scope_kind",
    ),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        name="fk_project_data_sources_workspace_project",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint("project_id", "source_type", name="uq_project_data_sources_type"),
)
sa.Index(
    "ix_project_data_sources_status",
    project_data_sources.c.workspace_id,
    project_data_sources.c.project_id,
    project_data_sources.c.status,
)
sa.Index(
    "uq_pds_customer_dataset_active",
    project_data_sources.c.gcp_project_id,
    project_data_sources.c.dataset_id,
    unique=True,
    postgresql_where=sa.text("status = 'active' AND scope_kind = 'customer'"),
    sqlite_where=sa.text("status = 'active' AND scope_kind = 'customer'"),
)


legacy_case_mappings = sa.Table(
    "legacy_case_mappings",
    platform_metadata,
    sa.Column("legacy_case_id", sa.String(100), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        name="fk_legacy_case_mappings_workspace_project",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint("project_id", name="uq_legacy_case_mappings_project"),
)


report_runs = sa.Table(
    "report_runs",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column(
        "created_by_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("client_run_id", sa.String(100), nullable=True),
    sa.Column("schema_version", sa.String(32), nullable=False, server_default="report.v2"),
    sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
    sa.Column("input_json", sa.JSON, nullable=True),
    sa.Column("error_code", sa.String(100), nullable=True),
    sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint(
        "status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')",
        name="ck_report_runs_status",
    ),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        name="fk_report_runs_workspace_project",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint("workspace_id", "project_id", "id", name="uq_report_runs_scope_id"),
    sa.UniqueConstraint("project_id", "client_run_id", name="uq_report_runs_project_client"),
)
sa.Index(
    "ix_report_runs_project_created",
    report_runs.c.workspace_id,
    report_runs.c.project_id,
    report_runs.c.created_at,
)
sa.Index(
    "ix_report_runs_status",
    report_runs.c.workspace_id,
    report_runs.c.status,
    report_runs.c.updated_at,
)


report_snapshots = sa.Table(
    "report_snapshots",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("report_run_id", sa.String(36), nullable=False),
    sa.Column("snapshot_version", sa.Integer, nullable=False, server_default="1"),
    sa.Column("title", sa.String(300), nullable=True),
    sa.Column("summary", sa.Text, nullable=True),
    sa.Column("report_json", sa.JSON, nullable=False),
    sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint("snapshot_version >= 1", name="ck_report_snapshots_version"),
    sa.CheckConstraint("size_bytes >= 0", name="ck_report_snapshots_size"),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id", "report_run_id"],
        ["report_runs.workspace_id", "report_runs.project_id", "report_runs.id"],
        name="fk_report_snapshots_scoped_run",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint("report_run_id", "snapshot_version", name="uq_report_snapshots_run_version"),
)
sa.Index(
    "ix_report_snapshots_scope_created",
    report_snapshots.c.workspace_id,
    report_snapshots.c.project_id,
    report_snapshots.c.created_at,
)


report_messages = sa.Table(
    "report_messages",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("report_run_id", sa.String(36), nullable=False),
    sa.Column(
        "app_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("role", sa.String(32), nullable=False),
    sa.Column("content", sa.Text, nullable=False),
    sa.Column("metadata_json", sa.JSON, nullable=True),
    sa.Column("ordinal", sa.Integer, nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint(
        "role IN ('user', 'assistant', 'system', 'tool')",
        name="ck_report_messages_role",
    ),
    sa.CheckConstraint("ordinal >= 0", name="ck_report_messages_ordinal"),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id", "report_run_id"],
        ["report_runs.workspace_id", "report_runs.project_id", "report_runs.id"],
        name="fk_report_messages_scoped_run",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint("report_run_id", "ordinal", name="uq_report_messages_run_ordinal"),
)
sa.Index("ix_report_messages_run_created", report_messages.c.report_run_id, report_messages.c.created_at)


report_share_links = sa.Table(
    "report_share_links",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("report_run_id", sa.String(36), nullable=False),
    sa.Column(
        "created_by_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("token_hash", sa.String(64), nullable=False),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("access_count", sa.Integer, nullable=False, server_default="0"),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint("access_count >= 0", name="ck_report_share_links_access_count"),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id", "report_run_id"],
        ["report_runs.workspace_id", "report_runs.project_id", "report_runs.id"],
        name="fk_report_share_links_scoped_run",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint("token_hash", name="uq_report_share_links_token_hash"),
)
sa.Index("ix_report_share_links_expiry", report_share_links.c.revoked_at, report_share_links.c.expires_at)


audit_events = sa.Table(
    "audit_events",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column(
        "project_id",
        sa.String(36),
        sa.ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column(
        "actor_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("event_type", sa.String(100), nullable=False),
    sa.Column("target_type", sa.String(100), nullable=True),
    sa.Column("target_id", sa.String(100), nullable=True),
    sa.Column("request_id", sa.String(100), nullable=True),
    sa.Column("metadata_json", sa.JSON, nullable=True),
    sa.Column("ip_hash", sa.String(64), nullable=True),
    sa.Column("user_agent_hash", sa.String(64), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
)
sa.Index("ix_audit_events_workspace_created", audit_events.c.workspace_id, audit_events.c.created_at)
sa.Index("ix_audit_events_actor_created", audit_events.c.actor_user_id, audit_events.c.created_at)


analysis_jobs = sa.Table(
    "analysis_jobs",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column(
        "created_by_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("job_type", sa.String(64), nullable=False),
    sa.Column("status", sa.String(32), nullable=False, server_default="queued"),
    sa.Column("stage", sa.String(64), nullable=True),
    sa.Column("progress_pct", sa.Integer, nullable=False, server_default="0"),
    sa.Column("idempotency_key", sa.String(255), nullable=True),
    sa.Column("request_json", sa.JSON, nullable=True),
    sa.Column("result_summary_json", sa.JSON, nullable=True),
    sa.Column("error_json", sa.JSON, nullable=True),
    sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint(
        "status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')",
        name="ck_analysis_jobs_status",
    ),
    sa.CheckConstraint(
        "progress_pct >= 0 AND progress_pct <= 100",
        name="ck_analysis_jobs_progress",
    ),
    sa.CheckConstraint("attempts >= 0", name="ck_analysis_jobs_attempts"),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        name="fk_analysis_jobs_workspace_project",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint("workspace_id", "project_id", "id", name="uq_analysis_jobs_scope_id"),
    sa.UniqueConstraint(
        "workspace_id", "idempotency_key", name="uq_analysis_jobs_workspace_idem"
    ),
)
sa.Index(
    "ix_analysis_jobs_project_created",
    analysis_jobs.c.workspace_id,
    analysis_jobs.c.project_id,
    analysis_jobs.c.created_at,
)
sa.Index("ix_analysis_jobs_status_heartbeat", analysis_jobs.c.status, analysis_jobs.c.heartbeat_at)


analysis_job_artifacts = sa.Table(
    "analysis_job_artifacts",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("analysis_job_id", sa.String(36), nullable=False),
    sa.Column("artifact_type", sa.String(64), nullable=False),
    sa.Column("storage_kind", sa.String(32), nullable=False),
    sa.Column("storage_ref", sa.String(1000), nullable=False),
    sa.Column("content_sha256", sa.String(64), nullable=True),
    sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
    sa.Column("mime_type", sa.String(200), nullable=True),
    sa.Column("metadata_json", sa.JSON, nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint(
        "storage_kind IN ('database', 'vercel_blob', 'inline')",
        name="ck_analysis_job_artifacts_storage_kind",
    ),
    sa.CheckConstraint("size_bytes >= 0", name="ck_analysis_job_artifacts_size"),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id", "analysis_job_id"],
        ["analysis_jobs.workspace_id", "analysis_jobs.project_id", "analysis_jobs.id"],
        name="fk_analysis_job_artifacts_scoped_job",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint(
        "analysis_job_id", "artifact_type", "storage_ref",
        name="uq_analysis_job_artifacts_ref",
    ),
)
sa.Index(
    "ix_analysis_job_artifacts_job",
    analysis_job_artifacts.c.analysis_job_id,
    analysis_job_artifacts.c.created_at,
)


workflow_step_executions = sa.Table(
    "workflow_step_executions",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column("analysis_job_id", sa.String(36), nullable=False),
    sa.Column("step_key", sa.String(100), nullable=False),
    sa.Column("attempt", sa.Integer, nullable=False, server_default="1"),
    sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
    sa.Column("input_json", sa.JSON, nullable=True),
    sa.Column("output_json", sa.JSON, nullable=True),
    sa.Column("error_json", sa.JSON, nullable=True),
    sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint("attempt >= 1", name="ck_workflow_step_executions_attempt"),
    sa.CheckConstraint(
        "status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'canceled')",
        name="ck_workflow_step_executions_status",
    ),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id", "analysis_job_id"],
        ["analysis_jobs.workspace_id", "analysis_jobs.project_id", "analysis_jobs.id"],
        name="fk_workflow_steps_scoped_job",
        ondelete="CASCADE",
    ),
    sa.UniqueConstraint(
        "analysis_job_id", "step_key", "attempt",
        name="uq_workflow_steps_job_step_attempt",
    ),
)
sa.Index(
    "ix_workflow_steps_job_status",
    workflow_step_executions.c.analysis_job_id,
    workflow_step_executions.c.status,
)


rate_limit_buckets = sa.Table(
    "rate_limit_buckets",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=True,
    ),
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
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    ),
    sa.Column("project_id", sa.String(36), nullable=True),
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
    sa.CheckConstraint(
        "monthly_limit_microunits >= 0", name="ck_ai_budget_accounts_limit"
    ),
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
        "workspace_id", "scope_key", "provider", name="uq_ai_budget_account_scope"
    ),
)


ai_usage_ledger = sa.Table(
    "ai_usage_ledger",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("workspace_id", sa.String(36), nullable=False),
    sa.Column("project_id", sa.String(36), nullable=False),
    sa.Column(
        "app_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("analysis_job_id", sa.String(36), nullable=True),
    sa.Column("report_run_id", sa.String(36), nullable=True),
    sa.Column("provider", sa.String(64), nullable=False),
    sa.Column("model", sa.String(128), nullable=True),
    sa.Column("operation", sa.String(100), nullable=False),
    sa.Column("input_tokens", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("output_tokens", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("estimated_cost_microunits", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
    sa.Column("idempotency_key", sa.String(255), nullable=False),
    sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint("input_tokens >= 0", name="ck_ai_usage_ledger_input_tokens"),
    sa.CheckConstraint("output_tokens >= 0", name="ck_ai_usage_ledger_output_tokens"),
    sa.CheckConstraint(
        "estimated_cost_microunits >= 0", name="ck_ai_usage_ledger_cost"
    ),
    sa.ForeignKeyConstraint(
        ["workspace_id", "project_id"],
        ["projects.workspace_id", "projects.id"],
        name="fk_ai_usage_ledger_workspace_project",
        ondelete="CASCADE",
    ),
    sa.ForeignKeyConstraint(
        ["analysis_job_id"],
        ["analysis_jobs.id"],
        name="fk_ai_usage_ledger_job",
        ondelete="SET NULL",
    ),
    sa.ForeignKeyConstraint(
        ["report_run_id"],
        ["report_runs.id"],
        name="fk_ai_usage_ledger_report",
        ondelete="SET NULL",
    ),
    sa.UniqueConstraint("idempotency_key", name="uq_ai_usage_ledger_idempotency"),
)
sa.Index(
    "ix_ai_usage_ledger_scope_time",
    ai_usage_ledger.c.workspace_id,
    ai_usage_ledger.c.project_id,
    ai_usage_ledger.c.occurred_at,
)
sa.Index(
    "ix_ai_usage_ledger_provider_time",
    ai_usage_ledger.c.workspace_id,
    ai_usage_ledger.c.provider,
    ai_usage_ledger.c.occurred_at,
)


billing_customers = sa.Table(
    "billing_customers",
    platform_metadata,
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    sa.Column("provider", sa.String(32), nullable=False, server_default="stripe"),
    sa.Column("provider_customer_id", sa.String(255), nullable=False),
    sa.Column("billing_email", sa.String(320), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.UniqueConstraint("provider_customer_id", name="uq_billing_customers_provider_id"),
)


subscriptions = sa.Table(
    "subscriptions",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
    ),
    sa.Column("provider", sa.String(32), nullable=False, server_default="stripe"),
    sa.Column("provider_subscription_id", sa.String(255), nullable=False),
    sa.Column("price_id", sa.String(255), nullable=False),
    sa.Column("plan_key", sa.String(100), nullable=False),
    sa.Column("status", sa.String(32), nullable=False),
    sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
    sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
    sa.Column("cancel_at_period_end", sa.Boolean, nullable=False, server_default=sa.false()),
    sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("last_provider_event_created_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.UniqueConstraint("provider_subscription_id", name="uq_subscriptions_provider_id"),
)
sa.Index("ix_subscriptions_workspace_status", subscriptions.c.workspace_id, subscriptions.c.status)
sa.Index("ix_subscriptions_period_end", subscriptions.c.status, subscriptions.c.current_period_end)


billing_webhook_events = sa.Table(
    "billing_webhook_events",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("provider", sa.String(32), nullable=False, server_default="stripe"),
    sa.Column("provider_event_id", sa.String(255), nullable=False),
    sa.Column("event_type", sa.String(150), nullable=False),
    sa.Column("provider_event_created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("payload_sha256", sa.String(64), nullable=False),
    sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
    sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    sa.Column("error_message", sa.Text, nullable=True),
    sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint("attempts >= 0", name="ck_billing_webhook_events_attempts"),
    sa.UniqueConstraint("provider_event_id", name="uq_billing_webhook_events_provider_id"),
)
sa.Index(
    "ix_billing_webhook_events_status",
    billing_webhook_events.c.status,
    billing_webhook_events.c.received_at,
)


legal_document_versions = sa.Table(
    "legal_document_versions",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("document_key", sa.String(64), nullable=False),
    sa.Column("version", sa.String(32), nullable=False),
    sa.Column("revision_number", sa.Integer, nullable=False),
    sa.Column("title", sa.String(300), nullable=False),
    sa.Column("public_url", sa.String(500), nullable=False),
    sa.Column("content_sha256", sa.String(64), nullable=False),
    sa.Column("effective_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("requires_reacceptance", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("required_at_signup", sa.Boolean, nullable=False, server_default=sa.true()),
    sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint("revision_number >= 1", name="ck_legal_document_versions_revision"),
    sa.UniqueConstraint(
        "document_key", "version", name="uq_legal_document_versions_key_version"
    ),
    sa.UniqueConstraint(
        "document_key", "revision_number", name="uq_legal_document_versions_key_revision"
    ),
)
sa.Index(
    "ix_legal_document_versions_effective",
    legal_document_versions.c.document_key,
    legal_document_versions.c.effective_at,
)


legal_acceptances = sa.Table(
    "legal_acceptances",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "app_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column(
        "document_version_id",
        sa.String(36),
        sa.ForeignKey("legal_document_versions.id", ondelete="RESTRICT"),
        nullable=False,
    ),
    sa.Column("subject_user_ref_hash", sa.String(64), nullable=False),
    sa.Column("workspace_scope_key", sa.String(36), nullable=False),
    sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("ip_hash", sa.String(64), nullable=True),
    sa.Column("user_agent_hash", sa.String(64), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.UniqueConstraint(
        "subject_user_ref_hash", "workspace_scope_key", "document_version_id",
        name="uq_legal_acceptances_subject_scope_doc",
    ),
)
sa.Index("ix_legal_acceptances_user", legal_acceptances.c.app_user_id, legal_acceptances.c.accepted_at)
sa.Index(
    "ix_legal_acceptances_workspace",
    legal_acceptances.c.workspace_id,
    legal_acceptances.c.accepted_at,
)


deletion_requests = sa.Table(
    "deletion_requests",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "requested_by_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("request_type", sa.String(32), nullable=False),
    sa.Column("target_ref_hash", sa.String(64), nullable=False),
    sa.Column("status", sa.String(32), nullable=False, server_default="requested"),
    sa.Column("execute_after", sa.DateTime(timezone=True), nullable=False),
    sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("error_message", sa.Text, nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint(
        "request_type IN ('account', 'workspace')",
        name="ck_deletion_requests_type",
    ),
    sa.CheckConstraint(
        "status IN ('requested', 'processing', 'canceled', 'completed', 'failed')",
        name="ck_deletion_requests_status",
    ),
)
sa.Index(
    "uq_deletion_requests_active_target",
    deletion_requests.c.request_type,
    deletion_requests.c.target_ref_hash,
    unique=True,
    postgresql_where=sa.text("status IN ('requested', 'processing')"),
    sqlite_where=sa.text("status IN ('requested', 'processing')"),
)
sa.Index(
    "ix_deletion_requests_due",
    deletion_requests.c.status,
    deletion_requests.c.execute_after,
)


privacy_export_artifacts = sa.Table(
    "privacy_export_artifacts",
    platform_metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column(
        "request_event_id",
        sa.String(36),
        sa.ForeignKey("audit_events.id", ondelete="RESTRICT"),
        nullable=False,
    ),
    sa.Column(
        "workspace_id",
        sa.String(36),
        sa.ForeignKey("workspaces.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column(
        "requested_by_user_id",
        sa.String(36),
        sa.ForeignKey("app_users.id", ondelete="SET NULL"),
        nullable=True,
    ),
    sa.Column("scope", sa.String(32), nullable=False),
    sa.Column("status", sa.String(32), nullable=False, server_default="processing"),
    sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
    sa.Column("encryption_key_id", sa.String(100), nullable=True),
    sa.Column("json_nonce_ciphertext", sa.LargeBinary, nullable=True),
    sa.Column("csv_nonce_ciphertext", sa.LargeBinary, nullable=True),
    sa.Column("content_sha256", sa.String(64), nullable=True),
    sa.Column("size_bytes", sa.BigInteger, nullable=False, server_default="0"),
    sa.Column("record_count", sa.Integer, nullable=False, server_default="0"),
    sa.Column("error_code", sa.String(100), nullable=True),
    sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    sa.CheckConstraint(
        "scope IN ('account', 'workspace')",
        name="ck_privacy_export_artifacts_scope",
    ),
    sa.CheckConstraint(
        "status IN ('processing', 'ready', 'failed', 'expired')",
        name="ck_privacy_export_artifacts_status",
    ),
    sa.CheckConstraint("attempts >= 0", name="ck_privacy_export_artifacts_attempts"),
    sa.CheckConstraint("size_bytes >= 0", name="ck_privacy_export_artifacts_size"),
    sa.CheckConstraint("record_count >= 0", name="ck_privacy_export_artifacts_records"),
    sa.UniqueConstraint(
        "request_event_id", name="uq_privacy_export_artifacts_request_event"
    ),
)
sa.Index(
    "ix_privacy_export_artifacts_status_expiry",
    privacy_export_artifacts.c.status,
    privacy_export_artifacts.c.expires_at,
)
