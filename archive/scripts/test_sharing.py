"""Test script for social sharing functionality."""

import asyncio
import uuid
from sqlalchemy.orm import Session
from app.models.database import SessionLocal, init_db
from app.models import Agent, Legislation, Debate
from app.services.debate_service import DebateService


async def create_test_debate():
    """Create a test debate for sharing functionality."""
    # Initialize database
    print("Initializing database...")
    init_db()

    db: Session = SessionLocal()

    try:
        # Create sample agents
        print("\nCreating sample AI agents...")
        agents_data = [
            {
                "name": "Progressive Advocate",
                "persona": "A progressive policy expert focused on social equity",
                "system_prompt": "You are a progressive policy expert."
            },
            {
                "name": "Conservative Analyst",
                "persona": "A conservative economist focused on fiscal responsibility",
                "system_prompt": "You are a conservative policy analyst."
            }
        ]

        created_agents = []
        for agent_data in agents_data:
            agent = Agent(
                id=f"agent_{uuid.uuid4().hex[:12]}",
                name=agent_data["name"],
                description=f"A {agent_data['persona'].lower()}",
                persona=agent_data["persona"],
                system_prompt=agent_data["system_prompt"],
                expertise_areas="general,policy",
                is_active=True
            )
            db.add(agent)
            created_agents.append(agent)
            print(f"  ✓ Created: {agent.name}")

        # Create sample legislation
        print("\nCreating sample legislation...")
        sample_bill = Legislation(
            id=f"demo_bill_{uuid.uuid4().hex[:8]}",
            source="demo",
            level="federal",
            bill_number="HR123",
            title="Healthcare Access and Affordability Act",
            description="A comprehensive healthcare reform bill aimed at expanding coverage and reducing costs.",
            sponsor="Demo Sponsor",
            status="in_committee",
            external_url="https://example.com"
        )
        db.add(sample_bill)
        db.commit()
        print(f"  ✓ Created sample bill: {sample_bill.bill_number}")

        # Create PUBLIC debate
        print("\nCreating public debate...")
        debate_service = DebateService(db)
        debate = await debate_service.create_debate(
            legislation_id=sample_bill.id,
            topic=f"Should {sample_bill.bill_number} be passed into law?",
            agent_ids=[a.id for a in created_agents],
            max_turns=2,
            is_public=True  # Make it public for sharing
        )
        print(f"  ✓ Created public debate: {debate.id}")

        # Add some sample messages to make it interesting
        from app.models import DebateMessage
        sample_messages = [
            {
                "debate_id": debate.id,
                "agent_id": created_agents[0].id,
                "turn_number": 1,
                "position": "pro",
                "argument": "This healthcare bill represents a critical step toward ensuring that every American has access to affordable medical care. By expanding coverage and implementing cost controls, we can reduce the financial burden on families and improve public health outcomes. The current system leaves millions uninsured and underinsured, leading to preventable medical bankruptcies and poorer health outcomes. This legislation addresses these systemic issues through evidence-based reforms."
            },
            {
                "debate_id": debate.id,
                "agent_id": created_agents[1].id,
                "turn_number": 2,
                "position": "con",
                "argument": "While healthcare access is important, this bill's approach is fundamentally flawed. The proposed expansion would add trillions to our national debt without addressing the root causes of high healthcare costs. Instead of government mandates and price controls that have failed in other countries, we should focus on market-based solutions that increase competition and innovation. The current system, despite its imperfections, provides some of the best medical care in the world for those who can access it."
            }
        ]

        for msg_data in sample_messages:
            message = DebateMessage(**msg_data)
            db.add(message)

        db.commit()
        print("  ✓ Added sample debate messages")

        print("\n✓ Test debate created successfully!")
        print(f"  Debate ID: {debate.id}")
        print(f"  Public URL: http://localhost:8000/api/debates/public/{debate.id}")
        print(f"  Share Page: http://localhost:8000/debates/share/{debate.id}")

        return debate.id

    finally:
        db.close()


if __name__ == "__main__":
    debate_id = asyncio.run(create_test_debate())
    print(f"\nTest debate created with ID: {debate_id}")