"""Shared pytest fixtures for Common Ground tests."""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Agent, Legislation
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
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = Session()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Canned AI responses
# ---------------------------------------------------------------------------

CANNED_ARGUMENT = {
    "agent_id": "agent_test",
    "agent_name": "Test Agent",
    "position": "pro",
    "argument": "This is a well-reasoned test argument supporting the legislation.",
    "turn_number": 1,
    "stop_reason": "end_turn",
}

CANNED_RESEARCH = {
    "research": "Key facts: This legislation addresses healthcare access. Historical context: ...",
    "source": "claude",
    "confidence": "high",
}

CANNED_RATING = {
    "rater_agent_id": "agent_test",
    "rater_name": "Test Agent",
    "rating_data": {
        "scores": {
            "persuasiveness": 7.5,
            "logical_soundness": 8.0,
            "factual_accuracy": 7.0,
            "relevance": 8.5,
            "overall": 7.75,
        },
        "reasoning": "Well-structured argument with clear evidence.",
        "overall_assessment": "Strong argument.",
        "strengths": ["Clear structure", "Good evidence"],
        "weaknesses": ["Could use more data"],
    },
    "timestamp": None,
}


@pytest.fixture
def mock_claude_agent():
    """Patch ClaudeDebateAgent so no real Anthropic API calls are made."""
    with (
        patch(
            "app.agents.debate_agent.ClaudeDebateAgent.generate_argument",
            new_callable=AsyncMock,
            return_value=CANNED_ARGUMENT,
        ),
        patch(
            "app.agents.debate_agent.ClaudeDebateAgent.research_topic",
            new_callable=AsyncMock,
            return_value=CANNED_RESEARCH,
        ),
        patch(
            "app.agents.debate_agent.ClaudeDebateAgent.rate_argument",
            new_callable=AsyncMock,
            return_value=CANNED_RATING,
        ),
    ):
        yield


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

def make_agent(db, suffix="1", agent_type="claude"):
    agent = Agent(
        id=f"agent_{suffix}",
        name=f"Test Agent {suffix}",
        description="A test agent",
        persona="Policy Expert",
        system_prompt="You are a policy expert.",
        expertise_areas="policy",
        agent_type=agent_type,
        is_active=True,
    )
    db.add(agent)
    db.flush()
    return agent


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
