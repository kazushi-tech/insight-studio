"""Generation tables for AI Banner Generation (M5.7).

Revision ID: 005
Revises: 004
Create Date: 2026-03-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "generated_assets",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("review_run_id", sa.String(12), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("prompt_used", sa.Text, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("completed_at", sa.DateTime, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("generated_assets")
