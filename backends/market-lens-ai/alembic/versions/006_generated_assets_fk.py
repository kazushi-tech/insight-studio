"""Add foreign key constraint on generated_assets.review_run_id.

Revision ID: 006
Revises: 005
Create Date: 2026-03-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("generated_assets") as batch_op:
        batch_op.create_foreign_key(
            "fk_generated_assets_review_run_id",
            "review_runs",
            ["review_run_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    with op.batch_alter_table("generated_assets") as batch_op:
        batch_op.drop_constraint(
            "fk_generated_assets_review_run_id",
            type_="foreignkey",
        )
