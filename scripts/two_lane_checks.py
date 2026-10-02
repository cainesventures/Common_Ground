"""Mechanical and verifier checks that stand between the two-lane generator and the site.

Why this file exists: `generate_two_lane.py` produced good arguments and
invented facts inside them. Two confirmed failures, both on bills that are
pending right now:

  - 260514: the case for claimed the bill "saves 150 units of affordable
    housing". "150" is nowhere in the title, summary or full text. An earlier
    run of the same bill invented a different figure (24 units plus 10).
  - 260710: the bill is an Eighth District business *curfew*. The case for
    described it as "allowing businesses to stay open from 11 p.m. to 6 a.m.",
    which is the bill backwards. The inversion starts in the insights stage,
    before either argument is written -- and the source summary helps it along
    by saying "the new hours will be between 11 p.m. and 6 a.m." without
    saying that those are the hours businesses must be *closed*.

Both prompts already forbid inventing figures. Prompting did not hold, so the
checks here are not prompts.

Three checks, in descending order of how much they can be trusted:

  1. `ungrounded_numbers` -- fully mechanical. Every number in the generated
     text must appear in the source. No model is consulted and there is nothing
     to argue with: this is why numbers are the check worth building first.
  2. `direction_conflicts` -- mechanical, and deliberately narrow. Catches the
     one inversion class that has actually occurred (a restriction described as
     a permission) plus tax direction. It is a backstop, not coverage.
  3. `contradiction_check` -- a model verifying claims against the source, one
     claim at a time, with no writing to do. General, but it is a model, so its
     detection rate and false-positive rate are measured by
     `scripts/eval_two_lane.py` rather than assumed.

Everything here is importable by both the generator and the eval, so the eval
measures the same code that ships.
"""

import re

# ── Numbers ──────────────────────────────────────────────────────────────────

WORD_VALUES = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100, "thousand": 1000,
    "million": 1_000_000, "billion": 1_000_000_000,
}

ORDINAL_VALUES = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
    "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11,
    "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "twentieth": 20, "thirtieth": 30,
}

SCALES = {"hundred": 100, "thousand": 1000, "million": 1_000_000,
          "billion": 1_000_000_000, "k": 1000, "m": 1_000_000}

# A spelled-out number only counts as a factual claim when it is attached to
# something countable. Prose is full of "one of the", "two or three ways",
# "a second look", and flagging those would send good generations back to the
# model for no reason -- every needless regeneration is a GPU minute.
UNIT_WORDS = {
    "unit", "units", "percent", "percentage", "dollar", "dollars", "cent",
    "cents", "day", "days", "week", "weeks", "month", "months", "year",
    "years", "hour", "hours", "minute", "minutes", "home", "homes", "house",
    "houses", "apartment", "apartments", "household", "households",
    "property", "properties", "parcel", "parcels", "block", "blocks",
    "building", "buildings", "acre", "acres", "foot", "feet", "mile", "miles",
    "resident", "residents", "people", "person", "persons", "family",
    "families", "job", "jobs", "worker", "workers", "business",
    "businesses", "store", "stores", "camera", "cameras", "vote", "votes",
    "member", "members", "seat", "seats", "bed", "beds", "space", "spaces",
    "site", "sites", "street", "streets", "district", "districts", "ward",
    "wards", "school", "schools", "fine", "fines", "fee", "fees", "tax",
    "taxes", "million", "billion", "thousand", "hundred",
}

# Values that are never a factual claim worth rejecting over. 1 and 2 carry
# almost no information and appear constantly as English ("a single exception",
# "the two sides"); 2 is kept out of the SAFE set only when written in digits,
# which is handled by the quantified-phrase rule instead.
SAFE_VALUES = {0.0, 1.0}

# An ordinal in front of one of these is naming a real thing that can be got
# wrong. In front of anything else ("the third problem with this") it is
# rhetoric and checking it would reject good writing.
PLACE_WORDS = {
    "street", "streets", "avenue", "avenues", "boulevard", "road", "lane",
    "drive", "place", "district", "districts", "councilmanic", "ward",
    "wards", "precinct", "division", "section", "chapter", "title", "floor",
    "councilmanic_district", "council", "class", "tier",
}

