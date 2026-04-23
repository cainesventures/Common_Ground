"""
One-time migration: normalize all bill tags to canonical forms.

Run with:  python scripts/canonicalize_tags.py [--dry-run]
"""
import json
import sys
import os

# Add project root so we can import app config
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.database import get_db
from app.models import Legislation

# ---------------------------------------------------------------------------
# Canonicalization map
#
# Key   = tag as it currently appears in the DB (lowercase stripped)
# Value = canonical form to replace it with, or None to DROP the tag
# ---------------------------------------------------------------------------
CANON: dict[str, str | None] = {
    # ── Land use / zoning variants ──────────────────────────────────────
    "land-use":            "land use",
    "land_use":            "land use",
    "land use planning":   "land use",
    "urban-planning":      "zoning",
    "physical development":"development",

    # ── Economic development ─────────────────────────────────────────────
    "economic-development":"economic development",

    # ── City government variants ─────────────────────────────────────────
    "city-government":     "city government",
    "city_government":     "city government",
    "government regulation":"government",
    "government policy":   "government",
    "government structure":"government",
    "city finances":       "finance",
    "city services":       "government",

    # ── Capital / budget variants ─────────────────────────────────────────
    "capital_budget":      "budget",
    "capital spending":    "budget",
    "capital program":     "budget",
    "capital":             "budget",
    "fiscal_policy":       "finance",
    "procurement contracts":"procurement",

    # ── Tax variants ──────────────────────────────────────────────────────
    "taxes":               "taxation",
    "tax":                 "taxation",

    # ── Regulation variants ───────────────────────────────────────────────
    "regulations":         "regulation",

    # ── Housing variants ──────────────────────────────────────────────────
    "affordable_housing":  "housing",

    # ── Public space variants ─────────────────────────────────────────────
    "public_space":        "public space",

    # ── Public works → infrastructure ─────────────────────────────────────
    "public works":        "infrastructure",

    # ── Underscore → space ───────────────────────────────────────────────
    "sidewalk_cafes":      "sidewalk cafes",
    "cell_towers":         "cell towers",
    "outdoor_entertainment":"outdoor entertainment",

    # ── Street variants ───────────────────────────────────────────────────
    "street regulation":   "street management",

    # ── Too-generic / junk tags  → drop ──────────────────────────────────
    "Center City":         None,
    "center city":         None,
    "District38":          None,
    "district38":          None,
    "eagles":              None,
    "west_philly":         None,
    "west philly":         None,
    "policy":              None,
    "reform":              None,
    "resignation requirement": None,
}


def canonicalize(tags_json: str) -> tuple[list, list]:
    """Return (original_tags, canonical_tags). Drops Nones, deduplicates."""
    try:
        original = json.loads(tags_json)
    except Exception:
        return [], []

    seen: set[str] = set()
    result: list[str] = []
    for tag in original:
        t = tag.strip()
        # Lookup by exact form, then by lowercased form
        canonical = CANON.get(t, CANON.get(t.lower(), t))
        if canonical is None:
            continue                    # dropped
        if canonical.lower() not in seen:
            seen.add(canonical.lower())
            result.append(canonical)

    return original, result


def main():
    dry_run = "--dry-run" in sys.argv

    db = next(get_db())
    bills = db.query(Legislation).filter(
        Legislation.tags.isnot(None),
        Legislation.tags != "",
        Legislation.tags != "[]",
    ).all()

    changed = 0
    unchanged = 0

    for bill in bills:
        original, canonical = canonicalize(bill.tags)
        if not original:
            continue
        if canonical == original:
            unchanged += 1
            continue

        print(f"{bill.id}")
        print(f"  before: {original}")
        print(f"  after:  {canonical}")

        if not dry_run:
            bill.tags = json.dumps(canonical)
        changed += 1

    if not dry_run:
        db.commit()
        print(f"\nCommitted. Updated {changed} bills, {unchanged} already clean.")
    else:
        print(f"\nDRY RUN. Would update {changed} bills, {unchanged} already clean.")


if __name__ == "__main__":
    main()
