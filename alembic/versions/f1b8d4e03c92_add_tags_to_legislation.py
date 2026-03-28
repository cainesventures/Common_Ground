"""Add tags column to legislation.

Revision ID: f1b8d4e03c92
Revises: e7a3c9d02f81
Create Date: 2026-03-23
"""
from typing import Union
from alembic import op
import sqlalchemy as sa


revision: str = 'f1b8d4e03c92'
down_revision: Union[str, None] = 'e7a3c9d02f81'
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(sa.text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def upgrade() -> None:
    if not _column_exists("legislation", "tags"):
        with op.batch_alter_table("legislation") as batch_op:
            batch_op.add_column(sa.Column("tags", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("legislation") as batch_op:
        batch_op.drop_column("tags")
