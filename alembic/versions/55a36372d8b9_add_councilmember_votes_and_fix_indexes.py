"""add_councilmember_votes_and_fix_indexes

Revision ID: 55a36372d8b9
Revises: b2c3d4e5f6a1
Create Date: 2026-04-06 12:18:32.617946

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '55a36372d8b9'
down_revision: Union[str, None] = 'b2c3d4e5f6a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect, text
    bind = op.get_bind()
    inspector = inspect(bind)

    # Fix index renames on candidate_vote_predictions (idempotent — create_all may have used new names already)
    existing_indexes = {ix['name'] for ix in inspector.get_indexes('candidate_vote_predictions')}
    if 'ix_cvp_bill_id' in existing_indexes:
        op.drop_index('ix_cvp_bill_id', table_name='candidate_vote_predictions')
    if 'ix_cvp_candidate_id' in existing_indexes:
        op.drop_index('ix_cvp_candidate_id', table_name='candidate_vote_predictions')
    if 'ix_candidate_vote_predictions_bill_id' not in existing_indexes:
        op.create_index(op.f('ix_candidate_vote_predictions_bill_id'), 'candidate_vote_predictions', ['bill_id'], unique=False)
    if 'ix_candidate_vote_predictions_candidate_id' not in existing_indexes:
        op.create_index(op.f('ix_candidate_vote_predictions_candidate_id'), 'candidate_vote_predictions', ['candidate_id'], unique=False)

    # Add councilmember_votes table (idempotent — create_all may have already created it)
    if not inspector.has_table('councilmember_votes'):
        op.create_table(
            'councilmember_votes',
            sa.Column('id', sa.String(), nullable=False),
            sa.Column('councilmember_id', sa.String(), nullable=False),
            sa.Column('user_id', sa.String(), nullable=True),
            sa.Column('vote', sa.String(), nullable=False),
            sa.Column('voter_token', sa.String(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['councilmember_id'], ['councilmembers.id']),
            sa.ForeignKeyConstraint(['user_id'], ['users.id']),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('councilmember_id', 'voter_token', name='uq_cm_vote_per_voter'),
        )
        op.create_index(op.f('ix_councilmember_votes_councilmember_id'), 'councilmember_votes', ['councilmember_id'], unique=False)
        op.create_index(op.f('ix_councilmember_votes_user_id'), 'councilmember_votes', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_councilmember_votes_user_id'), table_name='councilmember_votes')
    op.drop_index(op.f('ix_councilmember_votes_councilmember_id'), table_name='councilmember_votes')
    op.drop_table('councilmember_votes')

    op.drop_index(op.f('ix_candidate_vote_predictions_candidate_id'), table_name='candidate_vote_predictions')
    op.drop_index(op.f('ix_candidate_vote_predictions_bill_id'), table_name='candidate_vote_predictions')
    op.create_index('ix_cvp_candidate_id', 'candidate_vote_predictions', ['candidate_id'], unique=False)
    op.create_index('ix_cvp_bill_id', 'candidate_vote_predictions', ['bill_id'], unique=False)
