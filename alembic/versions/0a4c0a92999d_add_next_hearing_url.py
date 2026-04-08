"""add_next_hearing_url

Revision ID: 0a4c0a92999d
Revises: f2df069b6946
Create Date: 2026-04-07 18:41:06.789121

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a4c0a92999d'
down_revision: Union[str, None] = 'f2df069b6946'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('legislation', sa.Column('next_hearing_url', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('legislation', 'next_hearing_url')
