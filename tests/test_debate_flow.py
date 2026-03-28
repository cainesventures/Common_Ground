"""Tests for the core debate orchestration flow."""

import json
import pytest

from app.models import Debate, DebateMessage
from app.services.debate_service import DebateService
from tests.conftest import make_agent, make_legislation


# ---------------------------------------------------------------------------
# create_debate
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_debate(test_db):
    """Debate is created with correct initial state."""
    leg = make_legislation(test_db)
    agent = make_agent(test_db)
    test_db.commit()

    service = DebateService(test_db)
    debate = await service.create_debate(
        legislation_id=leg.id,
        topic="Should this bill pass?",
        agent_ids=[agent.id],
        max_turns=3,
    )

    assert debate.id.startswith("debate_")
    assert debate.legislation_id == leg.id
    assert debate.turn_count == 0
    assert debate.max_turns == 3
    assert debate.status in ("active", "researching")
    assert len(debate.participating_agents) == 1


@pytest.mark.asyncio
async def test_create_debate_unknown_legislation(test_db):
    """Creating a debate with a missing legislation_id raises ValueError."""
    service = DebateService(test_db)
    with pytest.raises(ValueError, match="not found"):
        await service.create_debate(
            legislation_id="nonexistent",
            topic="Test",
            agent_ids=[],
        )


@pytest.mark.asyncio
async def test_create_debate_skips_missing_agents(test_db):
    """Unknown agent IDs are silently skipped (logged as warning)."""
    leg = make_legislation(test_db)
    test_db.commit()

    service = DebateService(test_db)
    debate = await service.create_debate(
        legislation_id=leg.id,
        topic="Test",
        agent_ids=["ghost_agent"],
        max_turns=2,
        research_enabled=False,
    )
    assert len(debate.participating_agents) == 0


# ---------------------------------------------------------------------------
# run_research_phase
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_research_phase(test_db, mock_claude_agent):
    """Research phase populates research_data and transitions status to active."""
    leg = make_legislation(test_db)
    agent = make_agent(test_db)
    test_db.commit()

    service = DebateService(test_db)
    debate = await service.create_debate(
        legislation_id=leg.id,
        topic="Should this bill pass?",
        agent_ids=[agent.id],
        max_turns=2,
        research_enabled=True,
    )

    success = await service.run_research_phase(debate.id)

    assert success is True
    assert debate.status == "active"
    assert debate.research_data is not None
    research = json.loads(debate.research_data)
    assert agent.id in research
    assert "research" in research[agent.id]


@pytest.mark.asyncio
async def test_research_skipped_when_disabled(test_db, mock_claude_agent):
    """Research phase is a no-op when research_enabled=False."""
    leg = make_legislation(test_db)
    agent = make_agent(test_db)
    test_db.commit()

    service = DebateService(test_db)
    debate = await service.create_debate(
        legislation_id=leg.id,
        topic="Test",
        agent_ids=[agent.id],
        max_turns=2,
        research_enabled=False,
    )

    success = await service.run_research_phase(debate.id)
    assert success is True
    assert debate.research_data is None


# ---------------------------------------------------------------------------
# run_debate_turn
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_run_single_turn(test_db, mock_claude_agent):
    """A single turn creates exactly one DebateMessage with the right fields."""
    leg = make_legislation(test_db)
    agent = make_agent(test_db)
    test_db.commit()

    service = DebateService(test_db)
    debate = await service.create_debate(
        legislation_id=leg.id,
        topic="Test",
        agent_ids=[agent.id],
        max_turns=3,
        research_enabled=False,
    )

    is_continuing = await service.run_debate_turn(debate.id)

    assert is_continuing is True
    assert debate.turn_count == 1

    messages = test_db.query(DebateMessage).filter(DebateMessage.debate_id == debate.id).all()
    assert len(messages) == 1
    msg = messages[0]
    assert msg.agent_id == agent.id
    assert msg.argument  # non-empty
    assert msg.position in ("pro", "con")
    assert msg.turn_number == 1


@pytest.mark.asyncio
async def test_run_full_debate(test_db, mock_claude_agent):
    """Running all turns completes the debate and returns False on the last call."""
    leg = make_legislation(test_db)
    agent1 = make_agent(test_db, suffix="a1")
    agent2 = make_agent(test_db, suffix="a2")
    test_db.commit()

    max_turns = 4
    service = DebateService(test_db)
    debate = await service.create_debate(
        legislation_id=leg.id,
        topic="Test",
        agent_ids=[agent1.id, agent2.id],
        max_turns=max_turns,
        research_enabled=False,
    )

    continuing = True
    while continuing:
        continuing = await service.run_debate_turn(debate.id)

    assert debate.turn_count == max_turns
    assert debate.status == "completed"

    messages = test_db.query(DebateMessage).filter(DebateMessage.debate_id == debate.id).all()
    assert len(messages) == max_turns


@pytest.mark.asyncio
async def test_run_turn_no_agents(test_db):
    """Running a turn on a debate with no agents raises ValueError."""
    leg = make_legislation(test_db)
    test_db.commit()

    service = DebateService(test_db)
    debate = await service.create_debate(
        legislation_id=leg.id,
        topic="Test",
        agent_ids=[],
        max_turns=2,
        research_enabled=False,
    )

    with pytest.raises(ValueError, match="no participating agents"):
        await service.run_debate_turn(debate.id)
