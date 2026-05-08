"""API routes for Philadelphia City Council elections and candidate vote predictions."""

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import Candidate, CandidateVotePrediction, Legislation
from app.auth import require_dev_tier
from app.models.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/elections", tags=["elections"])

DISCLAIMER = (
    "AI-generated speculation for civic engagement only. "
    "Predictions are not factual representations of any candidate's positions. "
    "They are generated from publicly available party and background information."
)


class CandidateCreate(BaseModel):
    name: str
    district: str
    party: Optional[str] = None
    bio: Optional[str] = None
    photo_url: Optional[str] = None
    website_url: Optional[str] = None
    office_sought: Optional[str] = None
    election_year: int
    is_incumbent: bool = False
    known_positions: Optional[str] = None


# ── Candidate CRUD ────────────────────────────────────────────────────────────

@router.get("/office-description")
async def get_office_description(
    office: str = Query(..., max_length=200),
    db: Session = Depends(get_db),
):
    """
    Return an AI-generated description of a Philadelphia elected office.
    Cached in aggregated_data_cache; generated on first request.
    """
    import json
    from app.models import AggregatedDataCache

    cache_key = f"office_{office.lower().replace(' ', '_')}"
    cached = db.query(AggregatedDataCache).filter_by(source="election_office_ai", key=cache_key).first()
    if cached and cached.data:
        return {"office": office, **json.loads(cached.data)}

    # Generate with AI
    from app.services.ai_provider import get_ai_provider

    provider = get_ai_provider()
    prompt = f"""Describe the elected office: "{office}" in Philadelphia city government.

Provide a JSON response with exactly these keys:
{{
  "what_it_does": "2-3 sentence plain-English description of this office's role and powers",
  "key_responsibilities": ["responsibility 1", "responsibility 2", "responsibility 3"],
  "good_candidate_traits": ["trait 1", "trait 2", "trait 3"],
  "term_length": "X years",
  "salary_approx": "$XX,XXX per year (approximate)"
}}

No markdown, no extra text — only the JSON object."""

    try:
        response = provider.complete(
            system_prompt="You are a nonpartisan civic education resource about Philadelphia government.",
            user_prompt=prompt,
        )
        match = __import__("re").search(r'\{.*\}', response, __import__("re").DOTALL)
        data = json.loads(match.group(0)) if match else {}
    except Exception as e:
        logger.warning(f"Office description AI failed for {office}: {e}")
        data = {
            "what_it_does": f"{office} is a Philadelphia elected position responsible for representing constituents and passing legislation.",
            "key_responsibilities": ["Introduce and vote on legislation", "Represent district constituents", "Attend committee hearings"],
            "good_candidate_traits": ["Community engagement", "Policy knowledge", "Integrity"],
            "term_length": "4 years",
            "salary_approx": "See Philadelphia City Council website",
        }

    # Cache it
    if cached:
        cached.data = json.dumps(data)
    else:
        db.add(AggregatedDataCache(
            id=f"cache_{uuid.uuid4().hex[:12]}",
            source="election_office_ai",
            key=cache_key,
            data=json.dumps(data),
            expires_at=None,
        ))
    db.commit()
    return {"office": office, **data}


@router.get("/candidates")
async def list_candidates(
    election_year: Optional[int] = Query(None),
    district: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Candidate)
    if election_year:
        q = q.filter(Candidate.election_year == election_year)
    if district:
        q = q.filter(Candidate.district.ilike(f"%{district}%"))
    candidates = q.order_by(Candidate.district, Candidate.name).all()
    return {
        "total": len(candidates),
        "candidates": [_serialize(c) for c in candidates],
    }


