"""API routes for upcoming City Council hearings."""

import asyncio
import json as _json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.models import Legislation
from app.auth import require_dev_tier
from app.models.database import get_db

router = APIRouter(prefix="/api/hearings", tags=["hearings"])


def _sse(data: dict) -> str:
    return f"data: {_json.dumps(data)}\n\n"


def _sse_stream(gen):
    return StreamingResponse(gen(), media_type="text/event-stream")


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


@router.get("/stream/refresh")
async def stream_refresh_hearings(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream hearing refresh progress as Server-Sent Events. Admin only."""
    from app.integrations.legistar_scraper import PhilaLegistarScraper

    async def gen():
        yield _sse({"current": 0, "total": 0, "message": "Scraping Calendar.aspx…", "done": False})
        await asyncio.sleep(0)

        try:
            scraper = PhilaLegistarScraper(headless=True)
            meetings = await asyncio.to_thread(scraper.scrape_upcoming_hearings)
        except Exception as e:
            yield _sse({"current": 0, "total": 0, "message": f"Scrape failed: {e}", "done": True, "error": True})
            return

        # Clear all stale hearing data
        db.query(Legislation).filter(
            Legislation.next_hearing_date.isnot(None)
        ).update({
            "next_hearing_date":     None,
            "next_hearing_time":     None,
            "next_hearing_body":     None,
            "next_hearing_location": None,
            "next_hearing_url":      None,
        }, synchronize_session=False)
        db.flush()

        total = len(meetings)
        yield _sse({"current": 0, "total": total, "message": f"Found {total} upcoming meetings, matching bills…", "done": False})
        await asyncio.sleep(0)

        bills_matched = 0
        for i, meeting in enumerate(meetings, 1):
            body = meeting.get("body", "meeting")
            date_str = meeting["date"].strftime("%b %d") if meeting.get("date") else ""
            yield _sse({"current": i, "total": total, "message": f"Processing {body} ({date_str}) — {len(meeting['bill_file_numbers'])} bills on agenda…", "done": False})
            await asyncio.sleep(0)

            for file_number in meeting["bill_file_numbers"]:
                stripped = file_number.replace("-", "")
                bill = (
                    db.query(Legislation)
                    .filter(
                        Legislation.bill_number.ilike(f"%{file_number}%")
                        | Legislation.bill_number.ilike(f"%{stripped}%")
                    )
                    .first()
                )
                if bill and (bill.next_hearing_date is None or meeting["date"] < bill.next_hearing_date):
                    bill.next_hearing_date     = meeting["date"]
                    bill.next_hearing_time     = meeting["time"]
                    bill.next_hearing_body     = meeting["body"]
                    bill.next_hearing_location = meeting["location"]
                    bill.next_hearing_url      = meeting.get("meeting_url")
                    bills_matched += 1

        db.commit()
        yield _sse({"current": total, "total": total, "message": f"Done — {total} meetings scraped, {bills_matched} bills updated", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


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
                "id":                    b.id,
                "bill_number":           b.bill_number,
                "title":                 b.title,
                "plain_title":           b.plain_title,
                "status":                b.status,
                "next_hearing_date":     b.next_hearing_date.isoformat() if b.next_hearing_date else None,
                "next_hearing_time":     b.next_hearing_time,
                "next_hearing_body":     b.next_hearing_body,
                "next_hearing_location": b.next_hearing_location,
                "next_hearing_url":      b.next_hearing_url,
            }
            for b in bills
        ],
    }
