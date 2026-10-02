"""Measure the hallucination rate of the two-lane generator, before and after the checks.

Built for the same reason as `scripts/eval_personas.py`: the persona work went
wrong twice by declaring a prompt fixed on a handful of hand-read samples. A
prompt that says "do not invent dollar figures" was already in place when the
generator claimed bill 260514 "saves 150 units of affordable housing", so
reading output and feeling reassured is not evidence. Nothing from this
pipeline goes near the frontend until the numbers below exist.

Two different things are measured, and they must not be confused:

  RATE -- how often the *generator* hallucinates, measured mechanically. The
  same sample of bills is generated twice, once with the checks off and once
  with them on, and every block of text is scored for numbers that are not in
  the bill. The "off" run is the problem's size. The "on" run is what would
  ship, plus what it costs: regenerations, and bills dropped for having no
  grounded case.

  DETECTORS -- whether the checks themselves work, measured on text whose
  correct verdict is known in advance. Grounded insights are mutated in ways
  that make them definitely false (a figure replaced with a different figure, a
  restriction rewritten as a permission, the burden moved to a different
  party), and the checks are scored on how many mutations they catch (recall)
  and how often they fire on the unmutated original (false positives).

  The number check needs the second measurement less than the contradiction
  check does -- numeric set membership is not a judgement call -- but the
  contradiction check is a model, and a model used as a detector needs its own
  error rate reported, or it is just another plausible-sounding idea.

Sample size: --sample 20 runs in about three minutes and is too noisy to
compare prompts with. Back-to-back runs of the identical code put the
checks-off rate at 15% and then 7%, and moved the triage count between 6 and 9
procedural out of 20, because nothing here is seeded at the model. Use 60 or
more for any number that is going to be written down or compared against a
later run; 20 is for seeing that the pipeline works.

Usage:
    python scripts/eval_two_lane.py --stage known        # the 2 confirmed failures
    python scripts/eval_two_lane.py --stage detectors    # recall / false positives
    python scripts/eval_two_lane.py --stage rate --sample 20
    python scripts/eval_two_lane.py --stage all --sample 20
"""

import argparse
import os
import random
import re
import sqlite3
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from generate_two_lane import (  # noqa: E402
    ATTEMPTS, INSIGHTS_SYSTEM, bill_facts, clean, grounding_source, two_lane)
from two_lane_checks import (  # noqa: E402
    contradiction_check, direction_conflicts, source_values,
    strip_list_markers, ungrounded_numbers)

DB = "common_ground_test.db"
SEED = 20261002  # fixed, so a prompt change is compared on identical bills

# The two failures that stopped this shipping. They are checked by name, as a
# regression test, and are NOT what the rate is measured on -- a rate measured
# on the two cases the checks were built from would mean nothing.
CONFIRMED = {
    "260514": "This bill saves 150 units of affordable housing in Mantua by "
              "preserving the development's approvals.",
    "260710": "This bill helps small businesses by allowing businesses to stay "
              "open from 11 p.m. to 6 a.m.",
}


def bills(n, seed=SEED):
    """Active bills with a usable summary -- the ones that would get the treatment."""
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "select * from legislation where status in ('introduced','in_committee') "
        "and summary is not null and length(summary) > 80").fetchall()
    conn.close()
    random.Random(seed).shuffle(rows)
    return rows[:n]


# ── Stage: the confirmed failures ────────────────────────────────────────────

def stage_known(provider):
    """Do the checks catch the two cases that are known to be wrong?

    A floor, not a score. If this ever fails, nothing below it is worth reading.
    """
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    print("confirmed failures (regression):")
    passed = 0
    for bn, text in CONFIRMED.items():
        r = conn.execute("select * from legislation where bill_number = ?",
                         (bn,)).fetchone()
        if r is None:
            print(f"   {bn}: NOT IN DB -- skipped")
            continue
        source = grounding_source(r)
        nums = ungrounded_numbers(text, source)
        direction = direction_conflicts(text, source)
        verdicts = contradiction_check(provider, text, source)
        caught = bool(nums or direction or verdicts["contradicted"])
        passed += caught
        by = []
        if nums:
            by.append(f"numbers {[n[0] for n in nums]}")
        if direction:
            by.append(f"direction {direction}")
        if verdicts["contradicted"]:
            by.append("contradiction check")
        print(f"   {bn}: {'CAUGHT' if caught else 'MISSED'}"
              f"{'  by ' + ', '.join(by) if by else ''}")
    conn.close()
    print(f"   {passed}/{len(CONFIRMED)} caught")
    return passed == len(CONFIRMED)