@router.post("/candidates")
async def create_candidate(
    data: CandidateCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    candidate = Candidate(
        id=f"cand_{uuid.uuid4().hex[:12]}",
        **data.model_dump(),
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    return {"success": True, "candidate": _serialize(candidate)}


@router.patch("/candidates/{candidate_id}")
async def update_candidate(
    candidate_id: str,
    data: CandidateCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    candidate = db.query(Candidate).filter_by(id=candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(candidate, field, value)
    candidate.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(candidate)
    return {"success": True, "candidate": _serialize(candidate)}


@router.delete("/candidates/{candidate_id}")
async def delete_candidate(
    candidate_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    candidate = db.query(Candidate).filter_by(id=candidate_id).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    db.delete(candidate)
    db.commit()
    return {"success": True}


# ── Predictions ───────────────────────────────────────────────────────────────

@router.get("/predictions")
async def get_predictions(
    bill_id: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Return AI vote predictions for all candidates for a given bill.
    Generates missing predictions on demand (one AI call per uncached candidate).
    """
    from app.services.election_service import generate_prediction

    bill = db.query(Legislation).filter_by(id=bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    candidates = db.query(Candidate).order_by(Candidate.district, Candidate.name).all()
    if not candidates:
        return {"bill_id": bill_id, "disclaimer": DISCLAIMER, "predictions": []}

    predictions = []
    for candidate in candidates:
        try:
            pred = generate_prediction(candidate, bill, db)
            predictions.append({
                "candidate_id":   candidate.id,
                "candidate_name": candidate.name,
                "district":       candidate.district,
                "party":          candidate.party,
                "is_incumbent":   candidate.is_incumbent,
                "predicted_vote": pred.predicted_vote,
                "reasoning":      pred.reasoning,
                "generated_at":   pred.generated_at.isoformat() if pred.generated_at else None,
            })
        except Exception as e:
            predictions.append({
                "candidate_id":   candidate.id,
                "candidate_name": candidate.name,
                "district":       candidate.district,
                "party":          candidate.party,
                "is_incumbent":   candidate.is_incumbent,
                "predicted_vote": "uncertain",
                "reasoning":      f"Prediction unavailable: {e}",
                "generated_at":   None,
            })

    return {
        "bill_id":     bill_id,
        "bill_title":  bill.plain_title or bill.title,
        "disclaimer":  DISCLAIMER,
        "predictions": predictions,
    }


@router.post("/candidates/scrape")
async def scrape_candidates(
    election_year: int = Query(2027),
    overwrite: bool = Query(False),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """
    Scrape Ballotpedia for Philadelphia City Council candidates and upsert into DB.
    If overwrite=False (default), only adds candidates whose name is not already in DB.
    Returns {"added": int, "skipped": int, "candidates": [...]}
    """
    from app.services.candidate_scraper import scrape_candidates as do_scrape

    scraped, source_year, source_url = do_scrape(election_year)
    if not scraped:
        raise HTTPException(
            status_code=502,
            detail=(
                f"Ballotpedia has no candidates for {election_year} yet — "
                "the page may not exist until closer to the election. "
                "Try a past election year (e.g. 2023 or 2025)."
            ),
        )

    existing_names = {c.name.lower() for c in db.query(Candidate.name).all()}

    added, skipped = 0, 0
    upserted = []
    for data in scraped:
        if not overwrite and data["name"].lower() in existing_names:
            skipped += 1
            continue
        if overwrite:
            existing = db.query(Candidate).filter(Candidate.name.ilike(data["name"])).first()
            if existing:
                for k, v in data.items():
                    if k != "id" and v is not None:
                        setattr(existing, k, v)
                existing.updated_at = datetime.utcnow()
                db.flush()
                upserted.append(_serialize(existing))
                added += 1
                continue
        c = Candidate(**data)
        db.add(c)
        db.flush()
        upserted.append(_serialize(c))
        added += 1

    db.commit()
    return {
        "success": True,
        "added": added,
        "skipped": skipped,
        "source_year": source_year,
        "source_url": source_url,
        "candidates": upserted,
    }


@router.delete("/predictions")
async def clear_predictions(
    bill_id: Optional[str] = Query(None),
    candidate_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Clear cached predictions. Filter by bill_id or candidate_id, or clear all."""
    q = db.query(CandidateVotePrediction)
    if bill_id:
        q = q.filter_by(bill_id=bill_id)
    if candidate_id:
        q = q.filter_by(candidate_id=candidate_id)
    deleted = q.delete()
    db.commit()
    return {"success": True, "deleted": deleted}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize(c: Candidate) -> dict:
    return {
        "id":              c.id,
        "name":            c.name,
        "district":        c.district,
        "party":           c.party,
        "bio":             c.bio,
        "photo_url":       c.photo_url,
        "website_url":     c.website_url,
        "office_sought":   c.office_sought,
        "election_year":   c.election_year,
        "is_incumbent":    c.is_incumbent,
        "known_positions": c.known_positions,
    }
