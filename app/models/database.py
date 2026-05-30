"""Database connection and session management.

Two physical SQLite databases, one logical session:
  - content.db (dev source of truth, restored from B2 on publish)
  - users.db   (prod source of truth, never wiped)

SQLAlchemy routes each query to the right engine via the `binds` argument on
the session, based on the model's declarative base.  Cross-bind relationships
are NOT supported by SQLAlchemy — see app/models/__init__.py docstring for
the design rules.
"""

import os
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from app.config import get_settings
from app.models import ContentBase, UserBase

settings = get_settings()


def _resolve_users_url(content_url: str) -> str:
    """Pick a users.db URL.

    Honors USERS_DATABASE_URL when set.  Otherwise:
      - For sqlite content DBs, defaults to a sibling file in the same dir,
        replacing the content basename with 'users.db' (or appending '_users'
        if the content name doesn't follow the expected pattern).
      - For non-sqlite (e.g. Postgres in some future setup), bails out — the
        operator must set USERS_DATABASE_URL explicitly.
    """
    override = os.environ.get("USERS_DATABASE_URL", "").strip()
    if override:
        return override

    if not content_url.startswith("sqlite"):
        raise RuntimeError(
            "USERS_DATABASE_URL must be set explicitly when DATABASE_URL "
            "is not SQLite (got: " + content_url + ")"
        )

    # sqlite:///./common_ground_test.db -> sqlite:///./users.db
    # sqlite:////data/common_ground.db -> sqlite:////data/users.db
    prefix, sep, path = content_url.partition(":///")
    if not sep:
        # Malformed URL — best-effort fallback
        return "sqlite:///./users.db"
    dirname = os.path.dirname(path)
    return f"{prefix}:///{os.path.join(dirname, 'users.db') if dirname else 'users.db'}"


_content_url = settings.database_url
_users_url = _resolve_users_url(_content_url)

_is_sqlite_content = _content_url.startswith("sqlite")
_is_sqlite_users = _users_url.startswith("sqlite")

content_engine = create_engine(
    _content_url,
    echo=settings.debug,
    future=True,
    **({} if _is_sqlite_content else {"pool_size": 30, "max_overflow": 10, "pool_timeout": 60}),
)

users_engine = create_engine(
    _users_url,
    echo=settings.debug,
    future=True,
    **({} if _is_sqlite_users else {"pool_size": 30, "max_overflow": 10, "pool_timeout": 60}),
)

# Backwards compat: the historical export name.
engine = content_engine


@event.listens_for(content_engine, "connect")
def _content_sqlite_pragmas(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


@event.listens_for(users_engine, "connect")
def _users_sqlite_pragmas(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


# Session factory binds each declarative base to its engine.  Any query on a
# Content model routes to content_engine; any query on a User model routes to
# users_engine.  Mixed-bind transactions are serialized — each engine gets its
# own commit, in order — which is acceptable for our workload (no atomic
# multi-bind writes required).
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    binds={ContentBase: content_engine, UserBase: users_engine},
    future=True,
)


def get_db() -> Session:
    """Dependency to get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_USER_TABLE_NAMES = (
    "users", "bill_tracking", "legislation_votes",
    "councilmember_votes", "bluesky_posts", "donations",
)


def _bootstrap_users_from_legacy_content():
    """Copy user data from content.db to users.db when transitioning from the
    single-DB era.  Idempotent: only runs when users.db has no User rows AND
    content.db still carries the legacy user tables.
    """
    import logging
    from sqlalchemy import text, inspect
    logger = logging.getLogger(__name__)

    with users_engine.connect() as uc:
        try:
            u_count = uc.execute(text("SELECT COUNT(*) FROM users")).scalar() or 0
        except Exception:
            u_count = 0
    if u_count > 0:
        return  # Already migrated.

    with content_engine.connect() as cc:
        legacy_users = cc.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        )).first()
    if not legacy_users:
        return  # No legacy users table — fresh install.

    logger.info("Bootstrapping users.db from legacy content.db user tables...")
    copied = 0
    users_insp = inspect(users_engine)
    for tn in _USER_TABLE_NAMES:
        with content_engine.connect() as cc:
            has = cc.execute(text(
                f"SELECT name FROM sqlite_master WHERE type='table' AND name='{tn}'"
            )).first()
            if not has:
                continue
            rows = cc.execute(text(f"SELECT * FROM {tn}")).mappings().all()
        if not rows:
            continue
        try:
            users_cols = {c["name"] for c in users_insp.get_columns(tn)}
        except Exception:
            continue
        projected = [{k: v for k, v in dict(r).items() if k in users_cols} for r in rows]
        if not projected:
            continue
        columns = list(projected[0].keys())
        col_list = ", ".join(columns)
        placeholders = ", ".join(f":{c}" for c in columns)
        stmt = text(f"INSERT INTO {tn} ({col_list}) VALUES ({placeholders})")
        with users_engine.begin() as uc:
            uc.execute(stmt, projected)
        copied += len(projected)
        logger.info(f"  Bootstrapped {len(projected)} rows into users.db:{tn}")
    if copied:
        logger.info(f"Legacy-user bootstrap complete: {copied} rows total.")


def init_db():
    """Bring both DBs up to date on startup.

    content.db: Alembic-managed — runs upgrade to head.
    users.db:   Bootstrapped via UserBase.metadata.create_all (idempotent).
                On first run after the split, also copies any pre-existing
                user data out of content.db (where it lived historically).
    """
    from alembic.config import Config
    from alembic import command

    base_dir = os.path.dirname(__file__)
    alembic_cfg = Config(os.path.join(base_dir, "..", "..", "alembic.ini"))
    alembic_cfg.set_main_option(
        "script_location",
        os.path.join(base_dir, "..", "..", "alembic"),
    )
    alembic_cfg.set_main_option("sqlalchemy.url", _content_url)
    command.upgrade(alembic_cfg, "head")

    # Ensure user-tables exist on users.db (no-op once schema is in place).
    UserBase.metadata.create_all(users_engine)

    # Migrate any legacy single-DB user data over (idempotent).
    _bootstrap_users_from_legacy_content()
