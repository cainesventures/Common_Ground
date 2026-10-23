"""Repair official titles the Legistar search grid cut at 600 characters.

844 bills were stored with titles ending mid-word ("...under certain terms
and co") because the first ingest takes the title from the search grid, and the
worker only filled the title when it was empty, so the full title on the detail
page never replaced it. The full title is still in each bill's full text, so
this recovers it with the same best_title() the worker now uses on new bills.

The FTS table is kept in sync by the legislation_fts_update trigger.

    python scripts/backfill_full_titles.py           # dry run: counts + samples
    python scripts/backfill_full_titles.py --apply   # write
"""
import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.integrations.legistar_scraper import best_title  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--db", default=str(ROOT / "common_ground_test.db"))
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    rows = con.execute(
        "SELECT id, title, full_text FROM legislation WHERE length(title) >= 599"
    ).fetchall()
    changes = [(new, bid) for bid, old, ft in rows if (new := best_title(old, None, ft)) != old]

    print(f"{len(rows)} titles at the 600-char cut, {len(changes)} recoverable from full text")
    for new, bid in changes[:3]:
        print(f"  {bid}: ...{new[-90:]}")

    if not args.apply:
        print("Dry run. Re-run with --apply to write.")
        return
    con.executemany("UPDATE legislation SET title = ? WHERE id = ?", changes)
    con.commit()
    print(f"Updated {len(changes)} titles.")


if __name__ == "__main__":
    main()
