"""Measure whether a perspective persona takes the stance its own values imply.

Built after a prompt change that looked fixed on three hand-picked calls and
turned out, at n=63, to have inverted one persona and left two untouched. The
point of this file is that no persona change ships again without a number
attached.

How it works. Bills are bucketed into categories where the correct stance is not
a matter of taste -- a tax cut, a new tax, a routine zoning map change -- and a
small set of (category, persona) pairs carry an expected stance. A technique is
scored on how often it hits that expectation and, more importantly, how often it
takes the *opposite* stance, which is the failure that reads as incoherent.

Bills whose summary matches more than one category are dropped rather than
guessed at: "increases the school district tax and reduces the city tax" is a
real summary and there is no single right answer for it.

Usage:
    python scripts/eval_personas.py --build          # show the eval set
    python scripts/eval_personas.py --technique baseline
    python scripts/eval_personas.py --technique two_stage --limit 40
    python scripts/eval_personas.py --compare        # run every technique
"""

import argparse
import json
import os
import random
import re
import sqlite3
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

DB = "common_ground_test.db"
SEED = 20260928  # fixed, so every technique sees exactly the same bills

# Words that make a bill's direction ambiguous or reverse it. "Ends real estate
# tax abatements" matches the tax_cut pattern but is a tax rise; "modifies
# abatements" could be either. Both are dropped rather than guessed at.
AMBIGUOUS = re.compile(
    r"\b(end|ends|ending|eliminat\w*|repeal\w*|phase[sd]?\s+out|sunset\w*"
    r"|modif\w*|revis\w*|amend\w*\s+the\s+rate|both)\b", re.I)

# Categories are chosen to cover what is actually PENDING, not what is easy to
# pattern-match. The first version of this file matched only 8.5% of active
# bills -- it had ten routine_zoning bills in it when zoning map changes are 0%
# of the active set, because they get enacted too fast to sit pending -- so half
# the eval measured a case that barely occurs and the rankings reflected that.
CATEGORY_PATTERNS = {
    # The largest real category: a new obligation or prohibition on someone.
    "new_mandate": r"\b(requir\w+|mandat\w+|prohibit\w+|restrict\w+|make[s]?\s+it\s+illegal"
                   r"|ban\s+(the\s+)?\w+|forbid\w*)\b",
    "tax_cut": r"(reduc|lower|decreas)\w*\s+(the\s+)?\w*\s*tax|tax\s+(cut|reduction)"
               r"|exempt\w*\s+from\s+\w*\s*tax|tax\s+(credit|abatement)"
               r"|(increas|expand|broaden)\w*\s+the\s+exemption",
    "tax_increase": r"(increas|rais)\w*\s+(the\s+)?\w*\s*tax|new tax|impos\w*\s+a\s+tax",
    # Matching the verb is hopeless here: a kerbside rule is written as
    # "prohibits truck parking on Arrott Street" and reads as a prohibition.
    # What makes it routine is the subject -- parking or traffic on a named
    # street -- so that is what is matched.
    "routine": r"amend\w*\s+the\s+philadelphia\s+zoning\s+maps"
               r"|(parking|stopping|loading)\W{0,4}(regulation|zone)|tow-?away"
               r"|(parking|stopping|loading|traffic)\b[^.]{0,60}\b"
               r"(street|avenue|boulevard|road|lane|drive|place)\b"
               r"|no[\W]{0,3}parking|renam\w+|encroachment|sidewalk\s+caf|stop\s+signs?",
    "surveillance": r"camera|surveillance|license plate|automated enforcement",
    "env_protect": r"\btree\b|green\s+(roof|space)|emission|air quality|stormwater",
}

# Only pairs a reasonable person would agree on. Deliberately sparse: a wrong
# expectation here would make a good technique look bad.
EXPECTED = {
    # A new obligation or prohibition is the clearest case for the persona whose
    # stated position is being "allergic to anything that expands state power
    # over people's lives or wallets". Conservative is asserted too, on the
    # strength of "quick to call out regulatory overreach", but it is the weaker
    # of the two: a conservative can favour a mandate on crime or enforcement.
    "new_mandate": {
        "libertarian": "oppose",
        "conservative": "oppose",
    },
    "tax_cut": {
        "conservative": "support",
        "libertarian": "support",
        "socialist": "oppose",
    },
    "tax_increase": {
        "conservative": "oppose",
        "libertarian": "oppose",
    },
    # Procedural business. A persona reaching for a stance here is inventing one.
    "routine": {
        "conservative": "neutral",
        "libertarian": "neutral",
        "progressive": "neutral",
        "socialist": "neutral",
        "centrist": "neutral",
    },
    "surveillance": {
        "civil_liberties": "oppose",
        "libertarian": "oppose",
    },
    "env_protect": {
        "environmental": "support",
    },
}

