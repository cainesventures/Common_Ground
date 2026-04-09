"""
Regenerate all perspectives for all analyzed bills.
Run from the project root: python scripts/regen_all_perspectives.py

Progress is logged to stdout and to scripts/regen_progress.log
"""
import sys
import time
import logging
from datetime import datetime

sys.path.insert(0, '.')

logging.basicConfig(level=logging.WARNING)  # suppress SQLAlchemy noise

from app.models.database import SessionLocal
from app.models import Legislation
from app.services.perspectives_service import generate_perspective, ALL_PERSPECTIVES

LOG_FILE = 'scripts/regen_progress.log'

def log(msg: str):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, 'a') as f:
        f.write(line + '\n')

def main():
    db = SessionLocal()

    bills = db.query(Legislation).filter(
        Legislation.analyzed_at != None
    ).order_by(Legislation.bill_number).all()

    total_bills = len(bills)
    total_perspectives = total_bills * len(ALL_PERSPECTIVES)
    done = 0
    failed = 0
    start_time = time.time()

    log(f"Starting full re-gen: {total_bills} bills x {len(ALL_PERSPECTIVES)} perspectives = {total_perspectives} total")

    for bill_idx, bill in enumerate(bills, 1):
        bill_start = time.time()
        bill_done = 0
        bill_failed = 0

        for ptype in ALL_PERSPECTIVES:
            try:
                result = generate_perspective(bill, ptype, db, force=True)
                if result:
                    bill_done += 1
                    done += 1
                else:
                    bill_failed += 1
                    failed += 1
            except Exception as e:
                bill_failed += 1
                failed += 1
                log(f"  ERROR {bill.bill_number} {ptype}: {e}")

        bill_elapsed = time.time() - bill_start
        total_elapsed = time.time() - start_time
        avg_per_bill = total_elapsed / bill_idx
        remaining_bills = total_bills - bill_idx
        eta_min = (remaining_bills * avg_per_bill) / 60

        log(
            f"[{bill_idx:3d}/{total_bills}] {bill.bill_number} — "
            f"{bill_done}/{len(ALL_PERSPECTIVES)} ok, {bill_failed} failed "
            f"({bill_elapsed:.0f}s) | ETA {eta_min:.0f}min"
        )

    total_time = (time.time() - start_time) / 60
    log(f"\nDone. {done} generated, {failed} failed. Total time: {total_time:.1f} min")
    db.close()

if __name__ == '__main__':
    main()
