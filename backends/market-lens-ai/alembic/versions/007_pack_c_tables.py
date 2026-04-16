"""Pack C tables: watchlists, snapshots, jobs, delivery, admin.

Revision ID: 007
Revises: 006
Create Date: 2026-03-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Watchlists (project-level grouping) ──
    op.create_table(
        "watchlists",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("project_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=True),
    )

    # ── Extend watchlist_entries (batch mode for SQLite) ──
    with op.batch_alter_table("watchlist_entries") as batch_op:
        batch_op.add_column(sa.Column("watchlist_id", sa.String(12), nullable=True))
        batch_op.add_column(sa.Column("source_type", sa.String(32), nullable=True, server_default="official_site"))
        batch_op.add_column(sa.Column("last_snapshot_hash", sa.String(64), nullable=True))

    # ── Extend digest_reports (batch mode for SQLite) ──
    with op.batch_alter_table("digest_reports") as batch_op:
        batch_op.add_column(sa.Column("diff_json", sa.Text, nullable=True))

    # ── Watchlist snapshots ──
    op.create_table(
        "watchlist_snapshots",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column(
            "entry_id",
            sa.String(12),
            sa.ForeignKey("watchlist_entries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("title", sa.String, nullable=True),
        sa.Column("headlines", sa.Text, nullable=True),
        sa.Column("ctas", sa.Text, nullable=True),
        sa.Column("meta_description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )

    # ── Jobs (Phase 8) ──
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("job_type", sa.String(32), nullable=False),
        sa.Column("cron_expression", sa.String(64), nullable=True),
        sa.Column("target_id", sa.String(12), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("last_run_at", sa.DateTime, nullable=True),
        sa.Column("next_run_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=True),
    )

    op.create_table(
        "job_results",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(12),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("started_at", sa.DateTime, nullable=False),
        sa.Column("completed_at", sa.DateTime, nullable=True),
        sa.Column("result_json", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
    )

    # ── Delivery (Phase 8) ──
    op.create_table(
        "delivery_configs",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("target", sa.String, nullable=False),
        sa.Column("enabled", sa.Integer, nullable=False, server_default="1"),
        sa.Column("config_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=True),
    )

    op.create_table(
        "delivery_logs",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column(
            "config_id",
            sa.String(12),
            sa.ForeignKey("delivery_configs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("digest_id", sa.String(12), nullable=True),
        sa.Column("sent_at", sa.DateTime, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
    )

    # ── Admin usage (Phase 9) ──
    op.create_table(
        "usage_events",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("workspace_id", sa.String(64), nullable=True),
        sa.Column("detail_json", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("usage_events")
    op.drop_table("delivery_logs")
    op.drop_table("delivery_configs")
    op.drop_table("job_results")
    op.drop_table("jobs")
    op.drop_table("watchlist_snapshots")
    with op.batch_alter_table("digest_reports") as batch_op:
        batch_op.drop_column("diff_json")
    with op.batch_alter_table("watchlist_entries") as batch_op:
        batch_op.drop_column("last_snapshot_hash")
        batch_op.drop_column("source_type")
        batch_op.drop_column("watchlist_id")
    op.drop_table("watchlists")
