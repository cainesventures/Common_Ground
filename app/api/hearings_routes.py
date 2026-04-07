"""API routes for upcoming City Council hearings."""

import asyncio
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.models import Legislation
from app.auth import require_dev_tier
from app.models.database import get_db

router = APIRouter(prefix="/api/hearings", tags=["hearings"])


@router.post("/refresh")
async def refresh_hearings(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Scrape Calendar.aspx and update hearing dates for matching bills. Admin only."""
    from app.services.hearing_service import refresh_upcoming_hearings
    try:
        result = await asyncio.to_thread(refresh_upcoming_hearings, db)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/upcoming")
async def get_upcoming_hearings(
    days: int = Query(30, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """Return bills with a hearing scheduled within the next `days` days, sorted by date."""
    now = datetime.utcnow()
    cutoff = now + timedelta(days=days)
    bills = (
        db.query(Legislation)
        .filter(
            Legislation.next_hearing_date.isnot(None),
            Legislation.next_hearing_date >= now,
            Legislation.next_hearing_date <= cutoff,
        )
        .order_by(Legislation.next_hearing_date.asc())
        .all()
    )
    return {
        "total": len(bills),
        "hearings": [
            {
                "id":                   b.id,
                "bill_number":          b.bill_number,
                "title":                b.title,
                "plain_title":          b.plain_title,
                "status":               b.status,
                "next_hearing_date":    b.next_hearing_date.isoformat() if b.next_hearing_date else None,
                "next_hearing_time":    b.next_hearing_time,
                "next_hearing_body":    b.next_hearing_body,
                "next_hearing_location": b.next_hearing_location,
            }
            for b in bills
        ],
    }
