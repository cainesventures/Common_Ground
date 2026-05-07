"""
Fetch new Philadelphia City Council bills from Legistar and upsert into local DB.

Two modes (both run by default in the weekly pipeline):

1. Incremental fetch — scrapes the Legistar list page for bills introduced after
   the last ingest date. Fast (~2 min). Captures new bills only.

2. Status sync — exports all 8,500+ bills via Legistar's Excel export, then updates
   status and final_date for every bill already in the DB. Captures bills that moved
   from introduced/in_committee → signed_into_law/failed since the last run.
   Takes ~3-4 min but is the only reliable way to catch status changes.

Usage:
    python scripts/fetch_bills.py                  # both: incremental + status sync
    python scripts/fetch_bills.py --skip-sync      # incremental only (faster)
    python scripts/fetch_bills.py --sync-only      # status sync only
    python scripts/fetch_bills.py --since 2026-01-01  # explicit incremental cutoff

Part of the publish workflow — run before worker.py and publish.ps1.
"""

import argparse
import os
import sys
import tempfile
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

from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from app.models import Base, Legislation
from app.integrations.legistar_scraper import PhilaLegistarScraper, _parse_date, _normalize_status

DB_PATH = os.environ.get("DB_PATH", str(ROOT / "common_ground_test.db"))
_engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=_engine)


def get_latest_introduced_date(db) -> datetime | None:
    return db.query(func.max(Legislation.introduced_date)).filter(
        Legislation.level == "local"
    ).scalar()


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


def sync_statuses(db) -> tuple[int, int]:
    """
    Export all bills from Legistar via Excel and update status + final_date for
    every bill already in the DB whose status has changed.
    """
    print("Downloading Legistar Excel export (all bills)...")
    scraper = PhilaLegistarScraper(headless=True)
    tmp = tempfile.mktemp(suffix=".xls")
    try:
        scraper.export_to_excel(tmp)
        rows = PhilaLegistarScraper.parse_excel_export(tmp)
    finally:
        if Path(tmp).exists():
            Path(tmp).unlink()

    print(f"  Parsed {len(rows):,} rows from Excel export")

    checked = updated = 0
    for row in rows:
        file_number = row.get("file_number", "").strip()
        if not file_number:
            continue

        new_status = _normalize_status(row.get("status", ""))
        final_date = _parse_date(row.get("final_date", ""))

        bill = db.query(Legislation).filter(
            Legislation.bill_number == file_number,
            Legislation.level == "local",
        ).first()

        if not bill:
            continue

        checked += 1
        changed = False
        if new_status and new_status != bill.status:
            print(f"  Status: {file_number} {bill.status!r} -> {new_status!r}")
            bill.status = new_status
            changed = True
        if final_date and final_date != bill.final_date:
            bill.final_date = final_date
            changed = True
        if changed:
            bill.updated_at = datetime.utcnow()
            updated += 1

    db.commit()
    print(f"  Status sync: checked {checked:,} bills, updated {updated}")
    return checked, updated


def main():
    parser = argparse.ArgumentParser(description="Fetch new Philadelphia bills from Legistar")
    parser.add_argument("--limit", type=int, default=250, help="Max rows for incremental fetch (default: 250)")
    parser.add_argument("--since", type=str, default=None, help="Cutoff date YYYY-MM-DD (default: auto from DB)")
    parser.add_argument("--skip-sync", action="store_true", help="Skip status sync, do incremental fetch only")
    parser.add_argument("--sync-only", action="store_true", help="Run status sync only, skip incremental fetch")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        # ── Incremental fetch ─────────────────────────────────────────────────
        if not args.sync_only:
            if args.since:
                since_date = datetime.strptime(args.since, "%Y-%m-%d")
                print(f"Since date: {since_date.date()} (from --since flag)")
            else:
                since_date = get_latest_introduced_date(db)
                if since_date:
                    print(f"Since date: {since_date} (auto from DB)")
                else:
                    print("No bills in DB — fetching without date cutoff")

            print(f"Scraping Legistar for new bills (limit={args.limit}) ...")
            scraper = PhilaLegistarScraper(headless=True)
            bills = scraper.scrape_bills(
                limit=args.limit,
                fetch_details=False,
                allowed_types=["Bill"],
                since_date=since_date,
            )
            print(f"Scraped {len(bills)} bills from Legistar list")

            if bills:
                ingested, updated = upsert_bills(db, bills)
                print(f"Incremental fetch: {ingested} new, {updated} updated")
            else:
                print("No new bills found.")

        # ── Status sync ───────────────────────────────────────────────────────
        if not args.skip_sync:
            sync_statuses(db)

    finally:
        db.close()


if __name__ == "__main__":
    main()
