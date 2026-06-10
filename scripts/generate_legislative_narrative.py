"""
Generate the legislative narrative for Philadelphia City Council — two stages:

  Stage 1: For each year with data, build a rich stats packet (volume, pass
           rate, tag trends, top sponsors, notable bills, contested votes,
           time-to-passage) and have the LLM write a structured year-in-review
           (headline + narrative + key themes). Numbers shown in the UI come
           straight from the DB; the LLM only writes interpretive text.

  Stage 2: Feed all the year summaries back to the LLM to synthesize the
           overall multi-decade narrative.

Output goes to frontend/public/data/legislative_history.json, which the
Insights page fetches at runtime — no build step needed.

Year entries are cached in the output file itself: completed past years are
not regenerated on subsequent runs (their data can't change), only the
current year and the overall synthesis are refreshed.

Usage:
    python scripts/generate_legislative_narrative.py              # incremental
    python scripts/generate_legislative_narrative.py --force      # regenerate everything
    python scripts/generate_legislative_narrative.py --years 2024,2025

Environment (reads from .env if present, otherwise uses defaults):
    DB_PATH      — path to the SQLite database (default: common_ground_test.db)
    AI_BASE_URL  — Ollama base URL (default: http://localhost:11434)
    AI_MODEL     — model name (default: llama3.1:8b)
"""

import argparse
import json
import os
import re
import sqlite3
import statistics
import sys
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

# ── Config ────────────────────────────────────────────────────────────────────

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

