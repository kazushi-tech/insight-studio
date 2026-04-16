"""Discovery tables for competitor URL discovery (M5.2).

Revision ID: 002
Revises: 001
Create Date: 2026-03-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "discovery_searches",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("brand_url", sa.String, nullable=False),
        sa.Column("brand_domain", sa.String, nullable=False),
        sa.Column("query_used", sa.String, nullable=False),
        sa.Column("provider", sa.String(16), nullable=False, server_default="cse"),
        sa.Column("result_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )

    op.create_table(
        "discovery_candidates",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column(
            "search_id",
            sa.String(12),
            sa.ForeignKey("discovery_searches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("url", sa.String, nullable=False),
        sa.Column("domain", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=True),
        sa.Column("snippet", sa.Text, nullable=True),
        sa.Column("score", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("discovery_candidates")
    op.drop_table("discovery_searches")
