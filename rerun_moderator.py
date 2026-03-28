"""
1. Adds a turn-0 moderator introduction to any debate that's missing one.
2. Deletes moderator error messages and regenerates them via Ollama.

Usage:
    python rerun_moderator.py
"""

import asyncio
import json
import sys
import uuid

from app.models.database import SessionLocal
from app.models import Debate, DebateMessage
from app.agents.moderator_agent import ModeratorAgent, MODERATOR_AGENT_ID


def _new_id():
    return f"msg_{uuid.uuid4().hex[:12]}"


async def main():
    db = SessionLocal()
    moderator = ModeratorAgent()
    print(f"Moderator backend: {moderator._backend}\n")

    try:
        all_debates = db.query(Debate).all()

        for debate in all_debates:
            print(f"Debate: {debate.title} ({debate.id})")

            # ── 1. Add turn-0 intro if missing ───────────────────────────────
            has_intro = db.query(DebateMessage).filter(
                DebateMessage.debate_id == debate.id,
                DebateMessage.position == "moderator",
                DebateMessage.turn_number == 0,
            ).first()

            if not has_intro:
                print("  No opening intro found — generating turn 0...")
                intro = await moderator.introduce_bill(
                    legislation_title=debate.legislation.title,
                    legislation_description=debate.legislation.description,
                    full_text=debate.legislation.full_text,
                    research_sources=[],
                    topic=debate.topic,
                )
                db.add(DebateMessage(
                    id=_new_id(),
                    debate_id=debate.id,
                    agent_id=MODERATOR_AGENT_ID,
                    turn_number=0,
                    position="moderator",
                    argument=intro["argument"],
                    citations=json.dumps(intro.get("citations", [])),
                ))
                db.commit()
                print(f"  Intro saved. Preview: {intro['argument'][:120]}...")

            # ── 2. Replace any error messages ─────────────────────────────────
            error_msgs = (
                db.query(DebateMessage)
                .filter(
                    DebateMessage.debate_id == debate.id,
                    DebateMessage.position == "moderator",
                    DebateMessage.argument.like("Moderator error:%"),
                )
                .order_by(DebateMessage.turn_number)
                .all()
            )

            if not error_msgs:
                print("  No error messages.\n")
                continue

            print(f"  Found {len(error_msgs)} error message(s) to replace.")

            mod_sources: list[dict] = []
            if debate.research_data:
                try:
                    rd = json.loads(debate.research_data)
                    mod_sources = rd.get("moderator", {}).get("sources", [])
                except Exception:
                    pass

            all_debator_msgs = (
                db.query(DebateMessage)
                .filter(
                    DebateMessage.debate_id == debate.id,
                    DebateMessage.position != "moderator",
                )
                .order_by(DebateMessage.turn_number)
                .all()
            )

            for err_msg in error_msgs:
                turn = err_msg.turn_number
                is_closing = (turn > debate.max_turns)
                print(f"  Regenerating turn {turn} ({'closing' if is_closing else 'fact-check'})...")

                db.delete(err_msg)
                db.flush()

                if is_closing:
                    all_args = [
                        {"agent_name": m.agent.name, "argument": m.argument, "position": m.position}
                        for m in all_debator_msgs
                    ]
                    result = await moderator.close_debate(
                        legislation_title=debate.legislation.title,
                        all_arguments=all_args,
                        research_sources=mod_sources,
                    )
                else:
                    debator_msg = next(
                        (m for m in all_debator_msgs if m.turn_number == turn), None
                    )
                    if not debator_msg:
                        print(f"    No debator message for turn {turn}, skipping.")
                        db.commit()
                        continue

                    prior_checks = [
                        m.argument for m in
                        db.query(DebateMessage)
                        .filter(
                            DebateMessage.debate_id == debate.id,
                            DebateMessage.position == "moderator",
                            DebateMessage.turn_number > 0,
                            DebateMessage.turn_number < turn,
                        )
                        .all()
                        if not m.argument.startswith("Moderator error:")
                    ]

                    result = await moderator.fact_check(
                        argument=debator_msg.argument,
                        agent_name=debator_msg.agent.name,
                        research_sources=mod_sources,
                        previous_moderator_checks=prior_checks,
                    )

                    if result is None:
                        print(f"    Moderator chose NO_INTERJECT for turn {turn}.")
                        db.commit()
                        continue

                db.add(DebateMessage(
                    id=_new_id(),
                    debate_id=debate.id,
                    agent_id=MODERATOR_AGENT_ID,
                    turn_number=turn,
                    position="moderator",
                    argument=result["argument"],
                    citations=json.dumps(result.get("citations", [])),
                ))
                db.commit()
                print(f"    Done. Preview: {result['argument'][:120]}...")

            print()

        print("All done.")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
