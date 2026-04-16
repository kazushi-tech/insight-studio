"""Library tables for Brand / Evidence Library (M5.5).

Revision ID: 003
Revises: 002
Create Date: 2026-03-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "library_items",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("item_type", sa.String(32), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("url", sa.String, nullable=True),
        sa.Column("tags", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("library_items")
