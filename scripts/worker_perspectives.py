"""
Perspectives worker — Ollama GPU inference only.
Only runs the perspectives step; skips all other steps.

Default: batch=28, parallel=10
Registered as Task Scheduler job "CommonGroundWorkerPersp" every 30 min.

Usage:
    python scripts/worker_perspectives.py
    python scripts/worker_perspectives.py --batch 20 --dry-run
"""

import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DEFAULT_BATCH = 28
DEFAULT_PARALLEL = 10


def main():
    parser = argparse.ArgumentParser(description="Perspectives-only worker (Ollama GPU)")
    parser.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    parser.add_argument("--parallel", type=int, default=DEFAULT_PARALLEL)
    parser.add_argument("--year", type=int, default=0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from scripts.worker_core import setup_logging, run_worker
    log = setup_logging("worker_perspectives")

    run_worker(
        log=log,
        allowed_steps=["perspectives"],
        batch=args.batch,
        parallel=args.parallel,
        dry_run=args.dry_run,
        year=args.year,
        progress_key="worker_perspectives",
    )


if __name__ == "__main__":
    main()
