"""API routes for legislation management."""

import logging
import re
import uuid as _uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.database import get_db
from app.services.legislation_service import LegislationIngestionService
from app.models import Legislation, LegislationVote
from app.auth import require_dev_tier, get_optional_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/legislation", tags=["legislation"])

VALID_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
}


@router.post("/ingest/federal")
async def ingest_federal_legislation(
    congress: int = Query(118, ge=100, le=120, description="Congress session number (100-120)"),
    limit: int = Query(20, ge=1, le=250, description="Number of bills to fetch"),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and ingest federal bills from Congress.gov."""
    try:
        service = LegislationIngestionService(db)
        count = await service.ingest_federal_legislation(congress, limit)
        return {"success": True, "bills_ingested": count}
    except Exception as e:
        logger.error(f"Error ingesting federal legislation (congress={congress}): {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/ingest/state/{state}")
async def ingest_state_legislation(
    state: str,
    limit: int = Query(20, ge=1, le=250, description="Number of bills to fetch"),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and ingest bills from a specific state via OpenStates."""
    state_upper = state.upper()
    if state_upper not in VALID_STATES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid state abbreviation: '{state}'. Must be a valid US state/territory code."
        )

    try:
        service = LegislationIngestionService(db)
        count = await service.ingest_state_legislation(state_upper, limit)
        return {"success": True, "bills_ingested": count}
    except Exception as e:
        logger.error(f"Error ingesting state legislation (state={state_upper}): {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


_CITY_SLUG_RE = re.compile(r"^[a-zA-Z0-9\-]+$")


@router.post("/ingest/local/{city}")
async def ingest_local_legislation(
    city: str,
    limit: int = Query(20, ge=1, le=250, description="Number of matters to fetch"),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and ingest city/municipal legislation via the Legistar API.

    The ``city`` parameter is the Legistar client slug for the municipality, e.g.:
    - ``Philadelphia`` for Philadelphia, PA
    - ``nyc`` for New York City
    - ``Seattle`` for Seattle, WA

    Find a city's slug at https://webapi.legistar.com/Help or by visiting
    https://{city}.legistar.com.
    """
    city = city.strip()
    if not city or len(city) > 50 or not _CITY_SLUG_RE.match(city):
        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid city slug. Must be 1–50 alphanumeric characters or hyphens "
                "(e.g. 'Philadelphia', 'nyc', 'los-angeles')."
            ),
        )

    try:
        service = LegislationIngestionService(db)
        result = await service.ingest_local_legislation(city, limit)
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Error ingesting local legislation for city={city!r}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/list")
async def list_legislation(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    level: str = Query("", max_length=20),
    db: Session = Depends(get_db)
):
    """List all legislation with pagination."""
    try:
        service = LegislationIngestionService(db)
        results, total = service.search_legislation("", limit=limit, offset=offset, level=level)
        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "results": [
                {"id": leg.id, "bill_number": leg.bill_number, "title": leg.title,
                 "source": leg.source, "status": leg.status, "level": leg.level}
                for leg in results
            ]
        }
    except Exception as e:
        logger.error(f"Error listing legislation: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/search")
async def search_legislation(
    q: str = Query('', max_length=200, description="Search query — omit or leave blank to list all"),
    limit: int = Query(20, ge=1, le=100, description="Max results to return"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    level: str = Query("", max_length=20),
    db: Session = Depends(get_db)
):
    """Search for legislation by title or bill number."""
    try:
        service = LegislationIngestionService(db)
        results, total = service.search_legislation(q, limit=limit, offset=offset, level=level)
        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "results": [
                {
                    "id": leg.id,
                    "bill_number": leg.bill_number,
                    "title": leg.title,
                    "source": leg.source,
                    "status": leg.status,
                    "level": leg.level,
                }
                for leg in results
            ]
        }
    except Exception as e:
        logger.error(f"Error searching legislation (q={q!r}): {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


class VoteRequest(BaseModel):
    vote: str
    voter_token: str
    debate_id: str | None = None

    @field_validator("vote")
    @classmethod
    def valid_vote(cls, v: str) -> str:
        if v not in {"support", "oppose", "neutral"}:
            raise ValueError("vote must be 'support', 'oppose', or 'neutral'")
        return v

    @field_validator("voter_token")
    @classmethod
    def valid_uuid(cls, v: str) -> str:
        try:
            _uuid.UUID(v)
        except ValueError:
            raise ValueError("voter_token must be a valid UUID")
        return v


def _tally(rows) -> dict:
    counts = {"support": 0, "oppose": 0, "neutral": 0}
    for vote, n in rows:
        if vote in counts:
            counts[vote] = n
    counts["total"] = counts["support"] + counts["oppose"] + counts["neutral"]
    return counts


def _vote_counts(db: Session, legislation_id: str) -> dict:
    """Return member, anonymous, and combined vote counts for a bill."""
    base_q = (
        db.query(LegislationVote.vote, func.count(LegislationVote.id))
        .filter(LegislationVote.legislation_id == legislation_id)
        .group_by(LegislationVote.vote)
    )

    member = _tally(base_q.filter(LegislationVote.user_id.isnot(None)).all())
    anonymous = _tally(base_q.filter(LegislationVote.user_id.is_(None)).all())

    total = {
        "support": member["support"] + anonymous["support"],
        "oppose":  member["oppose"]  + anonymous["oppose"],
        "neutral": member["neutral"] + anonymous["neutral"],
    }
    total["total"] = total["support"] + total["oppose"] + total["neutral"]

    return {"member": member, "anonymous": anonymous, "total": total}


@router.post("/{legislation_id}/vote")
async def cast_vote(
    legislation_id: str,
    body: VoteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_user),
):
    """Cast or update a Support / Oppose / Neutral vote on a piece of legislation.

    Votes are anonymous and deduplicated by ``voter_token`` (a UUID the client
    generates once and persists in localStorage).  Submitting again with the
    same token updates the existing vote rather than adding a new one.
    """
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    try:
        existing = (
            db.query(LegislationVote)
            .filter(
                LegislationVote.legislation_id == legislation_id,
                LegislationVote.voter_token == body.voter_token,
            )
            .first()
        )

        if existing:
            existing.vote = body.vote
            if body.debate_id:
                existing.debate_id = body.debate_id
            if current_user and not existing.user_id:
                existing.user_id = current_user.id
        else:
            db.add(LegislationVote(
                id=f"vote_{_uuid.uuid4().hex[:12]}",
                legislation_id=legislation_id,
                debate_id=body.debate_id,
                user_id=current_user.id if current_user else None,
                vote=body.vote,
                voter_token=body.voter_token,
            ))

        db.commit()
        return {
            "success": True,
            "vote": body.vote,
            "counts": _vote_counts(db, legislation_id),
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error casting vote on {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{legislation_id}/votes")
async def get_votes(
    legislation_id: str,
    voter_token: str | None = Query(None, description="Your voter token (UUID) to retrieve your current vote"),
    db: Session = Depends(get_db),
):
    """Get vote tallies for a piece of legislation.

    Pass ``voter_token`` to also receive the caller's current vote.
    """
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    your_vote = None
    if voter_token:
        row = (
            db.query(LegislationVote)
            .filter(
                LegislationVote.legislation_id == legislation_id,
                LegislationVote.voter_token == voter_token,
            )
            .first()
        )
        your_vote = row.vote if row else None

    return {
        "success": True,
        "legislation_id": legislation_id,
        "counts": _vote_counts(db, legislation_id),
        "your_vote": your_vote,
    }


@router.get("/{legislation_id}")
async def get_legislation(
    legislation_id: str,
    db: Session = Depends(get_db)
):
    """Get detailed information about specific legislation."""
    try:
        leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
        if not leg:
            raise HTTPException(status_code=404, detail="Legislation not found")

        return {
            "success": True,
            "data": {
                "id": leg.id,
                "bill_number": leg.bill_number,
                "title": leg.title,
                "description": leg.description,
                "full_text": leg.full_text,
                "sponsor": leg.sponsor,
                "status": leg.status,
                "source": leg.source,
                "level": leg.level,
                "introduced_date": leg.introduced_date,
                "external_url": leg.external_url,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching legislation {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
