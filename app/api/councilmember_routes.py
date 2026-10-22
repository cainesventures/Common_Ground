"""API routes for Philadelphia City Council members."""

import json
import logging
import urllib.request
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.database import get_db
from app.models import CouncilmemberVote, BillVoteRecord, Legislation
from app.auth import require_dev_tier, get_optional_user, get_current_user
from app.rate_limit import limiter
from app.services.councilmember_service import (
    get_all_councilmembers,
    get_councilmember,
    get_councilmember_bills,
    get_legislative_profile,
    scrape_and_upsert_councilmembers,
    backfill_missing_emails,
    sponsored_bill_counts,
)

# Known Philadelphia City Council district GeoJSON sources (tried in order)
_DISTRICT_GEOJSON_URLS = [
    # OpenDataPhilly / City of Philadelphia ArcGIS
    "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Council_Districts_2024/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
    "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
    "https://services1.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
    # OpenDataPhilly CKAN direct download
    "https://opendata.arcgis.com/datasets/9298c2f3fa3241fbb176ff1cd84e2d26_0.geojson",
]

_geojson_cache: dict | None = None


def _next_election_year() -> int:
    """Philadelphia City Council elections every 4 years in odd years: 2019, 2023, 2027…"""
    current = datetime.utcnow().year
    base = 2019
    cycles_elapsed = (current - base) // 4
    candidate = base + (cycles_elapsed + 1) * 4
    return candidate if candidate > current else candidate + 4

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/councilmembers", tags=["councilmembers"])


@router.get("/districts-geojson")
async def get_districts_geojson():
    """Proxy Philadelphia City Council district boundaries GeoJSON.

    Tries multiple known sources and caches the first successful response
    in memory for the lifetime of the process.
    """
    global _geojson_cache
    if _geojson_cache is not None:
        return JSONResponse(content=_geojson_cache)

    last_error = None
    for url in _DISTRICT_GEOJSON_URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            if data.get("features"):
                logger.info(f"Loaded district GeoJSON from {url} ({len(data['features'])} features)")
                _geojson_cache = data
                return JSONResponse(content=data)
        except Exception as e:
            last_error = e
            logger.warning(f"District GeoJSON source failed ({url}): {e}")

    raise HTTPException(status_code=502, detail=f"Could not fetch district boundaries: {last_error}")


