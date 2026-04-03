"""add hearing columns to legislation

Revision ID: a1b2c3d4e5f6
Revises: f84f819166f4
Create Date: 2026-04-02

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = ('f84f819166f4', 'b4d1e7f08a23')
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('legislation', sa.Column('next_hearing_date',     sa.DateTime(), nullable=True))
    op.add_column('legislation', sa.Column('next_hearing_time',     sa.String(),   nullable=True))
    op.add_column('legislation', sa.Column('next_hearing_body',     sa.String(),   nullable=True))
    op.add_column('legislation', sa.Column('next_hearing_location', sa.String(),   nullable=True))


def downgrade() -> None:
    op.drop_column('legislation', 'next_hearing_location')
    op.drop_column('legislation', 'next_hearing_body')
    op.drop_column('legislation', 'next_hearing_time')
    op.drop_column('legislation', 'next_hearing_date')