DB_PATH      = os.environ.get("DB_PATH", str(ROOT / "common_ground_test.db"))
OLLAMA_URL   = os.environ.get("AI_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("AI_MODEL", "llama3.1:8b")
OUTPUT_PATH  = ROOT / "frontend" / "public" / "data" / "legislative_history.json"

TERMINAL_STATUSES = ["signed_into_law", "failed", "vetoed", "withdrawn", "tabled"]


# ── Shared helpers ────────────────────────────────────────────────────────────

def _parse_tags(tags_str: str | None) -> list[str]:
    if not tags_str:
        return []
    try:
        tags = json.loads(tags_str) if tags_str.startswith("[") else [t.strip() for t in tags_str.split(",")]
        return [t.strip() for t in tags if t and t.strip()]
    except Exception:
        return []


def _bill_title(row: dict) -> str:
    return row.get("plain_title") or row.get("headline") or row.get("title") or row.get("bill_number") or "Untitled"


# ── DB queries ────────────────────────────────────────────────────────────────

def gather_overall_stats(conn: sqlite3.Connection) -> dict:
    c = conn.cursor()

    c.execute("SELECT COUNT(*) FROM legislation WHERE level='local'")
    total = c.fetchone()[0]

    c.execute("""
        SELECT MIN(strftime('%Y', introduced_date)), MAX(strftime('%Y', introduced_date))
        FROM legislation WHERE level='local' AND introduced_date IS NOT NULL
    """)
    year_from, year_to = c.fetchone()

    c.execute("""
        SELECT status, COUNT(*) FROM legislation WHERE level='local' GROUP BY status
    """)
    status_counts = dict(c.fetchall())
    signed   = status_counts.get("signed_into_law", 0)
    terminal = sum(status_counts.get(s, 0) for s in TERMINAL_STATUSES)
    active   = sum(status_counts.get(s, 0) for s in ["introduced", "in_committee"])

    c.execute("""
        SELECT sponsor, COUNT(*) as n FROM legislation
        WHERE level='local' AND sponsor IS NOT NULL AND sponsor != ''
        GROUP BY sponsor ORDER BY n DESC LIMIT 5
    """)
    top_sponsors = c.fetchall()

    c.execute("SELECT tags FROM legislation WHERE level='local' AND tags IS NOT NULL AND analyzed_at IS NOT NULL")
    tag_counter: Counter = Counter()
    for (tags_str,) in c.fetchall():
        for tag in _parse_tags(tags_str):
            tag_counter[tag] += 1
    top_tags = tag_counter.most_common(8)

    return {
        "total": total,
        "year_from": year_from,
        "year_to": year_to,
        "signed": signed,
        "terminal": terminal,
        "pass_rate": round(signed / terminal, 3) if terminal else 0.0,
        "active": active,
        "top_sponsors": top_sponsors,
        "top_tags": top_tags,
    }


def gather_tag_counts_by_year(conn: sqlite3.Connection) -> dict[int, Counter]:
    """One pass over all analyzed bills -> per-year tag Counters (for trend deltas)."""
    c = conn.cursor()
    c.execute("""
        SELECT strftime('%Y', introduced_date), tags FROM legislation
        WHERE level='local' AND introduced_date IS NOT NULL
          AND tags IS NOT NULL AND analyzed_at IS NOT NULL
    """)
    by_year: dict[int, Counter] = {}
    for year_str, tags_str in c.fetchall():
        year = int(year_str)
        counter = by_year.setdefault(year, Counter())
        for tag in _parse_tags(tags_str):
            counter[tag] += 1
    return by_year


def gather_year_stats(conn: sqlite3.Connection, year: int, tag_counts_by_year: dict[int, Counter]) -> dict:
    """Build the full stats packet for one year."""
    c = conn.cursor()
    ystr = str(year)

    c.execute("""
        SELECT status, COUNT(*) FROM legislation
        WHERE level='local' AND strftime('%Y', introduced_date) = ?
        GROUP BY status
    """, (ystr,))
    status_counts = dict(c.fetchall())
    total    = sum(status_counts.values())
    signed   = status_counts.get("signed_into_law", 0)
    terminal = sum(status_counts.get(s, 0) for s in TERMINAL_STATUSES)
    # Philly council terms run 4 years (2024–2027, ...); pending bills die at
    # term end, so non-terminal bills from prior terms are dead, not active.
    now_year = datetime.now().year
    current_term_start = now_year - (now_year % 4)
    nonterminal = status_counts.get("introduced", 0) + status_counts.get("in_committee", 0)
    died_in_committee = nonterminal if year < current_term_start else 0
    still_pending     = nonterminal if year >= current_term_start else 0

    c.execute("""
        SELECT COUNT(*) FROM legislation
        WHERE level='local' AND strftime('%Y', introduced_date) = ?
    """, (str(year - 1),))
    prior_total = c.fetchone()[0]

    # Time to passage — signed bills introduced this year with a final date
    c.execute("""
        SELECT julianday(final_date) - julianday(introduced_date) FROM legislation
        WHERE level='local' AND strftime('%Y', introduced_date) = ?
          AND status='signed_into_law' AND final_date IS NOT NULL
          AND julianday(final_date) >= julianday(introduced_date)
    """, (ystr,))
    spans = [r[0] for r in c.fetchall()]
    median_days = round(statistics.median(spans)) if spans else None

    # Tags: this year's top, plus biggest movers vs prior year
    tags_now   = tag_counts_by_year.get(year, Counter())
    tags_prior = tag_counts_by_year.get(year - 1, Counter())
    top_tags = [{"tag": t, "count": n} for t, n in tags_now.most_common(8)]
    deltas = {t: tags_now.get(t, 0) - tags_prior.get(t, 0)
              for t in set(tags_now) | set(tags_prior)}
    movers = sorted(deltas.items(), key=lambda kv: abs(kv[1]), reverse=True)
    rising  = [{"tag": t, "delta": d} for t, d in movers if d > 2][:4]
    falling = [{"tag": t, "delta": d} for t, d in movers if d < -2][:4]

    c.execute("""
        SELECT sponsor, COUNT(*) as n FROM legislation
        WHERE level='local' AND strftime('%Y', introduced_date) = ?
          AND sponsor IS NOT NULL AND sponsor != ''
        GROUP BY sponsor ORDER BY n DESC LIMIT 5
    """, (ystr,))
    top_sponsors = [{"name": name, "count": n} for name, n in c.fetchall()]

    # Notable bills — highest-impact substantive legislation
    c.execute("""
        SELECT id, bill_number, plain_title, headline, title, lede, impact_score, status, tags
        FROM legislation
        WHERE level='local' AND strftime('%Y', introduced_date) = ?
          AND impact_score IS NOT NULL AND bill_type = 'substantive'
        ORDER BY impact_score DESC, introduced_date ASC LIMIT 5
    """, (ystr,))
    cols = [d[0] for d in c.description]
    notable_bills = []
    for row in c.fetchall():
        r = dict(zip(cols, row))
        notable_bills.append({
            "id": r["id"],
            "bill_number": r["bill_number"],
            "title": _bill_title(r),
            "lede": r["lede"],
            "impact_score": r["impact_score"],
            "status": r["status"],
            "tags": _parse_tags(r["tags"])[:4],
        })

    # Contested bills — roll calls with at least one Nay
    # (bill_vote_records.action_date is not populated, so the year join goes
    # through the bill's introduced_date)
    c.execute("""
        SELECT v.legislation_id,
               SUM(CASE WHEN v.vote='Yea' THEN 1 ELSE 0 END) AS yeas,
               SUM(CASE WHEN v.vote='Nays' THEN 1 ELSE 0 END) AS nays
        FROM bill_vote_records v
        JOIN legislation l ON l.id = v.legislation_id
        WHERE l.level='local' AND strftime('%Y', l.introduced_date) = ?
        GROUP BY v.legislation_id
        HAVING nays > 0
        ORDER BY nays DESC, yeas ASC
    """, (ystr,))
    contested_rows = c.fetchall()
    contested_count = len(contested_rows)

    contested_bills = []
    for leg_id, yeas, nays in contested_rows[:5]:
        c.execute("""
            SELECT id, bill_number, plain_title, headline, title, status FROM legislation WHERE id = ?
        """, (leg_id,))
        bcols = [d[0] for d in c.description]
        bill = dict(zip(bcols, c.fetchone()))
        c.execute("""
            SELECT voter_name FROM bill_vote_records
            WHERE legislation_id = ? AND vote='Nays' ORDER BY voter_name
        """, (leg_id,))
        dissenters = [r[0] for r in c.fetchall()]
        contested_bills.append({
            "id": bill["id"],
            "bill_number": bill["bill_number"],
            "title": _bill_title(bill),
            "status": bill["status"],
            "yeas": int(yeas),
            "nays": int(nays),
            "dissenters": dissenters,
        })

    return {
        "year": year,
        "total": total,
        "delta_vs_prior": total - prior_total if prior_total else None,
        "signed": signed,
        "failed": status_counts.get("failed", 0),
        "vetoed": status_counts.get("vetoed", 0),
        "died_in_committee": died_in_committee,
        "still_pending": still_pending,
        "pass_rate": round(signed / terminal, 3) if terminal else None,
        "median_days_to_passage": median_days,
        "top_tags": top_tags,
        "rising_tags": rising,
        "falling_tags": falling,
        "top_sponsors": top_sponsors,
        "notable_bills": notable_bills,
        "contested_count": contested_count,
        "contested_bills": contested_bills,
    }


# ── Prompts ───────────────────────────────────────────────────────────────────

def build_year_prompt(s: dict, is_partial_year: bool) -> str:
    tags_str = ", ".join(f"{t['tag']} ({t['count']})" for t in s["top_tags"][:6]) or "none"
    sponsors_str = ", ".join(f"{sp['name']} ({sp['count']} bills)" for sp in s["top_sponsors"][:3]) or "none"
    rising_str  = ", ".join(f"{t['tag']} (+{t['delta']})" for t in s["rising_tags"]) or "none"
    falling_str = ", ".join(f"{t['tag']} ({t['delta']})" for t in s["falling_tags"]) or "none"

    notable_str = "\n".join(
        f"- Bill {b['bill_number']}: {b['title']} (impact {b['impact_score']}/10, {b['status'].replace('_', ' ')})"
        + (f" — {b['lede']}" if b.get("lede") else "")
        for b in s["notable_bills"]
    ) or "none"

    contested_str = "\n".join(
        f"- Bill {b['bill_number']}: {b['title']} — passed {b['yeas']}-{b['nays']}"
        f" (dissenting: {', '.join(b['dissenters'][:5])})"
        for b in s["contested_bills"]
    ) or "none — every roll call this year was unanimous"

    if s["pass_rate"] is not None:
        pass_str = (
            f"of the bills that reached a final vote, {round(s['pass_rate'] * 100)}% became law"
            " (bills that died in committee never reached a vote and are NOT counted in that percentage"
            " — never describe the pass rate as a share of all introduced bills)"
        )
    else:
        pass_str = "pass rate unavailable"
    delta_str = ""
    if s["delta_vs_prior"] is not None:
        word = "more" if s["delta_vs_prior"] >= 0 else "fewer"
        delta_str = f" ({abs(s['delta_vs_prior'])} {word} than the year before)"
    partial_note = "\nNOTE: This year is still in progress — the numbers are partial. Frame the analysis accordingly." if is_partial_year else ""

    fate_extra = ""
    if s.get("died_in_committee"):
        fate_extra = f" | Died in committee when the council term ended: {s['died_in_committee']}"
    elif s.get("still_pending"):
        fate_extra = f" | Still pending: {s['still_pending']}"

    return f"""You are a data journalist writing a year-in-review of Philadelphia City Council legislative activity in {s["year"]} for a civic website called Open Common Ground.{partial_note}

DATA FOR {s["year"]}:
- Bills introduced: {s["total"]}{delta_str}
- Signed into law: {s["signed"]} | Failed: {s["failed"]} | Vetoed: {s["vetoed"]}{fate_extra} | {pass_str}
- Median days from introduction to becoming law: {s["median_days_to_passage"] if s["median_days_to_passage"] is not None else "n/a"}
- Top issue areas: {tags_str}
- Issues on the rise vs prior year: {rising_str}
- Issues declining vs prior year: {falling_str}
- Most active sponsors: {sponsors_str}
- Highest-impact bills:
{notable_str}
- Contested votes ({s["contested_count"]} bills drew at least one Nay this year):
{contested_str}

Respond with ONLY a JSON object, no markdown fences, in exactly this shape:
{{
  "headline": "a punchy newspaper-style headline for the council's {s["year"]} (max 12 words)",
  "narrative": "two short paragraphs separated by \\n\\n analyzing the year: what dominated the agenda, what shifted vs the prior year, what the contested votes reveal. Use the actual numbers above. Plain language for a general audience.",
  "key_themes": ["3 to 5 short theme phrases, each 2-5 words"]
}}

Rules:
- Use only facts and numbers from the data above. Do not invent events, names, or causes.
- Do not speculate about why something happened unless the data shows it.
- No jargon. No bullet points inside the narrative.
"""


def build_synthesis_prompt(overall: dict, year_entries: list[dict]) -> str:
    pass_pct = round(overall["pass_rate"] * 100)
    tags_str = ", ".join(f"{tag} ({n:,} bills)" for tag, n in overall["top_tags"])
    sponsors_str = ", ".join(f"{name} ({n:,} bills)" for name, n in overall["top_sponsors"])
    current_year = datetime.now().year
    n_years = int(overall["year_to"]) - int(overall["year_from"]) + 1
    avg_per_year = round(overall["total"] / n_years)
    total_contested = sum(e["stats"]["contested_count"] for e in year_entries)

    year_lines = []
    for e in sorted(year_entries, key=lambda x: x["year"]):
        s = e["stats"]
        themes = "; ".join(e.get("key_themes", [])[:3])
        year_lines.append(
            f"- {e['year']}: {s['total']} bills, top issue {s['top_tags'][0]['tag'] if s['top_tags'] else 'n/a'},"
            f" {s['contested_count']} contested votes. {e.get('headline', '')} Themes: {themes}"
        )
    years_block = "\n".join(year_lines)

    return f"""You are a data journalist writing a compelling narrative summary of {int(overall["year_to"]) - int(overall["year_from"]) + 1} years of Philadelphia City Council legislative activity for a civic website called Open Common Ground.

OVERALL STATISTICS (note: {current_year} is a partial year):
- Total bills introduced: {overall["total"]:,} ({overall["year_from"]}–{overall["year_to"]})
- Average per year: {avg_per_year} bills
- Bills signed into law: {overall["signed"]:,} ({pass_pct}% of closed bills)
- Bills that drew at least one Nay vote across all years combined: {total_contested} — every other roll call was unanimous
- Currently active: {overall["active"]:,} bills
- Top issue areas: {tags_str}
- Most prolific sponsors: {sponsors_str}

YEAR-BY-YEAR SUMMARIES (each generated from the underlying bill data):
{years_block}

Write exactly 3 paragraphs:
1. Open with the scale and historical significance of this data. Mention the specific year range and total bill count. Make it compelling — this is the first thing a curious Philadelphian will read.
2. Trace the big arcs across the years using the summaries above: which issues rose and fell, identifiable eras or turning points, what the {pass_pct}% pass rate and the rarity of contested votes reveal about how the council works.
3. End by connecting the data to civic action — what Philadelphians can do with this information and why tracking legislation matters.

Rules:
- Use only facts and numbers given above. Be specific. Do not invent events.
- Do not perform arithmetic or derive new figures — quote numbers exactly as provided.
- Never describe one number as a multiple or fraction of another (no "twice", "three times", "a third of").
- Write for a general audience, not policy experts. No jargon.
- Flowing paragraphs only — no bullet points, no headers.
- Each paragraph: 3–5 sentences.
- Do not start with "Philadelphia" — vary the opening.

Output ONLY the 3 paragraphs, nothing else."""


# ── Ollama call ───────────────────────────────────────────────────────────────

def call_ollama(prompt: str, format_schema: dict | None = None) -> str:
    url = f"{OLLAMA_URL}/api/generate"
    payload: dict = {"model": OLLAMA_MODEL, "prompt": prompt, "stream": False}
    if format_schema:
        # Ollama enforces the JSON schema on the output (structured outputs)
        payload["format"] = format_schema
    body = json.dumps(payload).encode()
    req  = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read())["response"].strip()


