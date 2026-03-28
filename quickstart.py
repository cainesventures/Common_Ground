"""Quick start script for Common Ground."""

import sys
import asyncio
sys.stdout.reconfigure(encoding='utf-8')
import uuid
from sqlalchemy.orm import Session
from app.models.database import SessionLocal, init_db
from app.models import Agent, Legislation
from app.services.legislation_service import LegislationIngestionService
from app.services.debate_service import DebateService


async def main():
    """Run quick start demo."""
    # Initialize database
    print("Initializing database...")
    init_db()
    
    db: Session = SessionLocal()
    
    try:
        # Step 1: Create sample agents
        print("\n1. Creating sample AI agents...")
        agents_data = [
            {
                "name": "Progressive Advocate",
                "persona": "A progressive policy expert focused on social equity and civil rights",
                "system_prompt": "You are a progressive policy expert. Focus on equity, social justice, and expanded government programs."
            },
            {
                "name": "Conservative Analyst",
                "persona": "A conservative economist focused on fiscal responsibility",
                "system_prompt": "You are a conservative policy analyst. Focus on fiscal responsibility, free markets, and limited government."
            },
            {
                "name": "Moderate Evaluator",
                "persona": "A nonpartisan policy analyst who evaluates practical impacts",
                "system_prompt": "You are a nonpartisan policy analyst. Focus on practical outcomes and evidence-based analysis."
            }
        ]
        
        created_agents = []
        for agent_data in agents_data:
            agent = db.query(Agent).filter(Agent.name == agent_data["name"]).first()
            if agent:
                agent.agent_type = "gemini"
                print(f"  ~ Reusing existing: {agent.name}")
            else:
                agent = Agent(
                    id=f"agent_{uuid.uuid4().hex[:12]}",
                    name=agent_data["name"],
                    description=f"A {agent_data['persona'].lower()}",
                    persona=agent_data["persona"],
                    system_prompt=agent_data["system_prompt"],
                    expertise_areas="general,policy,legislation",
                    agent_type="gemini",
                    is_active=True
                )
                db.add(agent)
                print(f"  ✓ Created: {agent.name}")
            created_agents.append(agent)

        db.commit()
        
        # Step 2: Ingest federal legislation
        print("\n2. Ingesting federal legislation...")
        try:
            service = LegislationIngestionService(db)
            count = await service.ingest_federal_legislation(congress=118, limit=5)
            print(f"  ✓ Ingested {count} federal bills")
        except Exception as e:
            print(f"  ⚠ Could not ingest federal bills: {e}")
            print("    Note: Requires CONGRESS_API_KEY in .env")
        
        # Step 3: Create sample legislation if none exist
        legislation = db.query(Legislation).first()
        if not legislation:
            print("\n3. Creating sample legislation...")
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
            legislation = sample_bill
            print(f"  ✓ Created sample bill: {legislation.bill_number}")
        
        # Step 4: Create debate
        print("\n4. Creating debate...")
        debate_service = DebateService(db)
        debate = await debate_service.create_debate(
            legislation_id=legislation.id,
            topic=f"Should {legislation.bill_number} be passed into law?",
            agent_ids=[a.id for a in created_agents],
            max_turns=3,
            research_enabled=False,
        )
        print(f"  ✓ Created debate: {debate.id}")
        
        # Step 5: Run debate
        print("\n5. Running debate...")
        print("  Note: This will make API calls to Anthropic. Ensure ANTHROPIC_API_KEY is set.")
        
        turn_count = 0
        while True:
            try:
                is_continuing = await debate_service.run_debate_turn(debate.id)
                turn_count += 1
                
                # Get the message that was just added
                from app.models import DebateMessage
                last_msg = db.query(DebateMessage).filter(
                    DebateMessage.debate_id == debate.id,
                    DebateMessage.turn_number == turn_count
                ).first()
                
                if last_msg:
                    print(f"  Turn {turn_count}: {last_msg.agent.name} ({last_msg.position})")
                
                if not is_continuing:
                    break
            except Exception as e:
                print(f"  ⚠ Error running debate: {e}")
                break
        
        print(f"\n✓ Debate completed with {turn_count} turns")
        
        # Step 6: Show results
        print("\n6. Debate Results:")
        debate = db.query(type(debate)).filter(type(debate).id == debate.id).first()
        from app.models import DebateMessage
        messages = db.query(DebateMessage).filter(
            DebateMessage.debate_id == debate.id
        ).order_by(DebateMessage.turn_number).all()
        
        for msg in messages:
            print(f"\nTurn {msg.turn_number} - {msg.agent.name} ({msg.position.upper()}):")
            print(f"{msg.argument[:200]}...")
        
        print("\n✓ Quick start demo completed!")
        print(f"\nNext steps:")
        print(f"1. Start the server: python main.py")
        print(f"2. Visit API docs: http://localhost:8000/docs")
        print(f"3. View your debate at: GET /api/debates/{debate.id}")
        
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