# ── Stage: detector recall and false positives ───────────────────────────────

# Each mutator turns a true claim into a definitely false one, mechanically, so
# the correct verdict is known without anyone reading it. Applied to insights
# that have already passed the checks, so the only difference between the clean
# and mutated text is the injected error.
def mutate_number(text, source=""):
    """Replace the first figure with a different, equally plausible figure.

    This is 260514's failure exactly: a number that reads naturally and is not
    in the bill.

    The replacement is checked against the source before it is used. A first
    version multiplied the figure and landed, twice in seventeen bills, on a
    number that was already somewhere in the full text -- a date, a code
    section -- so the detector was correctly saying "that number is in the
    bill" and the recall figure was measuring the mutator's carelessness at
    12%. An injected error that is not actually an error cannot be scored.
    """
    # Mutate the text the checks will actually see. Line enumerators are
    # stripped before any number is extracted, so an injected error planted in
    # "1." is removed before it can be detected -- which showed up as number
    # recall of 89% when the five misses were all mutated bullet numbers, not
    # mutated facts.
    text = strip_list_markers(text)
    m = re.search(r"(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?![\d.])", text)
    if not m:
        return None
    original = int(m.group(1).replace(",", ""))
    present = source_values(source)
    for candidate in (original * 3 + 7, original * 7 + 13, original + 541,
                      original * 11 + 97):
        if candidate != original and float(candidate) not in present:
            return text[:m.start(1)] + f"{candidate:,}" + text[m.end(1):]
    return None


# Each substitution has to leave grammatical English behind. An earlier version
# turned "requires businesses to close" into "exempts businesses from
# businesses to close", and a detector flagging that is reacting to the
# garbling, not to the contradiction -- which would flatter the recall number.
_POLARITY_SUBS = [
    (r"\bmust\s+close\b", "may stay open"),
    (r"\bshall\s+not\b", "shall"),
    (r"\bprohibits\b", "permits"),
    (r"\bprohibit\b", "permit"),
    (r"\brequires\b", "does not require"),
    (r"\brequire\b", "not require"),
    (r"\brestricts\b", "expands"),
    (r"\bbans\b", "authorises"),
    (r"\bincreases\b", "reduces"),
    (r"\bimposes\b", "removes"),
    (r"\bextends\b", "terminates"),
    (r"\bpreserves\b", "revokes"),
    (r"\ba\s+fine\b", "a rebate"),
]


def mutate_polarity(text, source=""):
    """Reverse the direction of the bill's first directional verb.

    260710's failure: a restriction described as a permission. Only the first
    match is flipped, so the rest of the block still reads coherently and the
    detector has to notice the conflict rather than the register.
    """
    for pattern, replacement in _POLARITY_SUBS:
        if re.search(pattern, text, re.I):
            return re.sub(pattern, replacement, text, count=1, flags=re.I)
    return None


_ACTOR_SUBS = [
    (r"\bbusinesses\b", "the City"),
    (r"\blandlords?\b", "tenants"),
    (r"\btenants?\b", "landlords"),
    (r"\bthe City\b", "private developers"),
    (r"\bdevelopers?\b", "residents"),
    (r"\bresidents\b", "city agencies"),
    (r"\bemployers?\b", "employees"),
]


def mutate_actor(text, source=""):
    """Move the obligation or benefit onto a different party."""
    for pattern, replacement in _ACTOR_SUBS:
        if re.search(pattern, text):
            return re.sub(pattern, replacement, text, count=1)
    return None


