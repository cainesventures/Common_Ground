"""API routes for legislation management."""

import logging
import re
import uuid as _uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.database import get_db
from app.services.legislation_service import LegislationIngestionService
from app.models import Legislation, LegislationVote, BillPerspective
from app.auth import require_dev_tier, get_optional_user
from app.services.perspectives_service import ALL_PERSPECTIVES

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/legislation", tags=["legislation"])

_GENERIC_DESCRIPTIONS = {'bill', 'ordinance', 'resolution', 'motion', 'order', ''}

def _display_description(leg) -> str | None:
    """Return the best available short description for a bill card."""
    if leg.description and leg.description.strip().lower() not in _GENERIC_DESCRIPTIONS:
        return leg.description
    if leg.full_text:
        text = leg.full_text
        # Skip boilerplate up to "Tally", then skip the title duplicate
        idx = text.lower().find("tally")
        if idx != -1:
            text = text[idx + len("tally"):]
            # After Tally, the title is repeated — jump to the first WHEREAS/SECTION/BE IT
            for marker in ("WHEREAS", "SECTION", "BE IT"):
                m = text.find(marker)
                if m != -1:
                    text = text[m:]
                    break
            else:
                # No known marker found — skip first paragraph as fallback
                para_end = text.find("\n\n")
                if para_end != -1:
                    text = text[para_end:].lstrip()
        return text[:300].strip() or None
    return None

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
    limit: int = Query(20, ge=1, le=250, description="Number of matters to fetch (ignored when bulk=true)"),
    bulk: bool = Query(False, description="Philadelphia only: export all ~8500 bills via Excel in one shot"),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and ingest city/municipal legislation.

    For Philadelphia, pass ``bulk=true`` to export all ~8,500 bills at once via
    Excel export (ignores ``limit``). Individual bill analysis (sponsors, full text)
    is deferred until the Analyze button is clicked per bill.

    For other cities, uses the Legistar REST API with the city slug.
    """
    city = city.strip()
    if not city or len(city) > 50 or not _CITY_SLUG_RE.match(city):
        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid city slug. Must be 1–50 alphanumeric characters or hyphens "
                "(e.g. 'philadelphia', 'nyc', 'los-angeles')."
            ),
        )

    try:
        service = LegislationIngestionService(db)
        result = await service.ingest_local_legislation(city, limit, bulk=bulk)
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


@router.get("/tag-counts")
async def get_tag_counts(db: Session = Depends(get_db)):
    """Return all tags that exist in the DB with their bill counts, sorted by count desc."""
    import json
    from collections import Counter

    rows = db.query(Legislation.tags).filter(
        Legislation.tags.isnot(None),
        Legislation.tags != "",
        Legislation.tags != "[]",
    ).all()

    counter: Counter = Counter()
    for (tags_json,) in rows:
        try:
            tags = json.loads(tags_json)
            if isinstance(tags, list):
                for t in tags:
                    if isinstance(t, str) and t:
                        counter[t] += 1
        except Exception:
            pass

    return {
        "tags": [{"tag": tag, "count": count} for tag, count in counter.most_common()]
    }


@router.get("/search")
async def search_legislation(
    q: str = Query('', max_length=200),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    level: str = Query("", max_length=20),
    analyzed: str = Query("", description="Filter: 'true' = analyzed, 'false' = pending, '' = all"),
    tag: str = Query("", max_length=60),
    impact: str = Query("", max_length=20),
    db: Session = Depends(get_db)
):
    """Search for legislation with optional filters."""
    try:
        analyzed_filter: Optional[bool] = None
        if analyzed == "true":
            analyzed_filter = True
        elif analyzed == "false":
            analyzed_filter = False

        service = LegislationIngestionService(db)
        results, total = service.search_legislation(
            q, limit=limit, offset=offset, level=level, analyzed=analyzed_filter, tag=tag, impact=impact
        )
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
                    "plain_title": leg.plain_title,
                    "source": leg.source,
                    "status": leg.status,
                    "level": leg.level,
                    "tags": leg.tags,
                    "description": _display_description(leg),
                    "summary": leg.summary,
                    "impact_level": leg.impact_level,
                    "impact_score": leg.impact_score,
                    "bill_type": leg.bill_type,
                    "analyzed_at": leg.analyzed_at.isoformat() if leg.analyzed_at else None,
                }
                for leg in results
            ]
        }
    except Exception as e:
        logger.error(f"Error searching legislation (q={q!r}): {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/plain-titles")
async def generate_plain_titles(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Generate plain-English names for all bills that don't have one."""
    try:
        service = LegislationIngestionService(db)
        result = service.generate_plain_titles()
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Error generating plain titles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tag-all")
async def tag_all_bills(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Auto-tag all untagged bills using AI."""
    try:
        service = LegislationIngestionService(db)
        result = service.tag_untagged_bills()
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Error auto-tagging bills: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fetch-news-all")
async def fetch_news_all_bills(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and store news articles for all bills."""
    from app.services.news_service import fetch_and_store_news
    bills = db.query(Legislation).filter(Legislation.level == "local").all()
    fetched = 0
    total_articles = 0
    for bill in bills:
        try:
            articles = fetch_and_store_news(bill, db)
            total_articles += len(articles)
            fetched += 1
        except Exception as e:
            logger.warning(f"News fetch failed for {bill.bill_number}: {e}")
    return {"success": True, "bills_processed": fetched, "total_articles": total_articles}


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


@router.post("/{legislation_id}/analyze")
async def analyze_legislation(
    legislation_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Trigger AI analysis for a bill: summary, impact score, tags, and 3 base perspectives.

    Sets analyzed_at on success. Idempotent — safe to call multiple times.
    """
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    try:
        from app.services.bill_research_service import analyze_bill
        from app.services.perspectives_service import generate_base_perspectives

        leg = analyze_bill(leg, db)
        perspectives = generate_base_perspectives(leg, db)

        return {
            "success": True,
            "bill_number": leg.bill_number,
            "summary": leg.summary,
            "impact_score": leg.impact_score,
            "impact_level": leg.impact_level,
            "bill_type": leg.bill_type,
            "tags": leg.tags,
            "analyzed_at": leg.analyzed_at,
            "perspectives_generated": [p.perspective_type for p in perspectives],
        }
    except Exception as e:
        logger.error(f"Error analyzing legislation {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@router.post("/{legislation_id}/perspectives/{perspective_type}")
async def generate_perspective(
    legislation_id: str,
    perspective_type: str,
    db: Session = Depends(get_db),
):
    """Generate (or return cached) a single on-demand perspective for a bill.

    Public endpoint — no auth required. Results are cached after first generation.
    """
    if perspective_type not in ALL_PERSPECTIVES:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown perspective type. Valid types: {', '.join(ALL_PERSPECTIVES)}",
        )

    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    if not leg.analyzed_at:
        raise HTTPException(
            status_code=400,
            detail="Bill must be analyzed first. Use POST /analyze.",
        )

    try:
        from app.services.perspectives_service import generate_perspective as _gen
        persp = _gen(leg, perspective_type, db)
        if not persp:
            raise HTTPException(status_code=500, detail="Failed to generate perspective")

        return {
            "success": True,
            "perspective_type": persp.perspective_type,
            "position": persp.position,
            "key_arguments": persp.key_arguments,
            "concerns": persp.concerns,
            "assessment": persp.assessment,
            "ai_provider": persp.ai_provider,
            "ai_model": persp.ai_model,
            "generated_at": persp.generated_at,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating {perspective_type} for {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{legislation_id}/perspectives")
async def get_perspectives(
    legislation_id: str,
    db: Session = Depends(get_db),
):
    """Get all generated perspectives for a bill."""
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    perspectives = db.query(BillPerspective).filter(
        BillPerspective.bill_id == legislation_id
    ).all()

    generated = {p.perspective_type for p in perspectives}
    pending = [t for t in ALL_PERSPECTIVES if t not in generated]

    return {
        "success": True,
        "bill_id": legislation_id,
        "analyzed": leg.analyzed_at is not None,
        "perspectives": [
            {
                "perspective_type": p.perspective_type,
                "position": p.position,
                "key_arguments": p.key_arguments,
                "concerns": p.concerns,
                "assessment": p.assessment,
                "generated_at": p.generated_at,
            }
            for p in perspectives
        ],
        "pending_types": pending,
    }


@router.post("/{legislation_id}/fetch-news")
async def fetch_legislation_news(
    legislation_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and store related news articles for a bill from Google News RSS."""
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    try:
        from app.services.news_service import fetch_and_store_news
        articles = fetch_and_store_news(leg, db)
        return {"success": True, "articles_found": len(articles), "articles": articles}
    except Exception as e:
        logger.error(f"Error fetching news for {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail=f"News fetch failed: {e}")


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
                "plain_title": leg.plain_title,
                "summary": leg.summary,
                "impact_score": leg.impact_score,
                "impact_level": leg.impact_level,
                "bill_type": leg.bill_type,
                "tags": leg.tags,
                "analyzed_at": leg.analyzed_at,
                "news_links": leg.news_links,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching legislation {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
