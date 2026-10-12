"""Shared pytest fixtures for Common Ground tests."""

import os

_GPU_NOTE = """Running the test suite must not touch the GPU.

test_health_ai_no_key exercises /health/ai, which makes a real
provider.complete() call. Locally that meant every `pytest` run pulled
llama3.1:8b — 5 GB — into an 8 GB card that is also driving the desktop, and
waited out a cold model load (observed at 71s, ~9 min for the whole suite).

Set before anything imports app.config, whose get_settings() is lru_cached and
would otherwise freeze the real values from .env.

The light model is the default here so that if any test ever does reach a
live Ollama, it pulls 2 GB rather than 5 GB. The real fix for /health/ai is in
the test itself, which stubs the provider out so no socket is opened at all —
pointing the base URL at a closed port was tried first and was worse: the
route's wait_for gives up after 10s but the blocked thread keeps running (see
main.py), and a connect to 127.0.0.1:1 takes ~58s to fail on Windows, so the
suite went from 6s to 69s.
See [feedback_never_launch_unguarded_gpu_runs] / scripts/gpu_guard.py.
"""
os.environ.setdefault("AI_MODEL", "llama3.2:3b")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import ContentBase, UserBase, Legislation, fts
from app.models.database import get_db


# ---------------------------------------------------------------------------
# Database fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def test_db():
    """
    In-memory SQLite session, schema created fresh for each test.

    StaticPool ensures all connections (including those acquired by FastAPI's
    async route handlers) share the same underlying in-memory database, so
    tables created by create_all are visible throughout the test.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Tests use a single in-memory DB for both content and user tables —
    # bind routing isn't needed because the metadata creates all tables here.
    ContentBase.metadata.create_all(bind=engine)
    UserBase.metadata.create_all(bind=engine)

    # legislation_fts is a virtual table, so create_all does not know about it.
    # Without it every search carrying a `q` returns a 500 here while passing
    # in production, which is exactly backwards for a test suite. Same DDL the
    # migration runs -- see app/models/fts.py.
    with engine.begin() as conn:
        fts.create_all(conn.exec_driver_sql, populate=False)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = Session()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Test client fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def client(test_db):
    """FastAPI TestClient with the test DB injected."""
    from main import app

    def _override():
        yield test_db

    app.dependency_overrides[get_db] = _override
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Reusable DB seeding helpers
# ---------------------------------------------------------------------------

def make_legislation(db, suffix="1"):
    leg = Legislation(
        id=f"bill_{suffix}",
        source="test",
        level="federal",
        bill_number=f"HR{suffix}",
        title=f"Test Healthcare Bill {suffix}",
        description="A bill to expand healthcare access.",
        status="introduced",
    )
    db.add(leg)
    db.flush()
    return leg
