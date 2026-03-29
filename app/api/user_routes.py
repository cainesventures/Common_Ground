"""API routes for authenticated user actions."""

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.models import Legislation, LegislationVote, User
from app.models.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/users", tags=["users"])


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
