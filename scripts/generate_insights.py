"""Generate "what this bill actually does" for concluded bills.

WHY THIS EXISTS, SEPARATELY FROM generate_two_lane.py
-----------------------------------------------------
The case for / case against is only written for bills still before Council.
That is a deliberate scope decision: the lane prompts are written in the
present and future ("this bill would shift repair costs to owners"), and on a
bill signed into law in 2018 or lapsed in 2004 that framing tells a reader the
decision is still open. Retrofitting it would mean a second set of prompts and
a second pass over 8,000 bills to judge the result.

The insights stage has no such problem. It states what the bill does rather
than arguing about it -- "Prohibits the operation of Electric Personal
Assistive Mobility Devices on sidewalks" -- so it reads correctly whether the
bill passed, lapsed or is still moving. It also runs the same grounding and
self-contradiction checks every other stage runs, which the 17 legacy personas
never did.

So this fills the gap left by removing the persona panel: the bills that lost
their only piece of writing get a verified factual one instead.

Measured on a 30-bill sample of that exact population: 93% produced grounded
insights, 4.0s per bill steady-state.

STATE
-----
Writes `two_lane_state = 'insights_only'`, deliberately NOT 'argued'. Several
things key off 'argued' -- TwoLanePanel renders on it, and
generate_sitemap.py promotes it out of the archive segment -- and a bill with
insights but no arguments is not the same product. A bill whose insights
cannot be grounded in three attempts gets 'dropped' with a reason, so a re-run
does not keep paying for it.

Both states are non-null, which is what makes a re-run cheap: the default
selection skips any bill that already has one.

GUARD RAILS
-----------
Defaults to llama3.2:3b, keeps a floor of free VRAM, and stops at a wall-clock
budget. The first version of this script had none of that: it held
llama3.1:8b resident for about three hours over 1,896 bills and made the
machine unusable until a hard reboot. See scripts/gpu_guard.py for the
measurements. Pass --unguarded only on a machine nobody is using.

Usage:
    # review a few, no writes
    python scripts/generate_insights.py --limit 20

    # the real run, in resumable 45-minute slices (re-run until it reports 0 left)
    python scripts/generate_insights.py --had-personas --limit 0 --write

    # a machine nobody is using: bigger model, no budget
    python scripts/generate_insights.py --had-personas --limit 0 --write         --model llama3.1:8b --unguarded

    python scripts/generate_insights.py --bill 210205 --redo
"""

import argparse
import logging
import os
import random
import sqlite3
import sys
import textwrap
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from generate_two_lane import (  # noqa: E402  (after the sys.path fix-up)
    ATTEMPTS, _generate_insights, bill_facts, grounding_source)
from gpu_guard import (  # noqa: E402
    DEFAULT_FLOOR_MB, HEAVY_MODEL, LIGHT_MODEL, Budget, BudgetExhausted,
    VramExhausted, VramGuard, preflight)

DB = "common_ground_test.db"

# Same source-quality floor generate_two_lane uses: a bill whose Legistar
# record carries no usable text is where the model invents plausible-sounding
# legislation, which is what scripts/clear_ungrounded_headlines.py had to
# clean up after.
FLOOR = ("summary is not null and length(summary) > 40 "
         "and skip_reason is null "
         "and summary not like '%no title, sponsor%' "
         "and summary not like '%contains no title%'")

CONCLUDED = "status not in ('introduced','in_committee','awaiting_mayor')"


def _now() -> str:
    """UTC timestamp in the same naive form the other columns use."""
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(" ", "seconds")


def pick_bills(limit, bill_number=None, had_personas=False,
               all_concluded=False, redo=False):
    """Choose the bills to work on.

    `had_personas` is the main scope and the point of the script: concluded
    bills that carried one of the 16,217 legacy persona blocks, i.e. exactly
    the pages that lost their only piece of writing when that panel was
    removed.

    `limit` always caps the result; 0 means no cap. The scope flags choose the
    population, not how much of it to do -- keeping those separate is the
    difference between `--limit 3 --had-personas` printing three bills for
    review and silently walking all 1,896 of them.
    """
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        if bill_number:
            rows = conn.execute(
                "select * from legislation where bill_number = ?",
                (bill_number,)).fetchall()
            return rows

        where = f"{FLOOR} and {CONCLUDED}"
        if not redo:
            where += " and two_lane_state is null"
        if had_personas:
            where += (" and exists (select 1 from bill_perspectives p "
                      "where p.bill_id = legislation.id)")
        rows = conn.execute(
            f"select * from legislation where {where}").fetchall()
    finally:
        conn.close()

    if had_personas or all_concluded:
        # Newest first: if a long run is interrupted, the bills most likely to
        # be read are already done. (generate_two_lane goes oldest-first for
        # the opposite reason -- there, the newest active bills are the cheap
        # top-up run.)
        rows = sorted(rows, key=lambda r: r["bill_number"], reverse=True)
    else:
        random.Random(11).shuffle(rows)
    return rows[:limit] if limit else rows