MUTATORS = {"number": mutate_number, "polarity": mutate_polarity,
            "actor": mutate_actor}


def _detect(provider, text, source):
    """What the full check stack says about one block. True = flagged."""
    if ungrounded_numbers(text, source):
        return True, "numbers"
    if direction_conflicts(text, source):
        return True, "direction"
    if contradiction_check(provider, text, source)["contradicted"]:
        return True, "contradiction"
    return False, None


def stage_detectors(provider, rows, concurrency):
    """Recall per mutator, and the false-positive rate on unmutated insights."""
    print(f"\ndetectors: generating grounded insights for {len(rows)} bills ...",
          flush=True)

    def insights_for(r):
        # Same call the generator makes, cleaning included -- an eval that
        # measures a slightly different pipeline measures nothing.
        text = clean(provider.complete(system_prompt=INSIGHTS_SYSTEM,
                                       user_prompt=bill_facts(r)), limit=800)
        return r, text

    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        pairs = list(ex.map(insights_for, rows))

    # Only insights that pass the checks as written can serve as a clean
    # baseline: mutating text that is already wrong measures nothing.
    jobs = []
    clean_pairs = []
    for r, text in pairs:
        source = grounding_source(r)
        if ungrounded_numbers(text, source) or direction_conflicts(text, source):
            continue
        clean_pairs.append((r, text, source))
        jobs.append(("clean", r, text, source))
        for name, fn in MUTATORS.items():
            mutated = fn(text, source)
            if mutated and mutated != text:
                jobs.append((name, r, mutated, source))

    def one(job):
        kind, r, text, source = job
        flagged, by = _detect(provider, text, source)
        return kind, r["bill_number"], flagged, by

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        results = list(ex.map(one, jobs))
    elapsed = time.time() - t0

    tally = defaultdict(lambda: [0, 0])  # n, flagged
    by_detector = defaultdict(int)
    for kind, _bn, flagged, by in results:
        tally[kind][0] += 1
        tally[kind][1] += flagged
        if flagged and kind != "clean":
            by_detector[f"{kind}/{by}"] += 1

    print(f"   {len(clean_pairs)} usable insights, {len(jobs)} checks, "
          f"{elapsed/60:.1f} min")
    n_clean, flagged_clean = tally["clean"]
    fpr = flagged_clean / n_clean * 100 if n_clean else 0
    print(f"\n   false positives on unmutated insights: "
          f"{flagged_clean}/{n_clean} = {fpr:.0f}%")
    print(f"\n   {'injected error':14} {'n':>4} {'caught':>7} {'recall':>8}")
    print("   " + "-" * 36)
    for name in MUTATORS:
        n, caught = tally[name]
        rec = caught / n * 100 if n else 0
        print(f"   {name:14} {n:>4} {caught:>7} {rec:>7.0f}%")
    if by_detector:
        print("\n   which check caught it:")
        for key, count in sorted(by_detector.items()):
            print(f"      {key:26} {count}")
    return {"fpr": fpr, "tally": dict(tally)}


# ── Stage: the generator's own rate, with the checks off and on ──────────────

def _score_blocks(out, source):
    """Ungrounded numbers and direction conflicts per generated block."""
    per_block = {}
    for key in ("insights", "case_for", "case_against"):
        text = out.get(key)
        if not text:
            continue
        per_block[key] = {
            "numbers": ungrounded_numbers(text, source),
            "direction": direction_conflicts(text, source),
        }
    return per_block


