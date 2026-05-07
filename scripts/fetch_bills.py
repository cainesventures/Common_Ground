"""
Fetch new Philadelphia City Council bills from Legistar and upsert into local DB.

Runs the Playwright scraper directly (no backend needed). Automatically computes
an incremental cutoff from the most recent bill already in the database — only
bills introduced after that date are fetched.

Usage:
    python scripts/fetch_bills.py           # incremental: since last ingest date
    python scripts/fetch_bills.py --limit 50  # cap at 50 rows from Legistar
    python scripts/fetch_bills.py --since 2026-01-01  # explicit cutoff date

Part of the publish workflow — run before worker.py and publish.ps1.
"""

import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)


def _load_env():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


_load_env()

from app.models.database import SessionLocal
from app.models.legislation import Legislation
from app.integrations.legistar_scraper import PhilaLegistarScraper
from sqlalchemy import func


def get_latest_introduced_date(db) -> datetime | None:
    row = db.query(func.max(Legislation.introduced_date)).filter(
        Legislation.level == "local"
    ).scalar()
    return row


def upsert_bills(db, bills: list) -> tuple[int, int]:
    ingested = updated = 0
    for parsed in bills:
        try:
            parsed["city"] = "philadelphia"
            parsed["level"] = "local"
            existing = db.query(Legislation).filter(Legislation.id == parsed["id"]).first()

            if not existing and parsed.get("bill_number"):
                stub_id = f"legistar_phila_{parsed['bill_number']}"
                if stub_id != parsed["id"]:
                    existing = db.query(Legislation).filter(Legislation.id == stub_id).first()
                    if existing:
                        existing.id = parsed["id"]

            if existing:
                for key, value in parsed.items():
                    if value is not None:
                        setattr(existing, key, value)
                existing.updated_at = datetime.utcnow()
                updated += 1
            else:
                db.add(Legislation(**parsed))
                ingested += 1

        except Exception as e:
            print(f"  [warn] Failed to store bill {parsed.get('id', '?')}: {e}")
            continue

    db.commit()
    return ingested, updated


def main():
    parser = argparse.ArgumentParser(description="Fetch new Philadelphia bills from Legistar")
    parser.add_argument("--limit", type=int, default=250, help="Max rows to fetch from Legistar (default: 250)")
    parser.add_argument("--since", type=str, default=None, help="Cutoff date YYYY-MM-DD (default: auto from DB)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.since:
            since_date = datetime.strptime(args.since, "%Y-%m-%d")
            print(f"Since date: {since_date.date()} (from --since flag)")
        else:
            since_date = get_latest_introduced_date(db)
            if since_date:
                print(f"Since date: {since_date} (auto from DB — most recent bill)")
            else:
                print("No bills in DB — fetching full history (this may take a while)")

        print(f"Scraping Legistar (limit={args.limit}) ...")
        scraper = PhilaLegistarScraper(headless=True)
        bills = scraper.scrape_bills(
            limit=args.limit,
            fetch_details=False,
            allowed_types=["Bill"],
            since_date=since_date,
        )
        print(f"Scraped {len(bills)} bills from Legistar")

        if not bills:
            print("No new bills found — DB is up to date.")
            return

        ingested, updated = upsert_bills(db, bills)
        print(f"Done: {ingested} new, {updated} updated")

    finally:
        db.close()


if __name__ == "__main__":
    main()