# Share of currently-pending bills in each category, measured not assumed.
# Scores are reported both raw and weighted by this, because the raw number
# over-counts whichever category happens to be easiest to sample.
def production_weights():
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = [r[0] for r in conn.execute(
        "select summary from legislation where status in ('introduced','in_committee') "
        "and summary is not null and length(summary) > 60")]
    conn.close()
    compiled = {c: re.compile(p, re.I) for c, p in CATEGORY_PATTERNS.items()}
    counts = defaultdict(int)
    for summary in rows:
        cat = categorise(summary, compiled)
        if cat:
            counts[cat] += 1
    total = sum(counts[c] for c in EXPECTED) or 1
    return {c: counts[c] / total for c in EXPECTED}, counts, len(rows)

OPPOSITE = {"support": "oppose", "oppose": "support"}


def categorise(summary: str, compiled):
    """One category per bill, or None if it is genuinely ambiguous.

    "routine" wins outright when it matches, because procedural bills are full
    of mandate verbs: a no-parking rule reads as "prohibits parking on the east
    side of Fox Street" and would otherwise be scored as a substantive new
    obligation, which is not what it is.
    """
    if compiled["routine"].search(summary):
        return "routine"
    hits = [c for c, rx in compiled.items() if c != "routine" and rx.search(summary)]
    return hits[0] if len(hits) == 1 else None


def build_eval_set(per_category: int = 10):
    """Bills that match exactly one category, sampled deterministically."""
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "select bill_number, title, sponsor, status, summary, full_text, description "
        "from legislation where summary is not null and length(summary) > 60"
    ).fetchall()
    conn.close()

    compiled = {c: re.compile(p, re.I) for c, p in CATEGORY_PATTERNS.items()}
    buckets = defaultdict(list)
    for r in rows:
        summary = r["summary"] or ""
        cat = categorise(summary, compiled)
        if not cat:
            continue
        # Direction words only matter where the expectation depends on direction.
        if cat in ("tax_cut", "tax_increase") and AMBIGUOUS.search(summary):
            continue
        buckets[cat].append(r)

    rng = random.Random(SEED)
    out = []
    for cat in EXPECTED:
        pool = buckets.get(cat, [])
        rng.shuffle(pool)
        for r in pool[:per_category]:
            out.append((cat, r))
    return out


def build_user_prompt(r):
    from app.services.perspectives_service import _USER_PROMPT_TEMPLATE
    return _USER_PROMPT_TEMPLATE.format(
        bill_number=r["bill_number"], title=(r["title"] or "")[:400],
        sponsor=r["sponsor"] or "Unknown", status=r["status"],
        summary=(r["summary"] or "")[:600],
        full_text=(r["full_text"] or r["description"] or r["title"] or "")[:2000],
        city_context="")


def build_facts_prompt(r):
    """Just the bill, with none of the perspective template's instructions.

    build_user_prompt ends with "Return a JSON object with position and
    response", which is right for a perspective and wrong for every neutral
    stage: fed that, the summariser returned a full JSON perspective complete
    with its own stance, so the "persona-free" stages were never persona-free.
    """
    return (
        f"BILL NUMBER: {r['bill_number']}\n"
        f"TITLE: {(r['title'] or '')[:400]}\n"
        f"SPONSOR(S): {r['sponsor'] or 'Unknown'}\n"
        f"STATUS: {r['status']}\n"
        f"SUMMARY: {(r['summary'] or '')[:600]}\n"
        f"FULL TEXT:\n{(r['full_text'] or r['description'] or r['title'] or '')[:2000]}"
    )


def normalize(raw: str) -> str:
    raw = (raw or "").lower()
    if "support" in raw and "oppose" not in raw:
        return "support"
    if "oppose" in raw and "support" not in raw:
        return "oppose"
    return "neutral"


# ── Techniques ───────────────────────────────────────────────────────────────

def technique_baseline(provider, persona, r):
    """What ships today: one call returning position and prose together."""
    from app.services.perspectives_service import PERSPECTIVE_PROMPTS, _extract_json
    raw = provider.complete(system_prompt=PERSPECTIVE_PROMPTS[persona],
                            user_prompt=build_user_prompt(r))
    return normalize(str(_extract_json(raw).get("position", "")))


