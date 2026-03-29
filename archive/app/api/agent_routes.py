"""API routes for agent management."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field, field_validator
from app.models.database import get_db
from app.models import Agent
from app.config import get_settings
from app.auth import require_paid_tier, require_dev_tier, get_current_user
import uuid
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/agents", tags=["agents"])

VALID_AGENT_TYPES = {"claude", "local", "byo"}


class AgentCreateRequest(BaseModel):
    """Request to create a new agent."""
    name: str
    description: str
    persona: str
    system_prompt: str
    expertise_areas: str = ""
    agent_type: str = "claude"  # claude, local, byo
    model_name: str = get_settings().default_model
    api_url: str = ""  # For BYO AI
    api_key: str = ""  # For BYO AI

    # Optional video avatar/voice for AI video generation (HeyGen or other providers)
    avatar_id: str | None = Field(None, max_length=100)
    voice_id: str | None = Field(None, max_length=100)

    @field_validator("name", "persona", "system_prompt")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Field must not be empty")
        return v.strip()

    @field_validator("name")
    @classmethod
    def name_length(cls, v: str) -> str:
        if len(v) > 100:
            raise ValueError("Name must be 100 characters or fewer")
        return v

    @field_validator("system_prompt")
    @classmethod
    def system_prompt_length(cls, v: str) -> str:
        if len(v) > 8000:
            raise ValueError("System prompt must be 8000 characters or fewer")
        return v

    @field_validator("agent_type")
    @classmethod
    def valid_agent_type(cls, v: str) -> str:
        if v not in VALID_AGENT_TYPES:
            raise ValueError(f"agent_type must be one of: {', '.join(sorted(VALID_AGENT_TYPES))}")
        return v

    @field_validator("api_url")
    @classmethod
    def byo_url_scheme(cls, v: str) -> str:
        if v and not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("api_url must start with http:// or https://")
        return v


class AgentResponse(BaseModel):
    """Response model for agent."""
    id: str
    name: str
    description: str
    persona: str
    agent_type: str
    is_active: bool


@router.post("/create")
async def create_agent(
    request: AgentCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Create a new debate agent. Paid tier for claude; dev tier for local/byo."""
    if request.agent_type in ("local", "byo"):
        if current_user.subscription_tier != "dev":
            raise HTTPException(
                status_code=403,
                detail="Local and BYO agent types require the developer tier.",
            )
    elif current_user.subscription_tier not in ("paid", "dev"):
        raise HTTPException(
            status_code=403,
            detail="Creating agents requires a paid subscription.",
        )
    try:
        agent = Agent(
            id=f"agent_{uuid.uuid4().hex[:12]}",
            name=request.name,
            description=request.description,
            persona=request.persona,
            system_prompt=request.system_prompt,
            expertise_areas=request.expertise_areas,
            agent_type=request.agent_type,
            model_name=request.model_name,
            api_url=request.api_url,
            api_key=request.api_key,
            avatar_id=request.avatar_id,
            voice_id=request.voice_id,
            is_active=True
        )
        
        db.add(agent)
        db.commit()
        
        return {
            "success": True,
            "agent": {
                "id": agent.id,
                "name": agent.name,
                "description": agent.description,
                "persona": agent.persona,
                "agent_type": agent.agent_type,
                "is_active": agent.is_active
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error creating agent: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/list")
async def list_agents(
    db: Session = Depends(get_db),
    limit: int = Query(20, ge=1, le=100, description="Max results to return"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
):
    """List active agents with pagination."""
    try:
        query = db.query(Agent).filter(Agent.is_active == True, Agent.id != "agent_moderator_sys")
        total = query.count()
        agents = query.offset(offset).limit(limit).all()

        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "agents": [
                {
                    "id": agent.id,
                    "name": agent.name,
                    "description": agent.description,
                    "persona": agent.persona,
                    "agent_type": agent.agent_type,
                    "expertise_areas": agent.expertise_areas
                }
                for agent in agents
            ]
        }
    except Exception as e:
        logger.error(f"Unexpected error listing agents: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{agent_id}")
async def get_agent(
    agent_id: str,
    db: Session = Depends(get_db)
):
    """Get agent profile including debate stats and recent debates."""
    from app.models import Debate, DebateMessage, Rating, debate_participants
    from sqlalchemy import func

    try:
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")

        # Debates participated in (via junction table)
        debate_ids_q = (
            db.query(debate_participants.c.debate_id)
            .filter(debate_participants.c.agent_id == agent_id)
            .subquery()
        )
        debate_count = db.query(func.count()).select_from(debate_ids_q).scalar() or 0

        # Total arguments made
        argument_count = (
            db.query(func.count(DebateMessage.id))
            .filter(DebateMessage.agent_id == agent_id)
            .scalar() or 0
        )

        # Average ratings across all rated messages
        rated = (
            db.query(
                func.avg(Rating.persuasiveness_score).label("persuasiveness"),
                func.avg(Rating.logical_soundness_score).label("logical_soundness"),
                func.avg(Rating.factual_accuracy_score).label("factual_accuracy"),
                func.avg(Rating.relevance_score).label("relevance"),
                func.avg(Rating.overall_score).label("overall"),
                func.count(Rating.id).label("rating_count"),
            )
            .join(DebateMessage, Rating.message_id == DebateMessage.id)
            .filter(DebateMessage.agent_id == agent_id)
            .first()
        )

        avg_ratings = None
        if rated and rated.rating_count:
            avg_ratings = {
                "persuasiveness": round(rated.persuasiveness or 0, 1),
                "logical_soundness": round(rated.logical_soundness or 0, 1),
                "factual_accuracy": round(rated.factual_accuracy or 0, 1),
                "relevance": round(rated.relevance or 0, 1),
                "overall": round(rated.overall or 0, 1),
                "rating_count": rated.rating_count,
            }

        # Recent debates (last 10)
        recent_debates = (
            db.query(Debate)
            .join(debate_ids_q, Debate.id == debate_ids_q.c.debate_id)
            .order_by(Debate.created_at.desc())
            .limit(10)
            .all()
        )

        return {
            "success": True,
            "agent": {
                "id": agent.id,
                "name": agent.name,
                "description": agent.description,
                "persona": agent.persona,
                "expertise_areas": agent.expertise_areas,
                "agent_type": agent.agent_type,
                "is_active": agent.is_active,
            },
            "stats": {
                "debate_count": debate_count,
                "argument_count": argument_count,
                "avg_ratings": avg_ratings,
            },
            "recent_debates": [
                {
                    "id": d.id,
                    "title": d.title,
                    "topic": d.topic,
                    "status": d.status,
                    "legislation_title": d.legislation.title if d.legislation else None,
                    "legislation_id": d.legislation_id,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                }
                for d in recent_debates
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error fetching agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{agent_id}/debates")
async def get_agent_debates(
    agent_id: str,
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Paginated debate history for an agent."""
    from app.models import Debate, debate_participants
    from sqlalchemy import func

    try:
        agent = db.query(Agent).filter(Agent.id == agent_id).first()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")

        debate_ids_q = (
            db.query(debate_participants.c.debate_id)
            .filter(debate_participants.c.agent_id == agent_id)
            .subquery()
        )

        base = db.query(Debate).join(debate_ids_q, Debate.id == debate_ids_q.c.debate_id)
        total = base.count()
        debates = base.order_by(Debate.created_at.desc()).offset(offset).limit(limit).all()

        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "debates": [
                {
                    "id": d.id,
                    "title": d.title,
                    "topic": d.topic,
                    "status": d.status,
                    "legislation_title": d.legislation.title if d.legislation else None,
                    "legislation_id": d.legislation_id,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                }
                for d in debates
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching debates for agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/create-preset/{preset_name}")
async def create_preset_agent(
    preset_name: str,
    db: Session = Depends(get_db),
    _user=Depends(require_paid_tier),
):
    """Create an agent from a preset configuration."""
    try:
        # Import presets
        from sample_agents import (
            PROGRESSIVE_ADVOCATE, CONSERVATIVE_ANALYST, NONPARTISAN_EVALUATOR,
            FISCAL_EXPERT, HEALTHCARE_EXPERT, ENVIRONMENTAL_ANALYST,
            HUMANIST, COMMUNIST, SOCIALIST, CAPITALIST, COMEDIAN, DRAMATIC,
            LIBERTARIAN, ANARCHIST, TECHNOCRAT, POPULIST
        )
        
        presets = {
            "progressive": PROGRESSIVE_ADVOCATE,
            "conservative": CONSERVATIVE_ANALYST,
            "nonpartisan": NONPARTISAN_EVALUATOR,
            "fiscal": FISCAL_EXPERT,
            "healthcare": HEALTHCARE_EXPERT,
            "environmental": ENVIRONMENTAL_ANALYST,
            "humanist": HUMANIST,
            "communist": COMMUNIST,
            "socialist": SOCIALIST,
            "capitalist": CAPITALIST,
            "comedian": COMEDIAN,
            "dramatic": DRAMATIC,
            "libertarian": LIBERTARIAN,
            "anarchist": ANARCHIST,
            "technocrat": TECHNOCRAT,
            "populist": POPULIST
        }
        
        if preset_name not in presets:
            raise HTTPException(status_code=400, detail=f"Unknown preset: {preset_name}")
        
        config = presets[preset_name]
        
        agent = Agent(
            id=f"agent_{uuid.uuid4().hex[:12]}",
            name=config["name"],
            description=config["description"],
            persona=config["persona"],
            system_prompt=config["system_prompt"],
            expertise_areas=config.get("expertise_areas", ""),
            agent_type="claude",  # Default to Claude for presets
            is_active=True
        )
        
        db.add(agent)
        db.commit()
        
        return {
            "success": True,
            "agent": {
                "id": agent.id,
                "name": agent.name,
                "description": agent.description,
                "persona": agent.persona,
                "agent_type": agent.agent_type,
                "is_active": agent.is_active
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Unexpected error creating preset agent {preset_name}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
