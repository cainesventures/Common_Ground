"""
Backfill committee + roll-call action dates from phila.legistar.com.

One page visit per bill recovers two fields that earlier scrapes missed:

  legislation.committee          — the "In control" hyperlink (hypInControlOf2).
                                   The old scraper read lblReferredTo2, which
                                   doesn't exist on Philly's Legistar, so the
                                   column is NULL on every row.
  bill_vote_records.action_date  — the bill page's history table carries the
                                   date + tally ("17:0") for each vote action,
                                   so no Action Details popups are needed. The
                                   stored vote records are one deduplicated
                                   roll call per bill; they get the date of the
                                   latest tallied action (the passage vote).

Also fills legislation.final_date when missing.

Resumable: processed bill ids are appended to logs/backfill_details_progress.txt
and skipped on restart. Safe to run while the dev backend is up (WAL mode).

Usage:
    python scripts/backfill_detail_metadata.py            # full run (~5-6 h)
    python scripts/backfill_detail_metadata.py --limit 10 # smoke test
"""

import argparse
import re
import sqlite3
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / "common_ground_test.db"
PROGRESS_PATH = ROOT / "logs" / "backfill_details_progress.txt"

TALLY_RE = re.compile(r"^\d+[:-]\d+$")
BROWSER_RECYCLE_EVERY = 400  # pages; guards against slow chromium memory growth


def parse_us_date(raw: str) -> datetime | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def extract_from_page(page) -> dict:
    """Pull committee, final action date, and vote-action dates from a loaded detail page."""
    out: dict = {"committee": None, "final_date": None, "latest_vote_date": None}

    el = page.query_selector("#ctl00_ContentPlaceHolder1_hypInControlOf2")
    committee = el.inner_text().strip() if el else ""
    # "CITY COUNCIL" means the bill is/was before the full body, not a committee.
    if committee and committee.upper() != "CITY COUNCIL":
        out["committee"] = committee

    el = page.query_selector("#ctl00_ContentPlaceHolder1_lblPassed2")
    out["final_date"] = parse_us_date(el.inner_text() if el else "")

    # History grid: Date | Ver. | Action By | Action | Result | Tally | ...
    vote_dates = []
    for row in page.query_selector_all("#ctl00_ContentPlaceHolder1_gridLegislation_ctl00 tr"):
        cells = [c.inner_text().strip() for c in row.query_selector_all("td")]
        if len(cells) < 6:
            continue
        date, tally = parse_us_date(cells[0]), cells[5].replace("\xa0", "").strip()
        if date and TALLY_RE.match(tally):
            vote_dates.append(date)
    if vote_dates:
        out["latest_vote_date"] = max(vote_dates)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=0, help="Max bills to process this run (0 = all)")
    parser.add_argument("--delay", type=float, default=0.3, help="Seconds to sleep between pages")
    args = parser.parse_args()

    from playwright.sync_api import sync_playwright

    con = sqlite3.connect(DB_PATH, timeout=30)
    con.execute("PRAGMA busy_timeout=10000")

    done: set[str] = set()
    if PROGRESS_PATH.exists():
        done = {line.split(",")[0] for line in PROGRESS_PATH.read_text().splitlines() if line.strip()}
    PROGRESS_PATH.parent.mkdir(parents=True, exist_ok=True)
    progress = open(PROGRESS_PATH, "a", encoding="utf-8")

    voted_bills = {r[0] for r in con.execute("select distinct legislation_id from bill_vote_records")}

    bills = con.execute("""
        select id, external_url, final_date from legislation
        where external_url is not null and external_url != ''
        order by introduced_date desc
    """).fetchall()
    todo = [b for b in bills if b[0] not in done]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(bills)} bills with URLs | {len(done)} already done | {len(todo)} to process", flush=True)

    stats = {"committee": 0, "vote_date": 0, "final_date": 0, "fail": 0}
    t0 = time.time()

    with sync_playwright() as p:
        browser = page = None

        def fresh_browser():
            nonlocal browser, page
            if browser:
                browser.close()
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()

        fresh_browser()

        for i, (bill_id, url, final_date) in enumerate(todo, 1):
            if i % BROWSER_RECYCLE_EVERY == 0:
                fresh_browser()
            ok = False
            for attempt in (1, 2):
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    page.wait_for_selector("#ctl00_ContentPlaceHolder1_lblFile2", timeout=12000)
                    data = extract_from_page(page)
                    ok = True
                    break
                except Exception as e:
                    if attempt == 2:
                        print(f"[{i}/{len(todo)}] FAIL {bill_id}: {type(e).__name__}", flush=True)
                    else:
                        fresh_browser()

            if not ok:
                stats["fail"] += 1
                progress.write(f"{bill_id},fail\n")
                progress.flush()
                continue

            if data["committee"]:
                con.execute("update legislation set committee=? where id=?", (data["committee"], bill_id))
                stats["committee"] += 1
            if data["final_date"] and not final_date:
                con.execute("update legislation set final_date=? where id=?", (data["final_date"], bill_id))
                stats["final_date"] += 1
            if data["latest_vote_date"] and bill_id in voted_bills:
                con.execute(
                    "update bill_vote_records set action_date=? where legislation_id=?",
                    (data["latest_vote_date"], bill_id),
                )
                stats["vote_date"] += 1
            con.execute("update legislation set metadata_fetched_at=? where id=?",
                        (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), bill_id))
            con.commit()

            progress.write(f"{bill_id},ok\n")
            progress.flush()
            if i % 25 == 0 or i == len(todo):
                rate = i / (time.time() - t0)
                eta_h = (len(todo) - i) / rate / 3600 if rate else 0
                print(f"[{i}/{len(todo)}] committee={stats['committee']} vote_dates={stats['vote_date']} "
                      f"final_dates={stats['final_date']} fails={stats['fail']} "
                      f"({rate:.1f}/s, ~{eta_h:.1f}h left)", flush=True)
            time.sleep(args.delay)

        if browser:
            browser.close()

    progress.close()
    con.close()
    print(f"\nDone. {stats}", flush=True)


if __name__ == "__main__":
    main()
