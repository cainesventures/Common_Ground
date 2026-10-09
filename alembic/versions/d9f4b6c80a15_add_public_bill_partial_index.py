"""add_public_bill_partial_index

A partial index matching the "publicly visible bill" gate that
LegislationIngestionService.search_legislation applies when analyzed=True.

Why: /api/legislation/search is the busiest endpoint on the site -- the
homepage, the legislation list and every search go through it -- and its
dominant cost was its own COUNT(*). The gate requires analyzed_at, a non-empty
full_text and a non-empty headline, none of which any existing index covers, so
counting meant a full scan of 8,680 rows that average 6.5KB wide (full_text
reaches 221KB on the budget ordinances), reading overflow pages throughout.

Measured on the production corpus, same query, warm cache:

    COUNT(*) before : 78.9 ms
    COUNT(*) after  :  0.2 ms

The predicate must stay character-identical to the gate in
search_legislation, or SQLite will not use the index for that query. If the
gate changes, change this index with it.

introduced_date is the second column so the same index also serves the
ORDER BY introduced_date DESC on the page fetch.

Note on history: this revises c4e8f1a20b63, which backfills the seven
`legislation` columns that production has but no migration ever created --
`headline` among them. Without that predecessor this migration is the first to
reference `headline` and fails outright on a database built from migrations.

Revision ID: d9f4b6c80a15
Revises: c4e8f1a20b63
Create Date: 2026-10-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'd9f4b6c80a15'
down_revision: Union[str, None] = 'c4e8f1a20b63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEX_NAME = 'ix_legislation_public'
STATS_INDEX_NAME = 'ix_legislation_level_analyzed'

# Raw DDL rather than op.create_index(..., sqlite_where=...): the predicate has
# to match the ORM-generated WHERE clause textually for SQLite to pick the
# index up, and spelling it out here makes that comparison possible by reading.
# Key order follows the endpoint's actual WHERE clause, which is
#   level = ? AND city = ? AND <the gate>
# -- /api/legislation/search defaults local searches to city='philadelphia',
# so `city` is present on every real public query even though no caller passes
# it. Leaving it out of the key made it a residual term: the planner still
# picked the index up, then fell back to a row lookup per entry to test it, and
# the count stayed at 79ms. With `city` in the key it is 0.25ms. introduced_date
# stays last so the index also serves ORDER BY introduced_date DESC.
CREATE_INDEX = f"""
CREATE INDEX IF NOT EXISTS {INDEX_NAME}
    ON legislation (level, city, introduced_date)
 WHERE analyzed_at IS NOT NULL
   AND full_text IS NOT NULL
   AND full_text != ''
   AND headline IS NOT NULL
   AND headline != ''
"""


# Serves /api/legislation/stats, which the homepage hero pill calls on every
# visit for the bill count and the "Updated <date>" line. Both aggregates are
# scoped to level='local', and neither had an index that covered them:
# `max(analyzed_at)` with a level filter could not use ix_legislation_analyzed_at
# and fell back to reading 8,680 rows at ~57ms. As a covering index this is two
# index-only scans instead.
#
# (level, analyzed_at) rather than reusing (level, introduced_date): SQLite can
# answer count(*) from either, but only this one answers the max() too.
CREATE_STATS_INDEX = (
    f"CREATE INDEX IF NOT EXISTS {STATS_INDEX_NAME} "
    "ON legislation (level, analyzed_at)"
)


def upgrade() -> None:
    op.execute(CREATE_INDEX)
    op.execute(CREATE_STATS_INDEX)
    # Not optional. Without sqlite_stat1 the planner works from heuristics, and
    # it rates `analyzed_at IS NOT NULL` as a range scan -- so it chose
    # ix_legislation_level_analyzed for the search count and left it at 79ms,
    # i.e. adding these indexes made nothing faster and the stats index made
    # that query actively worse. With statistics it picks ix_legislation_public
    # and the same count runs in 0.25ms.
    #
    # sqlite_stat1 is an ordinary table, so it travels inside the DB file that
    # publish.ps1 snapshots to B2 and Railway restores -- production inherits
    # whatever was current when the snapshot was taken. Re-running ANALYZE
    # after a publish adds new bills is cheap and keeps it honest.
    op.execute("ANALYZE")


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {STATS_INDEX_NAME}")
    op.execute(f"DROP INDEX IF EXISTS {INDEX_NAME}")
    # Leave the planner without stale statistics describing dropped indexes.
    op.execute("ANALYZE")
