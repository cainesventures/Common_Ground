"""add_two_lane_columns

The case for / the case against, replacing the 17 personas as the thing a
reader sees first on an active bill. One row per bill, so columns on
legislation rather than a child table like bill_perspectives.

two_lane_state records why a bill has no case, which the page needs in order
to say nothing instead of showing an empty panel: "procedural" means triage
found no policy stake, "dropped" means the grounding checks rejected every
attempt. Neither stores text.

Revision ID: c7a1b2d3e4f5
Revises: e8f2a3b4c5d6
Create Date: 2026-10-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7a1b2d3e4f5'
down_revision: Union[str, None] = 'e8f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('legislation', sa.Column('case_for', sa.Text(), nullable=True))
    op.add_column('legislation', sa.Column('case_against', sa.Text(), nullable=True))
    op.add_column('legislation', sa.Column('two_lane_insights', sa.Text(), nullable=True))
    op.add_column('legislation', sa.Column('two_lane_state', sa.String(), nullable=True))
    op.add_column('legislation', sa.Column('two_lane_drop_reason', sa.String(), nullable=True))
    op.add_column('legislation', sa.Column('two_lane_model', sa.String(), nullable=True))
    op.add_column('legislation', sa.Column('two_lane_generated_at', sa.DateTime(), nullable=True))
    # Queried as "active bills still needing a case", which is the generator's
    # own work queue and the admin counts.
    op.create_index('ix_legislation_two_lane_state', 'legislation', ['two_lane_state'])


def downgrade() -> None:
    op.drop_index('ix_legislation_two_lane_state', table_name='legislation')
    op.drop_column('legislation', 'two_lane_generated_at')
    op.drop_column('legislation', 'two_lane_model')
    op.drop_column('legislation', 'two_lane_drop_reason')
    op.drop_column('legislation', 'two_lane_state')
    op.drop_column('legislation', 'two_lane_insights')
    op.drop_column('legislation', 'case_against')
    op.drop_column('legislation', 'case_for')
