"""Database connection and session management."""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, Session
from app.config import get_settings

settings = get_settings()

# SQLite uses NullPool; Postgres uses the default pool
_is_sqlite = settings.database_url.startswith("sqlite")
engine = create_engine(
    settings.database_url,
    echo=settings.debug,
    future=True,
    **({} if _is_sqlite else {"pool_size": 30, "max_overflow": 10, "pool_timeout": 60}),
)


@event.listens_for(engine, "connect")
def set_sqlite_pragmas(dbapi_conn, _):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

# Create session factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    future=True
)


def get_db() -> Session:
    """Dependency to get database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Run any pending Alembic migrations to bring the schema up to date."""
    from alembic.config import Config
    from alembic import command
    import os

    alembic_cfg = Config(os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini"))
    alembic_cfg.set_main_option(
        "script_location",
        os.path.join(os.path.dirname(__file__), "..", "..", "alembic"),
    )
    command.upgrade(alembic_cfg, "head")
