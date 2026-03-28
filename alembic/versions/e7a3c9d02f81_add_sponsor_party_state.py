"""Add sponsor_party and sponsor_state to legislation.

Revision ID: e7a3c9d02f81
Revises: d4e2f1a09b37
Create Date: 2026-03-23
"""
from typing import Union
from alembic import op
import sqlalchemy as sa


revision: str = 'e7a3c9d02f81'
down_revision: Union[str, None] = 'd4e2f1a09b37'
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(sa.text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def upgrade() -> None:
    if not _column_exists("legislation", "sponsor_party"):
        with op.batch_alter_table("legislation") as batch_op:
            batch_op.add_column(sa.Column("sponsor_party", sa.String(), nullable=True))
    if not _column_exists("legislation", "sponsor_state"):
        with op.batch_alter_table("legislation") as batch_op:
            batch_op.add_column(sa.Column("sponsor_state", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("legislation") as batch_op:
        batch_op.drop_column("sponsor_state")
        batch_op.drop_column("sponsor_party")
