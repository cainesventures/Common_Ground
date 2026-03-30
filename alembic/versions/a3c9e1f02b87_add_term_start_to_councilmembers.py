"""add_term_start_to_councilmembers

Revision ID: a3c9e1f02b87
Revises: f84f819166f4
Create Date: 2026-03-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3c9e1f02b87'
down_revision: Union[str, None] = 'f84f819166f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('councilmembers', sa.Column('term_start', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('councilmembers', 'term_start')
