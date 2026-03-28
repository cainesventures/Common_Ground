"""API routes for authenticated user actions.

All routes require a valid JWT (via Authorization: Bearer or access_token cookie).
"""

import logging
import uuid
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_paid_tier
from app.config import get_settings
from app.models import Agent, Debate, Legislation, LegislationVote, User
from app.models.database import get_db
from app.services.persona_builder import (
    DIMENSIONS,
    VALID_KEYS,
    build_persona_prompt,
    validate_stances,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/users", tags=["users"])


# ─── Profile ──────────────────────────────────────────────────────────────────

@router.get("/me")
async def get_my_profile(current_user: User = Depends(get_current_user)):
    """Return the authenticated user's profile."""
    return {
        "success": True,
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "display_name": current_user.display_name,
            "avatar_url": current_user.avatar_url,
            "subscription_tier": current_user.subscription_tier,
            "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
        },
    }


# ─── Vote history ─────────────────────────────────────────────────────────────

@router.get("/me/votes")
async def get_my_votes(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a paginated list of legislation the user has voted on."""
    query = (
        db.query(LegislationVote)
        .filter(LegislationVote.user_id == current_user.id)
        .order_by(LegislationVote.updated_at.desc())
    )
    total = query.count()
    rows = query.offset(offset).limit(limit).all()

    results = []
    for vote_row in rows:
        leg = db.query(Legislation).filter(Legislation.id == vote_row.legislation_id).first()
        results.append({
            "vote": vote_row.vote,
            "voted_at": vote_row.updated_at.isoformat() if vote_row.updated_at else None,
            "legislation": {
                "id": vote_row.legislation_id,
                "title": leg.title if leg else None,
                "bill_number": leg.bill_number if leg else None,
                "status": leg.status if leg else None,
                "level": leg.level if leg else None,
            },
        })

    return {
        "success": True,
        "total": total,
        "limit": limit,
        "offset": offset,
        "votes": results,
    }


# ─── My Debates ───────────────────────────────────────────────────────────────

@router.get("/me/debates")
async def get_my_debates(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return debates created by the authenticated user."""
    query = (
        db.query(Debate)
        .filter(Debate.created_by_user_id == current_user.id)
        .order_by(Debate.created_at.desc())
    )
    total = query.count()
    debates = query.offset(offset).limit(limit).all()

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
                "turn_count": d.turn_count,
                "max_turns": d.max_turns,
                "legislation_title": d.legislation.title if d.legislation else None,
                "legislation_id": d.legislation_id,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in debates
        ],
    }


# ─── Personal AI Debator ──────────────────────────────────────────────────────

@router.get("/stances/dimensions")
async def get_stance_dimensions():
    """Return the list of policy stance dimensions for the Personal AI Debator builder.

    The UI should render each dimension as a 5-button row or slider.
    """
    return {
        "success": True,
        "dimensions": [
            {
                "key": d["key"],
                "label": d["label"],
                "description": d["description"],
                "positions": {str(k): v for k, v in d["positions"].items()},
            }
            for d in DIMENSIONS
        ],
    }


class PersonalAgentRequest(BaseModel):
    stances: Dict[str, int]
    display_name: Optional[str] = None       # e.g. "Alex's Debator" — max 50 chars
    avatar_id: Optional[str] = None          # HeyGen stock avatar ID

    @field_validator("display_name")
    @classmethod
    def name_length(cls, v):
        if v and len(v.strip()) > 50:
            raise ValueError("display_name must be 50 characters or fewer")
        return v.strip() if v else v

    @field_validator("avatar_id")
    @classmethod
    def avatar_length(cls, v):
        if v and len(v) > 100:
            raise ValueError("avatar_id must be 100 characters or fewer")
        return v


@router.get("/me/agent")
async def get_my_agent(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the user's Personal AI Debator, or 404 if none exists."""
    agent = db.query(Agent).filter(Agent.owner_user_id == current_user.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="No personal AI debator found. Create one via POST /me/agent.")

    return {
        "success": True,
        "agent": {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "avatar_id": agent.avatar_id,
            "is_active": agent.is_active,
        },
    }


@router.post("/me/agent")
async def create_or_replace_my_agent(
    body: PersonalAgentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _tier=Depends(require_paid_tier),
):
    """Create or replace the user's Personal AI Debator.

    Accepts stance choices (integers 1–5 per policy dimension) and generates
    an AI agent with a system prompt derived from those stances.
    One personal debator per user — calling this again replaces the previous one.
    """
    # Validate stances
    errors = validate_stances(body.stances)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    display_name = body.display_name or (current_user.display_name or "My") + "'s Debator"
    system_prompt = build_persona_prompt(body.stances, display_name=display_name)

    settings = get_settings()

    # Remove existing personal agent if present
    existing = db.query(Agent).filter(Agent.owner_user_id == current_user.id).first()
    if existing:
        db.delete(existing)
        db.flush()

    agent = Agent(
        id=f"agent_{uuid.uuid4().hex[:12]}",
        name=display_name,
        description=f"Personal AI Debator for {current_user.display_name or current_user.email}",
        persona="Personal Debator",
        system_prompt=system_prompt,
        expertise_areas="",
        agent_type="claude",
        model_name=settings.default_model,
        avatar_id=body.avatar_id,
        owner_user_id=current_user.id,
        is_active=True,
    )
    db.add(agent)
    db.commit()

    return {
        "success": True,
        "agent": {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "avatar_id": agent.avatar_id,
            "is_active": agent.is_active,
        },
    }


@router.delete("/me/agent")
async def delete_my_agent(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete the user's Personal AI Debator."""
    agent = db.query(Agent).filter(Agent.owner_user_id == current_user.id).first()
    if not agent:
        raise HTTPException(status_code=404, detail="No personal AI debator to delete.")

    db.delete(agent)
    db.commit()
    return {"success": True, "message": "Personal AI debator deleted."}
