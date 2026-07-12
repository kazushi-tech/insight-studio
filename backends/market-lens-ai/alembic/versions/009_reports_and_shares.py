"""Persistent reports, snapshots, conversations, sharing, and audit events.

Revision ID: 009
Revises: 008
Create Date: 2026-07-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "report_runs",
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
        sa.UniqueConstraint(
            "workspace_id", "project_id", "id", name="uq_report_runs_scope_id"
        ),
        sa.UniqueConstraint(
            "project_id", "client_run_id", name="uq_report_runs_project_client"
        ),
    )
    op.create_index(
        "ix_report_runs_project_created",
        "report_runs",
        ["workspace_id", "project_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_report_runs_status",
        "report_runs",
        ["workspace_id", "status", "updated_at"],
        unique=False,
    )

    op.create_table(
        "report_snapshots",
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
        sa.UniqueConstraint(
            "report_run_id", "snapshot_version", name="uq_report_snapshots_run_version"
        ),
    )
    op.create_index(
        "ix_report_snapshots_scope_created",
        "report_snapshots",
        ["workspace_id", "project_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "report_messages",
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
        sa.UniqueConstraint(
            "report_run_id", "ordinal", name="uq_report_messages_run_ordinal"
        ),
    )
    op.create_index(
        "ix_report_messages_run_created",
        "report_messages",
        ["report_run_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "report_share_links",
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
    op.create_index(
        "ix_report_share_links_expiry",
        "report_share_links",
        ["revoked_at", "expires_at"],
        unique=False,
    )

    op.create_table(
        "audit_events",
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
    op.create_index(
        "ix_audit_events_workspace_created",
        "audit_events",
        ["workspace_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_events_actor_created",
        "audit_events",
        ["actor_user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_audit_events_actor_created", table_name="audit_events")
    op.drop_index("ix_audit_events_workspace_created", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_index("ix_report_share_links_expiry", table_name="report_share_links")
    op.drop_table("report_share_links")
    op.drop_index("ix_report_messages_run_created", table_name="report_messages")
    op.drop_table("report_messages")
    op.drop_index("ix_report_snapshots_scope_created", table_name="report_snapshots")
    op.drop_table("report_snapshots")
    op.drop_index("ix_report_runs_status", table_name="report_runs")
    op.drop_index("ix_report_runs_project_created", table_name="report_runs")
    op.drop_table("report_runs")
