"""Regenerate ledes on live bills that fail app/services/headline_checks.py.

Concluded bills had their flagged ledes cleared (clear_flagged_ledes.py); a
live bill keeps its lede because the home slideshow and the Bluesky bot use
it, so those get rewritten instead. Small set (10 on 2026-10-23).

Guarded like every local inference run: gpu_guard preflight, VramGuard before
each request, a wall-clock Budget, and a commit per bill. The previous lede is
saved to .lede_regen_checkpoint.json first so --revert can restore it.

    python scripts/regenerate_flagged_ledes.py --list
    python scripts/regenerate_flagged_ledes.py --apply
    python scripts/regenerate_flagged_ledes.py --revert --apply
"""
import argparse
import json
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

CHECKPOINT = ROOT / ".lede_regen_checkpoint.json"
ACTIVE = ("introduced", "in_committee", "awaiting_mayor")
log = logging.getLogger("regen-ledes")


def flagged(bill) -> bool:
    from app.services.headline_checks import loaded_words, unsupported_places
    source = " ".join(filter(None, [bill.title, bill.description, bill.full_text]))
    return bool(loaded_words(bill.lede) or unsupported_places(bill.lede, source))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--revert", action="store_true")
    ap.add_argument("--model", default="llama3.2:3b")
    ap.add_argument("--vram-floor-mb", type=int, default=1500)
    ap.add_argument("--budget-minutes", type=int, default=15)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    os.environ["AI_MODEL"] = args.model

    from app.models.database import SessionLocal
    from app.models import Legislation

    db = SessionLocal()
    saved = json.loads(CHECKPOINT.read_text(encoding="utf-8")) if CHECKPOINT.exists() else {}

    if args.revert:
        for bid, old in saved.items():
            bill = db.query(Legislation).filter(Legislation.id == bid).first()
            if bill:
                bill.lede = old
        if args.apply:
            db.commit()
        log.info("%s %d ledes", "Restored" if args.apply else "Would restore", len(saved))
        return 0

    bills = [
        b for b in db.query(Legislation).filter(
            Legislation.status.in_(ACTIVE), Legislation.lede.isnot(None), Legislation.lede != "",
        ).all()
        if flagged(b)
    ]
    log.info("%d live bills with a flagged lede", len(bills))
    if args.list or not bills:
        for b in bills:
            print(f"{b.bill_number:10} {b.lede[:100]}")
        return 0

    from app.services.ai_provider import get_ai_provider
    from app.services.legislation_service import _ai_lede
    from gpu_guard import Budget, BudgetExhausted, VramExhausted, VramGuard, preflight

    provider = get_ai_provider()
    peak = preflight(args.model, args.vram_floor_mb)
    guard = VramGuard(floor_mb=args.vram_floor_mb, unload=getattr(provider, "_unload", None),
                      model_peak_mb=peak, resident_mb=getattr(provider, "resident_vram_mb", None))
    budget = Budget(minutes=args.budget_minutes)
    done = 0
    try:
        for b in bills:
            try:
                budget.check()
                guard.wait_for_headroom()
            except (BudgetExhausted, VramExhausted) as e:
                log.warning("Stopping: %s", e)
                break
            new = _ai_lede(b, provider)
            old = b.lede
            b.lede = new or None
            if new and flagged(b):
                log.warning("%s still flagged, not saving: %s", b.bill_number, new)
                b.lede = old
                continue
            log.info("%s\n    old: %s\n    new: %s", b.bill_number, old, new or "(cleared: model found nothing to say)")
            if args.apply:
                saved.setdefault(b.id, old)
                CHECKPOINT.write_text(json.dumps(saved, indent=1, ensure_ascii=False), encoding="utf-8")
                db.commit()
            else:
                db.rollback()
            done += 1
    finally:
        try:
            provider._unload()  # hand the VRAM back now, not after keep_alive
        except Exception:
            pass
    log.info("%d ledes %s", done, "rewritten" if args.apply else "would be rewritten (dry run)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
