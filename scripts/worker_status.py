"""
Print a progress report for the background worker.

Usage:
    python scripts/worker_status.py
    python scripts/worker_status.py --year 2025
"""

import sys
import json
import argparse
import logging
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import os; os.chdir(ROOT)

# Suppress SQLAlchemy before any import
logging.getLogger("sqlalchemy").setLevel(logging.CRITICAL)
logging.getLogger("sqlalchemy.engine").setLevel(logging.CRITICAL)
logging.disable(logging.INFO)

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

import sqlite3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=0)
    args = parser.parse_args()

    # Re-enable for our own print
    logging.disable(logging.NOTSET)

    db_path = ROOT / "common_ground_test.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    year_clause = f"AND strftime('%Y', introduced_date) = '{args.year}'" if args.year else ""

    # Overall counts
    c.execute(f"""
        SELECT
            count(*) as total,
            sum(CASE WHEN full_text IS NOT NULL AND full_text != '' THEN 1 ELSE 0 END) as has_text,
            sum(CASE WHEN analyzed_at IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
            sum(CASE WHEN headline IS NOT NULL AND lede IS NOT NULL THEN 1 ELSE 0 END) as has_headline,
            sum(CASE WHEN metadata_fetched_at IS NOT NULL THEN 1 ELSE 0 END) as has_metadata,
            sum(CASE WHEN news_fetched_at IS NOT NULL THEN 1 ELSE 0 END) as has_news,
            sum(CASE WHEN skip_reason IS NOT NULL THEN 1 ELSE 0 END) as skipped
        FROM legislation
        WHERE source = 'legistar'
        {year_clause}
    """)
    row = c.fetchone()
    total = row["total"]

    # Non-terminal bills are the only ones eligible for perspectives/news
    TERMINAL = "('signed_into_law','failed','vetoed','withdrawn','tabled')"
    c.execute(f"""
        SELECT count(*) as n FROM legislation
        WHERE source = 'legistar' AND skip_reason IS NULL
        AND analyzed_at IS NOT NULL
        AND status NOT IN {TERMINAL}
        {year_clause}
    """)
    non_terminal = c.fetchone()["n"]

    # Perspectives: non-terminal bills with 5+ perspectives
    c.execute(f"""
        SELECT count(*) as has_persp FROM (
            SELECT l.id FROM legislation l
            JOIN bill_perspectives bp ON bp.bill_id = l.id
            WHERE l.source = 'legistar' AND l.skip_reason IS NULL
            AND l.status NOT IN {TERMINAL}
            {year_clause}
            GROUP BY l.id
            HAVING count(DISTINCT bp.perspective_type) >= 5
        )
    """)
    has_persp = c.fetchone()["has_persp"]

    # News: non-terminal bills with news fetched
    c.execute(f"""
        SELECT count(*) as has_news_active FROM legislation
        WHERE source = 'legistar' AND skip_reason IS NULL
        AND analyzed_at IS NOT NULL
        AND status NOT IN {TERMINAL}
        AND news_fetched_at IS NOT NULL
        {year_clause}
    """)
    has_news_active = c.fetchone()["has_news_active"]

    # "Fully complete" = text + analyzed + headline + metadata + perspectives (non-terminal only)
    c.execute(f"""
        SELECT count(*) as complete FROM (
            SELECT l.id FROM legislation l
            LEFT JOIN (
                SELECT bill_id, count(DISTINCT perspective_type) as pcount
                FROM bill_perspectives GROUP BY bill_id
            ) p ON p.bill_id = l.id
            WHERE l.source = 'legistar'
              AND l.full_text IS NOT NULL AND l.full_text != ''
              AND l.analyzed_at IS NOT NULL
              AND l.headline IS NOT NULL
              AND l.lede IS NOT NULL
              AND l.metadata_fetched_at IS NOT NULL
              AND (
                l.status IN {TERMINAL}
                OR COALESCE(p.pcount, 0) >= 5
              )
              {year_clause}
        )
    """)
    complete = c.fetchone()["complete"]

    # Skip reason breakdown
    c.execute(f"""
        SELECT skip_reason, count(*) as n FROM legislation
        WHERE source = 'legistar' AND skip_reason IS NOT NULL {year_clause}
        GROUP BY skip_reason ORDER BY n DESC
    """)
    skip_rows = c.fetchall()

    title = f"Worker Status — {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    if args.year:
        title += f"  (year={args.year})"
    print()
    print(title)
    print("=" * len(title))
    eligible = total - row['skipped']  # exclude permanently skipped from denominator
    print(f"  Total bills        : {total} ({row['skipped']} permanently skipped)")
    print(f"  Fully complete     : {complete:>5}  ({pct(complete, eligible)})")
    print()
    print("  Step completeness (of eligible bills):")
    print(f"    Full text        : {row['has_text']:>5}  ({pct(row['has_text'], eligible)})")
    print(f"    Analyzed         : {row['analyzed']:>5}  ({pct(row['analyzed'], eligible)})")
    print(f"    Headline/lede    : {row['has_headline']:>5}  ({pct(row['has_headline'], eligible)})")
    print(f"    Metadata         : {row['has_metadata']:>5}  ({pct(row['has_metadata'], eligible)})")
    print(f"    Perspectives(5+) : {has_persp:>5}  ({pct(has_persp, non_terminal)}) of {non_terminal} non-terminal")
    print(f"    News             : {has_news_active:>5}  ({pct(has_news_active, non_terminal)}) of {non_terminal} non-terminal")
    print()
    print(f"  Permanently skipped: {row['skipped']}")
    for sr in skip_rows:
        print(f"    {sr['skip_reason']}: {sr['n']}")

    if not args.year:
        print()
        print("  Per-year breakdown:")
        c.execute("""
            SELECT
                strftime('%Y', introduced_date) as yr,
                count(*) as total,
                sum(CASE WHEN analyzed_at IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
                sum(CASE WHEN skip_reason IS NOT NULL THEN 1 ELSE 0 END) as skipped
            FROM legislation
            WHERE source = 'legistar' AND introduced_date IS NOT NULL
            GROUP BY yr ORDER BY yr DESC LIMIT 8
        """)
        for yr_row in c.fetchall():
            print(f"    {yr_row['yr']}: {yr_row['analyzed']}/{yr_row['total']} analyzed, {yr_row['skipped']} skipped")

    # Worker run stats
    for key, label in [("worker_fast", "Fast worker"), ("worker_perspectives", "Persp worker"), ("worker", "Worker (legacy)")]:
        progress_file = ROOT / "logs" / f"{key}_progress.json"
        if progress_file.exists():
            try:
                p = json.loads(progress_file.read_text(encoding="utf-8"))
                print()
                print(f"  {label} stats:")
                print(f"    Last run         : {p.get('last_run', 'never')}")
                print(f"    Total runs       : {p.get('runs', 0)}")
                print(f"    Bills processed  : {p.get('total_processed', 0)}")
                print(f"    Bills skipped    : {p.get('total_skipped', 0)}")
                print(f"    Errors           : {p.get('total_errors', 0)}")
            except Exception:
                pass

    conn.close()
    print()


def pct(n, total) -> str:
    if not total:
        return "  0%"
    return f"{100 * n // total:>3}%"


if __name__ == "__main__":
    main()
