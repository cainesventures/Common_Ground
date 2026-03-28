"""Resume all active/incomplete debates with rate-limit-friendly pacing."""
import sys
import asyncio
sys.stdout.reconfigure(encoding='utf-8')
from app.models.database import SessionLocal, init_db
from app.models import Debate
from app.services.debate_service import DebateService

DELAY_BETWEEN_TURNS = 15  # seconds — keeps well under 5 req/min free tier


async def main():
    init_db()
    db = SessionLocal()
    try:
        incomplete = (
            db.query(Debate)
            .filter(Debate.status == "active", Debate.turn_count < Debate.max_turns)
            .all()
        )
        print(f"Found {len(incomplete)} incomplete debate(s)")

        service = DebateService(db)
        for debate in incomplete:
            print(f"\n{debate.title} ({debate.turn_count}/{debate.max_turns} turns done)")
            while True:
                try:
                    continuing = await service.run_debate_turn(debate.id)
                    db.refresh(debate)
                    print(f"  Turn {debate.turn_count} done — waiting {DELAY_BETWEEN_TURNS}s")
                    if not continuing:
                        break
                    await asyncio.sleep(DELAY_BETWEEN_TURNS)
                except Exception as e:
                    print(f"  Error: {e}")
                    print(f"  Waiting 60s before retrying...")
                    await asyncio.sleep(60)
                    break
            print(f"  Status: {debate.status}")

        print("\nAll done!")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