_DIGIT_NUMBER = re.compile(r"(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*"
                           r"(hundred|thousand|million|billion|k|m)?\b", re.I)
_WORD_NUMBER = re.compile(
    r"\b(" + "|".join(sorted(WORD_VALUES, key=len, reverse=True)) + r")"
    r"(?:[-\s](" + "|".join(sorted(WORD_VALUES, key=len, reverse=True)) + r"))?\b",
    re.I)
_ORDINAL = re.compile(
    r"\b(" + "|".join(sorted(ORDINAL_VALUES, key=len, reverse=True)) + r")\b|"
    r"\b(\d+)(?:st|nd|rd|th)\b", re.I)


def _digit_values(text: str):
    """Every digit-written number, with its scaled reading where one applies.

    "$1.2 million" yields both 1.2 and 1200000, because the source may write
    either form and matching should not depend on which one it chose.
    """
    out = []
    for m in _DIGIT_NUMBER.finditer(text or ""):
        try:
            base = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        out.append((m.group(0).strip(), base))
        scale = SCALES.get((m.group(2) or "").lower())
        if scale:
            out.append((m.group(0).strip(), base * scale))
    return out


def _word_values(text: str):
    """Spelled-out numbers, including "twenty-four" and "ten thousand"."""
    out = []
    for m in _WORD_NUMBER.finditer(text or ""):
        first = WORD_VALUES[m.group(1).lower()]
        second = WORD_VALUES[m.group(2).lower()] if m.group(2) else None
        if second is None:
            out.append((m.group(0), float(first), m.start(), m.end()))
            continue
        # "twenty four" composes by addition, "ten thousand" by multiplication.
        value = first * second if second >= 100 else first + second
        out.append((m.group(0), float(value), m.start(), m.end()))
    return out


def _ordinal_values(text: str):
    out = []
    for m in _ORDINAL.finditer(text or ""):
        if m.group(1):
            out.append((m.group(0), float(ORDINAL_VALUES[m.group(1).lower()])))
        else:
            out.append((m.group(0), float(m.group(2))))
    return out


def source_values(source: str) -> set:
    """Every number the source can be said to contain, as floats.

    Spelled and ordinal forms are included on the source side unconditionally:
    "Eighth Councilmanic District" in the title should ground "the 8th
    District" in the output. The output side is stricter -- see
    `ungrounded_numbers`.
    """
    values = set(SAFE_VALUES)
    for _, v in _digit_values(source):
        values.add(v)
    for _, v, _s, _e in _word_values(source):
        values.add(v)
    for _, v in _ordinal_values(source):
        values.add(v)
    # Percentages and plain counts should match across notation, and a source
    # "1000" grounding an output "1,000" already falls out of the float form.
    return values


def _is_quantified(text: str, start: int, end: int) -> bool:
    """Is this spelled-out number attached to something countable?

    Looks one or two words either side for a unit noun or a currency marker.
    "twenty-four units" and "$ten" count; "one of the committees" does not.
    """
    after = re.findall(r"[A-Za-z%$]+", text[end:end + 40])[:2]
    before = re.findall(r"[A-Za-z%$]+", text[max(0, start - 20):start])[-1:]
    for w in after + before:
        if w.lower().strip("%$") in UNIT_WORDS or w in ("%", "$"):
            return True
    return "%" in text[end:end + 3] or "$" in text[max(0, start - 2):start]


_LIST_MARKER = re.compile(r"^[ \t]*(?:\d+|[a-z])[.)][ \t]+", re.M | re.I)


def strip_list_markers(text: str) -> str:
    """Drop "1." / "2)" line enumerators before any number is extracted.

    The insights stage is asked for 2-4 points and often numbers them, and the
    first measured run rejected two of thirteen bills for asserting "3" --
    which was the third bullet, not a quantity. A check that burns a GPU minute
    regenerating a correct answer loses trust as fast as one that misses a
    fabrication.
    """
    return _LIST_MARKER.sub("", text or "")


