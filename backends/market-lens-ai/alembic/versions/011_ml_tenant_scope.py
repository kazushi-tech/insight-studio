"""Add tenant ownership to existing Market Lens root records.

Revision ID: 011
Revises: 010
Create Date: 2026-07-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INTERNAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001"
INTERNAL_PROJECT_ID = "00000000-0000-0000-0000-000000000002"

_STANDARD_TENANT_TABLES = (
    "assets",
    "review_runs",
    "discovery_searches",
    "library_items",
    "watchlist_entries",
    "jobs",
    "delivery_configs",
    "generated_assets",
)


def _add_standard_tenant_scope(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.add_column(sa.Column("workspace_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("project_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("created_by_user_id", sa.String(36), nullable=True))

    op.execute(
        sa.text(
            f"UPDATE {table_name} "
            "SET workspace_id = :workspace_id, project_id = :project_id "
            "WHERE workspace_id IS NULL OR project_id IS NULL"
        ).bindparams(
            workspace_id=INTERNAL_WORKSPACE_ID,
            project_id=INTERNAL_PROJECT_ID,
        )
    )

    with op.batch_alter_table(table_name) as batch_op:
        batch_op.alter_column(
            "workspace_id", existing_type=sa.String(36), nullable=False
        )
        batch_op.alter_column(
            "project_id", existing_type=sa.String(36), nullable=False
        )
        batch_op.create_foreign_key(
            f"fk_{table_name}_workspace_project",
            "projects",
            ["workspace_id", "project_id"],
            ["workspace_id", "id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            f"fk_{table_name}_created_by_user",
            "app_users",
            ["created_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        f"ix_{table_name}_tenant_scope",
        table_name,
        ["workspace_id", "project_id"],
        unique=False,
    )


def _drop_standard_tenant_scope(table_name: str) -> None:
    op.drop_index(f"ix_{table_name}_tenant_scope", table_name=table_name)
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.drop_constraint(
            f"fk_{table_name}_created_by_user", type_="foreignkey"
        )
        batch_op.drop_constraint(
            f"fk_{table_name}_workspace_project", type_="foreignkey"
        )
        batch_op.drop_column("created_by_user_id")
        batch_op.drop_column("project_id")
        batch_op.drop_column("workspace_id")


def upgrade() -> None:
    for table_name in _STANDARD_TENANT_TABLES:
        _add_standard_tenant_scope(table_name)

    # watchlists already had a free-form project_id. Preserve it before
    # replacing the active scope with the deterministic internal project.
    with op.batch_alter_table("watchlists") as batch_op:
        batch_op.add_column(sa.Column("workspace_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("created_by_user_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("legacy_project_ref", sa.String(64), nullable=True))
    op.execute(
        sa.text(
            "UPDATE watchlists SET legacy_project_ref = project_id, "
            "workspace_id = :workspace_id, project_id = :project_id"
        ).bindparams(
            workspace_id=INTERNAL_WORKSPACE_ID,
            project_id=INTERNAL_PROJECT_ID,
        )
    )
    with op.batch_alter_table("watchlists") as batch_op:
        batch_op.alter_column(
            "workspace_id", existing_type=sa.String(36), nullable=False
        )
        batch_op.alter_column(
            "project_id",
            existing_type=sa.String(64),
            type_=sa.String(36),
            nullable=False,
        )
        batch_op.create_foreign_key(
            "fk_watchlists_workspace_project",
            "projects",
            ["workspace_id", "project_id"],
            ["workspace_id", "id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_watchlists_created_by_user",
            "app_users",
            ["created_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        "ix_watchlists_tenant_scope",
        "watchlists",
        ["workspace_id", "project_id"],
        unique=False,
    )

    # usage_events already had a nullable free-form workspace_id. Preserve it
    # for forensic compatibility before enforcing the new tenant foreign key.
    with op.batch_alter_table("usage_events") as batch_op:
        batch_op.add_column(sa.Column("project_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("created_by_user_id", sa.String(36), nullable=True))
        batch_op.add_column(sa.Column("legacy_workspace_ref", sa.String(64), nullable=True))
    op.execute(
        sa.text(
            "UPDATE usage_events SET legacy_workspace_ref = workspace_id, "
            "workspace_id = :workspace_id, project_id = :project_id"
        ).bindparams(
            workspace_id=INTERNAL_WORKSPACE_ID,
            project_id=INTERNAL_PROJECT_ID,
        )
    )
    with op.batch_alter_table("usage_events") as batch_op:
        batch_op.alter_column(
            "workspace_id",
            existing_type=sa.String(64),
            type_=sa.String(36),
            nullable=False,
        )
        batch_op.alter_column(
            "project_id", existing_type=sa.String(36), nullable=False
        )
        batch_op.create_foreign_key(
            "fk_usage_events_workspace_project",
            "projects",
            ["workspace_id", "project_id"],
            ["workspace_id", "id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_usage_events_created_by_user",
            "app_users",
            ["created_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index(
        "ix_usage_events_tenant_scope",
        "usage_events",
        ["workspace_id", "project_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_usage_events_tenant_scope", table_name="usage_events")
    with op.batch_alter_table("usage_events") as batch_op:
        batch_op.drop_constraint(
            "fk_usage_events_created_by_user", type_="foreignkey"
        )
        batch_op.drop_constraint(
            "fk_usage_events_workspace_project", type_="foreignkey"
        )
    op.execute(
        "UPDATE usage_events SET workspace_id = legacy_workspace_ref"
    )
    with op.batch_alter_table("usage_events") as batch_op:
        batch_op.alter_column(
            "workspace_id",
            existing_type=sa.String(36),
            type_=sa.String(64),
            nullable=True,
        )
        batch_op.drop_column("legacy_workspace_ref")
        batch_op.drop_column("created_by_user_id")
        batch_op.drop_column("project_id")

    op.drop_index("ix_watchlists_tenant_scope", table_name="watchlists")
    with op.batch_alter_table("watchlists") as batch_op:
        batch_op.drop_constraint(
            "fk_watchlists_created_by_user", type_="foreignkey"
        )
        batch_op.drop_constraint(
            "fk_watchlists_workspace_project", type_="foreignkey"
        )
    op.execute("UPDATE watchlists SET project_id = legacy_project_ref")
    with op.batch_alter_table("watchlists") as batch_op:
        batch_op.alter_column(
            "project_id",
            existing_type=sa.String(36),
            type_=sa.String(64),
            nullable=True,
        )
        batch_op.drop_column("legacy_project_ref")
        batch_op.drop_column("created_by_user_id")
        batch_op.drop_column("workspace_id")

    for table_name in reversed(_STANDARD_TENANT_TABLES):
        _drop_standard_tenant_scope(table_name)
