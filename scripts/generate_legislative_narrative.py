"""
Generate a multi-decade legislative narrative for Philadelphia City Council.

Queries aggregate stats from the local SQLite DB, sends them to Ollama,
and writes the result to frontend/public/data/legislative_history.json.

That JSON file is fetched by the Insights page at runtime — no build step needed.

Usage:
    python scripts/generate_legislative_narrative.py

Environment (reads from .env if present, otherwise uses defaults):
    DB_PATH      — path to the SQLite database (default: common_ground_test.db)
    AI_BASE_URL  — Ollama base URL (default: http://localhost:11434)
    AI_MODEL     — model name (default: llama3.1:8b)
"""

import json
import os
import sqlite3
import sys
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path

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

DB_PATH     = os.environ.get("DB_PATH", str(ROOT / "common_ground_test.db"))
OLLAMA_URL  = os.environ.get("AI_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("AI_MODEL", "llama3.1:8b")
OUTPUT_PATH = ROOT / "frontend" / "public" / "data" / "legislative_history.json"


# ── DB queries ────────────────────────────────────────────────────────────────

def gather_stats(db_path: str) -> dict:
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("SELECT COUNT(*) FROM legislation WHERE level='local'")
    total = c.fetchone()[0]

    c.execute("""
        SELECT MIN(strftime('%Y', introduced_date)), MAX(strftime('%Y', introduced_date))
        FROM legislation WHERE level='local' AND introduced_date IS NOT NULL
    """)
    year_from, year_to = c.fetchone()

    c.execute("""
        SELECT strftime('%Y', introduced_date) as yr, COUNT(*) as n
        FROM legislation WHERE level='local' AND introduced_date IS NOT NULL
        GROUP BY yr ORDER BY n DESC LIMIT 5
    """)
    busiest = c.fetchall()

    current_year = str(datetime.now().year)
    c.execute("""
        SELECT strftime('%Y', introduced_date) as yr, COUNT(*) as n
        FROM legislation WHERE level='local' AND introduced_date IS NOT NULL
          AND strftime('%Y', introduced_date) < ?
        GROUP BY yr ORDER BY n ASC LIMIT 3
    """, (current_year,))
    quietest = c.fetchall()

    c.execute("""
        SELECT status, COUNT(*) as n FROM legislation WHERE level='local'
        GROUP BY status
    """)
    status_counts = dict(c.fetchall())
    signed   = status_counts.get("signed_into_law", 0)
    terminal = sum(status_counts.get(s, 0) for s in ["signed_into_law", "failed", "vetoed", "withdrawn", "tabled"])
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
        if not tags_str:
            continue
        try:
            tags = json.loads(tags_str) if tags_str.startswith("[") else [t.strip() for t in tags_str.split(",")]
            for tag in tags:
                tag = tag.strip()
                if tag:
                    tag_counter[tag] += 1
        except Exception:
            pass
    top_tags = tag_counter.most_common(8)

    conn.close()
    return {
        "total": total,
        "year_from": year_from,
        "year_to": year_to,
        "signed": signed,
        "terminal": terminal,
        "pass_rate": round(signed / terminal, 3) if terminal else 0.0,
        "active": active,
        "busiest": busiest,
        "quietest": quietest,
        "top_sponsors": top_sponsors,
        "top_tags": top_tags,
    }


# ── Prompt ────────────────────────────────────────────────────────────────────

def build_prompt(s: dict) -> str:
    years_span = int(s["year_to"]) - int(s["year_from"]) + 1
    pass_pct   = round(s["pass_rate"] * 100)
    tags_str   = ", ".join(f"{tag} ({n:,} bills)" for tag, n in s["top_tags"])
    sponsors_str = ", ".join(f"{name} ({n:,} bills)" for name, n in s["top_sponsors"])
    busiest_str  = ", ".join(f"{yr} ({n:,})" for yr, n in s["busiest"][:3])
    quietest_str = ", ".join(f"{yr} ({n:,})" for yr, n in s["quietest"][:2])

    current_year = datetime.now().year
    return f"""You are a data journalist writing a compelling narrative summary of {years_span} years of Philadelphia City Council legislative activity for a civic website called Open Common Ground.

KEY STATISTICS (note: {current_year} is a partial year — exclude it from year comparisons):
- Total bills introduced: {s["total"]:,} ({s["year_from"]}–{s["year_to"]})
- Bills signed into law: {s["signed"]:,} ({pass_pct}% of closed bills)
- Currently active: {s["active"]:,} bills (introduced or in committee)
- Most active years (completed years only): {busiest_str}
- Quietest years (completed years only): {quietest_str}
- Top issue areas: {tags_str}
- Most prolific sponsors: {sponsors_str}

Write exactly 3 paragraphs:
1. Open with the scale and historical significance of this data. Mention the specific year range and total bill count. Make it compelling — this is the first thing a curious Philadelphian will read.
2. Highlight 2–3 interesting patterns: which issues dominate the agenda, how volume has shifted over time, what the {pass_pct}% pass rate reveals about the legislative process, or any surprising findings in the data.
3. End by connecting the data to civic action — what Philadelphians can do with this information, why tracking legislation matters, and what Open Common Ground makes possible.

Rules:
- Use the actual numbers from the statistics above. Be specific.
- Write for a general audience, not policy experts. No jargon.
- Flowing paragraphs only — no bullet points, no headers.
- Each paragraph: 3–5 sentences.
- Do not start with "Philadelphia" — vary the opening.

Output ONLY the 3 paragraphs, nothing else."""


# ── Ollama call ───────────────────────────────────────────────────────────────

def call_ollama(prompt: str) -> str:
    url = f"{OLLAMA_URL}/api/generate"
    body = json.dumps({"model": OLLAMA_MODEL, "prompt": prompt, "stream": False}).encode()
    req  = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    print(f"  Calling {OLLAMA_URL} model={OLLAMA_MODEL} ...")
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read())["response"].strip()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not Path(DB_PATH).exists():
        print(f"ERROR: DB not found at {DB_PATH}")
        print("Set DB_PATH env var or ensure common_ground_test.db is in the project root.")
        sys.exit(1)

    print(f"Reading DB: {DB_PATH}")
    stats = gather_stats(DB_PATH)
    print(f"  {stats['total']:,} bills  |  {stats['year_from']}–{stats['year_to']}  |  {round(stats['pass_rate']*100)}% pass rate")
    print(f"  Top tags: {', '.join(t for t, _ in stats['top_tags'][:4])}")

    narrative = call_ollama(build_prompt(stats))
    print(f"  Narrative: {len(narrative)} chars")

    output = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "years_covered": {"from": int(stats["year_from"]), "to": int(stats["year_to"])},
        "total_bills": stats["total"],
        "key_stats": [
            {"label": "Bills Introduced", "value": f"{stats['total']:,}",  "note": f"{stats['year_from']}–{stats['year_to']}"},
            {"label": "Signed into Law",  "value": f"{stats['signed']:,}", "note": f"{round(stats['pass_rate']*100)}% of closed bills"},
            {"label": "Active Bills",     "value": f"{stats['active']:,}", "note": "in committee or introduced"},
            {
                "label": "Top Issue",
                "value": stats["top_tags"][0][0].replace("-", " ").title() if stats["top_tags"] else "—",
                "note":  f"{stats['top_tags'][0][1]:,} bills" if stats["top_tags"] else "",
            },
        ],
        "narrative": narrative,
        "top_issues":  [{"tag": t, "count": n} for t, n in stats["top_tags"]],
        "top_sponsors": [{"name": nm, "count": n} for nm, n in stats["top_sponsors"]],
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nSaved: {OUTPUT_PATH}")
    print("\n--- Narrative preview ---")
    print(narrative[:500] + ("..." if len(narrative) > 500 else ""))


if __name__ == "__main__":
    main()