def persist(conn, row, insights, dropped, model):
    """Write one bill's result. Shares one connection across the run.

    Only the insight columns are touched. case_for / case_against stay NULL:
    this script does not write arguments, and a partially-populated two-lane
    row would make TwoLanePanel's "argued" contract a lie.
    """
    conn.execute(
        "update legislation set two_lane_insights = ?, two_lane_state = ?, "
        "two_lane_drop_reason = ?, two_lane_model = ?, "
        "two_lane_generated_at = ? where id = ?",
        (insights,
         "dropped" if dropped else "insights_only",
         dropped, model, _now(), row["id"]),
    )
    conn.commit()


def main():
    # The VRAM guard reports pauses through logging; without a handler those
    # warnings go nowhere and a run looks stalled rather than throttled.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20,
                    help="cap the number of bills; 0 means no cap")
    ap.add_argument("--bill", default=None)
    ap.add_argument("--had-personas", action="store_true",
                    help="concluded bills that carried a legacy persona (the default run)")
    ap.add_argument("--all-concluded", action="store_true",
                    help="every concluded bill without a state yet")
    ap.add_argument("--write", action="store_true",
                    help="persist to the database instead of only printing")
    ap.add_argument("--redo", action="store_true",
                    help="re-generate bills that already have a state")
    ap.add_argument("--no-checks", action="store_true",
                    help="skip the grounding checks (for comparison only)")
    # -- Guard rails. See scripts/gpu_guard.py for why these exist. ---------
    # This script's first version had none of them: it held llama3.1:8b
    # resident for ~3 hours over 1,896 bills and made the machine unusable
    # until a hard reboot. The work survived only because every bill is
    # committed as it completes.
    # Defaults to the light model rather than inheriting AI_MODEL from .env,
    # which is llama3.1:8b. The safe choice has to be the default one: this is
    # an extraction task, and on an 8GB card shared with a desktop the 8B model
    # is what made the machine unusable. Pass --model llama3.1:8b to opt back
    # in deliberately.
    ap.add_argument("--model", default=LIGHT_MODEL,
                    help=f"model to use (default {LIGHT_MODEL}); the 8B model "
                         "is measurably intrusive on this card")
    ap.add_argument("--gpu-layers", type=int, default=-1,
                    help="model layers to place on the GPU (-1 = all). The "
                         "only knob that makes the 8B model coexist with a "
                         "desktop on an 8GB card: fewer layers, less VRAM, "
                         "slower tokens/sec. llama3.1:8b has 33 layers.")
    ap.add_argument("--num-ctx", type=int, default=0,
                    help="context window (0 = Ollama's default, 4096). The KV "
                         "cache scales with this; insight prompts need ~1,800 "
                         "tokens including the reply.")
    ap.add_argument("--calibrate", type=int, default=0, metavar="N",
                    help="run N bills, report measured peak VRAM and speed, "
                         "and write nothing. Use this to pick --gpu-layers "
                         "before committing to a batch.")
    ap.add_argument("--vram-floor-mb", type=int, default=DEFAULT_FLOOR_MB,
                    help="pause when the desktop would be left with less than "
                         "this once the model is resident")
    ap.add_argument("--pause-seconds", type=int, default=30)
    ap.add_argument("--max-pauses", type=int, default=10)
    ap.add_argument("--budget-minutes", type=float, default=45,
                    help="wall-clock ceiling; stops cleanly when exceeded")
    ap.add_argument("--unguarded", action="store_true",
                    help="disable the VRAM floor and the budget. Only for a "
                         "machine nobody is using.")
    args = ap.parse_args()

    # Set before the provider is built, so the choices reach it.
    os.environ["AI_MODEL"] = args.model
    if args.gpu_layers >= 0:
        os.environ["AI_NUM_GPU"] = str(args.gpu_layers)
    if args.num_ctx > 0:
        os.environ["AI_NUM_CTX"] = str(args.num_ctx)
    # Calibration never writes and is bounded by its own count.
    if args.calibrate:
        args.write = False
        args.limit = args.calibrate

    from app.services.ai_provider import get_ai_provider
    provider = get_ai_provider()
    model = getattr(provider, "model", None) or os.getenv("AI_MODEL") or "unknown"

    guard = budget = None
    if not args.unguarded:
        peak = preflight(model, args.vram_floor_mb, args.gpu_layers)
        guard = VramGuard(
            floor_mb=args.vram_floor_mb,
            max_consecutive_pauses=args.max_pauses,
            pause_seconds=args.pause_seconds,
            unload=getattr(provider, "_unload", None),
            model_peak_mb=peak,
            resident_mb=getattr(provider, "resident_vram_mb", None),
        )
        budget = Budget(minutes=args.budget_minutes)

    rows = pick_bills(args.limit, args.bill,
                      had_personas=args.had_personas,
                      all_concluded=args.all_concluded,
                      redo=args.redo)
    if not rows:
        print("Nothing to do.")
        return 0

    print(f"model={model}  bills={len(rows)}  write={args.write}")
    wrap = lambda s: textwrap.fill(s, 96, initial_indent="      ",
                                   subsequent_indent="      ")

    conn = sqlite3.connect(DB, timeout=60) if args.write else None
    t0 = time.time()
    ok = dropped = 0
    try:
        for i, r in enumerate(rows, 1):
            # Both raise rather than degrade. Every bill already committed
            # stays committed, and a re-run skips it.
            if budget:
                budget.check()
            if guard:
                guard.wait_for_headroom()

            facts, source = bill_facts(r), grounding_source(r)
            t1 = time.time()
            insights, rejections, attempts = _generate_insights(
                provider, r, source, facts,
                checks=not args.no_checks, attempts=ATTEMPTS)
            dt = time.time() - t1

            # Sample again straight after generation. The guard's own sample
            # happens at the top of the loop, before the model is loaded on
            # the first pass and between requests afterwards, so on its own it
            # measures the resident size and misses the peak that KV cache and
            # compute buffers add during generation -- which is the number that
            # decides whether the desktop survives.
            if guard:
                guard.free_mb()

            reason = None if insights else "insights_ungrounded"
            if insights:
                ok += 1
            else:
                dropped += 1
            if conn:
                persist(conn, r, insights, reason, model)

            flag = "ok" if insights else "DROPPED"
            print(f"[{i}/{len(rows)}] {r['bill_number']} ({r['status']}) "
                  f"{flag} attempts={attempts} {dt:5.1f}s")
            if insights:
                print(wrap(insights[:400]))
            else:
                for line in rejections[:2]:
                    print(f"      ! {line}")
            # A long unattended run should be followable from the log tail.
            if i % 50 == 0:
                rate = (time.time() - t0) / i
                left = (len(rows) - i) * rate / 60
                print(f"--- {i}/{len(rows)}  {rate:.1f}s/bill  "
                      f"~{left:.0f} min remaining ---", flush=True)
    except (BudgetExhausted, VramExhausted) as stop:
        # Not a crash. A deliberate stop, with everything so far committed.
        print(f"\nSTOPPED: {stop}")
    finally:
        if conn:
            conn.close()

    total = time.time() - t0
    done = ok + dropped
    print(f"\n{done} of {len(rows)} bills in {total/60:.1f} min  "
          f"({total/max(done, 1):.1f}s/bill)")
    print(f"{ok} grounded, {dropped} dropped "
          f"({100*ok/max(done, 1):.0f}% usable)")
    if guard:
        total_vram = (VramGuard.sample() or (0, 0))[1]
        print(f"peak VRAM {guard.peak_used_mb}MB of {total_vram}MB "
              f"({total_vram - guard.peak_used_mb}MB left for the desktop at "
              f"peak), {guard.total_pauses} pause(s)")
        if args.calibrate:
            layers = "all" if args.gpu_layers < 0 else args.gpu_layers
            print()
            print(f"CALIBRATION: {model} at {layers} layers "
                  f"peaked at {guard.peak_used_mb}MB.")
            headroom = total_vram - guard.peak_used_mb
            if headroom < args.vram_floor_mb:
                print(f"  {headroom}MB left for the desktop is UNDER the "
                      f"{args.vram_floor_mb}MB floor - lower --gpu-layers.")
            else:
                print(f"  {headroom}MB left for the desktop, above the "
                      f"{args.vram_floor_mb}MB floor. Safe to run the batch "
                      "with these settings.")
            print("  Nothing was written.")
    if done < len(rows):
        print(f"{len(rows) - done} not attempted — re-run to continue.")
    if args.write:
        print(f"written to {DB}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
