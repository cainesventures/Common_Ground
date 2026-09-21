"""Regenerate headlines that describe concluded bills as if they were breaking news.

`_ai_headline` used to hardcode "present tense" with no date or status in the
prompt, so bills that passed years ago got headlines like "Council Approves X
Today". This re-runs the fixed prompt over the affected bills.

Built to run while the machine is being used for something else (a game, in
particular). Guardrails, in order of importance:

  * Never competes for VRAM. If a game is running, or free VRAM is below
    --vram-floor, inference runs CPU-only (num_gpu=0) and the GPU copy of the
    model is evicted. On this box CPU-only costs ~5s/headline vs ~1-2s on GPU,
    which is a fine trade for not stuttering a game.
  * Capped CPU threads (--threads, default 8 of 24 logical cores).
  * One request at a time, with --sleep seconds between them (duty cycle).
  * Resumable. Progress and every previous headline are checkpointed, so Ctrl-C
    is safe and a re-run picks up where it stopped.
  * Stoppable without a terminal: create the file named by --stop-file.

Usage:
    python scripts/regen_concluded_headlines.py --dry-run
    python scripts/regen_concluded_headlines.py
    python scripts/regen_concluded_headlines.py --mode cpu --sleep 3
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB = "common_ground_test.db"
CHECKPOINT = "scripts/.regen_headlines_checkpoint.json"

# Statuses where the bill is still in play. Everything else should read as past tense.
ACTIVE_STATUSES = {"introduced", "in_committee"}

# The tell for the defect: a concluded bill whose headline claims immediacy.
URGENCY_RE = re.compile(
    r"\b(tonight|today|this week|next month|next week|immediately|now|just|tomorrow|this month)\b",
    re.I,
)

# Game executables that mean "leave the GPU alone". tf_win64 is Team Fortress 2.
GAME_PROCESSES = {
    "tf_win64.exe", "tf.exe", "hl2.exe", "cs2.exe", "csgo.exe",
    "dota2.exe", "portal2.exe", "left4dead2.exe",
}


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


# ── Machine state ────────────────────────────────────────────────────────────

def running_games() -> list:
    """Names of any known game processes currently running."""
    try:
        import psutil
    except ImportError:
        return []
    found = []
    for p in psutil.process_iter(["name"]):
        name = (p.info.get("name") or "").lower()
        if name in GAME_PROCESSES:
            found.append(name)
    return sorted(set(found))


def free_vram_mb():
    """Free VRAM in MB, or None if this isn't an nvidia box."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        if out.returncode == 0:
            return int(out.stdout.strip().splitlines()[0])
    except Exception:
        pass
    return None


def lower_priority() -> None:
    """Drop to below-normal so foreground apps always win the scheduler."""
    try:
        import psutil
        p = psutil.Process()
        if sys.platform == "win32":
            p.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
        else:
            p.nice(10)
        log("process priority set to below-normal")
    except Exception as e:
        log(f"could not lower priority: {e}")


# ── Throttled Ollama provider ────────────────────────────────────────────────

