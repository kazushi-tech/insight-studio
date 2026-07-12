"""Persistent analysis jobs, workflow steps, rate limits, and AI budgets.

Revision ID: 010
Revises: 009
Create Date: 2026-07-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "analysis_jobs",
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
        sa.UniqueConstraint(
            "workspace_id", "project_id", "id", name="uq_analysis_jobs_scope_id"
        ),
        sa.UniqueConstraint(
            "workspace_id", "idempotency_key", name="uq_analysis_jobs_workspace_idem"
        ),
    )
    op.create_index(
        "ix_analysis_jobs_project_created",
        "analysis_jobs",
        ["workspace_id", "project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_analysis_jobs_status_heartbeat",
        "analysis_jobs",
        ["status", "heartbeat_at"],
        unique=False,
    )

    op.create_table(
        "analysis_job_artifacts",
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
    op.create_index(
        "ix_analysis_job_artifacts_job",
        "analysis_job_artifacts",
        ["analysis_job_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "analysis_worker_heartbeats",
        sa.Column("worker_id", sa.String(100), primary_key=True),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("active_jobs", sa.Integer, nullable=False, server_default="0"),
        sa.Column("processed_jobs", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("last_job_id", sa.String(36), nullable=True),
        sa.Column("last_job_status", sa.String(16), nullable=True),
        sa.Column("last_job_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deployment_sha", sa.String(64), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
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
    op.create_index(
        "ix_analysis_worker_heartbeats_expiry",
        "analysis_worker_heartbeats",
        ["state", "expires_at"],
        unique=False,
    )

    op.create_table(
        "workflow_step_executions",
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
    op.create_index(
        "ix_workflow_steps_job_status",
        "workflow_step_executions",
        ["analysis_job_id", "status"],
        unique=False,
    )

    op.create_table(
        "rate_limit_buckets",
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
    op.create_index(
        "ix_rate_limit_buckets_expiry",
        "rate_limit_buckets",
        ["expires_at"],
        unique=False,
    )

    op.create_table(
        "ai_budget_accounts",
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

    op.create_table(
        "ai_usage_ledger",
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
    op.create_index(
        "ix_ai_usage_ledger_scope_time",
        "ai_usage_ledger",
        ["workspace_id", "project_id", "occurred_at"],
        unique=False,
    )
    op.create_index(
        "ix_ai_usage_ledger_provider_time",
        "ai_usage_ledger",
        ["workspace_id", "provider", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_ai_usage_ledger_provider_time", table_name="ai_usage_ledger")
    op.drop_index("ix_ai_usage_ledger_scope_time", table_name="ai_usage_ledger")
    op.drop_table("ai_usage_ledger")
    op.drop_table("ai_budget_accounts")
    op.drop_index("ix_rate_limit_buckets_expiry", table_name="rate_limit_buckets")
    op.drop_table("rate_limit_buckets")
    op.drop_index("ix_workflow_steps_job_status", table_name="workflow_step_executions")
    op.drop_table("workflow_step_executions")
    op.drop_index("ix_analysis_job_artifacts_job", table_name="analysis_job_artifacts")
    op.drop_table("analysis_job_artifacts")
    op.drop_index(
        "ix_analysis_worker_heartbeats_expiry",
        table_name="analysis_worker_heartbeats",
    )
    op.drop_table("analysis_worker_heartbeats")
    op.drop_index("ix_analysis_jobs_status_heartbeat", table_name="analysis_jobs")
    op.drop_index("ix_analysis_jobs_project_created", table_name="analysis_jobs")
    op.drop_table("analysis_jobs")