def technique_two_stage(provider, persona, r):
    """Decide the stance on its own, before any prose exists to rationalise.

    The hypothesis is that asking for persona, stance and 2-3 paragraphs in one
    pass lets the prose lead: the model writes in a critical register because
    that reads as thoughtful, then labels it oppose. Stripped to a single word,
    there is nothing to follow but the values and the bill.
    """
    from app.services.perspectives_service import PERSPECTIVE_PROMPTS
    system = (
        PERSPECTIVE_PROMPTS[persona]
        + "\n\nYou are not writing anything yet. Decide one thing only: does THIS "
          "bill advance what you believe in, work against it, or barely touch it?\n"
          "Most council business is procedural -- a zoning map change, a lease, a "
          "parking regulation -- and on those the honest answer is neutral.\n"
          "Answer with exactly one word: support, oppose, or neutral."
    )
    raw = provider.complete(system_prompt=system, user_prompt=build_user_prompt(r))
    return normalize(raw.strip()[:40])


def technique_facts_first(provider, persona, r):
    """Name what the bill does before judging it.

    Same single call as the baseline, but the model must state the bill's actual
    effect first, so the stance is taken against something concrete rather than
    against the persona's general mood.
    """
    from app.services.perspectives_service import PERSPECTIVE_PROMPTS
    system = (
        PERSPECTIVE_PROMPTS[persona]
        + "\n\nBefore deciding, answer in this exact form:\n"
          "EFFECT: <one plain sentence: what does this bill actually change?>\n"
          "TEST: <does that advance, work against, or barely touch what you believe in?>\n"
          "POSITION: <support, oppose, or neutral>\n"
          "Most council business is procedural; on those the answer is neutral."
    )
    raw = provider.complete(system_prompt=system, user_prompt=build_user_prompt(r))
    m = re.search(r"POSITION:\s*(\w+)", raw, re.I)
    return normalize(m.group(1) if m else raw[-40:])


def technique_effect_then_stance(provider, persona, r):
    """Ground the judgement, then still force a decision.

    two_stage wins on accuracy but inverts more often; facts_first almost never
    inverts but retreats to neutral and loses accuracy. This asks for the bill's
    effect first, like facts_first, then demands the stance follow from the
    persona's own red lines rather than allowing a shrug.
    """
    from app.services.perspectives_service import PERSPECTIVE_PROMPTS
    system = (
        PERSPECTIVE_PROMPTS[persona]
        + "\n\nYou are not writing an article. Work through this in order:\n"
          "EFFECT: one plain sentence - what does this bill actually change?\n"
          "STAKE: name the thing you believe in that this touches, or write NONE "
          "if it genuinely touches nothing you care about.\n"
          "POSITION: if STAKE is NONE, answer neutral. Otherwise answer support "
          "if the effect advances that thing, or oppose if it works against it. "
          "Do not answer neutral once you have named a stake - that is a dodge.\n"
          "Answer in exactly those three lines."
    )
    raw = provider.complete(system_prompt=system, user_prompt=build_user_prompt(r))
    m = re.search(r"POSITION:\s*(\w+)", raw, re.I)
    return normalize(m.group(1) if m else raw[-40:])


def _effect_call(provider, r) -> str:
    """Stage 1, deliberately persona-free.

    Comprehension and judgement are separated here on purpose: asked to read a
    bill *as* a conservative, the model's reading of what the bill does already
    tilts, and every later stage inherits that tilt.
    """
    return provider.complete(
        system_prompt=(
            "You summarise municipal legislation for a reference database. You "
            "have no opinions about policy. State plainly what the bill changes, "
            "in one sentence, with no evaluation of whether it is good or bad."
        ),
        user_prompt=build_facts_prompt(r),
    ).strip()[:400]


def technique_three_stage(provider, persona, r):
    """effect (no persona) -> stance (persona). Two calls, three logical steps."""
    from app.services.perspectives_service import PERSPECTIVE_PROMPTS
    effect = _effect_call(provider, r)
    system = (
        PERSPECTIVE_PROMPTS[persona]
        + "\n\nYou are not writing anything yet. Decide one thing only: does this "
          "bill advance what you believe in, work against it, or barely touch it?\n"
          "Most council business is procedural, and on those the honest answer is "
          "neutral.\nAnswer with exactly one word: support, oppose, or neutral."
    )
    raw = provider.complete(
        system_prompt=system,
        user_prompt=f"Bill {r['bill_number']}.\nWhat it does: {effect}\n\nYour one-word position:",
    )
    return normalize(raw.strip()[:40])


