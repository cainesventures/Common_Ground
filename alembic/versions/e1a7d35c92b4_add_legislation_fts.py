"""add_legislation_fts

A full-text index over the fields a human would actually search, replacing
five chained `LIKE '%term%'` scans.

Why: /api/legislation/search matched only `title` and `bill_number` until
recently -- the two fields written in legalese -- so "pothole", "Navy Yard" and
"AirBnB" returned nothing. Adding `headline`, `plain_title` and `summary` to
the LIKE chain fixed the recall but tripled the cost, because a leading
wildcard cannot use an index: every query became a full scan of 8,680 rows and
the count alone took 67ms.

    text-search count, 5 x LIKE   67.2 ms
    text-search count, FTS5        0.5 ms

The index costs about 0.2MB on a 161MB database.

Two things FTS5 also fixes, which LIKE could not:

  * **Word awareness.** `LIKE '%tenant%'` matches "lieutenant". The porter
    tokenizer matches "tenant" and "tenants" and not "lieutenant", so the
    tenant query drops from 142 hits to 101 more accurate ones.
  * **Relevance.** FTS5 exposes `rank`, so a search can be ordered by how well
    a bill matches instead of by date. Searching "tenant" previously returned
    bills about cigarettes and tax refunds first, because they merely mentioned
    tenants and happened to be recent.

Kept in sync by triggers rather than by a periodic rebuild: a silently stale
search index returns wrong results with no error, and the enrichment worker
rewrites `headline` and `summary` outside the publish flow. publish.ps1 also
has an `ANALYZE` step, and a 'rebuild' there would be a reasonable belt-and-
braces, but the triggers are what make correctness not depend on remembering.

An external-content table (`content='legislation'`) so the text is stored once;
the FTS table holds only the index.

Revision ID: e1a7d35c92b4
Revises: d9f4b6c80a15
Create Date: 2026-10-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

from app.models import fts as fts_schema


revision: str = 'e1a7d35c92b4'
down_revision: Union[str, None] = 'd9f4b6c80a15'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # DDL comes from app/models/fts.py so the migration, the test fixture and
    # any rebuild script cannot disagree about the search schema -- they did,
    # and the result was every `q`-bearing search 500ing under pytest while
    # passing in production. That module's docstring explains why importing
    # app code here is the right trade for a derived index.
    fts_schema.create_all(op.execute)

    # The planner needs statistics for the new table before it will cost the
    # FTS join sensibly.
    op.execute("ANALYZE")


def downgrade() -> None:
    fts_schema.drop_all(op.execute)
    op.execute("ANALYZE")
