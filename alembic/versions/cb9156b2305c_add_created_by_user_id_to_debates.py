"""add_created_by_user_id_to_debates

Revision ID: cb9156b2305c
Revises: a2f8c3d91e04
Create Date: 2026-03-18 20:46:03.544729

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cb9156b2305c'
down_revision: Union[str, None] = 'a2f8c3d91e04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(sa.text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def upgrade() -> None:
    # agents: avatar_id, voice_id, owner_user_id (may already exist from create_all)
    if not _column_exists('agents', 'avatar_id'):
        op.add_column('agents', sa.Column('avatar_id', sa.String(), nullable=True))
    if not _column_exists('agents', 'voice_id'):
        op.add_column('agents', sa.Column('voice_id', sa.String(), nullable=True))
    if not _column_exists('agents', 'owner_user_id'):
        op.add_column('agents', sa.Column('owner_user_id', sa.String(), nullable=True))
        op.create_index('ix_agents_owner_user_id', 'agents', ['owner_user_id'], unique=False)

    # debates: created_by_user_id
    if not _column_exists('debates', 'created_by_user_id'):
        op.add_column('debates', sa.Column('created_by_user_id', sa.String(), nullable=True))
        op.create_index('ix_debates_created_by_user_id', 'debates', ['created_by_user_id'], unique=False)

    # legislation_votes: user_id
    if not _column_exists('legislation_votes', 'user_id'):
        op.add_column('legislation_votes', sa.Column('user_id', sa.String(), nullable=True))
        op.create_index('ix_legislation_votes_user_id', 'legislation_votes', ['user_id'], unique=False)

    # Note: SQLite does not support CREATE FOREIGN KEY or ALTER COLUMN SET NOT NULL —
    # these constraints are enforced at the application layer instead.


def downgrade() -> None:
    if _column_exists('legislation_votes', 'user_id'):
        op.drop_index('ix_legislation_votes_user_id', table_name='legislation_votes')
        with op.batch_alter_table('legislation_votes') as batch_op:
            batch_op.drop_column('user_id')

    if _column_exists('debates', 'created_by_user_id'):
        op.drop_index('ix_debates_created_by_user_id', table_name='debates')
        with op.batch_alter_table('debates') as batch_op:
            batch_op.drop_column('created_by_user_id')

    if _column_exists('agents', 'owner_user_id'):
        op.drop_index('ix_agents_owner_user_id', table_name='agents')
        with op.batch_alter_table('agents') as batch_op:
            batch_op.drop_column('owner_user_id')
    if _column_exists('agents', 'voice_id'):
        with op.batch_alter_table('agents') as batch_op:
            batch_op.drop_column('voice_id')
    if _column_exists('agents', 'avatar_id'):
        with op.batch_alter_table('agents') as batch_op:
            batch_op.drop_column('avatar_id')
