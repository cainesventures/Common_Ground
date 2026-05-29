"""Detect and fix mismatched bill ledes.

A mismatch is when the lede text has no keyword overlap with the bill's
plain_title or tags — a symptom of ledes being written for the wrong bill
during bulk generation.

Usage (run from project root):
  python scripts/fix_ledes.py            # dry run: print mismatch report
  python scripts/fix_ledes.py --fix      # regenerate ledes for mismatched bills
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
import json
import argparse

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
    "only", "than", "those", "these", "there", "their", "through", "toward",
    "between", "public", "percent", "million", "billion", "measure", "legislation",
}


def content_words(text: str) -> set[str]:
    words = re.findall(r"[a-z]{4,}", text.lower())
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
        return False  # Too short to judge reliably

    bill_text = plain_title + " " + " ".join(tags)
    bill_words = content_words(bill_text)

    return len(lede_words & bill_words) == 0


def main():
    parser = argparse.ArgumentParser(description="Detect and fix mismatched bill ledes.")
    parser.add_argument("--fix", action="store_true", help="Regenerate ledes for mismatched bills")
    args = parser.parse_args()

    from app.models.database import SessionLocal
    from app.models import Legislation

    db = SessionLocal()
    try:
        bills = (
            db.query(Legislation)
            .filter(
                Legislation.analyzed_at.isnot(None),
                Legislation.lede.isnot(None),
                Legislation.lede != "",
            )
            .all()
        )
        print(f"Checking {len(bills)} bills with ledes...")

        mismatches = [b for b in bills if is_mismatch(b)]
        print(f"\nFound {len(mismatches)} suspected mismatches:\n")

        for b in mismatches:
            lede_preview = (b.lede or "")[:120].replace("\n", " ")
            print(f"  [{b.id}] {b.plain_title or b.title}")
            print(f"  Lede: {lede_preview}")
            print()

        if not args.fix:
            if mismatches:
                print(f"Run with --fix to regenerate ledes for these {len(mismatches)} bills.")
            return

        if not mismatches:
            print("Nothing to fix.")
            return

        from app.services.legislation_service import _ai_lede
        from app.services.ai_provider import get_ai_provider
        provider = get_ai_provider()

        fixed = 0
        for b in mismatches:
            new_lede = _ai_lede(b, provider)
            if new_lede:
                print(f"Fixed: {b.plain_title or b.id}")
                print(f"  Old: {(b.lede or '')[:80]}")
                print(f"  New: {new_lede[:80]}")
                b.lede = new_lede
                fixed += 1
            else:
                print(f"Skipped (empty AI result): {b.plain_title or b.id}")

        db.commit()
        print(f"\nRegenerated {fixed}/{len(mismatches)} ledes.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
