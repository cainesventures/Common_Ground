"""API routes for authenticated user actions."""

import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.models import BillTracking, Legislation, LegislationVote, User
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
            "digest_enabled": current_user.digest_enabled,
            "digest_frequency": current_user.digest_frequency or "weekly",
            "digest_min_impact": current_user.digest_min_impact or "low",
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
                "plain_title": leg.plain_title if leg else None,
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


# ── Bill Tracking ─────────────────────────────────────────────────────────────

@router.post("/me/track/{bill_id}")
async def toggle_track_bill(
    bill_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Toggle tracking (save/unsave) a bill. Returns current tracked state."""
    bill = db.query(Legislation).filter(Legislation.id == bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    existing = db.query(BillTracking).filter(
        BillTracking.user_id == current_user.id,
        BillTracking.bill_id == bill_id,
    ).first()

    if existing:
        db.delete(existing)
        db.commit()
        return {"success": True, "tracked": False}

    tracking = BillTracking(
        id=f"track_{uuid.uuid4().hex[:12]}",
        user_id=current_user.id,
        bill_id=bill_id,
    )
    db.add(tracking)
    db.commit()
    return {"success": True, "tracked": True}


@router.get("/me/tracked-bills")
async def get_tracked_bills(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all bills the current user is tracking."""
    trackings = (
        db.query(BillTracking)
        .filter(BillTracking.user_id == current_user.id)
        .order_by(BillTracking.tracked_at.desc())
        .all()
    )

    bills = []
    for t in trackings:
        leg = db.query(Legislation).filter(Legislation.id == t.bill_id).first()
        if not leg:
            continue
        tags = []
        try:
            tags = json.loads(leg.tags) if leg.tags else []
        except Exception:
            pass
        bills.append({
            "id": leg.id,
            "bill_number": leg.bill_number,
            "title": leg.title,
            "plain_title": leg.plain_title,
            "status": leg.status,
            "level": leg.level,
            "impact_level": leg.impact_level,
            "impact_score": leg.impact_score,
            "bill_type": leg.bill_type,
            "tags": leg.tags,
            "summary": leg.summary,
            "description": leg.description,
            "analyzed_at": leg.analyzed_at.isoformat() if leg.analyzed_at else None,
            "tracked_at": t.tracked_at.isoformat() if t.tracked_at else None,
        })

    return {"success": True, "bills": bills}


@router.get("/me/tracked-bill-ids")
async def get_tracked_bill_ids(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return just the bill IDs the current user is tracking (for fast lookup)."""
    ids = [
        row.bill_id
        for row in db.query(BillTracking.bill_id)
        .filter(BillTracking.user_id == current_user.id)
        .all()
    ]
    return {"success": True, "ids": ids}


# ── User Preferences ──────────────────────────────────────────────────────────

class PreferencesUpdate(BaseModel):
    digest_enabled: bool
    digest_frequency: str = "weekly"
    digest_min_impact: str = "low"

    @field_validator("digest_frequency")
    @classmethod
    def valid_frequency(cls, v: str) -> str:
        if v not in ("daily", "weekly", "never"):
            raise ValueError("digest_frequency must be 'daily', 'weekly', or 'never'")
        return v

    @field_validator("digest_min_impact")
    @classmethod
    def valid_impact(cls, v: str) -> str:
        if v not in ("low", "medium", "high"):
            raise ValueError("digest_min_impact must be 'low', 'medium', or 'high'")
        return v


@router.patch("/me/preferences")
async def update_preferences(
    body: PreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update user notification preferences."""
    current_user.digest_enabled = body.digest_enabled
    current_user.digest_frequency = body.digest_frequency
    current_user.digest_min_impact = body.digest_min_impact
    db.commit()
    return {
        "success": True,
        "digest_enabled": current_user.digest_enabled,
        "digest_frequency": current_user.digest_frequency,
        "digest_min_impact": current_user.digest_min_impact,
    }


# ── Email Digest (admin trigger) ──────────────────────────────────────────────

@router.post("/send-digest")
async def trigger_digest(
    lookback_days: int = Query(7, ge=1, le=30),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Trigger a weekly digest send to all opted-in users. Dev tier only."""
    if current_user.subscription_tier != "dev":
        raise HTTPException(status_code=403, detail="Dev tier required")

    from app.services.email_service import send_weekly_digest
    try:
        result = send_weekly_digest(db, lookback_days=lookback_days)
        return {"success": True, **result}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Digest send failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to send digest")
