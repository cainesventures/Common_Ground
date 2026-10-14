"""The shared tag -> category mapping has one source; prove it stays that way.

The mapping used to exist as two hand-maintained literals, one in the API and
one in the web app. They drifted, and nothing caught it: the Categories filter
quietly reported Public Safety 13 against 704 uses of the tag, because the map
was keyed 'public safety' and the tags on bills are 'public-safety'.

It now lives in app/data/tag_categories.json. The API reads it directly and the
web app's copy is generated from it, so the only way drift returns is if the
generated file stops matching. That is what these tests are for, and they run
in CI with the rest of the suite.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "app" / "data" / "tag_categories.json"
GENERATED = ROOT / "frontend" / "lib" / "tag-categories.generated.ts"
SYNC = ROOT / "scripts" / "sync_tag_categories.py"


def test_generated_file_is_in_sync():
    """Fails when app/data/tag_categories.json changed and nobody regenerated."""
    result = subprocess.run(
        [sys.executable, str(SYNC), "--check"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    assert result.returncode == 0, (
        f"{GENERATED.relative_to(ROOT)} is stale.\n"
        f"Run: python scripts/sync_tag_categories.py\n\n"
        f"{result.stdout}{result.stderr}"
    )


def test_api_loads_the_canonical_mapping():
    from app.api.legislation_routes import _TAG_TO_CATEGORY

    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    expected = sum(len(tags) for tags in data["categories"].values())
    assert len(_TAG_TO_CATEGORY) == expected


def test_no_tag_claimed_by_two_categories():
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    seen: dict[str, str] = {}
    for category, tags in data["categories"].items():
        for tag in tags:
            key = tag.lower().strip()
            assert key not in seen, (
                f"tag {tag!r} is listed under both {seen[key]!r} and {category!r}"
            )
            seen[key] = category


@pytest.mark.parametrize(
    "tag,expected",
    [
        # The spellings that were silently unmatched before the fix.
        ("public-safety", "public safety"),
        ("public safety", "public safety"),
        ("public_safety", "public safety"),
        ("PUBLIC-SAFETY", "public safety"),
        ("environment", "environment"),
        ("historic-preservation", "zoning"),
        ("ethics", "government"),
        # Nonsense still resolves to nothing rather than a wrong bucket.
        ("not-a-real-tag", None),
    ],
)
def test_lookup_tolerates_spelling(tag, expected):
    from app.api.legislation_routes import _category_for_tag

    assert _category_for_tag(tag) == expected
