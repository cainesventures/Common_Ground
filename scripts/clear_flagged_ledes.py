"""Clear ledes on concluded bills that editorialize or invent a neighborhood.

Ledes are now generated only for live bills (worker_core._run_headline), but
8,493 concluded bills still carry one from an earlier run, written before the
lede prompt forbade embellishment. The 2026-10-23 audit found ~2,400 of them
failing app/services/headline_checks.py: "Residents are bracing for...",
"cracks down", or a neighborhood the bill never names.

A concluded bill does not need a lede: BillCard falls back to the first
sentence of the summary, which is the analysis output and is clean (2 audit
hits in 8,680). So the fix is to clear the flagged ones, not regenerate them.
Ledes on live bills are left alone; they go through the regen script.

The cleared text is written to .lede_clear_checkpoint.json first, so --revert
can put it back.

    python scripts/clear_flagged_ledes.py            # dry run
    python scripts/clear_flagged_ledes.py --apply
    python scripts/clear_flagged_ledes.py --revert --apply
"""
import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.services.headline_checks import loaded_words, unsupported_places  # noqa: E402

ACTIVE = {"introduced", "in_committee", "awaiting_mayor"}
CHECKPOINT = ROOT / ".lede_clear_checkpoint.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--db", default=str(ROOT / "common_ground_test.db"))
    args = ap.parse_args()
    con = sqlite3.connect(args.db)

    if args.revert:
        saved = json.loads(CHECKPOINT.read_text(encoding="utf-8"))
        print(f"{'Restoring' if args.apply else 'Would restore'} {len(saved)} ledes")
        if args.apply:
            con.executemany("UPDATE legislation SET lede = ? WHERE id = ?",
                            [(lede, bid) for bid, lede in saved.items()])
            con.commit()
        return

    rows = con.execute(
        "SELECT id, status, lede, title, description, full_text FROM legislation "
        "WHERE level='local' AND lede IS NOT NULL AND lede != ''"
    ).fetchall()
    flagged = {
        bid: lede for bid, status, lede, title, desc, full in rows
        if status not in ACTIVE and (
            loaded_words(lede)
            or unsupported_places(lede, " ".join(filter(None, [title, desc, full])))
        )
    }
    print(f"{len(rows)} ledes, {len(flagged)} flagged on concluded bills")
    if not args.apply:
        print("Dry run. Re-run with --apply to clear.")
        return

    previous = json.loads(CHECKPOINT.read_text(encoding="utf-8")) if CHECKPOINT.exists() else {}
    previous.update(flagged)
    CHECKPOINT.write_text(json.dumps(previous, indent=1, ensure_ascii=False), encoding="utf-8")
    con.executemany("UPDATE legislation SET lede = NULL WHERE id = ?", [(b,) for b in flagged])
    con.commit()
    print(f"Cleared {len(flagged)} ledes; originals in {CHECKPOINT.name}")


if __name__ == "__main__":
    main()
