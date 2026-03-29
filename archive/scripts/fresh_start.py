"""
Delete the database, reseed debates, then run the moderator — all in one shot.

Usage:
    python fresh_start.py
"""
import asyncio
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

DB_PATH = "common_ground_test.db"


async def main():
    run_start = time.perf_counter()

    # ── 1. Delete database ────────────────────────────────────────────────────
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
        print(f"Deleted {DB_PATH}")
    else:
        print(f"No existing database found at {DB_PATH}")

    # ── 2. Reseed ─────────────────────────────────────────────────────────────
    print("\n── Seeding debates ──────────────────────────────────────────────────")
    import seed_debates
    t0 = time.perf_counter()
    await seed_debates.main()
    seed_elapsed = time.perf_counter() - t0
    print(f"   Seeding took {seed_elapsed:.1f}s")

    # ── 3. Run moderator (intros + fact-checks) ───────────────────────────────
    print("\n── Running moderator ────────────────────────────────────────────────")
    import rerun_moderator
    t0 = time.perf_counter()
    await rerun_moderator.main()
    mod_elapsed = time.perf_counter() - t0
    print(f"   Moderator took {mod_elapsed:.1f}s")

    total = time.perf_counter() - run_start
    print(f"\n✓ Fresh start complete.  Total: {total:.1f}s  (seed {seed_elapsed:.1f}s | moderator {mod_elapsed:.1f}s)")


if __name__ == "__main__":
    asyncio.run(main())
