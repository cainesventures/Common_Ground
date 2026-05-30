"""Detect and fix bill ledes for current-term bills.

Default (no flags): heuristic dry-run report.
  --fix             regenerate only heuristic-flagged mismatches
  --fix --all       regenerate every current-term bill that has a lede
  --workers N       parallel AI calls against Ollama (default 4)

A mismatch is when the lede text shares no keyword overlap with the bill's
plain_title or tags — a symptom of ledes being written for the wrong bill.
But the heuristic has false negatives, so --all is the safer rebuild after
a prompt change.

Scope: bills introduced during the current Philadelphia City Council term
(2020 / 2024 / 2028 / ...) regardless of status.  The bot posts any current-
term bill, so we need accurate ledes for all of them — not just the active-
status subset.

Run from project root.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
import json
import argparse
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

STOPWORDS = {
    "this", "that", "with", "from", "have", "been", "would", "could", "will",
    "their", "them", "they", "which", "when", "what", "where", "were", "about",
    "more", "into", "than", "some", "over", "also", "bill", "bills", "under",
    "plan", "proposed", "proposal", "vote", "votes", "voted", "passed", "approved",
    "philadelphia", "philly", "city", "council", "local", "year", "years",
    "residents", "after", "before", "since", "while", "just", "such", "your",
    "help", "make", "take", "come", "work", "time", "like", "know", "want",
    "look", "well", "first", "long", "even", "back", "good", "much", "most",
    "need", "said", "says", "should", "must", "many", "each", "last", "next",
    "only", "those", "these", "there", "through", "toward", "between", "public",
    "percent", "million", "billion", "measure", "legislation",
}


def content_words(text: str) -> set:
    words = re.findall(r"[a-z]{4,}", (text or "").lower())
    return {w for w in words if w not in STOPWORDS}


def is_mismatch(bill) -> bool:
    lede = bill.lede or ""
    plain_title = bill.plain_title or bill.title or ""
    try:
        tags_raw = bill.tags or ""
        tags = json.loads(tags_raw) if tags_raw.startswith("[") else []
    except Exception:
        tags = []
    lede_words = content_words(lede)
    if len(lede_words) < 5:
        return False
    bill_words = content_words(plain_title + " " + " ".join(tags))
    return len(lede_words & bill_words) == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fix", action="store_true", help="Regenerate ledes (otherwise dry run)")
    parser.add_argument("--all", action="store_true", help="Regenerate every active bill (not just flagged)")
    parser.add_argument("--workers", type=int, default=4, help="Parallel AI calls (default 4)")
    parser.add_argument("--commit-every", type=int, default=50, help="DB commit batch size (default 50)")
    args = parser.parse_args()

    from datetime import datetime, timezone
    from sqlalchemy import extract
    from app.models.database import SessionLocal
    from app.models import Legislation

    # Scope: current Philadelphia City Council term.  Members serve 4-year
    # terms starting in 2020, 2024, 2028 ...  The bot only spotlights bills
    # from this window, so we only need accurate ledes for the same window.
    # (See workers/bluesky_bot.py for the matching formula.)
    current_year = datetime.now(timezone.utc).year
    term_start_year = current_year - ((current_year - 2020) % 4)

    db = SessionLocal()
    try:
        bills = (
            db.query(Legislation)
            .filter(
                extract("year", Legislation.introduced_date) >= term_start_year,
                Legislation.analyzed_at.isnot(None),
                Legislation.lede.isnot(None),
                Legislation.lede != "",
            )
            .all()
        )
        print(f"Loaded {len(bills)} current-term bills with ledes (since {term_start_year}).")

        if args.all:
            targets = bills
            print(f"--all: regenerating all {len(targets)} ledes.")
        else:
            targets = [b for b in bills if is_mismatch(b)]
            print(f"Heuristic flagged {len(targets)} suspected mismatches.")

        if not args.fix:
            print(f"\nDry run. Use --fix to regenerate.")
            return

        if not targets:
            print("Nothing to regenerate.")
            return

        from app.services.legislation_service import _ai_lede
        from app.services.ai_provider import get_ai_provider
        provider = get_ai_provider()
        print(f"Using {args.workers} parallel workers against shared Ollama connection pool.")

        # Worker function: pure AI call, no DB access.  Reads pre-loaded
        # attributes off the Legislation instance (safe — eager columns).
        def regen(bill):
            try:
                return bill.id, _ai_lede(bill, provider), None
            except Exception as e:
                return bill.id, "", str(e)

        results: dict = {}  # bill_id -> new lede ("" means clear)
        errors = 0
        start = time.time()

        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = [ex.submit(regen, b) for b in targets]
            for i, fut in enumerate(as_completed(futures), 1):
                bid, new_lede, err = fut.result()
                if err:
                    errors += 1
                    if errors <= 3:
                        print(f"  ERROR on {bid}: {err}")
                results[bid] = new_lede
                if i % 25 == 0 or i == len(targets):
                    elapsed = time.time() - start
                    rate = i / elapsed if elapsed else 0
                    eta = (len(targets) - i) / rate if rate else 0
                    print(f"  [{i}/{len(targets)}]  {rate:.1f} bills/sec  ETA {eta/60:.1f} min  errors={errors}")

        # Apply results — single-threaded, batched commits
        bill_by_id = {b.id: b for b in targets}
        fixed = cleared = 0
        for i, (bid, new_lede) in enumerate(results.items(), 1):
            bill = bill_by_id.get(bid)
            if not bill:
                continue
            if new_lede:
                bill.lede = new_lede
                fixed += 1
            else:
                bill.lede = None
                cleared += 1
            if i % args.commit_every == 0:
                db.commit()

        db.commit()
        print(f"\nDone in {(time.time() - start)/60:.1f} min.  Fixed {fixed}, cleared {cleared}, errors {errors}.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
