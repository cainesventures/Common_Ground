"""add_argument_variants

Revision ID: d4e2f1a09b37
Revises: cb9156b2305c
Create Date: 2026-03-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e2f1a09b37'
down_revision: Union[str, None] = 'cb9156b2305c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(sa.text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def upgrade() -> None:
    if not _column_exists('debate_messages', 'argument_variants'):
        op.add_column('debate_messages',
            sa.Column('argument_variants', sa.Text(), nullable=True))


def downgrade() -> None:
    if _column_exists('debate_messages', 'argument_variants'):
        with op.batch_alter_table('debate_messages') as batch_op:
            batch_op.drop_column('argument_variants')