def technique_four_stage(provider, persona, r):
    """effect -> who it affects -> stance. Adds a persona-free interests step.

    Tests whether naming winners and losers before judging helps, or whether it
    is one decomposition too many and the stance drifts from the bill.
    """
    from app.services.perspectives_service import PERSPECTIVE_PROMPTS
    effect = _effect_call(provider, r)
    interests = provider.complete(
        system_prompt=(
            "You analyse municipal legislation neutrally. Given what a bill does, "
            "name in one sentence who gains and who loses from it. If nobody "
            "meaningfully gains or loses, say so."
        ),
        user_prompt=f"Bill {r['bill_number']}.\nWhat it does: {effect}",
    ).strip()[:400]
    system = (
        PERSPECTIVE_PROMPTS[persona]
        + "\n\nYou are not writing anything yet. Decide one thing only: does this "
          "bill advance what you believe in, work against it, or barely touch it?\n"
          "Most council business is procedural, and on those the honest answer is "
          "neutral.\nAnswer with exactly one word: support, oppose, or neutral."
    )
    raw = provider.complete(
        system_prompt=system,
        user_prompt=(f"Bill {r['bill_number']}.\nWhat it does: {effect}\n"
                     f"Who gains and loses: {interests}\n\nYour one-word position:"),
    )
    return normalize(raw.strip()[:40])


def technique_steelman(provider, persona, r):
    """insights -> steelman -> counter-argument -> stance.

    three_stage's first call is one neutral sentence, which is thin enough that
    a persona never sees the angle it cares about: environmental fell to 4/10
    because "changes the zoning designation of a parcel" says nothing about
    trees. Here the bill is read for its substantive provisions, then argued
    both ways with no persona attached, so the persona chooses between two cases
    that already exist rather than inventing one from its own mood.
    """
    from app.services.perspectives_service import PERSPECTIVE_PROMPTS

    insights = provider.complete(
        system_prompt=(
            "You brief legislators on municipal bills. You have no opinions. List "
            "the 2-4 substantive things this bill actually does: what changes, for "
            "whom, and any money, powers, obligations or restrictions involved. "
            "Be concrete and factual. No evaluation."
        ),
        user_prompt=build_facts_prompt(r),
    ).strip()[:700]

    steelman = provider.complete(
        system_prompt=(
            "You make the strongest honest case IN FAVOUR of a municipal bill, "
            "whatever your own view. Two or three sentences. Argue only from what "
            "the bill actually does. If there is genuinely no case to make because "
            "the bill is purely procedural, say exactly: NO REAL CASE."
        ),
        user_prompt=f"Bill {r['bill_number']}.\nWhat it does:\n{insights}",
    ).strip()[:500]

    counter = provider.complete(
        system_prompt=(
            "You make the strongest honest case AGAINST a municipal bill, whatever "
            "your own view. Two or three sentences. Argue only from what the bill "
            "actually does -- costs, risks, who loses, powers it hands over, "
            "precedent it sets. If there is genuinely no case to make because the "
            "bill is purely procedural, say exactly: NO REAL CASE."
        ),
        user_prompt=f"Bill {r['bill_number']}.\nWhat it does:\n{insights}",
    ).strip()[:500]

    system = (
        PERSPECTIVE_PROMPTS[persona]
        + "\n\nYou are not writing anything yet. Both sides of this bill have "
          "already been argued for you. Decide which case is stronger BY YOUR OWN "
          "VALUES -- not which is better written.\n"
          "If both cases say NO REAL CASE, or the bill is procedural and touches "
          "nothing you believe in, answer neutral.\n"
          "Answer with exactly one word: support, oppose, or neutral."
    )
    raw = provider.complete(
        system_prompt=system,
        user_prompt=(f"Bill {r['bill_number']}.\nWhat it does:\n{insights}\n\n"
                     f"Case in favour:\n{steelman}\n\n"
                     f"Case against:\n{counter}\n\nYour one-word position:"),
    )
    return normalize(raw.strip()[:40])


