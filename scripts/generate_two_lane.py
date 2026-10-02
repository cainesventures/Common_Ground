"""Generate a two-lane view of a bill: the case for, and the case against.

Replaces the 17-persona treatment for active bills. The reasoning, from the
persona evaluation work:

  - The argument generation was the part that worked. In the hybrid eval the
    persona-free steelman and counter-argument took civil_liberties from 4/10 to
    9/10 on surveillance bills.
  - Assigning those arguments to a labelled political persona, with a
    support/oppose badge, was the part that did not. The best measured stance
    accuracy on clear-cut bills was 69%, and the failures are the visible kind:
    a conservative columnist calling a tax cut a giveaway to real estate.
  - Nobody was reading them anyway. Over 120 days, 45 people viewed bills and
    one person opened a perspective, three times.

Three calls per bill, all persona-free. A triage step first, because forcing a
case for and against guarantees a case exists: that is how the earlier pipeline
ended up arguing passionately about a kerbside parking rule.

Usage:
    python scripts/generate_two_lane.py --sample 20      # print for review
    python scripts/generate_two_lane.py --bill 260466    # one bill
"""

import argparse
import os
import random
import re
import sqlite3
import sys
import textwrap
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB = "common_ground_test.db"

TRIAGE_SYSTEM = (
    "You triage municipal bills. Answer PROCEDURAL if the bill is routine "
    "housekeeping with no real policy stake -- a zoning map change, a kerbside "
    "parking or traffic rule, a street or park renaming, a lease, an "
    "encroachment permit. Answer SUBSTANTIVE if it changes a tax, creates an "
    "obligation or prohibition on people or businesses, spends or moves real "
    "money, or expands a government power. Answer with exactly one word."
)

INSIGHTS_SYSTEM = (
    "You brief legislators on municipal bills. You have no opinions. List the "
    "2-4 substantive things this bill actually does: what changes, for whom, and "
    "any money, powers, obligations or restrictions involved. Be concrete and "
    "factual. No evaluation."
)

FOR_SYSTEM = (
    "You write the case IN FAVOUR of a municipal bill for a civic reference "
    "site, so a reader can weigh it themselves. Make the strongest honest "
    "argument, whatever your own view.\n\n"
    "Ground every claim in what the bill actually does. Do not invent dollar "
    "figures, neighbourhoods, statistics or consequences that are not in the "
    "material. Name who benefits and how.\n\n"
    "Two or three sentences, plain language, no hedging, no 'proponents argue'. "
    "Write the argument, do not describe it."
)

AGAINST_SYSTEM = (
    "You write the case AGAINST a municipal bill for a civic reference site, so "
    "a reader can weigh it themselves. Make the strongest honest argument, "
    "whatever your own view.\n\n"
    "Ground every claim in what the bill actually does -- costs, who bears them, "
    "who loses, powers it hands over, enforcement burden, precedent it sets. Do "
    "not invent dollar figures, neighbourhoods, statistics or consequences that "
    "are not in the material.\n\n"
    "Two or three sentences, plain language, no hedging, no 'critics say'. Write "
    "the argument, do not describe it."
)


def clean(text: str, limit: int = 900) -> str:
    """Strip the model's preamble and never cut a sentence in half.

    Three of 22 blocks opened with "Here is the case AGAINST Bill 260514:" and
    four were sliced mid-word by a hard character cap, which reads as broken
    rather than brief.
    """
    t = (text or "").strip()
    t = re.sub(r"^\s*(here is|below is|the following is)[^:\n]{0,80}:\s*", "", t, flags=re.I)
    t = re.sub(r"^\s*case\s+(for|against)[^:\n]{0,60}:\s*", "", t, flags=re.I)
    t = t.strip()
    if len(t) <= limit:
        return t
    cut = t[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return (cut[:end + 1] if end > limit // 2 else cut.rstrip()).strip()


def bill_facts(r) -> str:
    return (
        f"BILL NUMBER: {r['bill_number']}\n"
        f"TITLE: {(r['title'] or '')[:400]}\n"
        f"SPONSOR(S): {r['sponsor'] or 'Unknown'}\n"
        f"STATUS: {r['status']}\n"
        f"SUMMARY: {(r['summary'] or '')[:800]}\n"
        f"FULL TEXT:\n{(r['full_text'] or r['description'] or r['title'] or '')[:2500]}"
    )


def two_lane(provider, r) -> dict:
    """Returns {procedural, insights, case_for, case_against}."""
    facts = bill_facts(r)

    triage = provider.complete(system_prompt=TRIAGE_SYSTEM, user_prompt=facts)
    if "procedural" in triage.lower()[:40]:
        return {"procedural": True, "insights": None,
                "case_for": None, "case_against": None}

    insights = provider.complete(
        system_prompt=INSIGHTS_SYSTEM, user_prompt=facts).strip()[:800]
    grounded = f"Bill {r['bill_number']}.\nWhat it does:\n{insights}"

    return {
        "procedural": False,
        "insights": insights,
        "case_for": clean(provider.complete(
            system_prompt=FOR_SYSTEM, user_prompt=grounded)),
        "case_against": clean(provider.complete(
            system_prompt=AGAINST_SYSTEM, user_prompt=grounded)),
    }


def pick_bills(n, bill_number=None):
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    if bill_number:
        rows = conn.execute(
            "select * from legislation where bill_number = ?", (bill_number,)).fetchall()
    else:
        # Active bills only -- these are the ones that would get the treatment.
        rows = conn.execute(
            "select * from legislation where status in ('introduced','in_committee') "
            "and summary is not null and length(summary) > 80").fetchall()
        random.Random(11).shuffle(rows)
        rows = rows[:n]
    conn.close()
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=20)
    ap.add_argument("--bill", default=None)
    args = ap.parse_args()

    from app.services.ai_provider import get_ai_provider
    provider = get_ai_provider()
    rows = pick_bills(args.sample, args.bill)

    wrap = lambda s, i="    ": textwrap.fill(s, 96, initial_indent=i, subsequent_indent=i)
    t0 = time.time()
    procedural = 0
    for i, r in enumerate(rows, 1):
        out = two_lane(provider, r)
        print("=" * 100)
        print(f"[{i}/{len(rows)}] BILL {r['bill_number']}  ({r['status']})")
        print(wrap((r["summary"] or "")[:300], "    "))
        print()
        if out["procedural"]:
            procedural += 1
            print("    -- PROCEDURAL: no case presented --")
            print()
            continue
        print("  CASE FOR")
        print(wrap(out["case_for"]))
        print()
        print("  CASE AGAINST")
        print(wrap(out["case_against"]))
        print()
    print("=" * 100)
    print(f"{len(rows)} bills in {(time.time()-t0)/60:.1f} min "
          f"({procedural} judged procedural, {len(rows)-procedural} argued)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
