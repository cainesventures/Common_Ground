"""Remove "ethics" and "elections" tags the bill's title does not support.

See app/services/tag_checks.py for what the tagger got wrong and why it
matters to the Insights key finding. This applies those rules to every local
bill already in the DB; worker_core applies them to new ones.

The original tag lists are written to .subject_tag_checkpoint.json first, so
--revert can put them back.

    python scripts/fix_subject_tags.py            # dry run, lists every removal
    python scripts/fix_subject_tags.py --apply
    python scripts/fix_subject_tags.py --revert --apply
"""
import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.services.tag_checks import drop_unsupported_subject_tags  # noqa: E402

CHECKPOINT = ROOT / ".subject_tag_checkpoint.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--db", default=str(ROOT / "common_ground_test.db"))
    args = ap.parse_args()
    con = sqlite3.connect(args.db)

    if args.revert:
        saved = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
        print(f"{'Restoring' if args.apply else 'Would restore'} tags on {len(saved)} bills")
        if args.apply:
            con.executemany("UPDATE legislation SET tags = ? WHERE id = ?",
                            [(tags, bid) for bid, tags in saved.items()])
            con.commit()
        return

    rows = con.execute(
        "SELECT id, bill_number, title, tags FROM legislation "
        "WHERE level='local' AND (tags LIKE '%ethics%' OR tags LIKE '%elections%')"
    ).fetchall()
    changed: dict[str, tuple[str, list]] = {}
    for bid, num, title, raw in rows:
        try:
            tags = json.loads(raw)
        except (TypeError, ValueError):
            continue
        kept = drop_unsupported_subject_tags(tags, title, num)
        if kept != tags:
            changed[bid] = (raw, kept)
            removed = ", ".join(t for t in tags if t not in kept)
            print(f"  {num:<10} -{removed:<20} {(title or '')[:90]}")

    print(f"{len(rows)} candidate bills, {len(changed)} lose a tag")
    if not args.apply:
        print("Dry run. Re-run with --apply to write.")
        return

    previous = json.loads(CHECKPOINT.read_text(encoding="utf-8")) if CHECKPOINT.exists() else {}
    for bid, (raw, _) in changed.items():
        previous.setdefault(bid, raw)  # keep the oldest original on a re-run
    CHECKPOINT.write_text(json.dumps(previous, indent=1, ensure_ascii=False), encoding="utf-8")
    con.executemany("UPDATE legislation SET tags = ? WHERE id = ?",
                    [(json.dumps(kept), bid) for bid, (_, kept) in changed.items()])
    con.commit()
    print(f"Updated {len(changed)} bills; originals in {CHECKPOINT.name}")


if __name__ == "__main__":
    main()
