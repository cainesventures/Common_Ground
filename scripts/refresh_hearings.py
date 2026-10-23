"""Refresh upcoming committee hearings from the Legistar calendar.

publish.ps1 runs scripts/worker.py, which never had the hearings step (only
worker_core.py did), so hearing dates were never refreshed and every bill
showed none. This is that step on its own, run by the publish right after the
fetch so the hearing reminders and the bill-page banner have current data.
"""
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models.database import SessionLocal  # noqa: E402
from app.services.hearing_service import refresh_upcoming_hearings  # noqa: E402

if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    db = SessionLocal()
    try:
        r = refresh_upcoming_hearings(db)
        print(f"Hearings: {r['meetings_scraped']} upcoming meetings, {r['bills_matched']} bills scheduled")
    finally:
        db.close()
