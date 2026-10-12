"""
Generate a segmented static sitemap from the local SQLite database.

Outputs to frontend/public/ — committed to the repo so Vercel serves them as
static files with no API dependency at runtime.

    sitemap.xml                 sitemap index, the only file robots.txt names
    sitemap-core.xml            hand-built pages, year reviews, blog, members
    sitemap-bills.xml           bills that carry an argument, plus live bills
    sitemap-bills-archive.xml   concluded bills with no argument

WHY THIS IS SPLIT
-----------------
It used to be one flat file listing every local bill at priority 0.6 — 8,737
URLs, of which ~98% were a concluded bill whose page is an AI headline, a lede
and a summary over the same legal boilerplate. Google was being asked to treat
a lapsed 2004 resolution as equal in value to the bills that actually carry a
case for and against, and the site's whole indexable surface was dominated by
the thinnest thing on it. Traffic is almost entirely Google organic, so that
is not a cosmetic problem.

Splitting does two things a flat file cannot:

  - Search Console reports coverage per sitemap. Right now "are bill pages
    getting indexed?" is unanswerable because every URL is in one bucket;
    afterwards, indexed-vs-submitted for sitemap-bills.xml and for
    sitemap-bills-archive.xml are separate numbers, and the gap between them
    is the measurement that tells you whether thin pages are actually being
    dropped.
  - Priority and changefreq stop claiming that every bill is equally
    important and equally fresh.

The archive is still listed. Segmenting is reversible and costs nothing;
de-indexing 3,000+ pages is neither, and it should be a decision taken against
the Search Console numbers this split makes visible, not bundled in with the
plumbing that makes them visible. See ARCHIVE_PRIORITY below.

Run as part of the publish workflow after enriching new bills:
    python scripts/generate_sitemap.py

Environment:
    DB_PATH — path to SQLite database (default: common_ground_test.db)
"""

import json
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
PUBLIC = ROOT / "frontend" / "public"
HISTORY_JSON = PUBLIC / "data" / "legislative_history.json"
BLOG_JSON = PUBLIC / "data" / "blog_posts.json"

SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9"

# Concluded bills, kept in the index but marked as what they are: unchanging,
# and secondary to the bills still in play. Drop them from the sitemap
# entirely once Search Console shows whether they are being indexed at all.
#
# Two grades, because they are not all the same thing any more. A bill with
# grounding-checked "what this bill does" insights carries real writing;
# one with nothing has a headline, a lede and a summary over the same legal
# boilerplate as thousands of others.
ARCHIVE_PRIORITY = "0.2"
ARCHIVE_WITH_INSIGHTS_PRIORITY = "0.4"

NOW = datetime.now(timezone.utc).strftime("%Y-%m-%d")
CURRENT_YEAR = datetime.now(timezone.utc).year


def _history_years() -> list[int]:
    """Years with a generated year-in-review page (generate_legislative_narrative.py)."""
    if not HISTORY_JSON.exists():
        return []
    try:
        data = json.loads(HISTORY_JSON.read_text(encoding="utf-8"))
        return sorted(e["year"] for e in data.get("years", []))
    except Exception:
        return []


def _blog_posts() -> list[str]:
    """Slugs of published blog posts (frontend/lib/blog.ts)."""
    if not BLOG_JSON.exists():
        return []
    try:
        data = json.loads(BLOG_JSON.read_text(encoding="utf-8"))
        return [p["slug"] for p in data.get("posts", []) if p.get("slug")]
    except Exception:
        return []


def _add(urlset, loc: str, priority: str, freq: str, lastmod: str | None = None):
    """One <url> entry.

    Child order is loc, lastmod, changefreq, priority — the sitemaps.org
    schema declares them as an xsd:sequence, so anything else fails a strict
    validator. The previous generator emitted priority before changefreq and
    no lastmod at all; Google tolerated it, third-party validators did not.
    """
    u = SubElement(urlset, "url")
    SubElement(u, "loc").text = loc
    if lastmod:
        SubElement(u, "lastmod").text = lastmod
    SubElement(u, "changefreq").text = freq
    SubElement(u, "priority").text = priority


def _urlset() -> Element:
    return Element("urlset", xmlns=SITEMAP_NS)


def _content_lastmod(row: dict) -> str | None:
    """The newest date that reflects a real change to what a reader sees.

    Deliberately NOT `updated_at` or `last_updated`: both are pipeline
    timestamps, touched whenever a worker re-ran over the row. Using them
    would tell Google that all 8,680 pages changed on the day of the last
    backfill, which is false, and a lastmod that is routinely wrong is worse
    than none — crawlers learn to disregard it for the whole host.

    So: the day the argument was written if there is one, else the day the
    bill concluded, else the day it was introduced.
    """
    for key in ("two_lane_generated_at", "final_date", "introduced_date"):
        val = row.get(key)
        if val:
            return str(val)[:10]
    return None


def _write(tree: ElementTree, path: Path) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        tree.write(f, encoding="unicode", xml_declaration=False)
    return len(tree.getroot())


# ── Segments ─────────────────────────────────────────────────────────────────