def _triage_is_procedural(provider, r) -> bool:
    """Persona-free: is there anything here to have an opinion about?

    steelman's weakness was that forcing a case for and against guarantees a
    case exists, so a persona took a side on a kerbside parking rule. This lets
    procedural bills leave before any argument is manufactured.
    """
    raw = provider.complete(
        system_prompt=(
            "You triage municipal bills. Answer PROCEDURAL if the bill is routine "
            "housekeeping with no real policy stake -- a zoning map change, a "
            "kerbside parking or traffic rule, a street or park renaming, a lease, "
            "an encroachment permit. Answer SUBSTANTIVE if it changes a tax, "
            "creates an obligation or prohibition on people or businesses, spends "
            "or moves real money, or expands a government power. "
            "Answer with exactly one word."
        ),
        user_prompt=build_facts_prompt(r),
    )
    return "procedural" in raw.lower()[:40]


def _stance_vote(provider, system, user, rounds=3):
    """Majority of several short stance calls.

    The stance call is a single word and cheap, and run-to-run variance on this
    eval is around two points, so a majority is worth more than it costs.
    """
    votes = [normalize(provider.complete(system_prompt=system, user_prompt=user).strip()[:40])
             for _ in range(rounds)]
    return max(set(votes), key=votes.count)


def technique_hybrid(provider, persona, r):
    """triage -> (insights -> steelman -> counter) -> voted stance.

    Combines the two things that worked separately: steelman fixed the personas
    that never saw their own issue, and a neutral exit fixed the personas that
    invented opinions about kerbside parking.
    """
    from app.services.perspectives_service import PERSPECTIVE_PROMPTS

    if _triage_is_procedural(provider, r):
        return "neutral"

    insights = provider.complete(
        system_prompt=(
            "You brief legislators on municipal bills. You have no opinions. List "
            "the 2-4 substantive things this bill actually does: what changes, for "
            "whom, and any money, powers, obligations or restrictions involved. "
            "Be concrete and factual. No evaluation."
        ),
        user_prompt=build_facts_prompt(r),
    ).strip()[:700]

    steelman = provider.complete(
        system_prompt=(
            "You make the strongest honest case IN FAVOUR of a municipal bill, "
            "whatever your own view. Two or three sentences, arguing only from "
            "what the bill actually does."
        ),
        user_prompt=f"Bill {r['bill_number']}.\nWhat it does:\n{insights}",
    ).strip()[:500]

    counter = provider.complete(
        system_prompt=(
            "You make the strongest honest case AGAINST a municipal bill, whatever "
            "your own view. Two or three sentences, arguing only from what the bill "
            "actually does -- costs, risks, who loses, powers it hands over, "
            "precedent it sets."
        ),
        user_prompt=f"Bill {r['bill_number']}.\nWhat it does:\n{insights}",
    ).strip()[:500]

    system = (
        PERSPECTIVE_PROMPTS[persona]
        + "\n\nYou are not writing anything yet. Both sides have already been "
          "argued for you. Decide which case is stronger BY YOUR OWN VALUES -- not "
          "which is better written. If the bill genuinely touches nothing you "
          "believe in, answer neutral.\n"
          "Answer with exactly one word: support, oppose, or neutral."
    )
    user = (f"Bill {r['bill_number']}.\nWhat it does:\n{insights}\n\n"
            f"Case in favour:\n{steelman}\n\nCase against:\n{counter}\n\n"
            "Your one-word position:")
    return _stance_vote(provider, system, user)


TECHNIQUES = {
    "baseline": technique_baseline,
    "hybrid": technique_hybrid,
    "two_stage": technique_two_stage,
    "facts_first": technique_facts_first,
    "effect_then_stance": technique_effect_then_stance,
    "three_stage": technique_three_stage,
    "four_stage": technique_four_stage,
    "steelman": technique_steelman,
}


# ── Scoring ──────────────────────────────────────────────────────────────────

def run(technique_name, eval_set, concurrency=4):
    from app.services.ai_provider import get_ai_provider
    fn = TECHNIQUES[technique_name]
    provider = get_ai_provider()

    jobs = [(cat, r, persona, want)
            for cat, r in eval_set
            for persona, want in EXPECTED[cat].items()]

    results = []

    def one(job):
        cat, r, persona, want = job
        try:
            got = fn(provider, persona, r)
        except Exception as e:
            return (cat, persona, want, None, type(e).__name__)
        return (cat, persona, want, got, None)

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        results = list(ex.map(one, jobs))
    elapsed = time.time() - t0
    return results, elapsed


