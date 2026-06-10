"""
Generate a static sitemap.xml from the local SQLite database.

Outputs to frontend/public/sitemap.xml — committed to the repo so Vercel
serves it as a static file with no API dependency at runtime.

Run as part of the publish workflow after enriching new bills:
    python scripts/generate_sitemap.py

Environment:
    DB_PATH — path to SQLite database (default: common_ground_test.db)
"""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, ElementTree, indent

ROOT = Path(__file__).parent.parent

def _load_env():
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))

_load_env()

DB_PATH = os.environ.get("DB_PATH", str(ROOT / "common_ground_test.db"))
BASE_URL = "https://opencommonground.com"
OUTPUT = ROOT / "frontend" / "public" / "sitemap.xml"
HISTORY_JSON = ROOT / "frontend" / "public" / "data" / "legislative_history.json"


def _history_years() -> list[int]:
    """Years with a generated year-in-review page (see generate_legislative_narrative.py)."""
    if not HISTORY_JSON.exists():
        return []
    try:
        import json
        data = json.loads(HISTORY_JSON.read_text(encoding="utf-8"))
        return sorted(e["year"] for e in data.get("years", []))
    except Exception:
        return []


def build_sitemap(db_path: str) -> ElementTree:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("SELECT id FROM legislation WHERE level='local'")
    bill_ids = [row[0] for row in c.fetchall()]

    c.execute("SELECT id FROM councilmembers")
    member_ids = [row[0] for row in c.fetchall()]

    conn.close()

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    urlset = Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")

    static = [
        (BASE_URL,                                          "1.0",  "weekly",  now),
        (f"{BASE_URL}/philadelphia",                        "0.9",  "daily",   now),
        (f"{BASE_URL}/philadelphia/legislation",            "0.8",  "daily",   now),
        (f"{BASE_URL}/philadelphia/insights",               "0.8",  "weekly",  now),
        (f"{BASE_URL}/philadelphia/councilmembers",         "0.7",  "weekly",  now),
        (f"{BASE_URL}/about",                               "0.6",  "monthly", now),
        (f"{BASE_URL}/donate",                              "0.5",  "monthly", now),
    ]

    for url, priority, freq, lastmod in static:
        u = SubElement(urlset, "url")
        SubElement(u, "loc").text = url
        SubElement(u, "priority").text = priority
        SubElement(u, "changefreq").text = freq
        SubElement(u, "lastmod").text = lastmod

    current_year = datetime.now(timezone.utc).year
    for year in _history_years():
        u = SubElement(urlset, "url")
        SubElement(u, "loc").text = f"{BASE_URL}/philadelphia/insights/{year}"
        SubElement(u, "priority").text = "0.7"
        # Past years are final; only the current year's review changes
        SubElement(u, "changefreq").text = "weekly" if year == current_year else "yearly"
        SubElement(u, "lastmod").text = now

    for bill_id in bill_ids:
        u = SubElement(urlset, "url")
        SubElement(u, "loc").text = f"{BASE_URL}/philadelphia/legislation/{bill_id}"
        SubElement(u, "priority").text = "0.6"
        SubElement(u, "changefreq").text = "weekly"

    for member_id in member_ids:
        u = SubElement(urlset, "url")
        SubElement(u, "loc").text = f"{BASE_URL}/philadelphia/councilmembers/{member_id}"
        SubElement(u, "priority").text = "0.5"
        SubElement(u, "changefreq").text = "monthly"

    indent(urlset, space="  ")
    return ElementTree(urlset)


def main():
    if not Path(DB_PATH).exists():
        print(f"ERROR: DB not found at {DB_PATH}")
        return

    print(f"Reading DB: {DB_PATH}")
    tree = build_sitemap(DB_PATH)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        tree.write(f, encoding="unicode", xml_declaration=False)

    # Count URLs
    from xml.etree.ElementTree import parse
    parsed = parse(OUTPUT)
    count = len(parsed.getroot())
    print(f"Wrote {count:,} URLs to {OUTPUT}")
    print(f"  File size: {OUTPUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
