"""Celery tasks for background debate execution and video generation."""

import asyncio
import logging
import time
from datetime import datetime, timedelta
from app.celery_app import celery_app
from app.models.database import SessionLocal
from app.services.debate_service import DebateService

logger = logging.getLogger(__name__)


def _run_async(coro):
    """Run an async coroutine from a sync Celery task."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, name="app.tasks.run_debate_background")
def run_debate_background(self, debate_id: str) -> dict:
    """
    Run a full debate (research + all turns) as a background task.

    Opens its own database session so it is safe to run in a Celery worker
    process separate from the FastAPI process.
    """
    db = SessionLocal()
    try:
        service = DebateService(db)

        # Run research phase if needed
        from app.models import Debate
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        if not debate:
            raise ValueError(f"Debate {debate_id} not found")

        if debate.research_enabled and debate.status == "researching":
            logger.info(f"[{debate_id}] Starting research phase")
            _run_async(service.run_research_phase(debate_id))

        # Run all debate turns
        turn_count = 0
        while True:
            is_continuing = _run_async(service.run_debate_turn(debate_id))
            turn_count += 1
            if not is_continuing:
                break

        logger.info(f"[{debate_id}] Completed {turn_count} turns")
        return {"debate_id": debate_id, "turns_completed": turn_count, "status": "completed"}

    except Exception as e:
        logger.error(f"[{debate_id}] Background debate failed: {e}")
        # Mark debate as failed so the client can detect it
        try:
            from app.models import Debate
            debate = db.query(Debate).filter(Debate.id == debate_id).first()
            if debate:
                debate.status = "failed"
                db.commit()
        except Exception:
            pass
        raise
    finally:
        db.close()


# ── Default agents used by the auto-debate pipeline ───────────────────────────
# Two presets that cover the broadest political spectrum for any legislation.
_AUTO_DEBATE_PRESETS = ["progressive", "conservative"]


def _ensure_auto_agents(db) -> list[str]:
    """Return IDs of the default auto-debate agents, creating them if absent."""
    from app.models import Agent

    try:
        from sample_agents import PROGRESSIVE_ADVOCATE, CONSERVATIVE_ANALYST
    except ImportError:
        logger.error("sample_agents module not found — auto-debate agents unavailable")
        return []

    preset_map = {
        "progressive": PROGRESSIVE_ADVOCATE,
        "conservative": CONSERVATIVE_ANALYST,
    }

    agent_ids = []
    for key, config in preset_map.items():
        existing = db.query(Agent).filter(Agent.name == config["name"]).first()
        if existing:
            agent_ids.append(existing.id)
        else:
            import uuid
            agent = Agent(
                id=f"agent_{uuid.uuid4().hex[:12]}",
                name=config["name"],
                description=config["description"],
                persona=config["persona"],
                system_prompt=config["system_prompt"],
                expertise_areas=config.get("expertise_areas", ""),
                agent_type="claude",
                is_active=True,
            )
            db.add(agent)
            db.flush()
            agent_ids.append(agent.id)
            logger.info(f"[auto-debate] Created preset agent: {config['name']}")

    db.commit()
    return agent_ids


@celery_app.task(name="app.tasks.auto_generate_debates")
def auto_generate_debates(max_debates: int = 1, lookback_hours: int = 48) -> dict:
    """
    Automatically create and queue debates for recently ingested legislation
    that has no debate yet.

    Runs on the Celery beat schedule (default: every hour).

    Args:
        max_debates:    Max number of new debates to create per run.
        lookback_hours: Only consider legislation ingested within this window.
    """
    from app.models import Legislation, Debate

    db = SessionLocal()
    created = []
    try:
        agent_ids = _ensure_auto_agents(db)
        if len(agent_ids) < 2:
            logger.error("[auto-debate] Not enough agents available — aborting")
            return {"created": 0, "error": "agents unavailable"}

        # Legislation ingested within the lookback window that has no debate yet
        since = datetime.utcnow() - timedelta(hours=lookback_hours)
        debated_ids = db.query(Debate.legislation_id).distinct().subquery()
        candidates = (
            db.query(Legislation)
            .filter(Legislation.created_at >= since)
            .filter(~Legislation.id.in_(debated_ids))
            .order_by(Legislation.created_at.desc())
            .limit(max_debates)
            .all()
        )

        if not candidates:
            logger.info("[auto-debate] No new legislation to debate")
            return {"created": 0}

        service = DebateService(db)

        for leg in candidates:
            topic = f"Should '{leg.title[:120]}' be enacted into law?"
            try:
                debate = _run_async(service.create_debate(
                    legislation_id=leg.id,
                    topic=topic,
                    agent_ids=agent_ids,
                    max_turns=1,
                    research_enabled=False,  # disable for initial smoke test; re-enable after confirming flow works
                ))
                debate.is_public = True
                db.commit()

                # Queue the full debate to run in the background
                run_debate_background.delay(debate.id)

                created.append({"debate_id": debate.id, "legislation_id": leg.id})
                logger.info(f"[auto-debate] Queued debate {debate.id} for {leg.id}")

            except Exception as e:
                logger.error(f"[auto-debate] Failed for {leg.id}: {e}")
                db.rollback()
                continue

        return {"created": len(created), "debates": created}

    except Exception as e:
        logger.error(f"[auto-debate] Task failed: {e}")
        return {"created": 0, "error": str(e)}
    finally:
        db.close()


@celery_app.task(bind=True, name="app.tasks.generate_debate_video")
def generate_debate_video(
    self,
    debate_id: str,
    video_record_id: str,
    provider_name: str = "heygen",
) -> dict:
    """
    Generate a talking-head video for a completed debate via an AI video provider.

    Opens its own database session (safe to run in a separate Celery worker process).

    Args:
        debate_id:      ID of the debate to render.
        video_record_id: ID of the DebateVideo row to update with results.
        provider_name:  Video provider key (default: "heygen").
    """
    db = SessionLocal()
    try:
        from app.models import Debate, DebateMessage, DebateVideo
        from app.video.factory import create_video_provider

        # Fetch and update the video record to "processing"
        video_record = db.query(DebateVideo).filter(
            DebateVideo.id == video_record_id
        ).first()
        if not video_record:
            raise ValueError(f"DebateVideo record {video_record_id} not found")

        video_record.status = "processing"
        db.commit()

        # Load debate + messages + agents
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        if not debate:
            raise ValueError(f"Debate {debate_id} not found")

        messages = (
            db.query(DebateMessage)
            .filter(DebateMessage.debate_id == debate_id)
            .order_by(DebateMessage.turn_number)
            .all()
        )
        agents = {a.id: a for a in debate.participating_agents}

        # Submit to provider
        provider = create_video_provider(provider_name)
        provider_video_id = _run_async(
            provider.generate_video(debate, messages, agents)
        )
        video_record.provider_video_id = provider_video_id
        db.commit()

        logger.info(
            f"[{debate_id}] Video submitted to {provider_name}: provider_video_id={provider_video_id}"
        )

        # Poll until done (max 10 minutes, 10-second intervals → 60 attempts)
        for attempt in range(60):
            time.sleep(10)
            status = _run_async(provider.get_status(provider_video_id))
            logger.debug(
                f"[{debate_id}] Video poll #{attempt + 1}: status={status['status']}"
            )

            if status["status"] == "completed":
                video_record.status = "completed"
                video_record.video_url = status.get("video_url")
                video_record.thumbnail_url = status.get("thumbnail_url")
                video_record.completed_at = datetime.utcnow()
                db.commit()
                logger.info(f"[{debate_id}] Video completed: {status['video_url']}")
                return {
                    "debate_id": debate_id,
                    "video_url": status["video_url"],
                    "provider": provider_name,
                }

            if status["status"] == "failed":
                raise RuntimeError(
                    f"Provider reported failure: {status.get('error', 'unknown')}"
                )

        raise TimeoutError("Video generation timed out after 10 minutes")

    except Exception as e:
        logger.error(f"[{debate_id}] Video generation failed: {e}")
        try:
            from app.models import DebateVideo
            video_record = db.query(DebateVideo).filter(
                DebateVideo.id == video_record_id
            ).first()
            if video_record:
                video_record.status = "failed"
                video_record.error_message = str(e)
                db.commit()
        except Exception:
            pass
        raise
    finally:
        db.close()
