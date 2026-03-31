"""add_digest_enabled_to_users

Revision ID: b4d1e7f08a23
Revises: a3c9e1f02b87
Create Date: 2026-03-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b4d1e7f08a23'
down_revision: Union[str, None] = 'a3c9e1f02b87'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('digest_enabled', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('users', 'digest_enabled')
