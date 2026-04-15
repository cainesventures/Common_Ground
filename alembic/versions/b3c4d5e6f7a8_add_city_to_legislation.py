"""add_city_to_legislation

Revision ID: b3c4d5e6f7a8
Revises: e861ec7b1a2a
Create Date: 2026-04-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, None] = 'e861ec7b1a2a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add city column — existing rows default to 'philadelphia'
    op.add_column(
        'legislation',
        sa.Column('city', sa.String(), server_default='philadelphia', nullable=True)
    )
    # Index for city-filtered queries
    op.create_index('ix_legislation_city', 'legislation', ['city'])


def downgrade() -> None:
    op.drop_index('ix_legislation_city', table_name='legislation')
    op.drop_column('legislation', 'city')
