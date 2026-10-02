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

Every stage is then checked mechanically before it is kept -- see
`scripts/two_lane_checks.py` for what is checked and why. Ungrounded output is
regenerated, and a bill that cannot produce grounded output in three attempts
is dropped rather than shipped with a reservation attached. The measured rate
at which that happens is `scripts/eval_two_lane.py`.

Usage:
    python scripts/generate_two_lane.py --sample 20      # print for review
    python scripts/generate_two_lane.py --bill 260466    # one bill
    python scripts/generate_two_lane.py --sample 20 --no-checks   # raw output
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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from two_lane_checks import (  # noqa: E402  (after the sys.path fix-up)
    contradiction_check, direction_conflicts, ungrounded_numbers)

DB = "common_ground_test.db"

TRIAGE_SYSTEM = (
    "You triage municipal bills. Answer PROCEDURAL if the bill is routine "
    "housekeeping with no real policy stake -- a zoning map change, a kerbside "
    "parking or traffic rule, a street or park renaming, a lease, an "
    "encroachment permit. Answer SUBSTANTIVE if it changes a tax, creates an "
    "obligation or prohibition on people or businesses, spends or moves real "
    "money, or expands a government power. Answer with exactly one word."
)

# "2-4" used to appear here as a digit range, and the model opened with "Here
# are the 2-4 substantive things this bill actually does:" often enough that
# the grounding check kept rejecting insights for asserting the number 4 -- a
# figure that came from the instruction, not the bill. Written out, the limit
# survives the echo without putting a digit in the text.
INSIGHTS_SYSTEM = (
    "You brief legislators on municipal bills. You have no opinions. List the "
    "substantive things this bill actually does, at most four of them: what "
    "changes, for whom, and any money, powers, obligations or restrictions "
    "involved. Be concrete and factual. No evaluation. Do not preface the list."
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

    "here are" was added after the grounding check started rejecting insights
    for asserting the number 4. The model was opening with "Here are the 2-4
    substantive things this bill actually does:" -- echoing the instruction it
    had just been given, so the only ungrounded figure in the text came from
    the prompt. Insights are run through this too now, which they were not
    before: a preamble quoting the brief back is not something a reader should
    see either.
    """
    t = (text or "").strip()
    # The optional lead-in clause is there because the echo also arrives as
    # "Based on the bill text, here are 3-4 substantive things ...:".
    t = re.sub(r"^\s*(?:[^.:\n]{0,50},\s*)?"
               r"(here is|here are|below is|below are|these are|"
               r"the following is|the following are)[^:\n]{0,80}:\s*",
               "", t, flags=re.I)
    t = re.sub(r"^\s*case\s+(for|against)[^:\n]{0,60}:\s*", "", t, flags=re.I)
    t = t.strip()
    if len(t) <= limit:
        return t
    cut = t[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return (cut[:end + 1] if end > limit // 2 else cut.rstrip()).strip()


def grounding_source(r) -> str:
    """Everything known about the bill, for the grounding checks to match against.

    Deliberately wider than `bill_facts`, which the model sees. A number that
    sits 3,000 characters into the full text cannot have been copied from the
    prompt, but it is still a real number in a real bill, and rejecting the
    summary's own figures because the prompt window clipped them would reject
    grounded bills. The check is "is this number in the bill", not "is it in
    the prompt".
    """
    return "\n".join(filter(None, (
        r["bill_number"], r["title"], r["sponsor"], r["summary"],
        r["description"], r["full_text"],
    )))


def bill_facts(r) -> str:
    return (
        f"BILL NUMBER: {r['bill_number']}\n"
        f"TITLE: {(r['title'] or '')[:400]}\n"
        f"SPONSOR(S): {r['sponsor'] or 'Unknown'}\n"
        f"STATUS: {r['status']}\n"
        f"SUMMARY: {(r['summary'] or '')[:800]}\n"
        f"FULL TEXT:\n{(r['full_text'] or r['description'] or r['title'] or '')[:2500]}"
    )


ATTEMPTS = 3  # one generation plus two retries; beyond that the bill is dropped


def _faults(text: str, source: str, label: str):
    """Mechanical faults in one block of generated text, as readable strings."""
    faults = []
    for raw, value in ungrounded_numbers(text, source):
        faults.append(f"{label}: ungrounded number {raw!r} ({value:g})")
    for name in direction_conflicts(text, source):
        faults.append(f"{label}: direction conflict ({name})")
    return faults


def _generate_insights(provider, r, source, facts, checks, attempts):
    """Insights, regenerated until grounded and not self-contradicting.

    This stage is checked hardest because it is upstream of both arguments:
    260710's inversion was already present here, in "the new hours will be
    between 11 p.m. and 6 a.m." read as permission, and both lanes inherited
    it. A number or a direction that gets past this point gets past everything.
    """
    rejections = []
    for attempt in range(1, attempts + 1):
        insights = clean(provider.complete(
            system_prompt=INSIGHTS_SYSTEM, user_prompt=facts), limit=800)
        if not checks:
            return insights, rejections, attempt
        faults = _faults(insights, source, "insights")
        verdicts = contradiction_check(provider, insights, source)
        faults += [f"insights: contradicted -- {c[:90]}"
                   for c in verdicts["contradicted"]]
        if not faults:
            return insights, rejections, attempt
        rejections += [f"attempt {attempt}: {f}" for f in faults]
    return None, rejections, attempts


def _generate_case(provider, system, grounded, source, label, checks, attempts):
    """One lane, regenerated until every number in it is in the bill."""
    rejections = []
    for attempt in range(1, attempts + 1):
        text = clean(provider.complete(system_prompt=system, user_prompt=grounded))
        if not checks:
            return text, rejections, attempt
        faults = _faults(text, source, label)
        if not faults:
            return text, rejections, attempt
        rejections += [f"attempt {attempt}: {f}" for f in faults]
    return None, rejections, attempts


def two_lane(provider, r, checks: bool = True, attempts: int = ATTEMPTS) -> dict:
    """Returns {procedural, insights, case_for, case_against, dropped, ...}.

    `dropped` is set when the bill is substantive but could not be argued in
    grounded terms within `attempts` tries. A dropped bill shows no case at
    all: a half-checked argument with a caveat under it is worse than silence
    on a site whose whole claim is that it does not make things up.
    """
    facts = bill_facts(r)
    source = grounding_source(r)
    out = {"procedural": False, "insights": None, "case_for": None,
           "case_against": None, "dropped": None, "rejections": [],
           "attempts": {}}

    triage = provider.complete(system_prompt=TRIAGE_SYSTEM, user_prompt=facts)
    if "procedural" in triage.lower()[:40]:
        out["procedural"] = True
        return out

    insights, rej, n = _generate_insights(provider, r, source, facts, checks, attempts)
    out["rejections"] += rej
    out["attempts"]["insights"] = n
    if insights is None:
        out["dropped"] = "insights_ungrounded"
        return out
    out["insights"] = insights

    # The arguments may use anything in the bill or in the verified insights.
    # Insights are a legitimate grounding source only because they have just
    # been checked against the bill themselves.
    arg_source = source + "\n" + insights
    grounded = f"Bill {r['bill_number']}.\nWhat it does:\n{insights}"

    for key, system, label in (("case_for", FOR_SYSTEM, "case_for"),
                               ("case_against", AGAINST_SYSTEM, "case_against")):
        text, rej, n = _generate_case(
            provider, system, grounded, arg_source, label, checks, attempts)
        out["rejections"] += rej
        out["attempts"][key] = n
        if text is None:
            out["dropped"] = f"{key}_ungrounded"
            return out
        out[key] = text

    return out


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
    ap.add_argument("--no-checks", action="store_true",
                    help="generate without the grounding checks, as it was before")
    args = ap.parse_args()

    from app.services.ai_provider import get_ai_provider
    provider = get_ai_provider()
    rows = pick_bills(args.sample, args.bill)

    wrap = lambda s, i="    ": textwrap.fill(s, 96, initial_indent=i, subsequent_indent=i)
    t0 = time.time()
    procedural = dropped = argued = regenerated = 0
    for i, r in enumerate(rows, 1):
        out = two_lane(provider, r, checks=not args.no_checks)
        print("=" * 100)
        print(f"[{i}/{len(rows)}] BILL {r['bill_number']}  ({r['status']})")
        print(wrap((r["summary"] or "")[:300], "    "))
        print()
        if out["rejections"]:
            regenerated += 1
            print("  REJECTED AND REGENERATED")
            for line in out["rejections"]:
                print(f"    {line}")
            print()
        if out["procedural"]:
            procedural += 1
            print("    -- PROCEDURAL: no case presented --")
            print()
            continue
        if out["dropped"]:
            dropped += 1
            print(f"    -- DROPPED ({out['dropped']}): no grounded case after "
                  f"{ATTEMPTS} attempts --")
            print()
            continue
        argued += 1
        print("  CASE FOR")
        print(wrap(out["case_for"]))
        print()
        print("  CASE AGAINST")
        print(wrap(out["case_against"]))
        print()
    print("=" * 100)
    print(f"{len(rows)} bills in {(time.time()-t0)/60:.1f} min  "
          f"{procedural} procedural, {argued} argued, {dropped} dropped")
    print(f"{regenerated} bills needed at least one regeneration"
          + ("  (checks off)" if args.no_checks else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