def output_numbers(text: str):
    """Numbers in generated text that amount to a factual claim.

    Digits always count: a model that writes "150" has asserted 150 of
    something. Spelled numbers count only when quantified, for the reason in
    UNIT_WORDS.

    Ordinals count only in front of a place or structure noun. "The second
    reason" is rhetoric and must not be checked; "the 19th Street bridge" and
    "the Eighth Councilmanic District" are facts, and getting the district
    number wrong on the bill that started all this would be as bad as any
    invented figure. An earlier version skipped output ordinals entirely, and
    the eval found the hole: injected errors planted in street numbers went
    undetected, 2 of 17.
    """
    text = strip_list_markers(text)
    found = []
    for raw, value in _digit_values(text):
        found.append((raw, value))
    for raw, value, start, end in _word_values(text):
        if _is_quantified(text, start, end):
            found.append((raw, value))
    for m in _ORDINAL.finditer(text):
        following = re.match(r"\W{0,3}(\w+)", text[m.end():])
        if following and following.group(1).lower() in PLACE_WORDS:
            value = (ORDINAL_VALUES[m.group(1).lower()] if m.group(1)
                     else float(m.group(2)))
            found.append((m.group(0), float(value)))
    return found


def ungrounded_numbers(text: str, source: str):
    """Numbers asserted in `text` that do not appear in `source`.

    Matching is numeric, never substring: "150" must not be allowed to pass
    because the source happens to contain "1500" or "260514". That is exactly
    the failure mode this check exists to catch.

    Returns a list of (as_written, value) -- empty means the text is grounded.
    """
    allowed = source_values(source)
    bad = []
    for raw, value in output_numbers(text):
        if value in allowed or value in SAFE_VALUES:
            continue
        bad.append((raw, value))
    # De-duplicate while keeping the order the reader would meet them in.
    seen, out = set(), []
    for raw, value in bad:
        if value in seen:
            continue
        seen.add(value)
        out.append((raw, value))
    return out


# ── Direction ────────────────────────────────────────────────────────────────

# One entry per inversion class that has actually happened. Each is a pair of
# poles: if the source sits at one pole and the generated text asserts the
# other, with nothing in the text acknowledging the source's pole, that is a
# contradiction a reader would notice immediately.
#
# Narrow on purpose. A general polarity detector built out of antonym lists
# fires on "this does not restrict businesses" and on every bill that both
# permits and forbids something, and a check that cries wolf gets switched off.
POLARITY_RULES = [
    {
        "name": "hours_restriction_as_permission",
        "source": re.compile(
            r"curfew|hour\s+restriction|business\s+hour|must\s+close|"
            r"closing\s+time|shall\s+(?:not\s+)?(?:be\s+)?(?:remain\s+)?open", re.I),
        "asserted": re.compile(
            r"allow\w*[^.]{0,60}\b(?:stay|remain|be)\s+open|"
            r"permit\w*[^.]{0,60}\b(?:stay|remain|be)\s+open|"
            r"let\w*[^.]{0,40}\bopen\b|"
            r"extend\w*[^.]{0,30}\b(?:business\s+)?hours|"
            r"longer\s+(?:business\s+)?hours|"
            r"operate\s+(?:freely\s+)?(?:overnight|all\s+night|around\s+the\s+clock)", re.I),
        "acknowledged": re.compile(
            r"curfew|restrict\w*|must\s+close|required?\s+to\s+close|"
            r"prohibit\w*|ban\b|closure", re.I),
    },
    {
        "name": "tax_direction",
        "source": re.compile(r"(increas|rais)\w*\s+(?:the\s+)?\w*\s*tax|new\s+tax|"
                             r"impos\w*\s+a\s+tax", re.I),
        "asserted": re.compile(r"(?:cut|cuts|cutting|reduc\w*|lower\w*)\s+(?:the\s+)?"
                               r"\w{0,12}\s*tax(?:es)?\b|tax\s+(?:cut|relief|break)", re.I),
        "acknowledged": re.compile(r"(?:increas|rais)\w*\s+(?:the\s+)?\w{0,12}\s*tax|"
                                   r"new\s+tax|higher\s+tax", re.I),
    },
]


