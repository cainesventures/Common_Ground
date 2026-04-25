"""
Fast enrichment worker — text, analyze, headline, metadata, news.
Skips perspectives (handled by worker_perspectives.py).

Default: batch=150, parallel=10
Registered as Task Scheduler job "CommonGroundWorkerFast" every 30 min.

Usage:
    python scripts/worker_fast.py
    python scripts/worker_fast.py --batch 100 --parallel 5 --dry-run
"""

import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

FAST_STEPS = ["text", "analyze", "headline", "metadata", "news", "votes", "hearings"]
DEFAULT_BATCH = 1000
DEFAULT_PARALLEL = 10


def main():
    parser = argparse.ArgumentParser(description="Fast enrichment worker (no perspectives)")
    parser.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    parser.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL)
    parser.add_argument("--year", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from scripts.worker_core import setup_logging, run_worker
    log = setup_logging("worker_fast")

    run_worker(
        log=log,
        allowed_steps=FAST_STEPS,
        batch=args.batch,
        parallel=args.parallel,
        dry_run=args.dry_run,
        year=args.year,
        progress_key="worker_fast",
    )


if __name__ == "__main__":
    main()
