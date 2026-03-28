"""subscription_tier and participant_settings

Revision ID: a2f8c3d91e04
Revises: c5b1a7160033
Create Date: 2026-03-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2f8c3d91e04'
down_revision: Union[str, None] = 'c5b1a7160033'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(sa.text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def upgrade() -> None:
    # Add subscription_tier if not already present (may exist from create_all)
    if not _column_exists('users', 'subscription_tier'):
        op.add_column('users', sa.Column('subscription_tier', sa.String(), nullable=True))

    # Migrate data: is_developer=True → 'dev', else 'free'
    if _column_exists('users', 'is_developer'):
        op.execute("UPDATE users SET subscription_tier = CASE WHEN is_developer = 1 THEN 'dev' ELSE 'free' END WHERE subscription_tier IS NULL OR subscription_tier = ''")

    # Drop is_developer using batch mode (required for SQLite column drops)
    if _column_exists('users', 'is_developer'):
        with op.batch_alter_table('users') as batch_op:
            batch_op.drop_column('is_developer')

    # Add participant_settings to debates if not present
    if not _column_exists('debates', 'participant_settings'):
        op.add_column('debates', sa.Column('participant_settings', sa.Text(), nullable=True))


def downgrade() -> None:
    if _column_exists('debates', 'participant_settings'):
        op.drop_column('debates', 'participant_settings')

    if not _column_exists('users', 'is_developer'):
        op.add_column('users', sa.Column('is_developer', sa.Boolean(), nullable=True))
        op.execute("UPDATE users SET is_developer = CASE WHEN subscription_tier = 'dev' THEN 1 ELSE 0 END")

    if _column_exists('users', 'subscription_tier'):
        with op.batch_alter_table('users') as batch_op:
            batch_op.drop_column('subscription_tier')
