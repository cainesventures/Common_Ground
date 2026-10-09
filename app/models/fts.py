"""The full-text search index over `legislation`.

The DDL lives here, in one place, because three callers need it and a fourth
would otherwise invent its own:

  * migration e1a7d35c92b4, which installs it on the content DB
  * the test fixture, which builds schema with `create_all` and would
    otherwise have no `legislation_fts` -- making every search with a `q`
    return a 500 in tests while passing in production
  * any future rebuild script

A migration importing application code is usually a mistake, because a
migration is meant to be a frozen snapshot of the schema at a point in time
while the application keeps moving. The exception is earned here: this is a
derived search index, not user data. If its definition ever changes, the change
arrives as a new migration, and the worst case for an old migration creating
the newer shape is that an index gets rebuilt -- nothing is lost. Weighed
against that, having the test suite and the migration disagree about the search
schema is the more expensive failure, and it is the one that actually happened.

`legislation_fts` is an external-content table: the text stays in
`legislation`, and this holds only the inverted index (about 0.2MB against a
161MB database). External-content tables are not maintained automatically,
which is what the triggers are for.
"""

# Column order is part of the contract: the triggers below and
# `_legislation_fts` / `_fts_match` in app.services.legislation_service are
# written against these names.
FTS_COLUMNS = ("bill_number", "title", "headline", "plain_title", "summary")

_COLS = ", ".join(FTS_COLUMNS)
_NEW_COLS = ", ".join(f"new.{c}" for c in FTS_COLUMNS)
_OLD_COLS = ", ".join(f"old.{c}" for c in FTS_COLUMNS)


# porter over unicode61: unicode61 folds case and accents, porter stems, so
# "requires" matches "require" and "tenant" does not match "lieutenant" the way
# a LIKE '%tenant%' did. Both ship inside SQLite's own FTS5, with no extension
# to load -- which matters because production runs whatever sqlite the
# python:3.12-slim image provides rather than a build we control.
CREATE_TABLE = f"""
CREATE VIRTUAL TABLE IF NOT EXISTS legislation_fts USING fts5(
    {_COLS},
    content='legislation',
    content_rowid='rowid',
    tokenize='porter unicode61'
)
"""

POPULATE = f"""
INSERT INTO legislation_fts(rowid, {_COLS})
    SELECT rowid, {_COLS} FROM legislation
"""

# The 'delete' command must be given the OLD column values: that is how FTS5
# locates the index entries to remove. Passing the new values instead leaves
# stale terms behind and corrupts the index -- it does not error, it just
# starts returning wrong rows.
CREATE_TRIGGERS = (
    f"""
    CREATE TRIGGER IF NOT EXISTS legislation_fts_insert
    AFTER INSERT ON legislation BEGIN
        INSERT INTO legislation_fts(rowid, {_COLS})
        VALUES (new.rowid, {_NEW_COLS});
    END
    """,
    f"""
    CREATE TRIGGER IF NOT EXISTS legislation_fts_delete
    AFTER DELETE ON legislation BEGIN
        INSERT INTO legislation_fts(legislation_fts, rowid, {_COLS})
        VALUES ('delete', old.rowid, {_OLD_COLS});
    END
    """,
    f"""
    CREATE TRIGGER IF NOT EXISTS legislation_fts_update
    AFTER UPDATE ON legislation BEGIN
        INSERT INTO legislation_fts(legislation_fts, rowid, {_COLS})
        VALUES ('delete', old.rowid, {_OLD_COLS});
        INSERT INTO legislation_fts(rowid, {_COLS})
        VALUES (new.rowid, {_NEW_COLS});
    END
    """,
)

DROP_OBJECTS = (
    "DROP TRIGGER IF EXISTS legislation_fts_update",
    "DROP TRIGGER IF EXISTS legislation_fts_delete",
    "DROP TRIGGER IF EXISTS legislation_fts_insert",
    "DROP TABLE IF EXISTS legislation_fts",
)


def create_all(execute, populate: bool = True) -> None:
    """Create the FTS table and its triggers.

    `execute` is any callable taking one SQL string -- `op.execute` under
    alembic, or `connection.exec_driver_sql` / `cursor.execute` elsewhere --
    so this works without caring which layer the caller is in.

    Pass ``populate=False`` for an empty database, where the backfill SELECT
    has nothing to do and the triggers will index rows as they arrive.
    """
    execute(CREATE_TABLE)
    if populate:
        execute(POPULATE)
    for stmt in CREATE_TRIGGERS:
        execute(stmt)


def drop_all(execute) -> None:
    """Remove the FTS table and its triggers."""
    for stmt in DROP_OBJECTS:
        execute(stmt)
