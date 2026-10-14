"""The canonical tag -> category mapping, and how to look a tag up in it.

The data lives in app/data/tag_categories.json and is shared with the web app,
which gets it through frontend/lib/tag-categories.generated.ts (see
scripts/sync_tag_categories.py). This module is the Python half.

It is its own module rather than living in legislation_routes because two
route modules need it now: the legislation facets and the lapsed-without-a-vote
analysis. Importing one route module into another to borrow a dict is how the
original duplication started.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent / "data" / "tag_categories.json"


@lru_cache(maxsize=1)
def tag_to_category() -> dict[str, str]:
    """Flat tag -> category key, loaded once."""
    with DATA_PATH.open(encoding="utf-8") as fh:
        data = json.load(fh)
    mapping: dict[str, str] = {}
    for category, tags in data["categories"].items():
        for tag in tags:
            mapping[str(tag).lower().strip()] = category
    return mapping


def category_for_tag(tag: str) -> str | None:
    """Look up a tag's category, tolerating hyphen/underscore/space spelling.

    The map was written with spaces ('public safety') but the tags written on
    bills are hyphenated ('public-safety'), so the biggest buckets matched
    nothing: the facets endpoint reported Public Safety 13 against 704 uses of
    the tag, Environment 6 against 362, Immigration 1. Normalising at lookup
    fixes every such pair at once instead of listing both spellings forever.
    """
    key = (tag or "").lower().strip()
    if not key:
        return None
    mapping = tag_to_category()
    for variant in (key, key.replace("-", " ").replace("_", " "), key.replace(" ", "-")):
        hit = mapping.get(variant)
        if hit:
            return hit
    return None


def categories_for_tags(tags: list) -> set[str]:
    """Every category a bill's tag list puts it in.

    A bill usually carries several tags, so it can land in more than one
    category. Callers counting bills per category must de-duplicate on the bill,
    which is what the set return is for.
    """
    found: set[str] = set()
    for tag in tags or []:
        if not isinstance(tag, str):
            continue
        hit = category_for_tag(tag)
        if hit:
            found.add(hit)
    return found
