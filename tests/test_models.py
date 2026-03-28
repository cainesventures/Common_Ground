"""Tests for Common Ground database models."""

import pytest
from app.models import Agent, Legislation


def test_agent_creation(test_db):
    """Test creating an agent."""
    agent = Agent(
        id="test_agent_1",
        name="Test Agent",
        description="A test agent",
        persona="Test persona",
        system_prompt="You are a test agent",
        expertise_areas="test",
        is_active=True
    )
    
    test_db.add(agent)
    test_db.commit()
    
    retrieved = test_db.query(Agent).filter(Agent.id == "test_agent_1").first()
    assert retrieved is not None
    assert retrieved.name == "Test Agent"


def test_legislation_creation(test_db):
    """Test creating legislation."""
    leg = Legislation(
        id="test_bill_1",
        source="test",
        level="federal",
        bill_number="HR123",
        title="Test Bill",
        status="introduced"
    )
    
    test_db.add(leg)
    test_db.commit()
    
    retrieved = test_db.query(Legislation).filter(Legislation.id == "test_bill_1").first()
    assert retrieved is not None
    assert retrieved.bill_number == "HR123"
