"""Service for scraping and storing upcoming Philadelphia City Council hearings."""

import logging
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Legislation

logger = logging.getLogger(__name__)


def refresh_upcoming_hearings(db: Session) -> dict:
    """
    Scrape Calendar.aspx for upcoming hearings and update matching legislation records.
    Returns {"meetings_scraped": int, "bills_matched": int}
    """
    from app.integrations.legistar_scraper import PhilaLegistarScraper

    scraper = PhilaLegistarScraper(headless=True)
    meetings = scraper.scrape_upcoming_hearings()

    # Clear all previously stored hearing data so stale/cancelled hearings are removed
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

    bills_matched = 0
    for meeting in meetings:
        for file_number in meeting["bill_file_numbers"]:
            # Strip dashes for flexible matching: "24-0001" → "240001"
            stripped = file_number.replace("-", "")
            bill = (
                db.query(Legislation)
                .filter(
                    Legislation.bill_number.ilike(f"%{file_number}%")
                    | Legislation.bill_number.ilike(f"%{stripped}%")
                )
                .first()
            )
            if bill:
                # Only update if this is the earliest upcoming hearing for the bill
                if (
                    bill.next_hearing_date is None
                    or meeting["date"] < bill.next_hearing_date
                ):
                    bill.next_hearing_date     = meeting["date"]
                    bill.next_hearing_time     = meeting["time"]
                    bill.next_hearing_body     = meeting["body"]
                    bill.next_hearing_location = meeting["location"]
                    bill.next_hearing_url      = meeting.get("meeting_url")
                    bills_matched += 1

    db.commit()
    logger.info(f"refresh_upcoming_hearings: {len(meetings)} meetings scraped, {bills_matched} bills updated")
    return {"meetings_scraped": len(meetings), "bills_matched": bills_matched}
