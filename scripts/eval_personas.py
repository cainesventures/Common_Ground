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

# A bill lands in a category only if it matches that category and no other.
CATEGORY_PATTERNS = {
    "tax_cut": r"(reduc|lower|decreas)\w*\s+(the\s+)?\w*\s*tax|tax\s+(cut|reduction)"
               r"|exempt\w*\s+from\s+\w*\s*tax|tax\s+(credit|abatement)",
    "tax_increase": r"(increas|rais)\w*\s+(the\s+)?\w*\s*tax|new tax|impos\w*\s+a\s+tax",
    "routine_zoning": r"amend\w*\s+the\s+philadelphia\s+zoning\s+maps",
    "routine_parking": r"(parking|stopping|loading)\s+(regulation|zone)|tow-?away",
    "surveillance": r"camera|surveillance|license plate|automated enforcement",
    "env_protect": r"\btree\b|green\s+(roof|space)|emission|air quality|stormwater",
}

# Only pairs a reasonable person would agree on. Deliberately sparse: a wrong
# expectation here would make a good technique look bad.
EXPECTED = {
    "tax_cut": {
        "conservative": "support",
        "libertarian": "support",
        "socialist": "oppose",
    },
    "tax_increase": {
        "conservative": "oppose",
        "libertarian": "oppose",
    },
    # Most of Council's business is procedural. A persona reaching for a stance
    # on a zoning map change is manufacturing one.
    "routine_zoning": {
        "conservative": "neutral",
        "libertarian": "neutral",
        "progressive": "neutral",
        "socialist": "neutral",
        "centrist": "neutral",
    },
    "routine_parking": {
        "conservative": "neutral",
        "progressive": "neutral",
        "socialist": "neutral",
    },
    "surveillance": {
        "civil_liberties": "oppose",
        "libertarian": "oppose",
    },
    "env_protect": {
        "environmental": "support",
    },
}

OPPOSITE = {"support": "oppose", "oppose": "support"}


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
        hits = [c for c, rx in compiled.items() if rx.search(summary)]
        if len(hits) != 1:
            continue
        # Direction words only matter where the expectation depends on direction.
        if hits[0] in ("tax_cut", "tax_increase") and AMBIGUOUS.search(summary):
            continue
        buckets[hits[0]].append(r)

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


TECHNIQUES = {
    "baseline": technique_baseline,
    "two_stage": technique_two_stage,
    "facts_first": technique_facts_first,
    "effect_then_stance": technique_effect_then_stance,
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


def score(results):
    total = hit = backwards = errored = 0
    per_persona = defaultdict(lambda: [0, 0, 0])  # n, hit, backwards
    for cat, persona, want, got, err in results:
        if err:
            errored += 1
            continue
        total += 1
        per_persona[persona][0] += 1
        if got == want:
            hit += 1
            per_persona[persona][1] += 1
        elif OPPOSITE.get(want) == got:
            backwards += 1
            per_persona[persona][2] += 1
    return {
        "n": total, "hit": hit, "backwards": backwards, "errors": errored,
        "accuracy": hit / total * 100 if total else 0,
        "backwards_pct": backwards / total * 100 if total else 0,
        "per_persona": per_persona,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--technique", choices=list(TECHNIQUES))
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--per-category", type=int, default=10)
    ap.add_argument("--concurrency", type=int, default=4)
    ap.add_argument("--build", action="store_true")
    args = ap.parse_args()

    eval_set = build_eval_set(args.per_category)
    pairs = sum(len(EXPECTED[c]) for c, _ in eval_set)
    by_cat = defaultdict(int)
    for cat, _ in eval_set:
        by_cat[cat] += 1

    print(f"eval set: {len(eval_set)} bills, {pairs} (bill, persona) judgements")
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
        s = score(results)
        scores[name] = s
        print(f"   {s['n']} judgements in {elapsed/60:.1f} min  "
              f"accuracy {s['accuracy']:.0f}%  backwards {s['backwards_pct']:.0f}%  "
              f"errors {s['errors']}")

    print()
    print(f"{'technique':14} {'n':>5} {'accuracy':>9} {'backwards':>10}")
    print("-" * 42)
    for name, s in scores.items():
        print(f"{name:14} {s['n']:>5} {s['accuracy']:>8.0f}% {s['backwards_pct']:>9.0f}%")

    best = max(scores, key=lambda k: (scores[k]["accuracy"], -scores[k]["backwards_pct"]))
    print(f"\nbest: {best}")
    print(f"\nper-persona for {best} (n / correct / backwards):")
    for persona, (n, h, b) in sorted(scores[best]["per_persona"].items()):
        print(f"   {persona:18} {n:>3}  {h:>3} correct  {b:>3} backwards")
    return 0


if __name__ == "__main__":
    sys.exit(main())