class ThrottledOllama:
    """Ollama client that decides GPU vs CPU per batch and caps thread count.

    Implements the same .complete() contract as app.services.ai_provider so it
    can be handed straight to _ai_headline.
    """

    def __init__(self, model, base_url, mode, threads, vram_floor):
        import httpx
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.mode = mode
        self.threads = threads
        self.vram_floor = vram_floor
        self._client = httpx.Client(timeout=300)
        self.use_gpu = None  # resolved on first check
        self.reason = ""

    def evaluate(self) -> bool:
        """Re-decide GPU vs CPU. Returns True if the decision changed."""
        if self.mode == "cpu":
            want, reason = False, "forced by --mode cpu"
        elif self.mode == "gpu":
            want, reason = True, "forced by --mode gpu"
        else:
            games = running_games()
            vram = free_vram_mb()
            if games:
                want, reason = False, f"game running ({', '.join(games)})"
            elif vram is not None and vram < self.vram_floor:
                want, reason = False, f"only {vram}MB VRAM free (floor {self.vram_floor}MB)"
            else:
                want = True
                reason = f"{vram}MB VRAM free" if vram is not None else "no GPU probe available"

        changed = want != self.use_gpu
        if changed:
            prev = self.use_gpu
            self.use_gpu = want
            self.reason = reason
            log(f"mode -> {'GPU' if want else 'CPU-only'} ({reason})")
            # Switching away from GPU leaves a 4.9GB copy resident for keep_alive
            # seconds; evict it so the game gets the VRAM back immediately.
            if prev is True and want is False:
                self._unload()
        return changed

    def _unload(self) -> None:
        try:
            self._client.post(
                f"{self.base_url}/api/chat",
                json={"model": self.model, "messages": [], "keep_alive": 0},
            )
            log("evicted model from VRAM")
        except Exception as e:
            log(f"unload failed (harmless): {e}")

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        options = {"num_thread": self.threads, "num_predict": 60, "temperature": 0.4}
        if not self.use_gpu:
            options["num_gpu"] = 0
        r = self._client.post(
            f"{self.base_url}/api/chat",
            json={
                "model": self.model,
                "stream": False,
                # Short, so an abandoned run frees VRAM quickly.
                "keep_alive": "60s",
                "options": options,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
        )
        r.raise_for_status()
        return r.json()["message"]["content"]

    def shutdown(self) -> None:
        if self.use_gpu:
            self._unload()


# ── Checkpointing ────────────────────────────────────────────────────────────

def load_checkpoint() -> dict:
    if os.path.exists(CHECKPOINT):
        with open(CHECKPOINT, encoding="utf8") as f:
            return json.load(f)
    return {"done": {}, "skipped": {}}


def save_checkpoint(ck: dict) -> None:
    tmp = CHECKPOINT + ".tmp"
    with open(tmp, "w", encoding="utf8") as f:
        json.dump(ck, f, indent=1)
    os.replace(tmp, CHECKPOINT)


# ── Main ─────────────────────────────────────────────────────────────────────

def select_bills(conn, limit):
    """Concluded bills whose current headline still claims immediacy."""
    rows = conn.execute(
        "select id, bill_number, status, headline from legislation "
        "where headline is not null and trim(headline) <> '' and skip_reason is null"
    ).fetchall()
    out = [r for r in rows
           if (r[2] or "").lower() not in ACTIVE_STATUSES and URGENCY_RE.search(r[3])]
    out.sort(key=lambda r: r[1] or "")
    return out[:limit] if limit else out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="max bills this run (0 = all)")
    ap.add_argument("--sleep", type=float, default=1.5, help="seconds between bills")
    ap.add_argument("--threads", type=int, default=8, help="CPU threads for inference")
    ap.add_argument("--mode", choices=["auto", "cpu", "gpu"], default="auto")
    ap.add_argument("--vram-floor", type=int, default=3000,
                    help="MB of free VRAM required before using the GPU")
    ap.add_argument("--check-every", type=int, default=25,
                    help="re-check game/VRAM state every N bills")
    ap.add_argument("--stop-file", default="scripts/.regen_stop")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    import sqlite3
    from app.services.legislation_service import _ai_headline

    conn = sqlite3.connect(DB)
    bills = select_bills(conn, args.limit)
    ck = load_checkpoint()
    todo = [b for b in bills if b[0] not in ck["done"]]

    log(f"{len(bills)} bills match; {len(ck['done'])} already done; {len(todo)} to process")
    if args.dry_run:
        for b in todo[:15]:
            log(f"  would regen {b[1]} [{b[2]}]: {b[3][:80]}")
        log(f"dry run — nothing written ({len(todo)} would be processed)")
        return 0
    if not todo:
        log("nothing to do")
        return 0

    lower_priority()
    provider = ThrottledOllama(
        model=os.getenv("AI_MODEL", "llama3.1:8b"),
        base_url=os.getenv("AI_BASE_URL", "http://localhost:11434"),
        mode=args.mode, threads=args.threads, vram_floor=args.vram_floor,
    )
    provider.evaluate()

    stopping = {"flag": False}

    def on_sigint(signum, frame):
        log("interrupt received — finishing current bill then stopping")
        stopping["flag"] = True

    signal.signal(signal.SIGINT, on_sigint)

    # Minimal stand-in for the ORM object _ai_headline expects.
    class BillView:
        __slots__ = ("id", "bill_number", "plain_title", "title", "summary",
                     "description", "status", "introduced_date")

    changed = failed = 0
    started = time.time()

    for i, (bid, bnum, status, old_headline) in enumerate(todo, 1):
        if stopping["flag"] or os.path.exists(args.stop_file):
            log(f"stopping (stop-file present)" if not stopping["flag"] else "stopping")
            break

        if (i - 1) % args.check_every == 0:
            provider.evaluate()

        row = conn.execute(
            "select plain_title, title, summary, description, status, introduced_date "
            "from legislation where id = ?", (bid,)
        ).fetchone()

        b = BillView()
        b.id, b.bill_number = bid, bnum
        b.plain_title, b.title, b.summary, b.description = row[0], row[1], row[2], row[3]
        b.status = row[4]
        b.introduced_date = datetime.fromisoformat(row[5]) if row[5] else None

        new = ""
        for attempt in (1, 2):
            try:
                new = _ai_headline(b, provider)
            except Exception as e:
                log(f"  {bnum}: error {e}")
                new = ""
                break
            # The whole point of this run is removing false immediacy; if the
            # model reproduced it, retry once before giving up.
            if new and not URGENCY_RE.search(new):
                break
            if attempt == 1 and new:
                log(f"  {bnum}: retrying, still reads as immediate -> {new[:60]!r}")
            new = "" if attempt == 2 else new

        if not new:
            failed += 1
            ck["skipped"][bid] = {"bill": bnum, "old": old_headline}
            log(f"  {bnum}: kept original (could not produce a clean headline)")
        else:
            conn.execute("update legislation set headline = ? where id = ?", (new, bid))
            conn.commit()
            changed += 1
            ck["done"][bid] = {"bill": bnum, "old": old_headline, "new": new}
            log(f"  {bnum} [{status}]: {new[:78]}")

        save_checkpoint(ck)

        rate = (time.time() - started) / i
        if i % 25 == 0:
            remaining = (len(todo) - i) * (rate + args.sleep)
            log(f"— {i}/{len(todo)} · {changed} rewritten · {failed} kept · "
                f"~{remaining / 60:.0f} min left")

        time.sleep(args.sleep)

    provider.shutdown()
    conn.close()
    log(f"done: {changed} rewritten, {failed} kept, {len(ck['done'])} total complete")
    log(f"checkpoint: {CHECKPOINT} (holds every previous headline for rollback)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
