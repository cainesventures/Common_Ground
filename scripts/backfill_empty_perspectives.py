"""Regenerate perspectives that were stored with a stance but no text.

_extract_json's regex fallback used to return {"position": ...} alone when a
generation was truncated, and generate_perspective stored that as a row with
assessment = None. On the page it renders as a support/oppose badge above
"No analysis available"; 5,282 rows across 1,901 bills ended up that way, and
they are server-rendered, so they are indexable.

Concurrency default of 4 is measured, not guessed: the GPU saturates at
concurrency 1 (~99% util), so extra threads buy little and cost latency.
Throughput peaked at 23.4/min at 4, and fell at 6 and 8.

Safe to interrupt. Progress is checkpointed per perspective, and the provider
pauses on its own if a game starts (AI_GPU_POLICY=pause).

Usage:
    python scripts/backfill_empty_perspectives.py --dry-run
    python scripts/backfill_empty_perspectives.py
    python scripts/backfill_empty_perspectives.py --concurrency 2 --limit 100
"""

import argparse
import json
import os
import re
import sqlite3
import statistics
import subprocess
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB = "common_ground_test.db"
CHECKPOINT = "scripts/.backfill_perspectives_checkpoint.json"
STOP_FILE = "scripts/.backfill_stop"


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def gpu_stat():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10)
        util, mem = out.stdout.strip().splitlines()[0].split(",")
        return int(util), int(mem)
    except Exception:
        return None, None


class Metrics:
    """Counters and latencies, safe to update from worker threads."""

    def __init__(self, total: int):
        self.total = total
        self.lock = threading.Lock()
        self.done = 0
        self.written = 0
        self.discarded = 0   # generated, but still no usable text
        self.failed = 0      # timeout or transport error
        self.salvaged = 0    # truncation-salvage path fired
        self.reasons = Counter()
        self.latencies = []
        self.started = time.time()

    def record(self, kind: str, seconds: float = 0.0, reason: str = "", salvaged: bool = False):
        with self.lock:
            self.done += 1
            if seconds:
                self.latencies.append(seconds)
            if kind == "written":
                self.written += 1
                if salvaged:
                    self.salvaged += 1
            elif kind == "discarded":
                self.discarded += 1
                self.reasons[reason or "no text"] += 1
            else:
                self.failed += 1
                self.reasons[reason or "error"] += 1

    def snapshot(self) -> str:
        with self.lock:
            elapsed = max(time.time() - self.started, 1e-6)
            rate = self.done / elapsed * 60
            remaining = self.total - self.done
            eta = timedelta(seconds=int(remaining / rate * 60)) if rate else "?"
            recent = self.latencies[-100:]
            p50 = statistics.median(recent) if recent else 0
            p95 = (statistics.quantiles(recent, n=20)[-1]
                   if len(recent) > 3 else (max(recent) if recent else 0))
            util, mem = gpu_stat()
            gpu = f"gpu {util}% {mem}M" if util is not None else "gpu n/a"
            pct = self.done * 100 / self.total if self.total else 100
            return (f"{self.done}/{self.total} ({pct:.0f}%) · {rate:.1f}/min · "
                    f"p50 {p50:.1f}s p95 {p95:.1f}s · "
                    f"ok {self.written} discarded {self.discarded} failed {self.failed} "
                    f"salvaged {self.salvaged} · {gpu} · ETA {eta}")


def load_checkpoint() -> set:
    if os.path.exists(CHECKPOINT):
        try:
            with open(CHECKPOINT, encoding="utf8") as f:
                return set(json.load(f).get("done", []))
        except Exception:
            pass
    return set()


def save_checkpoint(done: set) -> None:
    tmp = CHECKPOINT + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump({"done": sorted(done)}, f)
    os.replace(tmp, CHECKPOINT)


