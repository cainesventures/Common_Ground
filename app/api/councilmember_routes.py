"""API routes for Philadelphia City Council members."""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.models.database import get_db
from app.auth import require_dev_tier
from app.services.councilmember_service import (
    get_all_councilmembers,
    get_councilmember,
    get_councilmember_bills,
    scrape_and_upsert_councilmembers,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/councilmembers", tags=["councilmembers"])


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
                "bills_sponsored": m.bills_sponsored,
                "profile_url": m.profile_url,
            }
            for m in members
        ],
    }


@router.get("/{member_id}")
async def get_member(member_id: str, db: Session = Depends(get_db)):
    """Get a single council member with their sponsored bills."""
    member = get_councilmember(db, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Council member not found")

    bills, total = get_councilmember_bills(db, member.name, limit=50, offset=0)

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
            "bills_sponsored": member.bills_sponsored,
            "updated_at": member.updated_at.isoformat() if member.updated_at else None,
        },
        "bills": {
            "total": total,
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
