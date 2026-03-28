"""
Backfill argument_variants for existing DebateMessages that don't have them.

Usage:
    python backfill_variants.py
"""
import asyncio
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")


async def main():
    from app.models.database import SessionLocal
    from app.models import DebateMessage
    from app.agents.moderator_agent import ModeratorAgent

    db = SessionLocal()
    moderator = ModeratorAgent()

    try:
        messages = db.query(DebateMessage).filter(
            DebateMessage.argument_variants == None  # noqa: E711
        ).all()

        print(f"Found {len(messages)} messages without variants.")

        for i, msg in enumerate(messages, 1):
            try:
                variants = await moderator.generate_complexity_variants(msg.argument)
                msg.argument_variants = json.dumps(variants)
                db.commit()
                print(f"  [{i}/{len(messages)}] {msg.id} — done")
            except Exception as e:
                db.rollback()
                print(f"  [{i}/{len(messages)}] {msg.id} — FAILED: {e}")

        print("\n✓ Backfill complete.")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