def stage_rate(provider, rows, concurrency):
    """Generate the same bills with checks off, then on, and compare."""
    def run(checks):
        def one(r):
            try:
                out = two_lane(provider, r, checks=checks)
            except Exception as e:
                return r, None, f"{type(e).__name__}: {e}"
            return r, out, None
        t0 = time.time()
        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            results = list(ex.map(one, rows))
        return results, time.time() - t0

    report = {}
    for checks in (False, True):
        label = "checks ON " if checks else "checks OFF"
        print(f"\n{label}: generating {len(rows)} bills ...", flush=True)
        results, elapsed = run(checks)

        argued = procedural = dropped = errors = 0
        bad_bills = 0
        blocks = ungrounded_blocks = 0
        number_faults = direction_faults = 0
        extra_attempts = 0
        examples = []
        for r, out, err in results:
            if err:
                errors += 1
                continue
            if out["procedural"]:
                procedural += 1
                continue
            extra_attempts += sum(out["attempts"].values()) - len(out["attempts"])
            if out["dropped"]:
                dropped += 1
                continue
            argued += 1
            per_block = _score_blocks(out, grounding_source(r))
            dirty = False
            for key, faults in per_block.items():
                blocks += 1
                if faults["numbers"] or faults["direction"]:
                    ungrounded_blocks += 1
                    dirty = True
                    number_faults += len(faults["numbers"])
                    direction_faults += len(faults["direction"])
                    if len(examples) < 8:
                        examples.append(
                            (r["bill_number"], key,
                             [n[0] for n in faults["numbers"]] + faults["direction"]))
            bad_bills += dirty

        rate_bills = bad_bills / argued * 100 if argued else 0
        rate_blocks = ungrounded_blocks / blocks * 100 if blocks else 0
        print(f"   {elapsed/60:.1f} min   {procedural} procedural, {argued} argued, "
              f"{dropped} dropped, {errors} errors")
        print(f"   HALLUCINATION RATE: {bad_bills}/{argued} argued bills "
              f"= {rate_bills:.0f}%   ({ungrounded_blocks}/{blocks} blocks "
              f"= {rate_blocks:.0f}%)")
        print(f"   faults: {number_faults} ungrounded numbers, "
              f"{direction_faults} direction conflicts, "
              f"{extra_attempts} regenerations")
        for bn, key, faults in examples:
            print(f"      {bn} {key}: {faults}")
        report["on" if checks else "off"] = {
            "argued": argued, "dropped": dropped, "procedural": procedural,
            "bad_bills": bad_bills, "rate_bills": rate_bills,
            "rate_blocks": rate_blocks, "regenerations": extra_attempts,
            "errors": errors,
        }

    off, on = report["off"], report["on"]
    print("\n" + "=" * 72)
    print(f"{'':22} {'checks OFF':>12} {'checks ON':>12}")
    print("-" * 72)
    print(f"{'bills argued':22} {off['argued']:>12} {on['argued']:>12}")
    print(f"{'bills dropped':22} {off['dropped']:>12} {on['dropped']:>12}")
    print(f"{'hallucinating bills':22} {off['rate_bills']:>11.0f}% "
          f"{on['rate_bills']:>11.0f}%")
    print(f"{'hallucinating blocks':22} {off['rate_blocks']:>11.0f}% "
          f"{on['rate_blocks']:>11.0f}%")
    print(f"{'regenerations':22} {off['regenerations']:>12} {on['regenerations']:>12}")
    total = on["argued"] + on["dropped"]
    if total:
        print(f"\ncost of the guard: {on['dropped']}/{total} substantive bills "
              f"= {on['dropped']/total*100:.0f}% show no case rather than a "
              f"made-up one")
    print(f"\nShipping gate: hallucination rate with checks ON must be 0% on "
          f"numbers,\nwhich is mechanical, and the drop rate must be small "
          f"enough to be worth it.\nAttempts per stage: {ATTEMPTS}.")
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["known", "detectors", "rate", "all"],
                    default="all")
    ap.add_argument("--sample", type=int, default=20)
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args()

    from app.services.ai_provider import get_ai_provider
    provider = get_ai_provider()
    rows = bills(args.sample)
    print(f"eval set: {len(rows)} active bills, seed {SEED}")

    if args.stage in ("known", "all"):
        if not stage_known(provider) and args.stage == "known":
            return 1
    if args.stage in ("detectors", "all"):
        stage_detectors(provider, rows, args.concurrency)
    if args.stage in ("rate", "all"):
        stage_rate(provider, rows, args.concurrency)
    return 0


if __name__ == "__main__":
    sys.exit(main())
