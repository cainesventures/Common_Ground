"""Debate orchestration service."""

import logging
import uuid
import json
from datetime import datetime
from sqlalchemy.orm import Session
from app.agents.debate_agent import create_agent
from app.agents.moderator_agent import ModeratorAgent, get_or_create_moderator, MODERATOR_AGENT_ID
from app.models import Debate, DebateMessage, Agent, Legislation, Rating
from app.services.research_service import ResearchService

logger = logging.getLogger(__name__)


def _save_message(db: Session, debate_id: str, agent_id: str, turn_number: int,
                  position: str, argument: str, citations: list, research_data: str = "",
                  argument_variants: str = None) -> DebateMessage:
    msg = DebateMessage(
        id=f"msg_{uuid.uuid4().hex[:12]}",
        debate_id=debate_id,
        agent_id=agent_id,
        turn_number=turn_number,
        position=position,
        argument=argument,
        citations=json.dumps(citations) if citations else None,
        research_data=research_data,
        argument_variants=argument_variants,
    )
    db.add(msg)
    return msg


class DebateService:
    """Service for managing debates between AI agents."""

    def __init__(self, db: Session):
        self.db = db
        self.research = ResearchService.from_env()
        self.moderator = ModeratorAgent()

    # ── Debate creation ───────────────────────────────────────────────────────

    async def create_debate(
        self,
        legislation_id: str,
        topic: str,
        agent_ids: list[str],
        max_turns: int = 5,
        research_enabled: bool = True,
        participant_settings: dict | None = None,
    ) -> Debate:
        """Create and initialise a new debate.

        participant_settings: {agent_id: {"conviction": 1-5}, ...}
        """
        try:
            legislation = self.db.query(Legislation).filter(
                Legislation.id == legislation_id
            ).first()
            if not legislation:
                raise ValueError(f"Legislation {legislation_id} not found")

            # Ensure the moderator agent exists in the DB
            get_or_create_moderator(self.db)

            try:
                title = await self.moderator.generate_debate_title(
                    bill_number=legislation.bill_number or "",
                    bill_title=legislation.title,
                    bill_description=legislation.description or "",
                )
            except Exception as e:
                logger.warning(f"Title generation failed, using fallback: {e}")
                title = f"Debate: {legislation.bill_number or legislation.title[:60]}"

            debate = Debate(
                id=f"debate_{uuid.uuid4().hex[:12]}",
                legislation_id=legislation_id,
                title=title,
                topic=topic,
                status="researching" if research_enabled else "active",
                max_turns=max_turns,
                turn_count=0,
                research_enabled=research_enabled,
                participant_settings=json.dumps(participant_settings or {}),
            )

            self.db.add(debate)
            self.db.flush()

            for agent_id in agent_ids:
                agent = self.db.query(Agent).filter(Agent.id == agent_id).first()
                if not agent:
                    logger.warning(f"Agent {agent_id} not found, skipping")
                    continue
                debate.participating_agents.append(agent)

            self.db.commit()
            logger.info(f"Created debate {debate.id}")
            return debate

        except Exception as e:
            logger.error(f"Error creating debate: {e}")
            self.db.rollback()
            raise

    # ── Research phase ────────────────────────────────────────────────────────

    async def run_research_phase(self, debate_id: str) -> bool:
        """Run research for all agents + moderator, then post the moderator's opening."""
        try:
            debate = self.db.query(Debate).filter(Debate.id == debate_id).first()
            if not debate or not debate.research_enabled:
                if debate:
                    debate.status = "active"
                    self.db.commit()
                return True

            legislation = debate.legislation
            research_data: dict = {}

            # ── Per-agent research ──
            for agent_obj in debate.participating_agents:
                try:
                    sources = await self.research.research_for_agent(
                        agent_name=agent_obj.name,
                        agent_persona=agent_obj.persona or "",
                        legislation_title=legislation.title,
                        legislation_description=legislation.description or "",
                        topic=debate.topic,
                        num_results=5,
                    )
                    research_data[agent_obj.id] = {
                        "agent_name": agent_obj.name,
                        "sources": ResearchService.to_citations(sources),
                        "formatted": ResearchService.format_for_prompt(sources),
                    }
                except Exception as e:
                    logger.error(f"Research failed for agent {agent_obj.name}: {e}")
                    research_data[agent_obj.id] = {"agent_name": agent_obj.name, "sources": [], "formatted": ""}

            # ── Moderator research + opening ──
            mod_sources = await self.research.research_for_moderator(
                legislation_title=legislation.title,
                legislation_description=legislation.description or "",
                full_text=legislation.full_text,
            )
            research_data["moderator"] = {
                "sources": ResearchService.to_citations(mod_sources),
            }

            intro = await self.moderator.introduce_bill(
                legislation_title=legislation.title,
                legislation_description=legislation.description,
                full_text=legislation.full_text,
                research_sources=ResearchService.to_citations(mod_sources),
                topic=debate.topic,
            )

            try:
                intro_variants = await self.moderator.generate_complexity_variants(intro["argument"], is_moderator=True)
                intro_variants_json = json.dumps(intro_variants)
            except Exception as e:
                logger.warning(f"Intro variants failed (non-fatal): {e}")
                intro_variants_json = None

            _save_message(
                self.db, debate.id, MODERATOR_AGENT_ID,
                turn_number=0,
                position="moderator",
                argument=intro["argument"],
                citations=intro["citations"],
                argument_variants=intro_variants_json,
            )

            debate.research_data = json.dumps(research_data)
            debate.status = "active"
            self.db.commit()

            logger.info(f"Research phase complete for debate {debate_id}")
            return True

        except Exception as e:
            logger.error(f"Error in research phase: {e}")
            self.db.rollback()
            raise

    # ── Debate turn ───────────────────────────────────────────────────────────

    async def run_debate_turn(self, debate_id: str) -> bool:
        """Run one debator turn, then optionally insert a moderator fact-check.

        Returns True if debate continues, False if completed.
        """
        try:
            debate = self.db.query(Debate).filter(Debate.id == debate_id).first()
            if not debate:
                raise ValueError(f"Debate {debate_id} not found")

            if debate.turn_count >= debate.max_turns or debate.status != "active":
                await self._close_debate(debate)
                return False

            agents = debate.participating_agents
            if not agents:
                raise ValueError("Debate has no participating agents")

            current_agent_obj = agents[debate.turn_count % len(agents)]

            # Build agent instance
            agent = create_agent(
                current_agent_obj.agent_type,
                agent_id=current_agent_obj.id,
                name=current_agent_obj.name,
                persona=current_agent_obj.persona,
                system_prompt=current_agent_obj.system_prompt,
                model_name=current_agent_obj.model_name,
                api_url=current_agent_obj.api_url,
                api_key=current_agent_obj.api_key,
            )

            # Previous messages (exclude moderator from argument history)
            previous_messages = self.db.query(DebateMessage).filter(
                DebateMessage.debate_id == debate_id,
                DebateMessage.position != "moderator",
            ).all()

            previous_arguments = [
                {"agent_name": msg.agent.name, "argument": msg.argument, "position": msg.position}
                for msg in previous_messages
            ]

            # Last 2 moderator fact-checks for agents to consider
            recent_mod_checks = self.db.query(DebateMessage).filter(
                DebateMessage.debate_id == debate_id,
                DebateMessage.position == "moderator",
                DebateMessage.turn_number > 0,
            ).order_by(DebateMessage.turn_number.desc()).limit(2).all()
            moderator_notes = [m.argument for m in reversed(recent_mod_checks)]

            # Research sources for this agent
            research_sources: list[dict] = []
            if debate.research_data:
                try:
                    rd = json.loads(debate.research_data)
                    research_sources = rd.get(current_agent_obj.id, {}).get("sources", [])
                except (json.JSONDecodeError, AttributeError):
                    pass

            # Conviction level and position (from participant_settings if set)
            conviction_level = 3
            position = ["pro", "con"][debate.turn_count % 2]
            if debate.participant_settings:
                try:
                    ps = json.loads(debate.participant_settings)
                    agent_settings = ps.get(current_agent_obj.id, {})
                    conviction_level = agent_settings.get("conviction", 3)
                    if agent_settings.get("position"):
                        position = agent_settings["position"]
                except (json.JSONDecodeError, AttributeError):
                    pass

            legislation_summary = (
                debate.legislation.full_text
                or debate.legislation.description
                or debate.topic
            )

            arg_result = await agent.generate_argument(
                legislation_title=debate.legislation.title,
                legislation_summary=legislation_summary,
                position=position,
                previous_arguments=previous_arguments,
                turn_number=debate.turn_count + 1,
                research_sources=research_sources,
                conviction_level=conviction_level,
                moderator_notes=moderator_notes,
            )

            turn_number = debate.turn_count + 1

            try:
                arg_variants = await self.moderator.generate_complexity_variants(arg_result["argument"])
                arg_variants_json = json.dumps(arg_variants)
            except Exception as e:
                logger.warning(f"Argument variants failed (non-fatal): {e}")
                arg_variants_json = None

            _save_message(
                self.db, debate.id, current_agent_obj.id,
                turn_number=turn_number,
                position=position,
                argument=arg_result["argument"],
                citations=arg_result.get("citations", []),
                research_data=json.dumps({"sources": research_sources}),
                argument_variants=arg_variants_json,
            )

            debate.turn_count += 1
            debate.current_turn_agent_id = current_agent_obj.id
            debate.updated_at = datetime.utcnow()
            self.db.commit()

            # Moderator fact-check (non-blocking — if it fails, debate continues)
            await self._maybe_fact_check(debate, arg_result, current_agent_obj.name, turn_number)

            logger.info(f"Completed turn {debate.turn_count} for debate {debate_id}")

            if debate.turn_count >= debate.max_turns:
                await self._close_debate(debate)
                return False
            return True

        except Exception as e:
            logger.error(f"Error running debate turn: {e}")
            self.db.rollback()
            raise

    # ── Moderator helpers ─────────────────────────────────────────────────────

    async def _maybe_fact_check(self, debate: Debate, arg_result: dict,
                                agent_name: str, turn_number: int) -> None:
        """Insert a moderator fact-check message if warranted."""
        try:
            mod_sources: list[dict] = []
            if debate.research_data:
                rd = json.loads(debate.research_data)
                mod_sources = rd.get("moderator", {}).get("sources", [])

            # Gather previous moderator interjections to avoid repetition
            prior_checks = [
                m.argument for m in
                self.db.query(DebateMessage).filter(
                    DebateMessage.debate_id == debate.id,
                    DebateMessage.position == "moderator",
                    DebateMessage.turn_number > 0,
                ).all()
            ]

            result = await self.moderator.fact_check(
                argument=arg_result["argument"],
                agent_name=agent_name,
                research_sources=mod_sources,
                previous_moderator_checks=prior_checks,
            )

            if result:
                try:
                    fc_variants = await self.moderator.generate_complexity_variants(result["argument"], is_moderator=True)
                    fc_variants_json = json.dumps(fc_variants)
                except Exception:
                    fc_variants_json = None

                _save_message(
                    self.db, debate.id, MODERATOR_AGENT_ID,
                    turn_number=turn_number,
                    position="moderator",
                    argument=result["argument"],
                    citations=result.get("citations", []),
                    argument_variants=fc_variants_json,
                )
                self.db.commit()

        except Exception as e:
            logger.warning(f"Moderator fact-check failed (non-fatal): {e}")

    async def _close_debate(self, debate: Debate) -> None:
        """Mark debate completed and insert moderator closing summary."""
        try:
            all_messages = self.db.query(DebateMessage).filter(
                DebateMessage.debate_id == debate.id
            ).all()

            all_arguments = [
                {"agent_name": m.agent.name, "argument": m.argument, "position": m.position}
                for m in all_messages
            ]

            mod_sources: list[dict] = []
            if debate.research_data:
                try:
                    rd = json.loads(debate.research_data)
                    mod_sources = rd.get("moderator", {}).get("sources", [])
                except Exception:
                    pass

            closing = await self.moderator.close_debate(
                legislation_title=debate.legislation.title,
                all_arguments=all_arguments,
                research_sources=mod_sources,
            )

            try:
                closing_variants = await self.moderator.generate_complexity_variants(closing["argument"], is_moderator=True)
                closing_variants_json = json.dumps(closing_variants)
            except Exception:
                closing_variants_json = None

            _save_message(
                self.db, debate.id, MODERATOR_AGENT_ID,
                turn_number=debate.turn_count + 1,
                position="moderator",
                argument=closing["argument"],
                citations=closing.get("citations", []),
                argument_variants=closing_variants_json,
            )

            debate.status = "completed"
            self.db.commit()
            logger.info(f"Debate {debate.id} closed with moderator summary")

            # Auto-queue video generation
            try:
                from app.config import get_settings
                from app.models import DebateVideo
                from app.tasks import generate_debate_video
                _settings = get_settings()
                if _settings.heygen_api_key:
                    video = DebateVideo(
                        id=f"video_{uuid.uuid4().hex[:12]}",
                        debate_id=debate.id,
                        status="pending",
                        provider="heygen",
                    )
                    self.db.add(video)
                    self.db.commit()
                    task = generate_debate_video.delay(debate.id, video.id)
                    video.celery_task_id = task.id
                    self.db.commit()
                    logger.info(f"Auto-queued video generation for debate {debate.id}")
            except Exception as e:
                logger.warning(f"Auto-video queue failed (non-fatal): {e}")

        except Exception as e:
            logger.warning(f"Failed to generate closing summary (non-fatal): {e}")
            debate.status = "completed"
            self.db.commit()

    # ── Rating ────────────────────────────────────────────────────────────────

    async def rate_message(self, message_id: str, rater_agent_id: str) -> Rating:
        """Have one agent rate another's argument."""
        try:
            message = self.db.query(DebateMessage).filter(DebateMessage.id == message_id).first()
            if not message:
                raise ValueError(f"Message {message_id} not found")

            rater = self.db.query(Agent).filter(Agent.id == rater_agent_id).first()
            if not rater:
                raise ValueError(f"Agent {rater_agent_id} not found")

            agent = create_agent(
                rater.agent_type,
                agent_id=rater.id,
                name=rater.name,
                persona=rater.persona,
                system_prompt=rater.system_prompt,
                model_name=rater.model_name,
                api_url=rater.api_url,
                api_key=rater.api_key,
            )

            context = f"Bill: {message.debate.legislation.title}\nArgument by: {message.agent.name}"
            rating_result = await agent.rate_argument(argument=message.argument, context=context)
            rating_data = rating_result.get("rating_data", {})
            scores = rating_data.get("scores", {})

            rating = Rating(
                id=f"rating_{uuid.uuid4().hex[:12]}",
                message_id=message_id,
                rater_agent_id=rater_agent_id,
                persuasiveness_score=scores.get("persuasiveness"),
                logical_soundness_score=scores.get("logical_soundness"),
                factual_accuracy_score=scores.get("factual_accuracy"),
                relevance_score=scores.get("relevance"),
                overall_score=scores.get("overall"),
                reasoning=str(rating_data),
            )

            self.db.add(rating)
            self.db.commit()
            return rating

        except Exception as e:
            logger.error(f"Error rating message: {e}")
            self.db.rollback()
            raise
