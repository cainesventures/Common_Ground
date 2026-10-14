"""Generate the web app's tag->category map from the canonical JSON.

The mapping lived in two hand-maintained copies, app/api/legislation_routes.py
and frontend/lib/bill-categories.ts. They drifted, and the drift was invisible
until the Categories filter was measured: the API reported Public Safety 13
against 704 uses of the tag.

One file cannot simply be shared at runtime. .dockerignore excludes frontend/
from the API image, and the Next app cannot reliably import from outside its
own root, so neither side can read the other's tree. Generating one from the
other, with a test that fails when the generated file is stale, gets the same
guarantee without a runtime dependency.

Usage:
    python scripts/sync_tag_categories.py            # write the TS module
    python scripts/sync_tag_categories.py --check    # exit 1 if it is stale
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "app" / "data" / "tag_categories.json"
TARGET = ROOT / "frontend" / "lib" / "tag-categories.generated.ts"

HEADER = """// GENERATED FILE -- DO NOT EDIT.
//
// Source of truth: app/data/tag_categories.json
// Regenerate:     python scripts/sync_tag_categories.py
//
// Edits here are overwritten, and tests/test_tag_categories.py fails if this
// file does not match the JSON, so drift cannot reach main.

/** Canonical tag -> category key. */
export const TAG_TO_CATEGORY: Record<string, string> = {
"""

FOOTER = "}\n"


def load_mapping() -> dict[str, str]:
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    mapping: dict[str, str] = {}
    for category, tags in data["categories"].items():
        for tag in tags:
            key = tag.lower().strip()
            if key in mapping and mapping[key] != category:
                raise SystemExit(
                    f"tag {tag!r} is listed under both {mapping[key]!r} and {category!r}"
                )
            mapping[key] = category
    return mapping


def render(mapping: dict[str, str]) -> str:
    lines = [
        f"  {json.dumps(tag)}: {json.dumps(category)},"
        for tag, category in sorted(mapping.items())
    ]
    return HEADER + "\n".join(lines) + "\n" + FOOTER


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="exit 1 if the target is stale")
    args = ap.parse_args()

    expected = render(load_mapping())

    if args.check:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != expected:
            print(
                f"{TARGET.relative_to(ROOT)} is out of date.\n"
                "Run: python scripts/sync_tag_categories.py",
                file=sys.stderr,
            )
            return 1
        print(f"{TARGET.relative_to(ROOT)} is up to date.")
        return 0

    TARGET.write_text(expected, encoding="utf-8")
    print(f"wrote {TARGET.relative_to(ROOT)} ({len(load_mapping())} tags)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
