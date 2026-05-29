"""add_bluesky_engagement

Revision ID: e8f2a3b4c5d6
Revises: d7e1f2a3b4c5
Create Date: 2026-05-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e8f2a3b4c5d6'
down_revision: Union[str, None] = 'd7e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('bluesky_posts', sa.Column('like_count', sa.Integer(), nullable=True))
    op.add_column('bluesky_posts', sa.Column('repost_count', sa.Integer(), nullable=True))
    op.add_column('bluesky_posts', sa.Column('reply_count', sa.Integer(), nullable=True))
    op.add_column('bluesky_posts', sa.Column('engagement_checked_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('bluesky_posts', 'engagement_checked_at')
    op.drop_column('bluesky_posts', 'reply_count')
    op.drop_column('bluesky_posts', 'repost_count')
    op.drop_column('bluesky_posts', 'like_count')
