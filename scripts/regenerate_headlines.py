"""Regenerate headlines that assert a rule which never existed.

The problem
-----------
8,663 bills carry an AI-written `headline`, and 1,782 of them are for bills
that never became law (lapsed, failed or vetoed). 459 of those 1,782 are
written as though the bill passed:

    010257 [lapsed]  Muzzle Mandate Takes Effect Immediately Citywide
    030182 [lapsed]  Council Approves Measure Capping 2004 Real Estate Tax Increases
    080935 [lapsed]  City Cracks Down on Street Vending in Bustling Spring Garden
                     Area Effective Immediately

Nothing in those bills is in force. The headline is the largest text on the
page and the content of the `<title>` tag, so this is not a style problem --
the site is telling readers that rules exist when they do not.

The cause was the prompt: it told the model the bill "concluded (lapsed)", and
"concluded" reads as "finished successfully". `_HEADLINE_NEVER_ENACTED` in
app/services/legislation_service.py now gives these bills their own
instruction, which says "NEVER BECAME LAW" and asks for the proposal framing.
This script re-runs generation for the affected bills against that prompt.

Guard rails
-----------
Local inference on an 8GB card that is also driving the desktop has twice taken
this machine down -- fine at first, then slower and slower until only a hard
reboot recovered it. The mechanism is VRAM exhaustion followed by the Windows
NVIDIA driver silently spilling into system RAM instead of failing, so work
continues at a crawl while the desktop compositor fights for memory. With 128GB
of RAM there is effectively unlimited room to spill into, so it degrades
indefinitely rather than erroring.

So this script:

  * defaults to **llama3.2:3b** (~2.0GB) rather than llama3.1:8b (~5.3GB).
    Measured: the 8B model peaked at 6,027MB of 8,151MB, leaving ~2.1GB for a
    desktop that needs ~900MB at idle. Rewriting a headline is a small task and
    does not need the larger model.
  * pins `num_ctx` low. Headline prompts measure 179-338 characters, so the
    KV cache does not need to be sized for thousands of tokens.
  * **samples free VRAM before every bill**, and pauses (after unloading the
    model) when headroom drops below a floor -- which is what happens when the
    desktop's own usage grows underneath us.
  * **aborts** rather than grinding: after N consecutive pauses, after N
    consecutive failures, or when the wall-clock budget runs out.
  * runs strictly **serially**. scripts/worker.py defaults to `--parallel 10`,
    and with Ollama sizing its KV cache for the parallelism it is given, ten
    concurrent requests over bills whose text reaches 221KB is the most likely
    cause of the original crashes.
  * **checkpoints every bill** to JSON, so an abort costs nothing and a re-run
    skips completed work.
  * records the previous headline in that checkpoint, so `--revert` can put
    every one of them back. These strings are indexed by Google, and organic
    search is the only channel that reliably brings readers here, so changing
    them has to be reversible.
  * **writes nothing without `--apply`.**

Usage
-----
    python scripts/regenerate_headlines.py                   # dry run, all targets
    python scripts/regenerate_headlines.py --limit 15        # dry run, first 15
    python scripts/regenerate_headlines.py --limit 15 --apply
    python scripts/regenerate_headlines.py --apply           # the real run
    python scripts/regenerate_headlines.py --revert          # undo from checkpoint
    python scripts/regenerate_headlines.py --list            # show targets, no model
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Project root for `app.*`, and this directory for the sibling
# two_lane_checks module (scripts/ is not a package).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

log = logging.getLogger("regen-headlines")

CHECKPOINT = Path(__file__).resolve().parent.parent / ".headline_regen_checkpoint.json"

# ── Target selection ─────────────────────────────────────────────────────────
# Deliberately the same two regexes used to measure the problem, so the set the
# script touches is the set that was counted and reviewed, and re-running the
# measurement reproduces it.

# Language asserting that a rule exists or an action was taken.
ASSERTS_RULE = re.compile(
    r"\b(must|mandates?|requires?|bans?|prohibits?|outlaws?|cracks? down|imposes?|"
    r"establishes?|creates?|allows?|permits?|approves?|enacts?|sets?|caps?|raises?|"
    r"lowers?|expands?|extends?|will)\b",
    re.I,
)
# Language that correctly marks the bill as a proposal. A headline carrying any
# of these is already honest about the outcome and is left alone.
HEDGES_PROPOSAL = re.compile(
    r"\b(propose(s|d)?|proposal|seeks?|sought|aims?|would|could|may|plan(s|ned)?|"
    r"push(es)?|consider(s|ing)?|introduce(s|d)?|bill|eye(s|ing)?|weigh(s|ing)?|"
    r"move(s)? to|call(s)? for|urge(s)?|debate|attempt(s|ed)?|tried|tries|"
    r"intend(s|ed)?|wanted|looked to|set out to)\b",
    re.I,
)
# `sought` earns a note. It was missing, and the replacement prompt actively
# recommends "Council sought to..." as a good shape -- so the first dry run
# produced "Council sought to require businesses with 10 or more shopping carts
# to implement cart containment systems", which is a correct headline, and this
# check rejected it, because `seeks?` does not match "sought". A validator that
# rejects the phrasing the prompt asks for is worse than no validator.

# Wording that already reports the bill's own defeat, so the headline is
# honest and must be left alone. Scoped deliberately tightly to the bill's
# fate: a bare "fails to" also appears in penalty clauses aimed at the public
# -- "Fines for Those Who Fail to Comply" is a lapsed bill asserting a mandate
# and *is* a target, not an exception.
REPORTS_DEFEAT = re.compile(
    r"\b(fail(s|ed)? to (approve|pass|advance|adopt|enact)|reject(s|ed)?|"
    r"defeat(s|ed)?|vot(e|ed) down|voted against|withdraw(n)?|"
    r"never (became|passed|made))\b",
    re.I,
)

NEVER_ENACTED = ("lapsed", "failed", "vetoed")


def misleading(headline: str) -> bool:
    """True when a dead bill's headline reads as though it passed.

    Over the 1,782 never-enacted bills this selects 458: 459 assert a rule
    without hedging, less the one that already says Council failed to approve
    it.
    """
    if not headline:
        return False
    if REPORTS_DEFEAT.search(headline):
        return False
    return bool(ASSERTS_RULE.search(headline)) and not HEDGES_PROPOSAL.search(headline)


# VRAM supervision lives in scripts/gpu_guard.py (preflight, VramGuard,
# Budget). This script's private copy predated it and had no preflight.

# ── Checkpoint ───────────────────────────────────────────────────────────────

def load_checkpoint() -> dict:
    if not CHECKPOINT.exists():
        return {}
    try:
        return json.loads(CHECKPOINT.read_text(encoding="utf-8"))
    except Exception:
        log.warning("Checkpoint unreadable; starting fresh (old file kept)")
        return {}


def save_checkpoint(data: dict) -> None:
    """Write via a temp file so an interrupt cannot truncate the record.

    The checkpoint holds the only copy of the previous headlines, so a
    half-written file would mean losing the ability to revert.
    """
    tmp = CHECKPOINT.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(CHECKPOINT)


# ── Main ─────────────────────────────────────────────────────────────────────

def build_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--target", choices=["never-enacted", "quality"], default="never-enacted",
                   help="never-enacted: dead bills whose headline reads as law (the "
                        "original job). quality: any headline that fails "
                        "app/services/headline_checks.py (invented neighborhood, "
                        "editorializing word, contradicted dollar figure).")
    p.add_argument("--apply", action="store_true",
                   help="Write to the database. Without it, nothing is saved.")
    p.add_argument("--limit", type=int, default=0, help="Only the first N targets")
    p.add_argument("--list", action="store_true",
                   help="Print the target set and exit without loading a model")
    p.add_argument("--revert", action="store_true",
                   help="Restore previous headlines from the checkpoint")
    p.add_argument("--model", default="llama3.2:3b",
                   help="Ollama model (default llama3.2:3b, ~2.0GB)")
    p.add_argument("--num-ctx", type=int, default=2048,
                   help="Context window per request (default 2048)")
    p.add_argument("--vram-floor-mb", type=int, default=1500,
                   help="VRAM to keep for the desktop (default 1500, gpu_guard's floor)")
    p.add_argument("--pause-seconds", type=int, default=30)
    p.add_argument("--max-pauses", type=int, default=10)
    p.add_argument("--max-failures", type=int, default=5,
                   help="Abort after this many consecutive generation failures")
    p.add_argument("--budget-minutes", type=int, default=60,
                   help="Wall-clock budget; stops cleanly when exceeded")
    return p.parse_args()


def main() -> int:
    args = build_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    # Set before the provider is constructed -- it reads these in __init__.
    os.environ["AI_MODEL"] = args.model
    if args.num_ctx > 0:
        os.environ["AI_NUM_CTX"] = str(args.num_ctx)

    from sqlalchemy.orm import defer
    from app.models.database import SessionLocal
    from app.models import Legislation

    # Each target keeps its own checkpoint, so --revert on one never touches
    # headlines the other run wrote.
    global CHECKPOINT
    if args.target == "quality":
        CHECKPOINT = CHECKPOINT.with_name(".headline_quality_checkpoint.json")

    from app.services.headline_checks import headline_problems

    def bill_source(b) -> str:
        return " ".join(filter(None, [b.title, b.description, b.full_text]))

    db = SessionLocal()
    checkpoint = load_checkpoint()

    # ── revert ──
    if args.revert:
        if not checkpoint:
            log.error("No checkpoint at %s — nothing to revert.", CHECKPOINT)
            return 1
        restored = 0
        for bill_id, rec in checkpoint.items():
            old = rec.get("old")
            if old is None:
                continue
            bill = db.query(Legislation).filter(Legislation.id == bill_id).first()
            if bill is None:
                continue
            bill.headline = old
            restored += 1
        if args.apply:
            db.commit()
            log.info("Reverted %d headlines.", restored)
        else:
            db.rollback()
            log.info("Would revert %d headlines. Re-run with --apply.", restored)
        return 0

    # ── select targets ──
    # Only the columns a headline needs. `full_text` averages 6.5KB and reaches
    # 221KB, and _headline_source never looks at it, so there is no reason to
    # pull it across for 1,782 rows.
    if args.target == "quality":
        # full_text stays loaded here: the place check needs the whole bill.
        candidates = (
            db.query(Legislation)
            .options(defer(Legislation.supplementary_data), defer(Legislation.news_links),
                     defer(Legislation.case_for), defer(Legislation.case_against),
                     defer(Legislation.two_lane_insights))
            .filter(Legislation.level == "local", Legislation.headline.isnot(None),
                    Legislation.headline != "")
            .order_by(Legislation.introduced_date.desc())
            .all()
        )
        targets = [b for b in candidates if headline_problems(b.headline, bill_source(b), b.summary, b.status)]
        log.info("%d bills with a headline; %d fail the quality checks.",
                 len(candidates), len(targets))
    else:
      candidates = (
        db.query(Legislation)
        .options(
            defer(Legislation.full_text),
            defer(Legislation.supplementary_data),
            defer(Legislation.news_links),
            defer(Legislation.case_for),
            defer(Legislation.case_against),
            defer(Legislation.two_lane_insights),
        )
        .filter(
            Legislation.status.in_(NEVER_ENACTED),
            Legislation.headline.isnot(None),
            Legislation.headline != "",
        )
        .order_by(Legislation.introduced_date.desc())
        .all()
    )
      targets = [b for b in candidates if misleading(b.headline)]
      log.info("%d never-enacted bills with a headline; %d read as enacted.",
               len(candidates), len(targets))

    pending = [b for b in targets if b.id not in checkpoint]
    if len(pending) != len(targets):
        log.info("%d already done in a previous run; %d pending.",
                 len(targets) - len(pending), len(pending))
    if args.limit:
        pending = pending[: args.limit]

    if args.list:
        for b in pending:
            print(f"{b.bill_number:10} [{b.status:16}] {b.headline}")
        print(f"\n{len(pending)} target(s)")
        return 0

    if not pending:
        log.info("Nothing to do.")
        return 0

    if not args.apply:
        log.warning("DRY RUN — nothing will be written. Add --apply to save.")

    # ── generate ──
    from app.services.legislation_service import _ai_headline, _headline_source
    from two_lane_checks import ungrounded_numbers
    from app.services.ai_provider import (
        get_ai_provider, InferencePaused, InferenceTimeout,
    )

    from gpu_guard import Budget, BudgetExhausted, VramExhausted, VramGuard, preflight

    provider = get_ai_provider()
    # Refuse an impossible run in the first second, not the thirtieth minute.
    peak = preflight(args.model, args.vram_floor_mb)
    guard = VramGuard(
        floor_mb=args.vram_floor_mb,
        max_consecutive_pauses=args.max_pauses,
        pause_seconds=args.pause_seconds,
        unload=getattr(provider, "_unload", None),
        model_peak_mb=peak,
        resident_mb=getattr(provider, "resident_vram_mb", None),
    )
    budget = Budget(minutes=args.budget_minutes)

    s = VramGuard.sample()
    log.info("Model %s | num_ctx %s | VRAM %s",
             args.model, args.num_ctx,
             f"{s[0]}MB used of {s[1]}MB" if s else "unknown")

    done = failed = skipped = 0
    consecutive_failures = 0

    try:
        for i, bill in enumerate(pending, 1):
            try:
                budget.check()
                guard.wait_for_headroom()
            except BudgetExhausted:
                log.warning("Wall-clock budget of %dmin reached — stopping cleanly.",
                            args.budget_minutes)
                break
            except VramExhausted as e:
                log.error("Stopping to protect the desktop: %s", e)
                break

            old = bill.headline
            try:
                new = _ai_headline(bill, provider)
            except (InferenceTimeout, InferencePaused) as e:
                # Neither is retried here. InferenceTimeout specifically means
                # Ollama is still working on the abandoned request, and queuing
                # another behind it is what previously spiralled.
                log.error("[%d/%d] %s — stopping: %s", i, len(pending),
                          bill.bill_number, e)
                break
            except Exception as e:
                consecutive_failures += 1
                failed += 1
                log.warning("[%d/%d] %s failed (%d in a row): %s",
                            i, len(pending), bill.bill_number,
                            consecutive_failures, e)
                if consecutive_failures >= args.max_failures:
                    log.error("%d consecutive failures — stopping.",
                              consecutive_failures)
                    break
                continue

            consecutive_failures = 0

            if not new:
                # The model declined (EMPTY) or had no usable source. Leaving
                # the old headline is wrong, but blanking it is worse: the page
                # would fall back to the raw legal title. Flag and move on.
                skipped += 1
                log.info("[%d/%d] %s — model returned nothing, left unchanged",
                         i, len(pending), bill.bill_number)
                continue

            if bill.status in NEVER_ENACTED and misleading(new):
                # The new headline has the same defect. Worth knowing about:
                # it means the prompt change did not take for this bill, and
                # silently storing it would hide that.
                log.warning("[%d/%d] %s — regenerated headline STILL reads as "
                            "enacted, not saving: %s",
                            i, len(pending), bill.bill_number, new)
                skipped += 1
                continue

            still = headline_problems(new, bill_source(bill), bill.summary, bill.status)
            if still:
                log.warning("[%d/%d] %s — regenerated headline still %s, not saving: %s",
                            i, len(pending), bill.bill_number, "; ".join(still), new)
                skipped += 1
                continue

            # Numeric grounding, using the checker built and eval'd for the
            # two-lane work (100% recall on injected fabricated figures).
            # Rewriting a headline is an invitation to invent a specific: the
            # first dry run turned "Until Next Year" into "to January 31st",
            # which may or may not be in the bill. Matching is by value, not
            # substring, so "150" cannot be excused by a ZIP code in the text.
            bad_numbers = ungrounded_numbers(new, _headline_source(bill))
            if bad_numbers:
                log.warning("[%d/%d] %s — headline asserts figures absent from "
                            "the bill %s, not saving: %s",
                            i, len(pending), bill.bill_number,
                            [raw for raw, _ in bad_numbers], new)
                skipped += 1
                continue

            log.info("[%d/%d] %s [%s]\n    old: %s\n    new: %s",
                     i, len(pending), bill.bill_number, bill.status, old, new)

            checkpoint[bill.id] = {
                "bill_number": bill.bill_number,
                "status": bill.status,
                "old": old,
                "new": new,
                "at": datetime.now(timezone.utc).isoformat(),
                "model": args.model,
            }
            if args.apply:
                bill.headline = new
                db.commit()
                save_checkpoint(checkpoint)
            done += 1
    except KeyboardInterrupt:
        log.warning("Interrupted — progress is checkpointed.")
    finally:
        if args.apply:
            save_checkpoint(checkpoint)
        else:
            db.rollback()
        # Hand the VRAM back immediately rather than waiting out keep_alive.
        try:
            provider._unload()  # type: ignore[attr-defined]
        except Exception:
            pass

        s = VramGuard.sample()
        log.info(
            "%s: %d rewritten, %d skipped, %d failed. Peak VRAM %dMB%s.",
            "Applied" if args.apply else "Dry run",
            done, skipped, failed, guard.peak_used_mb,
            f" (now {s[0]}MB of {s[1]}MB)" if s else "",
        )
        if args.apply and done:
            log.info("Checkpoint: %s  (--revert restores the previous text)",
                     CHECKPOINT)
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
