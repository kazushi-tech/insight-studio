"""Clerk-backed platform users, workspaces, projects, and access scopes.

Revision ID: 008
Revises: 007
Create Date: 2026-07-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INTERNAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001"
INTERNAL_PROJECT_ID = "00000000-0000-0000-0000-000000000002"


def upgrade() -> None:
    op.create_table(
        "app_users",
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
    op.create_index("ix_app_users_status", "app_users", ["status"], unique=False)

    op.create_table(
        "workspaces",
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
    op.create_index("ix_workspaces_status", "workspaces", ["status"], unique=False)

    op.create_table(
        "workspace_memberships",
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
    op.create_index(
        "ix_workspace_memberships_user",
        "workspace_memberships",
        ["app_user_id", "role"],
        unique=False,
    )

    op.create_table(
        "projects",
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
    op.create_index(
        "ix_projects_workspace_status",
        "projects",
        ["workspace_id", "status"],
        unique=False,
    )

    op.create_table(
        "project_memberships",
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
    op.create_index(
        "ix_project_memberships_user",
        "project_memberships",
        ["app_user_id", "workspace_id", "role"],
        unique=False,
    )

    op.create_table(
        "project_data_sources",
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
    op.create_index(
        "ix_project_data_sources_status",
        "project_data_sources",
        ["workspace_id", "project_id", "status"],
        unique=False,
    )
    active_customer_scope = sa.text("status = 'active' AND scope_kind = 'customer'")
    op.create_index(
        "uq_pds_customer_dataset_active",
        "project_data_sources",
        ["gcp_project_id", "dataset_id"],
        unique=True,
        postgresql_where=active_customer_scope,
        sqlite_where=active_customer_scope,
    )

    op.create_table(
        "legacy_case_mappings",
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

    workspace_table = sa.table(
        "workspaces",
        sa.column("id", sa.String),
        sa.column("clerk_organization_id", sa.String),
        sa.column("slug", sa.String),
        sa.column("name", sa.String),
        sa.column("status", sa.String),
        sa.column("is_internal", sa.Boolean),
    )
    project_table = sa.table(
        "projects",
        sa.column("id", sa.String),
        sa.column("workspace_id", sa.String),
        sa.column("slug", sa.String),
        sa.column("name", sa.String),
        sa.column("status", sa.String),
        sa.column("is_internal", sa.Boolean),
        sa.column("is_demo", sa.Boolean),
        sa.column("version", sa.Integer),
    )
    op.bulk_insert(
        workspace_table,
        [{
            "id": INTERNAL_WORKSPACE_ID,
            "clerk_organization_id": None,
            "slug": "insight-studio-internal",
            "name": "Insight Studio Internal",
            "status": "active",
            "is_internal": True,
        }],
    )
    op.bulk_insert(
        project_table,
        [{
            "id": INTERNAL_PROJECT_ID,
            "workspace_id": INTERNAL_WORKSPACE_ID,
            "slug": "legacy-internal",
            "name": "Legacy Internal Data",
            "status": "active",
            "is_internal": True,
            "is_demo": False,
            "version": 1,
        }],
    )


def downgrade() -> None:
    op.drop_table("legacy_case_mappings")
    op.drop_index("uq_pds_customer_dataset_active", table_name="project_data_sources")
    op.drop_index("ix_project_data_sources_status", table_name="project_data_sources")
    op.drop_table("project_data_sources")
    op.drop_index("ix_project_memberships_user", table_name="project_memberships")
    op.drop_table("project_memberships")
    op.drop_index("ix_projects_workspace_status", table_name="projects")
    op.drop_table("projects")
    op.drop_index("ix_workspace_memberships_user", table_name="workspace_memberships")
    op.drop_table("workspace_memberships")
    op.drop_index("ix_workspaces_status", table_name="workspaces")
    op.drop_table("workspaces")
    op.drop_index("ix_app_users_status", table_name="app_users")
    op.drop_table("app_users")
