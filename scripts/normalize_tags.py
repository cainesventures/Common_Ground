"""
One-time script to normalize bill tags to a canonical taxonomy
derived from the actual tag distribution in the database.

Usage:
    python scripts/normalize_tags.py --dry-run
    python scripts/normalize_tags.py
"""

import sys
import json
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Canonical tag set — derived from real data, ~50 tags
# Each canonical tag maps to a list of aliases to absorb
CANONICAL = {
    "zoning":                   ["zoning", "rezoning", "zoning code"],
    "transportation":           ["transportation", "transit", "septa"],
    "parking":                  ["parking", "parking regulations", "parking regulation"],
    "infrastructure":           ["infrastructure", "city infrastructure", "utilities", "utility",
                                 "public utilities", "public works", "streets", "roads", "street",
                                 "sidewalks", "sidewalk", "sewer", "water management", "water",
                                 "plumbing", "capital projects", "capital program", "capital budget",
                                 "capital_budget", "capital_program", "capital_projects"],
    "land-use":                 ["land use", "land-use", "land_use", "land use planning",
                                 "land acquisition", "land sale", "easements", "encroachment",
                                 "public property", "public_property", "public-property",
                                 "city property", "city plan", "city_plan"],
    "planning":                 ["planning", "city planning", "urban planning", "urban development",
                                 "urban renewal", "city-planning", "urban_planning",
                                 "redevelopment", "development", "city development",
                                 "community development", "neighborhood development",
                                 "neighborhood improvement", "commercial development",
                                 "property development", "urban-development"],
    "finance":                  ["finance", "budget", "budgeting", "fiscal", "fiscal policy",
                                 "funding", "spending", "revenue", "debt", "bonds", "bonding",
                                 "grants", "city budget", "city-budget", "city finance",
                                 "capital program", "capital_program"],
    "taxation":                 ["taxation", "taxes", "tax", "property taxes", "property tax",
                                 "property assessment", "fees", "fines"],
    "business":                 ["business", "businesses", "commerce", "commercial",
                                 "business regulation", "business development",
                                 "local business", "local economy", "retail", "restaurants",
                                 "hotels", "tourism", "small business", "small_business",
                                 "street vending", "street vendors", "vendors", "vending",
                                 "sidewalk cafes", "sidewalk_cafes", "sidewalk cafe",
                                 "sidewalk café", "sidewalk sales", "newsstands",
                                 "advertising", "signs"],
    "housing":                  ["housing", "affordable housing", "affordable_housing",
                                 "homeownership", "residential", "real estate", "real_estate",
                                 "real-estate", "realestate", "property", "property rights",
                                 "property management", "property_management",
                                 "property maintenance", "property transfer",
                                 "property acquisition", "property owners",
                                 "landlord-tenant", "landlord-tenant law", "landlord", "tenant",
                                 "tenant rights", "low-income", "low-income support",
                                 "affordability", "homelessness", "blight prevention",
                                 "demolition", "construction", "building codes", "building_codes",
                                 "building code", "permits", "leasing", "leases", "lease",
                                 "office space"],
    "public-safety":            ["public safety", "public_safety", "public-safety", "safety",
                                 "law enforcement", "police", "police reform", "crime",
                                 "crime prevention", "emergency services", "fire"],
    "public-health":            ["public health", "public_health", "health", "healthcare",
                                 "covid-19", "smoking", "noise", "disability", "accessibility",
                                 "mental health"],
    "education":                ["education", "school district", "university",
                                 "temple university", "youth", "libraries", "library"],
    "environment":              ["environment", "environmental", "environmental policy",
                                 "sustainability", "energy", "recycling", "water",
                                 "waste management", "farming", "bicycling", "bicycles"],
    "economic-development":     ["economic development", "economic_development",
                                 "economic-development", "economy", "job creation", "jobs",
                                 "employment", "workforce development", "minimum wage", "wages",
                                 "labor", "compensation", "industrial"],
    "government":               ["government", "city government", "city-government",
                                 "city_government", "local government", "governance",
                                 "city council", "city charter", "ordinance", "regulation",
                                 "regulations", "policy", "public policy", "philadelphia code",
                                 "city code", "repeal", "technical amendment", "oversight",
                                 "accountability", "transparency", "government reform"],
    "procurement":              ["procurement", "contracts", "contracting", "city contracts",
                                 "city contracting", "contract", "contractors", "agreements",
                                 "licensing", "licenses"],
    "neighborhood":             ["neighborhood", "neighborhoods", "north philadelphia",
                                 "south philadelphia", "west philadelphia", "center city",
                                 "centercity", "community", "community organizations",
                                 "community improvement", "recreation", "parks",
                                 "parks and recreation", "park", "public spaces",
                                 "public space", "public_space", "public-space",
                                 "public facilities", "city facilities", "city services"],
    "elections":                ["elections", "election", "campaign finance", "redistricting",
                                 "districts", "district", "politics"],
    "pensions":                 ["pensions", "pension", "retirement", "benefits",
                                 "city employees", "city-employees", "employees"],
    "historic-preservation":    ["historic preservation", "naming", "renaming",
                                 "honorary designation", "recognition", "arts", "culture", "art"],
    "social-services":          ["social services", "seniors", "veterans", "animals",
                                 "diversity", "civil rights", "discrimination", "immigration",
                                 "fair practices", "disability", "food", "nonprofit",
                                 "philanthropy"],
    "technology":               ["technology", "red light cameras", "banking", "insurance"],
    "traffic":                  ["traffic", "traffic regulation", "traffic regulations",
                                 "traffic management", "traffic control", "traffic code",
                                 "traffic safety", "towing", "trucks", "airport"],
    "ethics":                   ["ethics", "accountability", "transparency",
                                 "campaign finance", "residency"],
    "leasing":                  ["leasing", "leases", "lease"],
}

