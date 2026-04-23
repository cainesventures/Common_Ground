"""add_committee_final_date_co_sponsors

Revision ID: 9b09e817c541
Revises: b3c4d5e6f7a8
Create Date: 2026-04-20 19:33:14.065303

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9b09e817c541'
down_revision: Union[str, None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('legislation', sa.Column('committee', sa.String(), nullable=True))
    op.add_column('legislation', sa.Column('final_date', sa.DateTime(), nullable=True))
    op.add_column('legislation', sa.Column('co_sponsors', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('legislation', 'co_sponsors')
    op.drop_column('legislation', 'final_date')
    op.drop_column('legislation', 'committee')