def select_targets(conn, limit):
    rows = conn.execute("""
        select p.id, p.perspective_type, p.bill_id, l.bill_number, l.title,
               l.sponsor, l.status, l.summary, l.full_text, l.description
        from bill_perspectives p join legislation l on l.id = p.bill_id
        where p.assessment is null or trim(p.assessment) = ''
        order by l.introduced_date desc""").fetchall()
    return rows[:limit] if limit else rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--concurrency", type=int, default=4,
                    help="measured optimum is 4; the GPU saturates at 1")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--report-every", type=int, default=25)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    from app.services.perspectives_service import (
        PERSPECTIVE_PROMPTS, _USER_PROMPT_TEMPLATE, _extract_json,
    )
    from app.services.ai_provider import get_ai_provider

    conn = sqlite3.connect(DB, timeout=60, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma journal_mode=wal")

    done = load_checkpoint()
    targets = [r for r in select_targets(conn, args.limit) if r["id"] not in done]

    log(f"{len(targets)} empty perspectives to regenerate "
        f"({len(done)} already done) at concurrency {args.concurrency}")
    if args.dry_run:
        for r in targets[:10]:
            log(f"  would regenerate {r['perspective_type']:20} on bill {r['bill_number']}")
        return 0
    if not targets:
        log("nothing to do")
        return 0

    provider = get_ai_provider()
    metrics = Metrics(len(targets))
    db_lock = threading.Lock()
    stop = threading.Event()

    def work(r):
        if stop.is_set():
            return
        prompt = _USER_PROMPT_TEMPLATE.format(
            bill_number=r["bill_number"], title=(r["title"] or "")[:400],
            sponsor=r["sponsor"] or "Unknown", status=r["status"],
            summary=(r["summary"] or "(not yet summarized)")[:600],
            full_text=(r["full_text"] or r["description"] or r["title"] or "")[:3000],
            city_context="")
        t0 = time.time()
        try:
            raw = provider.complete(
                system_prompt=PERSPECTIVE_PROMPTS[r["perspective_type"]],
                user_prompt=prompt)
        except Exception as e:
            metrics.record("failed", time.time() - t0, reason=type(e).__name__)
            return
        elapsed = time.time() - t0

        data = _extract_json(raw)
        text = (data.get("response") or data.get("assessment") or "").strip()
        if not text:
            # Leave the row alone; it is already empty, and a bad regeneration
            # should not overwrite a position that may still be right.
            metrics.record("discarded", elapsed, reason="no text returned")
            return

        raw_pos = str(data.get("position", "")).lower()
        if "support" in raw_pos and "oppose" not in raw_pos:
            position = "support"
        elif "oppose" in raw_pos and "support" not in raw_pos:
            position = "oppose"
        else:
            position = None  # keep whatever is stored

        salvaged = not re.search(r'"\s*\}\s*$', raw.strip())
        with db_lock:
            if position:
                conn.execute(
                    "update bill_perspectives set assessment=?, position=?, generated_at=? where id=?",
                    (text, position, datetime.now(timezone.utc).isoformat(), r["id"]))
            else:
                conn.execute(
                    "update bill_perspectives set assessment=?, generated_at=? where id=?",
                    (text, datetime.now(timezone.utc).isoformat(), r["id"]))
            conn.commit()
            done.add(r["id"])
        metrics.record("written", elapsed, salvaged=salvaged)

        if metrics.done % args.report_every == 0:
            log(metrics.snapshot())
            with db_lock:
                save_checkpoint(done)

    try:
        with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
            for _ in ex.map(work, targets):
                if os.path.exists(STOP_FILE):
                    stop.set()
                    log("stop file present — finishing in-flight work")
                    break
    except KeyboardInterrupt:
        stop.set()
        log("interrupted — saving progress")

    save_checkpoint(done)
    log("FINAL " + metrics.snapshot())
    if metrics.reasons:
        log("failure reasons: " + ", ".join(f"{k}={v}" for k, v in metrics.reasons.most_common()))
    remaining = conn.execute(
        "select count(*) from bill_perspectives where assessment is null or trim(assessment)=''"
    ).fetchone()[0]
    log(f"empty perspectives remaining in DB: {remaining}")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
