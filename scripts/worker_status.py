"""
Print a progress report for the background worker.

Usage:
    python scripts/worker_status.py
    python scripts/worker_status.py --year 2025
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import os; os.chdir(ROOT)

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

from app.models.database import SessionLocal
from app.models import Legislation, BillPerspective
from sqlalchemy import extract, func, case


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=0)
    args = parser.parse_args()

    db = SessionLocal()
    try:
        _print_report(db, args.year)
    finally:
        db.close()


def _print_report(db, year_filter: int):
    from sqlalchemy import exists as _exists

    q = db.query(Legislation).filter(Legislation.source == "legistar_phila")
    if year_filter:
        q = q.filter(extract("year", Legislation.introduced_date) == year_filter)

    bills = q.all()
    total = len(bills)
    if not total:
        print("No bills found.")
        return

    # Buckets
    has_text      = sum(1 for b in bills if b.full_text)
    has_analyzed  = sum(1 for b in bills if b.analyzed_at)
    has_headline  = sum(1 for b in bills if b.headline and b.lede)
    has_metadata  = sum(1 for b in bills if b.metadata_fetched_at)
    has_persp     = sum(1 for b in bills if _perspective_count(b, db) >= 17)
    has_news      = sum(1 for b in bills if b.news_fetched_at)
    skipped       = sum(1 for b in bills if b.skip_reason)
    complete      = sum(1 for b in bills if _is_complete(b, db))

    # Skip reason breakdown
    skip_reasons: dict[str, int] = {}
    for b in bills:
        if b.skip_reason:
            skip_reasons[b.skip_reason] = skip_reasons.get(b.skip_reason, 0) + 1

    title = f"Worker Status Report — {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    if year_filter:
        title += f" (year={year_filter})"
    print()
    print(title)
    print("=" * len(title))
    print(f"  Total bills        : {total}")
    print(f"  Fully complete     : {complete:>5}  ({pct(complete, total)})")
    print()
    print("  Step completeness:")
    print(f"    Full text        : {has_text:>5}  ({pct(has_text, total)})")
    print(f"    Analyzed         : {has_analyzed:>5}  ({pct(has_analyzed, total)})")
    print(f"    Headline/lede    : {has_headline:>5}  ({pct(has_headline, total)})")
    print(f"    Metadata         : {has_metadata:>5}  ({pct(has_metadata, total)})")
    print(f"    Perspectives(17) : {has_persp:>5}  ({pct(has_persp, total)})")
    print(f"    News             : {has_news:>5}  ({pct(has_news, total)})")
    print()
    print(f"  Permanently skipped: {skipped}")
    if skip_reasons:
        for reason, count in sorted(skip_reasons.items(), key=lambda x: -x[1]):
            print(f"    {reason}: {count}")

    # Per-year breakdown if no year filter
    if not year_filter:
        print()
        print("  Per-year breakdown:")
        years: dict[int, list] = {}
        for b in bills:
            y = b.introduced_date.year if b.introduced_date else 0
            years.setdefault(y, []).append(b)
        for y in sorted(years.keys(), reverse=True):
            ybills = years[y]
            yt = len(ybills)
            yc = sum(1 for b in ybills if _is_complete(b, db))
            ys = sum(1 for b in ybills if b.skip_reason)
            print(f"    {y}: {yc}/{yt} complete, {ys} skipped")

    # Worker run stats
    progress_file = ROOT / "logs" / "worker_progress.json"
    if progress_file.exists():
        try:
            p = json.loads(progress_file.read_text(encoding="utf-8"))
            print()
            print("  Worker run stats:")
            print(f"    Last run         : {p.get('last_run', 'never')}")
            print(f"    Total runs       : {p.get('runs', 0)}")
            print(f"    Total processed  : {p.get('total_processed', 0)}")
            print(f"    Total skipped    : {p.get('total_skipped', 0)}")
            print(f"    Total errors     : {p.get('total_errors', 0)}")
        except Exception:
            pass

    print()


def _perspective_count(bill, db) -> int:
    from app.models import BillPerspective
    return db.query(BillPerspective).filter(BillPerspective.bill_id == bill.id).count()


def _is_complete(bill, db) -> bool:
    if not bill.full_text:      return False
    if not bill.analyzed_at:    return False
    if not bill.headline:       return False
    if not bill.lede:           return False
    if not bill.metadata_fetched_at and bill.id.startswith("legistar_phila_"): return False
    if _perspective_count(bill, db) < 17: return False
    return True


def pct(n, total) -> str:
    if not total:
        return "  0%"
    return f"{100 * n // total:>3}%"


if __name__ == "__main__":
    main()