def build_core(member_ids: list[str]) -> ElementTree:
    """Hand-built pages, year-in-review pages, blog posts, council members.

    These are the pages worth ranking: each one is written or aggregated
    rather than being one record out of 8,680.
    """
    urlset = _urlset()

    static = [
        # "/" is deliberately absent: it 308-redirects to /philadelphia, and a
        # sitemap should only list URLs that resolve 200. Listing both split the
        # ranking signal between them.
        (f"{BASE_URL}/philadelphia",                "1.0", "daily"),
        (f"{BASE_URL}/philadelphia/legislation",    "0.8", "daily"),
        (f"{BASE_URL}/philadelphia/insights",       "0.8", "weekly"),
        (f"{BASE_URL}/philadelphia/councilmembers", "0.7", "weekly"),
        (f"{BASE_URL}/budget",                      "0.8", "monthly"),
        (f"{BASE_URL}/blog",                        "0.7", "weekly"),
        (f"{BASE_URL}/about",                       "0.6", "monthly"),
        (f"{BASE_URL}/donate",                      "0.5", "monthly"),
        # /pricing and /legal are thin but public. The genuinely private
        # routes carry NOINDEX in the app and stay out of here.
        (f"{BASE_URL}/pricing",                     "0.3", "yearly"),
        (f"{BASE_URL}/legal",                       "0.3", "yearly"),
    ]
    # /elections is omitted on purpose: the candidates table is empty, so the
    # page renders no candidates and no predictions. Re-add it when it has
    # data — submitting an empty page is asking for a thin-content assessment
    # on a URL that cannot earn anything back.
    for loc, priority, freq in static:
        _add(urlset, loc, priority, freq, NOW)

    for year in _history_years():
        _add(urlset, f"{BASE_URL}/philadelphia/insights/{year}", "0.7",
             "weekly" if year == CURRENT_YEAR else "yearly", NOW)

    for slug in _blog_posts():
        _add(urlset, f"{BASE_URL}/blog/{slug}", "0.7", "monthly", NOW)

    for member_id in member_ids:
        _add(urlset, f"{BASE_URL}/philadelphia/councilmembers/{member_id}",
             "0.6", "monthly", NOW)

    indent(urlset, space="  ")
    return ElementTree(urlset)


def build_bills(rows: list[dict], archive: bool) -> ElementTree:
    """Bill pages, in two grades.

    `archive=False` is the product: a bill carrying a case for and against, or
    one still moving through Council. `archive=True` is a concluded bill whose
    page is a headline, a lede and a summary.
    """
    urlset = _urlset()
    for row in rows:
        if archive:
            priority = (ARCHIVE_WITH_INSIGHTS_PRIORITY if row["two_lane_insights"]
                        else ARCHIVE_PRIORITY)
            freq = "yearly"
        elif row["two_lane_state"] == "argued":
            # The pages the site exists for.
            priority, freq = "0.8", "monthly"
        else:
            # Live, but nothing written about it yet — still changing.
            priority, freq = "0.6", "weekly"
        _add(urlset, f"{BASE_URL}/philadelphia/legislation/{row['id']}",
             priority, freq, _content_lastmod(row))
    indent(urlset, space="  ")
    return ElementTree(urlset)


def build_index(segments: list[str]) -> ElementTree:
    """The sitemap index — the only file robots.txt points at."""
    root = Element("sitemapindex", xmlns=SITEMAP_NS)
    for name in segments:
        s = SubElement(root, "sitemap")
        SubElement(s, "loc").text = f"{BASE_URL}/{name}"
        SubElement(s, "lastmod").text = NOW
    indent(root, space="  ")
    return ElementTree(root)


def main():
    if not Path(DB_PATH).exists():
        print(f"ERROR: DB not found at {DB_PATH}")
        return 1

    print(f"Reading DB: {DB_PATH}")
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    bills = [dict(r) for r in conn.execute(
        "SELECT id, status, two_lane_state, two_lane_generated_at, "
        "       two_lane_insights, final_date, introduced_date "
        "FROM legislation WHERE level='local'"
    )]
    member_ids = [r[0] for r in conn.execute("SELECT id FROM councilmembers")]
    conn.close()

    ACTIVE = ("introduced", "in_committee")

    def is_featured(b: dict) -> bool:
        return b["two_lane_state"] == "argued" or b["status"] in ACTIVE

    featured = [b for b in bills if is_featured(b)]
    archived = [b for b in bills if not is_featured(b)]

    written = []
    for name, tree in (
        ("sitemap-core.xml",          build_core(member_ids)),
        ("sitemap-bills.xml",         build_bills(featured, archive=False)),
        ("sitemap-bills-archive.xml", build_bills(archived, archive=True)),
    ):
        n = _write(tree, PUBLIC / name)
        size = (PUBLIC / name).stat().st_size / 1024
        print(f"  {name:28} {n:>6,} URLs  {size:>6.0f} KB")
        written.append(name)

    _write(build_index(written), PUBLIC / "sitemap.xml")

    total = len(bills) + len(member_ids)
    argued = sum(1 for b in bills if b["two_lane_state"] == "argued")
    with_insights = sum(1 for b in archived if b["two_lane_insights"])
    print(f"\n  sitemap.xml                  index of {len(written)} segments")
    print(f"\n{len(featured):,} of {len(bills):,} bill pages are featured "
          f"({argued:,} argued, {len(featured) - argued:,} live without an argument); "
          f"{len(archived):,} archived "
          f"({with_insights:,} of those carry checked insights).")
    if archived and len(archived) > len(featured):
        print(f"NOTE: the archive is still the bulk of the sitemap. Check "
              f"indexed-vs-submitted per segment in Search Console before "
              f"deciding whether to drop it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
