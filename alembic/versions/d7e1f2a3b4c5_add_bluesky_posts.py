"""add_bluesky_posts

Revision ID: d7e1f2a3b4c5
Revises: 9b09e817c541
Create Date: 2026-05-28 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7e1f2a3b4c5'
down_revision: Union[str, None] = '9b09e817c541'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'bluesky_posts',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('bill_id', sa.String(), sa.ForeignKey('legislation.id'), nullable=True),
        sa.Column('post_type', sa.String(), nullable=False),
        sa.Column('posted_at', sa.DateTime(), nullable=False),
        sa.Column('post_uri', sa.String(), nullable=True),
        sa.Column('post_cid', sa.String(), nullable=True),
    )
    op.create_index('ix_bluesky_posts_bill_id', 'bluesky_posts', ['bill_id'])
    op.create_index('ix_bluesky_posts_bill_type', 'bluesky_posts', ['bill_id', 'post_type'])
    op.create_index('ix_bluesky_posts_posted_at', 'bluesky_posts', ['posted_at'])


def downgrade() -> None:
    op.drop_index('ix_bluesky_posts_posted_at', table_name='bluesky_posts')
    op.drop_index('ix_bluesky_posts_bill_type', table_name='bluesky_posts')
    op.drop_index('ix_bluesky_posts_bill_id', table_name='bluesky_posts')
    op.drop_table('bluesky_posts')