def score(results, weights=None):
    total = hit = backwards = errored = 0
    per_persona = defaultdict(lambda: [0, 0, 0])  # n, hit, backwards
    per_cat = defaultdict(lambda: [0, 0, 0])
    for cat, persona, want, got, err in results:
        if err:
            errored += 1
            continue
        total += 1
        per_persona[persona][0] += 1
        per_cat[cat][0] += 1
        if got == want:
            hit += 1
            per_persona[persona][1] += 1
            per_cat[cat][1] += 1
        elif OPPOSITE.get(want) == got:
            backwards += 1
            per_persona[persona][2] += 1
            per_cat[cat][2] += 1

    # Raw accuracy treats every category as equally common, which it is not:
    # the sample is stratified so each category has enough judgements to mean
    # something, then reweighted so the headline reflects the bill mix that is
    # actually pending.
    weighted_acc = weighted_back = None
    if weights:
        wa = wb = wsum = 0.0
        for cat, (n, h, b) in per_cat.items():
            w = weights.get(cat, 0)
            if not n or not w:
                continue
            wa += w * (h / n)
            wb += w * (b / n)
            wsum += w
        if wsum:
            weighted_acc = wa / wsum * 100
            weighted_back = wb / wsum * 100

    return {
        "n": total, "hit": hit, "backwards": backwards, "errors": errored,
        "accuracy": hit / total * 100 if total else 0,
        "backwards_pct": backwards / total * 100 if total else 0,
        "weighted_accuracy": weighted_acc, "weighted_backwards": weighted_back,
        "per_persona": per_persona, "per_cat": per_cat,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--technique", choices=list(TECHNIQUES))
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--per-category", type=int, default=10)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--build", action="store_true")
    args = ap.parse_args()

    weights, cat_counts, n_active = production_weights()
    eval_set = build_eval_set(args.per_category)
    pairs = sum(len(EXPECTED[c]) for c, _ in eval_set)
    by_cat = defaultdict(int)
    for cat, _ in eval_set:
        by_cat[cat] += 1

    print(f"eval set: {len(eval_set)} bills, {pairs} (bill, persona) judgements")
    print(f"production mix across {n_active} pending bills (used to weight the score):")
    for cat, w in sorted(weights.items(), key=lambda kv: -kv[1]):
        print(f"   {cat:16} {cat_counts[cat]:>4} pending   weight {w*100:>5.1f}%")
    for c, n in sorted(by_cat.items()):
        print(f"   {c:18} {n:>3} bills x {len(EXPECTED[c])} personas")
    if args.build:
        print()
        for cat, r in eval_set[:8]:
            print(f"   [{cat}] {r['bill_number']}: {(r['summary'] or '')[:90]}")
        return 0

    names = list(TECHNIQUES) if args.compare else [args.technique]
    if not names or names == [None]:
        print("pass --technique or --compare")
        return 1

    scores = {}
    for name in names:
        print(f"\nrunning {name} ...", flush=True)
        results, elapsed = run(name, eval_set, args.concurrency)
        s = score(results, weights)
        scores[name] = s
        wa = f"{s['weighted_accuracy']:.0f}%" if s['weighted_accuracy'] is not None else "n/a"
        wb = f"{s['weighted_backwards']:.0f}%" if s['weighted_backwards'] is not None else "n/a"
        print(f"   {s['n']} judgements in {elapsed/60:.1f} min  "
              f"raw {s['accuracy']:.0f}%/{s['backwards_pct']:.0f}%  "
              f"weighted {wa}/{wb}  errors {s['errors']}")

    print()
    print(f"{'technique':20} {'raw acc':>8} {'raw back':>9} {'WTD acc':>8} {'WTD back':>9}")
    print("-" * 58)
    for name, s in scores.items():
        wa = s['weighted_accuracy'] if s['weighted_accuracy'] is not None else 0
        wb = s['weighted_backwards'] if s['weighted_backwards'] is not None else 0
        print(f"{name:20} {s['accuracy']:>7.0f}% {s['backwards_pct']:>8.0f}% "
              f"{wa:>7.0f}% {wb:>8.0f}%")

    best = max(scores, key=lambda k: ((scores[k]["weighted_accuracy"] or 0),
                                      -(scores[k]["weighted_backwards"] or 0)))
    print(f"\nbest: {best}")
    print(f"\nper-persona for {best} (n / correct / backwards):")
    for persona, (n, h, b) in sorted(scores[best]["per_persona"].items()):
        print(f"   {persona:18} {n:>3}  {h:>3} correct  {b:>3} backwards")
    return 0


if __name__ == "__main__":
    sys.exit(main())
