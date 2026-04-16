"""Initial tables for Market Lens AI DB backend.

Revision ID: 001
Revises: None
Create Date: 2026-03-23
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "assets",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("file_name", sa.String, nullable=False),
        sa.Column("mime_type", sa.String, nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("width", sa.Integer, nullable=True),
        sa.Column("height", sa.Integer, nullable=True),
        sa.Column("asset_type", sa.String(32), nullable=False, server_default="banner"),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )

    op.create_table(
        "asset_data",
        sa.Column(
            "asset_id",
            sa.String(12),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("data", sa.LargeBinary, nullable=False),
    )

    op.create_table(
        "review_runs",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column("asset_id", sa.String(12), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column("review_type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("brand_info", sa.Text, nullable=True),
        sa.Column("operator_memo", sa.Text, nullable=True),
        sa.Column("model", sa.String(64), nullable=True),
        sa.Column("lp_url", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=True),
    )

    op.create_table(
        "review_outputs",
        sa.Column(
            "run_id",
            sa.String(12),
            sa.ForeignKey("review_runs.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("output_json", sa.Text, nullable=False),
        sa.Column("model_used", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=True),
    )

    op.create_table(
        "export_records",
        sa.Column("id", sa.String(12), primary_key=True),
        sa.Column(
            "run_id",
            sa.String(12),
            sa.ForeignKey("review_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("format", sa.String(16), nullable=False),
        sa.Column("file_name", sa.String, nullable=False),
        sa.Column("file_size_bytes", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("export_records")
    op.drop_table("review_outputs")
    op.drop_table("review_runs")
    op.drop_table("asset_data")
    op.drop_table("assets")
