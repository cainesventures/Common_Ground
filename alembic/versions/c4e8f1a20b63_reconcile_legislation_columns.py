"""reconcile_legislation_columns

Add the `legislation` columns that exist in production but that no migration
ever created.

Seven columns were added to the ORM model and reached the live database by
`create_all` (or by hand), and were never captured as a migration:

    headline, lede, metadata_fetched_at, news_fetched_at,
    skip_reason, votes_fetched_at, worker_retries

The consequence was that `alembic upgrade head` against an empty database
produced a `legislation` table 42 columns wide where production has 49. Nothing
noticed, because production's database is never built from migrations -- it is
restored wholesale from the Backblaze snapshot that publish.ps1 uploads. The
migration history had quietly stopped being able to reproduce the schema, and
the only thing standing between that and a lost database was the snapshot.

It surfaced because d9f4b6c80a15 is the first migration to reference
`headline`: on a fresh database it failed with "no such column: headline".
This migration is inserted *before* it so the chain can rebuild from nothing.

Conditional on purpose. Every existing database -- local and production --
already has all seven, so an unconditional `ADD COLUMN` would fail on exactly
the databases that matter. Each column is added only when the table does not
already have it, which makes this a no-op everywhere except a rebuild.

Types mirror app/models/__init__.py. There is no downgrade: these columns hold
real data in production, and a migration that can silently drop
`headline` for 8,663 bills is more dangerous than an irreversible one.

Revision ID: c4e8f1a20b63
Revises: c7a1b2d3e4f5
Create Date: 2026-10-09 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'c4e8f1a20b63'
down_revision: Union[str, None] = 'c7a1b2d3e4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (name, type) -- all nullable, all without a server default, matching how the
# ORM declares them and how the live rows look.
MISSING_COLUMNS = (
    ("headline", sa.String()),
    ("lede", sa.String()),
    ("metadata_fetched_at", sa.DateTime()),
    ("news_fetched_at", sa.DateTime()),
    ("votes_fetched_at", sa.DateTime()),
    ("skip_reason", sa.String()),
    ("worker_retries", sa.Integer()),
)


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("legislation")}
    for name, type_ in MISSING_COLUMNS:
        if name not in existing:
            op.add_column("legislation", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    # Intentionally empty. See the module docstring: dropping these would
    # destroy the headlines, ledes and pipeline timestamps that the site is
    # built on, and this migration exists to let a rebuild catch up with
    # production rather than to model a reversible schema change.
    pass
