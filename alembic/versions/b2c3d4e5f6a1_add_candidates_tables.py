"""add candidates and vote predictions tables

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f6
Create Date: 2026-04-02

"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a1'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'candidates',
        sa.Column('id',              sa.String(),  nullable=False),
        sa.Column('name',            sa.String(),  nullable=False),
        sa.Column('district',        sa.String(),  nullable=False),
        sa.Column('party',           sa.String(),  nullable=True),
        sa.Column('bio',             sa.Text(),    nullable=True),
        sa.Column('photo_url',       sa.String(),  nullable=True),
        sa.Column('website_url',     sa.String(),  nullable=True),
        sa.Column('office_sought',   sa.String(),  nullable=True),
        sa.Column('election_year',   sa.Integer(), nullable=False),
        sa.Column('is_incumbent',    sa.Boolean(), nullable=True),
        sa.Column('known_positions', sa.Text(),    nullable=True),
        sa.Column('created_at',      sa.DateTime(), nullable=True),
        sa.Column('updated_at',      sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'candidate_vote_predictions',
        sa.Column('id',             sa.String(),  nullable=False),
        sa.Column('candidate_id',   sa.String(),  nullable=False),
        sa.Column('bill_id',        sa.String(),  nullable=False),
        sa.Column('predicted_vote', sa.String(),  nullable=False),
        sa.Column('reasoning',      sa.Text(),    nullable=True),
        sa.Column('ai_provider',    sa.String(),  nullable=True),
        sa.Column('ai_model',       sa.String(),  nullable=True),
        sa.Column('generated_at',   sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['candidate_id'], ['candidates.id']),
        sa.ForeignKeyConstraint(['bill_id'],      ['legislation.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('candidate_id', 'bill_id', name='uq_prediction_per_candidate_bill'),
    )
    op.create_index('ix_cvp_candidate_id', 'candidate_vote_predictions', ['candidate_id'])
    op.create_index('ix_cvp_bill_id',      'candidate_vote_predictions', ['bill_id'])


def downgrade() -> None:
    op.drop_index('ix_cvp_bill_id',      table_name='candidate_vote_predictions')
    op.drop_index('ix_cvp_candidate_id', table_name='candidate_vote_predictions')
    op.drop_table('candidate_vote_predictions')
    op.drop_table('candidates')