YEAR_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "headline":   {"type": "string"},
        "narrative":  {"type": "string"},
        "key_themes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["headline", "narrative", "key_themes"],
}


def extract_json(text: str) -> dict | None:
    """Pull the first JSON object out of an LLM response, tolerating fences/preamble."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None


def generate_year_analysis(stats: dict, is_partial_year: bool, attempts: int = 3) -> dict:
    """Call the LLM for one year, with retries on malformed JSON."""
    prompt = build_year_prompt(stats, is_partial_year)
    for attempt in range(1, attempts + 1):
        raw = call_ollama(prompt, format_schema=YEAR_ANALYSIS_SCHEMA)
        parsed = extract_json(raw)
        if parsed and parsed.get("headline") and parsed.get("narrative"):
            themes = parsed.get("key_themes")
            if not isinstance(themes, list):
                themes = []
            return {
                "headline": str(parsed["headline"]).strip(),
                "narrative": str(parsed["narrative"]).strip(),
                "key_themes": [str(t).strip() for t in themes if str(t).strip()][:5],
            }
        print(f"    attempt {attempt}: malformed JSON, retrying...")
    # Fallback: use the raw text as narrative so the run never hard-fails
    return {
        "headline": f"Philadelphia City Council in {stats['year']}",
        "narrative": raw,
        "key_themes": [],
    }


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--years", help="Comma-separated years to (re)generate, e.g. 2024,2025")
    parser.add_argument("--force", action="store_true", help="Regenerate all years, ignoring cached entries")
    parser.add_argument("--skip-synthesis", action="store_true", help="Skip the overall narrative (stage 2)")
    args = parser.parse_args()

    if not Path(DB_PATH).exists():
        print(f"ERROR: DB not found at {DB_PATH}")
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    current_year = datetime.now().year

    print(f"Reading DB: {DB_PATH}")
    overall = gather_overall_stats(conn)
    tag_counts_by_year = gather_tag_counts_by_year(conn)
    db_years = sorted(tag_counts_by_year.keys())
    print(f"  {overall['total']:,} bills | {overall['year_from']}–{overall['year_to']} | {len(db_years)} years")

    # Load cached year entries from the previous output
    cached: dict[int, dict] = {}
    existing_output = None
    if OUTPUT_PATH.exists():
        try:
            existing_output = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
            for e in existing_output.get("years", []):
                cached[e["year"]] = e
        except Exception:
            pass

    if args.years:
        requested = sorted({int(y.strip()) for y in args.years.split(",") if y.strip()})
    else:
        requested = db_years

    year_entries: dict[int, dict] = {}
    to_generate = []
    for year in requested:
        if year not in db_years:
            print(f"  WARNING: no bills found for {year}, skipping")
            continue
        # Past years with a cached AI analysis are final — skip unless forced.
        if not args.force and not args.years and year in cached and year != current_year:
            year_entries[year] = cached[year]
            continue
        to_generate.append(year)

    # Years cached but outside --years selection are kept as-is
    if args.years:
        for year, entry in cached.items():
            if year not in requested:
                year_entries[year] = entry

    print(f"  Generating {len(to_generate)} year(s): {to_generate or 'none'} | reusing {len(year_entries)} cached")

    for i, year in enumerate(to_generate, 1):
        print(f"[{i}/{len(to_generate)}] {year} — gathering stats...")
        stats = gather_year_stats(conn, year, tag_counts_by_year)
        print(f"    {stats['total']} bills, {stats['contested_count']} contested, top tag: "
              f"{stats['top_tags'][0]['tag'] if stats['top_tags'] else 'n/a'} — calling {OLLAMA_MODEL}...")
        analysis = generate_year_analysis(stats, is_partial_year=(year == current_year))
        year_entries[year] = {
            "year": year,
            "is_partial": year == current_year,
            "headline": analysis["headline"],
            "narrative": analysis["narrative"],
            "key_themes": analysis["key_themes"],
            "stats": {k: v for k, v in stats.items() if k not in ("notable_bills", "contested_bills")},
            "notable_bills": stats["notable_bills"],
            "contested_bills": stats["contested_bills"],
            "generated_at": _utc_now_iso(),
        }
        print(f"    \"{analysis['headline']}\"")

    years_list = [year_entries[y] for y in sorted(year_entries)]

    # Stage 2 — overall synthesis from the year summaries
    if args.skip_synthesis and existing_output and existing_output.get("narrative"):
        narrative = existing_output["narrative"]
        print("Skipping synthesis (kept existing overall narrative)")
    else:
        print(f"Synthesizing overall narrative from {len(years_list)} year summaries...")
        narrative = call_ollama(build_synthesis_prompt(overall, years_list))
        print(f"  Narrative: {len(narrative)} chars")

    output = {
        "generated_at": _utc_now_iso(),
        "years_covered": {"from": int(overall["year_from"]), "to": int(overall["year_to"])},
        "total_bills": overall["total"],
        "key_stats": [
            {"label": "Bills Introduced", "value": f"{overall['total']:,}",  "note": f"{overall['year_from']}–{overall['year_to']}"},
            {"label": "Signed into Law",  "value": f"{overall['signed']:,}", "note": f"{round(overall['pass_rate']*100)}% of closed bills"},
            {"label": "Active Bills",     "value": f"{overall['active']:,}", "note": "in committee or introduced"},
            {
                "label": "Top Issue",
                "value": overall["top_tags"][0][0].replace("-", " ").title() if overall["top_tags"] else "—",
                "note":  f"{overall['top_tags'][0][1]:,} bills" if overall["top_tags"] else "",
            },
        ],
        "narrative": narrative,
        "top_issues":  [{"tag": t, "count": n} for t, n in overall["top_tags"]],
        "top_sponsors": [{"name": nm, "count": n} for nm, n in overall["top_sponsors"]],
        "years": years_list,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    conn.close()
    print(f"\nSaved: {OUTPUT_PATH} ({len(years_list)} year entries)")


if __name__ == "__main__":
    main()
