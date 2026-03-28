"""Full fresh seed: agents + bills + debates via Ollama."""
import sys
import asyncio
sys.stdout.reconfigure(encoding='utf-8')
import uuid
from datetime import datetime
import json as _json
from app.models.database import SessionLocal, init_db
from app.models import Agent, Legislation
from app.services.debate_service import DebateService

AGENTS = [
    {
        "name": "Progressive Advocate",
        "persona": "A progressive policy expert focused on social equity and civil rights",
        "system_prompt": "You are a progressive policy expert. Focus on equity, social justice, and expanded government programs. Be passionate and cite real-world impacts on vulnerable communities.",
        "expertise_areas": "social policy,civil rights,healthcare,education",
    },
    {
        "name": "Conservative Analyst",
        "persona": "A conservative economist focused on fiscal responsibility and free markets",
        "system_prompt": "You are a conservative policy analyst. Focus on fiscal responsibility, free markets, limited government, and individual liberty. Be direct and argue from conservative first principles. Do not cite specific economists or attribute theories to named individuals unless you are certain they held that exact view — argue from the principles themselves instead.",
        "expertise_areas": "economics,fiscal policy,free markets,limited government",
    },
]

# Per-bill position assignments keyed by agent name.
# "pro" = supports passage, "con" = opposes.
BILL_POSITIONS = {
    "Medicare for All Act":
        {"Progressive Advocate": "pro", "Conservative Analyst": "con"},
    "Green New Deal for Public Housing Act":
        {"Progressive Advocate": "pro", "Conservative Analyst": "con"},
    "Secure the Border Act":
        {"Progressive Advocate": "con", "Conservative Analyst": "pro"},
    "Student Loan Forgiveness and Higher Education Reform Act":
        {"Progressive Advocate": "pro", "Conservative Analyst": "con"},
    "American Energy Independence and Carbon Tax Act":
        {"Progressive Advocate": "pro", "Conservative Analyst": "con"},
}

BILLS = [
    {
        "bill_number": "S. 1102",
        "title": "Secure the Border Act",
        "level": "federal",
        "status": "in_committee",
        "sponsor": "Sen. Tom Cotton",
        "sponsor_party": "Republican",
        "sponsor_state": "AR",
        "introduced_date": "2023-03-30",
        "tags": ["Immigration", "National Security"],
        "description": (
            "Increases funding for border wall construction and surveillance technology. "
            "Mandates E-Verify for all employers nationwide. Reduces annual legal immigration "
            "by 50%. Ends the diversity visa lottery and restricts asylum eligibility. "
            "Increases penalties for illegal entry and reentry."
        ),
    },
]


async def main():
    print("Initializing database...")
    init_db()
    db = SessionLocal()

    try:
        # Create agents
        print("\nCreating agents...")
        agents = []
        for a in AGENTS:
            agent = Agent(
                id=f"agent_{uuid.uuid4().hex[:12]}",
                name=a["name"],
                description=a["persona"],
                persona=a["persona"],
                system_prompt=a["system_prompt"],
                expertise_areas=a["expertise_areas"],
                agent_type="local",
                model_name="llama3.1:8b",
                is_active=True,
            )
            db.add(agent)
            agents.append(agent)
            print(f"  + {agent.name}")
        db.commit()

        # Create bills
        print("\nCreating bills...")
        bills = []
        for b in BILLS:
            introduced = b.get("introduced_date")
            leg = Legislation(
                id=f"bill_{uuid.uuid4().hex[:10]}",
                source="demo",
                level=b["level"],
                bill_number=b["bill_number"],
                title=b["title"],
                description=b["description"],
                sponsor=b["sponsor"],
                sponsor_party=b.get("sponsor_party"),
                sponsor_state=b.get("sponsor_state"),
                introduced_date=datetime.strptime(introduced, "%Y-%m-%d") if introduced else None,
                tags=_json.dumps(b["tags"]) if b.get("tags") else None,
                status=b["status"],
            )
            db.add(leg)
            db.flush()
            bills.append(leg)
            print(f"  + {b['bill_number']} — {b['title']}")
        db.commit()

        # Run debates
        print("\nRunning debates...")
        service = DebateService(db)
        for leg in bills:
            print(f"\n  {leg.bill_number} — {leg.title}")
            # Build participant_settings with per-agent positions
            positions = BILL_POSITIONS.get(leg.title, {})
            participant_settings = {
                a.id: {"conviction": 3, "position": positions.get(a.name, "pro")}
                for a in agents
            }
            debate = await service.create_debate(
                legislation_id=leg.id,
                topic=f"Should {leg.bill_number} ({leg.title}) be passed into law?",
                agent_ids=[a.id for a in agents],
                max_turns=6,
                research_enabled=False,
                participant_settings=participant_settings,
            )
            turn = 0
            while True:
                try:
                    continuing = await service.run_debate_turn(debate.id)
                    turn += 1
                    print(f"    Turn {turn} done")
                    if not continuing:
                        break
                except Exception as e:
                    print(f"    Error: {e}")
                    break
            print(f"    Status: {debate.status} ({turn} turns)")

        print("\nDone! Start the backend and visit http://localhost:3000")

    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
