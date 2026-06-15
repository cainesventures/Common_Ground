"""Canonical Philadelphia councilmember name matching.

Sponsor and roll-call voter strings from Legistar are *title + surname* only
("Councilmember Jones", "Council President Clarke") — there is no first name —
so members are matched to legislation by surname.  The surname must drop
generational suffixes: "Curtis Jones, Jr." -> "jones", not "jr.".

This logic lived inline in five places (councilmember_service, worker_core,
legislation_service, insights_routes) as `name.split()[-1]`, which silently
returned "Jr." for the two suffixed members — so Curtis Jones, Jr. and
Jeffery Young, Jr. matched zero bills and zero votes.  Centralised here so every
matcher uses identical, correct logic.
"""

# Generational suffixes that must never be treated as a surname.
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}

# Council title prefixes, longest first, for display-name stripping.
TITLE_PREFIXES = ("Councilmember At-Large ", "Councilmember ", "Council President ")


def surname(full_name: str | None) -> str:
    """Lowercased surname used for sponsor/voter matching.

    Titles fall away naturally (we take the last token); generational suffixes
    are dropped explicitly.  Returns "" for empty input.

        "Curtis Jones, Jr."                 -> "jones"
        "Councilmember Jones"               -> "jones"
        "Council President Clarke"          -> "clarke"
        "Councilmember At-Large Nina Ahmad" -> "ahmad"
    """
    if not full_name:
        return ""
    parts = [p for p in full_name.replace(",", " ").split()
             if p.rstrip(".").lower() not in NAME_SUFFIXES]
    return parts[-1].lower() if parts else full_name.lower()


def strip_title(name: str) -> str:
    """Member name without the council title prefix, for display."""
    for prefix in TITLE_PREFIXES:
        if name.startswith(prefix):
            return name[len(prefix):]
    return name