# Build reverse lookup: alias -> canonical
ALIAS_TO_CANONICAL = {}
for canonical, aliases in CANONICAL.items():
    for alias in aliases:
        ALIAS_TO_CANONICAL[alias.lower().strip()] = canonical


def normalize_tags(raw_tags: str) -> list[str]:
    """Parse raw tags string and return normalized canonical list."""
    if not raw_tags:
        return []
    try:
        if raw_tags.strip().startswith("["):
            tags = json.loads(raw_tags)
        else:
            tags = [t.strip() for t in raw_tags.split(",")]
    except Exception:
        return []

    normalized = set()
    for tag in tags:
        tag = tag.strip().lower()
        canonical = ALIAS_TO_CANONICAL.get(tag)
        if canonical:
            normalized.add(canonical)
        elif tag:
            # Keep unmapped tags as-is (cleaned up)
            normalized.add(tag.replace(" ", "-").replace("_", "-"))

    return sorted(normalized)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")

    from app.models.database import SessionLocal
    from app.models import Legislation

    db = SessionLocal()
    bills = db.query(Legislation).filter(
        Legislation.tags.isnot(None),
        Legislation.analyzed_at.isnot(None)
    ).all()

    updated = skipped = 0
    tag_counter = {}

    for bill in bills:
        original = bill.tags
        normalized = normalize_tags(original)
        new_tags = json.dumps(normalized)

        for t in normalized:
            tag_counter[t] = tag_counter.get(t, 0) + 1

        if new_tags != original:
            if not args.dry_run:
                bill.tags = new_tags
            updated += 1
        else:
            skipped += 1

    if not args.dry_run:
        db.commit()
    db.close()

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Updated: {updated}  Already clean: {skipped}")
    print(f"\nResulting canonical tag distribution ({len(tag_counter)} unique tags):")
    for tag, count in sorted(tag_counter.items(), key=lambda x: -x[1])[:40]:
        print(f"  {count:>5}  {tag}")


if __name__ == "__main__":
    main()