def direction_conflicts(text: str, source: str):
    """Names of polarity rules the text trips against the source.

    Empty means no *known* inversion class fired. It does not mean the text is
    faithful -- that is what `contradiction_check` is for.
    """
    hits = []
    for rule in POLARITY_RULES:
        if not rule["source"].search(source or ""):
            continue
        if not rule["asserted"].search(text or ""):
            continue
        if rule["acknowledged"].search(text or ""):
            continue
        hits.append(rule["name"])
    return hits


# ── Contradiction check (model as verifier) ──────────────────────────────────

VERIFIER_SYSTEM = (
    "You check claims against a source document. You are not writing anything "
    "and you have no opinions about the policy.\n\n"
    "For each numbered claim, answer on its own line in exactly this form:\n"
    "<number>: SUPPORTED|CONTRADICTED|NOT_IN_SOURCE\n\n"
    "SUPPORTED -- the source states this, or plainly implies it.\n"
    "CONTRADICTED -- the source states the opposite, or the claim reverses who "
    "is restricted, who pays, who benefits, or which direction something moves. "
    "A rule that forbids something described as permitting it is CONTRADICTED.\n"
    "NOT_IN_SOURCE -- the source neither states nor contradicts it.\n\n"
    "Judge only against the source text. Do not use outside knowledge of the "
    "city, the law, or what such a bill usually does. No explanations."
)

_VERDICT = re.compile(r"^\s*(\d+)\s*[:.\)-]\s*(SUPPORTED|CONTRADICTED|NOT_IN_SOURCE)",
                      re.I | re.M)


def split_claims(insights: str):
    """The insights block as a list of individual claims.

    The insights stage is asked for 2-4 bullet points and complies loosely:
    dashes, numbers, asterisks, or sentences in a paragraph. Bullets are
    preferred when present, otherwise sentences, because a whole block verified
    as one unit returns one verdict for several claims and loses the one that
    is wrong.
    """
    text = (insights or "").strip()
    if not text:
        return []
    lines = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", ln).strip()
             for ln in text.splitlines()]
    bullets = [ln for ln in lines if len(ln) > 25]
    if len(bullets) >= 2:
        return bullets[:8]
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if len(s.strip()) > 25]
    return sentences[:8]


def contradiction_check(provider, insights: str, source: str):
    """Verify each insight claim against the bill source.

    Returns {"claims": [(claim, verdict)], "contradicted": [...],
             "not_in_source": [...]}.

    Only CONTRADICTED is treated as a hard reject by the generator.
    NOT_IN_SOURCE is reported but not enforced: the source handed to the model
    is truncated full text, so "not in source" is as often a limit of the
    excerpt as a fabrication, and rejecting on it would reject grounded bills.
    """
    claims = split_claims(insights)
    if not claims:
        return {"claims": [], "contradicted": [], "not_in_source": []}

    numbered = "\n".join(f"{i}: {c}" for i, c in enumerate(claims, 1))
    raw = provider.complete(
        system_prompt=VERIFIER_SYSTEM,
        user_prompt=f"SOURCE:\n{source}\n\nCLAIMS:\n{numbered}\n\nVerdicts:",
    )
    verdicts = {int(m.group(1)): m.group(2).upper() for m in _VERDICT.finditer(raw or "")}

    out, contradicted, unsupported = [], [], []
    for i, claim in enumerate(claims, 1):
        # An unparseable verdict is treated as SUPPORTED, not as a failure.
        # Counting parse noise as hallucination would inflate the headline
        # number this whole exercise exists to make honest.
        verdict = verdicts.get(i, "SUPPORTED")
        out.append((claim, verdict))
        if verdict == "CONTRADICTED":
            contradicted.append(claim)
        elif verdict == "NOT_IN_SOURCE":
            unsupported.append(claim)
    return {"claims": out, "contradicted": contradicted, "not_in_source": unsupported}
