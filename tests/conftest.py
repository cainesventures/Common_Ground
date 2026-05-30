"""Shared pytest fixtures for Common Ground tests."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import ContentBase, UserBase, Legislation
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
