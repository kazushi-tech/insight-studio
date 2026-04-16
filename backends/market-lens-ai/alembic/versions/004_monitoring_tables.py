"""Monitoring tables for Monitoring Lite (M5.6).

Revision ID: 004
Revises: 003
Create Date: 2026-03-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "watchlist_entries",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("url", sa.String, nullable=False),
        sa.Column("label", sa.String, nullable=True),
        sa.Column("check_interval_hours", sa.Integer, nullable=False, server_default="24"),
        sa.Column("last_checked_at", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )

    op.create_table(
        "digest_reports",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column(
            "entry_id",
            sa.String(12),
            sa.ForeignKey("watchlist_entries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("changes_detected", sa.Integer, nullable=False, server_default="0"),
        sa.Column("summary", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("digest_reports")
    op.drop_table("watchlist_entries")
