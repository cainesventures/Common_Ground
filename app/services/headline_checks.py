"""Checks that AI-written headlines, ledes and summaries stay faithful and neutral.

The prompts already say "do not invent neighborhoods" and "only what the source
says", and the model ignores them often enough to matter: an audit on
2026-10-23 found 501 headlines naming a neighborhood the bill never mentions
(usually inferred from a street: Hermit Street -> "Roxborough"), 26 whose
dollar figure contradicts the summary, and ~1,500 headlines or ledes carrying
editorializing words ("bracing for", "cracks down", "chaos"). A rule in a
prompt is a request. These checks run on the output, so generation can retry
and the regen script can refuse to save a defective result.

Shared by app/services/legislation_service.py (retry on generation),
scripts/regenerate_headlines.py (target selection + save guard) and
scripts/audit_headline_consistency.py (reporting).
"""
import re

NEIGHBORHOODS = (
    "Kensington", "Fishtown", "Northern Liberties", "Port Richmond", "Frankford",
    "Germantown", "Chestnut Hill", "Mount Airy", "Manayunk", "Roxborough",
    "East Falls", "Nicetown", "Tioga", "Strawberry Mansion", "Brewerytown",
    "Fairmount", "Spring Garden", "Francisville", "Point Breeze", "Grays Ferry",
    "East Passyunk", "Passyunk", "Pennsport", "Queen Village", "Bella Vista",
    "Society Hill", "Old City", "Rittenhouse", "Graduate Hospital", "Center City",
    "University City", "Powelton", "Mantua", "Belmont", "Wynnefield", "Overbrook",
    "Cobbs Creek", "Kingsessing", "Southwest Philadelphia", "Eastwick",
    "Mayfair", "Holmesburg", "Tacony", "Bridesburg", "Juniata", "Olney", "Logan",
    "Fern Rock", "West Oak Lane", "East Oak Lane", "Oak Lane", "Lawncrest",
    "Fox Chase", "Bustleton", "Somerton", "Rhawnhurst", "Oxford Circle",
    "Navy Yard", "Hunting Park", "Fairhill", "Hartranft", "Poplar", "Callowhill",
    "Chinatown", "Washington Square", "Whitman", "Girard Estates", "Packer Park",
    "Andorra", "Wissahickon", "Cedarbrook", "Allegheny West", "Haddington",
    "Carroll Park", "Walnut Hill", "Spruce Hill", "Cedar Park", "Paschall",
    "Elmwood",
)

# Words that tell the reader how to feel about a bill. Kept to the ones the
# audit actually found plus close variants, not a general sentiment list, so a
# headline is never rejected for an ordinary verb.
LOADED = re.compile(
    r"\b(chaos|chaotic|towering|slams?|slammed|crackdowns?|cracks? down|cracked down|"
    r"war on|radical|controversial|draconian|sweeping|bombshell|outrage\w*|"
    r"skyrocket\w*|bracing for|braces for|disastrous|reckless|stunning)\b",
    re.I,
)

_MONEY = re.compile(r"\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|[mbk])?\b", re.I)
_SCALE = {"thousand": 1e3, "k": 1e3, "million": 1e6, "m": 1e6, "billion": 1e9, "b": 1e9}


def amounts(text: str | None) -> set[int]:
    """Dollar figures in text, in whole dollars, rounded to 3 significant figures
    so "$1.3 billion" and "$1,300,000,000" compare equal."""
    out = set()
    for num, unit in _MONEY.findall(text or ""):
        try:
            v = float(num.replace(",", "")) * _SCALE.get((unit or "").lower(), 1)
        except ValueError:
            continue
        if v <= 0:
            continue
        mag = 10 ** max(0, len(str(int(v))) - 3)
        out.add(int(round(v / mag) * mag))
    return out


def unsupported_places(text: str | None, source: str | None) -> list[str]:
    """Neighborhoods named in `text` that never appear in `source`."""
    src = (source or "").lower()
    found = []
    for hood in NEIGHBORHOODS:
        if re.search(rf"\b{re.escape(hood)}\b", text or "") and hood.lower() not in src:
            # "East Passyunk" also matches "Passyunk"; report the longer once.
            if not any(hood in f for f in found):
                found.append(hood)
    return found


def loaded_words(text: str | None) -> list[str]:
    return sorted({m.group(0).lower() for m in LOADED.finditer(text or "")})


def headline_problems(headline: str | None, source: str | None,
                      summary: str | None = None) -> list[str]:
    """Human-readable reasons a headline should not ship. Empty list = fine.

    `source` is the bill's own text (title, description, full text). `summary`
    is optional: when given, a headline dollar figure that is in neither the
    source nor the summary, while the summary states figures of its own, is
    treated as a contradiction.
    """
    problems = []
    places = unsupported_places(headline, source)
    if places:
        problems.append(f"names {', '.join(places)}, which the bill text never mentions")
    words = loaded_words(headline)
    if words:
        problems.append(f"uses editorializing language ({', '.join(words)})")
    h_amt = amounts(headline)
    if h_amt and summary is not None:
        s_amt = amounts(summary)
        missing = {a for a in h_amt if a not in s_amt and a not in amounts(source)}
        if missing and s_amt:
            problems.append("states a dollar figure the bill text and summary do not support")
    return problems