@router.post("/backfill-emails")
async def backfill_emails(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Scrape email addresses for council members that are currently missing one."""
    try:
        result = await backfill_missing_emails(db)
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Email backfill failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/scrape")
async def scrape_councilmembers(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Scrape all 17 current Philadelphia council member profiles from phlcouncil.com."""
    try:
        members = await scrape_and_upsert_councilmembers(db)
        return {
            "success": True,
            "scraped": len(members),
            "members": [{"id": m.id, "name": m.name, "district": m.district} for m in members],
        }
    except Exception as e:
        logger.error(f"Error scraping councilmembers: {e}")
        raise HTTPException(status_code=500, detail=f"Scrape failed: {e}")


@router.get("")
async def list_councilmembers(db: Session = Depends(get_db)):
    """List all Philadelphia City Council members."""
    members = get_all_councilmembers(db)
    sponsored = sponsored_bill_counts(db, members)
    return {
        "success": True,
        "total": len(members),
        "members": [
            {
                "id": m.id,
                "name": m.name,
                "district": m.district,
                "party": m.party,
                "email": m.email,
                "phone": m.phone,
                "photo_url": m.photo_url,
                "bills_sponsored": sponsored[m.id],
                "profile_url": m.profile_url,
                "term_start": m.term_start,
                "years_serving": (datetime.utcnow().year - m.term_start) if m.term_start else None,
                "next_election": _next_election_year(),
                "years_until_election": _next_election_year() - datetime.utcnow().year,
            }
            for m in members
        ],
    }


@router.get("/{member_id}")
async def get_member(
    member_id: str,
    bills_page: int = Query(1, ge=1),
    bills_limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get a single council member with their sponsored bills."""
    member = get_councilmember(db, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Council member not found")

    offset = (bills_page - 1) * bills_limit
    bills, total = get_councilmember_bills(db, member.name, term_start=member.term_start,
                                           limit=bills_limit, offset=offset)

    return {
        "success": True,
        "member": {
            "id": member.id,
            "name": member.name,
            "district": member.district,
            "party": member.party,
            "email": member.email,
            "phone": member.phone,
            "photo_url": member.photo_url,
            "bio": member.bio,
            "profile_url": member.profile_url,
            "bills_sponsored": total,
            "term_start": member.term_start,
            "years_serving": (datetime.utcnow().year - member.term_start) if member.term_start else None,
            "next_election": _next_election_year(),
            "years_until_election": _next_election_year() - datetime.utcnow().year,
            "updated_at": member.updated_at.isoformat() if member.updated_at else None,
        },
        "bills": {
            "total": total,
            "page": bills_page,
            "limit": bills_limit,
            "results": [
                {
                    "id": b.id,
                    "bill_number": b.bill_number,
                    "title": b.title,
                    "status": b.status,
                    "introduced_date": b.introduced_date.isoformat() if b.introduced_date else None,
                    "impact_level": b.impact_level,
                    "analyzed_at": b.analyzed_at.isoformat() if b.analyzed_at else None,
                }
                for b in bills
            ],
        },
    }


@router.get("/{member_id}/bills")
async def get_member_bills_by_outcome(
    member_id: str,
    outcome: str = Query(default="", pattern="^(signed|active|died|failed)?$"),
    page:    int = Query(1, ge=1),
    limit:   int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Sponsored bills for a member, optionally filtered to one outcome bucket.
    Powers the expandable Signed / Live Bills lists on the profile."""
    member = get_councilmember(db, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Council member not found")
    offset = (page - 1) * limit
    bills, total = get_councilmember_bills(
        db, member.name, term_start=member.term_start,
        outcome=outcome or None, limit=limit, offset=offset,
    )
    return {
        "success": True,
        "total": total,
        "page": page,
        "limit": limit,
        "results": [
            {
                "id": b.id,
                "bill_number": b.bill_number,
                "title": b.plain_title or b.title,
                "status": b.status,
                "introduced_date": b.introduced_date.isoformat() if b.introduced_date else None,
                "impact_level": b.impact_level,
            }
            for b in bills
        ],
    }


@router.get("/{member_id}/legislative-profile")
async def get_member_legislative_profile(member_id: str, db: Session = Depends(get_db)):
    """Aggregated analysis of what a member legislates on, their effectiveness,
    and their voting behaviour."""
    member = get_councilmember(db, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Council member not found")
    profile = get_legislative_profile(db, member.id, member.name, member.term_start)
    return {"success": True, "member_id": member.id, "profile": profile}


# ── Council member approval votes ────────────────────────────────────────────

class CouncilmemberVoteRequest(BaseModel):
    vote: str
    # Optional, and no longer the identity. Kept so the client can keep sending
    # what it already sends, and so each row records which browser cast it.
    voter_token: Optional[str] = None

    @field_validator("vote")
    @classmethod
    def valid_vote(cls, v: str) -> str:
        if v not in ("support", "oppose"):
            raise ValueError("vote must be 'support' or 'oppose'")
        return v

    @field_validator("voter_token")
    @classmethod
    def valid_token(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        try:
            uuid.UUID(v)
        except ValueError:
            raise ValueError("voter_token must be a valid UUID")
        return v


def _cm_vote_counts(db: Session, councilmember_id: str) -> dict:
    rows = (
        db.query(CouncilmemberVote.vote, func.count(CouncilmemberVote.id))
        .filter(CouncilmemberVote.councilmember_id == councilmember_id)
        .group_by(CouncilmemberVote.vote)
        .all()
    )
    counts = {"support": 0, "oppose": 0}
    for vote, n in rows:
        if vote in counts:
            counts[vote] = n
    return counts


@router.get("/{member_id}/votes")
async def get_member_votes(
    member_id: str,
    voter_token: str = Query("", deprecated=True, description="Ignored; retained so older clients keep working."),
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_user),
):
    """Get support/oppose vote counts for a council member and the caller's current vote.

    ``your_vote`` is resolved from the session. It used to be looked up by the
    ``voter_token`` query parameter, which meant anyone could read back a
    stranger's vote by guessing or replaying their token. The parameter is
    accepted and ignored so a cached client build does not start 422-ing.
    """
    counts = _cm_vote_counts(db, member_id)
    your_vote = None
    if current_user:
        row = (
            db.query(CouncilmemberVote)
            .filter(
                CouncilmemberVote.councilmember_id == member_id,
                CouncilmemberVote.user_id == current_user.id,
            )
            .first()
        )
        if row:
            your_vote = row.vote
    return {"success": True, "counts": counts, "your_vote": your_vote}


@router.post("/{member_id}/vote")
@limiter.limit("20/minute")
async def cast_member_vote(
    request: Request,
    member_id: str,
    body: CouncilmemberVoteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Cast or update a support/oppose vote on a council member.

    Requires an account. One vote per account per member; voting again updates
    that row.

    This endpoint used to accept anonymous votes deduplicated on a UUID the
    caller generated, with no rate limit -- so the "Citizen Approval" figure
    shown on a named council member's page could be set to any value by
    looping over fresh UUIDs. The frontend already refused to vote without a
    session (`isLoggedIn()` in CouncilmemberDetailClient); only the server did
    not check, so requiring auth here costs no reader anything.
    """
    from app.services.councilmember_service import get_councilmember
    if not get_councilmember(db, member_id):
        raise HTTPException(status_code=404, detail="Council member not found")

    try:
        existing = (
            db.query(CouncilmemberVote)
            .filter(
                CouncilmemberVote.councilmember_id == member_id,
                CouncilmemberVote.user_id == current_user.id,
            )
            .first()
        )
        if existing:
            existing.vote = body.vote
            existing.updated_at = datetime.utcnow()
            if body.voter_token:
                existing.voter_token = body.voter_token
        else:
            db.add(CouncilmemberVote(
                id=f"cmv_{uuid.uuid4().hex[:12]}",
                councilmember_id=member_id,
                user_id=current_user.id,
                vote=body.vote,
                voter_token=body.voter_token,
            ))
        db.commit()
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error casting council member vote on {member_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

    return {"success": True, "counts": _cm_vote_counts(db, member_id), "your_vote": body.vote}


@router.get("/{member_id}/vote-history")
async def get_vote_history(
    member_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Return official roll call vote history for a council member, paginated."""
    if not get_councilmember(db, member_id):
        raise HTTPException(status_code=404, detail="Council member not found")

    total = db.query(BillVoteRecord).filter(BillVoteRecord.councilmember_id == member_id).count()

    records = (
        db.query(BillVoteRecord, Legislation)
        .join(Legislation, BillVoteRecord.legislation_id == Legislation.id)
        .filter(BillVoteRecord.councilmember_id == member_id)
        .order_by(BillVoteRecord.action_date.desc().nullslast())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "success": True,
        "total": total,
        "page": page,
        "page_size": page_size,
        "data": [
            {
                "legislation_id": rec.legislation_id,
                "bill_number": leg.bill_number,
                "plain_title": leg.plain_title or leg.title,
                "vote": rec.vote,
                "action_date": rec.action_date,
                "result": rec.result,
                "impact_level": leg.impact_level,
                "status": leg.status,
            }
            for rec, leg in records
        ],
    }
