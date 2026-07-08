"""
Parse Philadelphia's annual operating-budget ordinances into a structured
25-year appropriations dataset.

Every "Adopting the Operating Budget for Fiscal Year XXXX" bill embeds the full
appropriation schedule in its text, in a stable structure:

    SECTION 2. Appropriations in the sum of (2,830,455,918) ... dollars are
    hereby made from the GENERAL FUND, as follows:
        2.1  TO THE COUNCIL
            Personal Services                 $ 10,866,020
            Purchase of Services                1,284,284
            ...
                Total                         $ 13,065,604
        2.2  TO THE MAYOR
            ...
    SECTION 3. ... hereby made from the WATER FUND, as follows:
        ...

Each fund declares its own total, which lets us CHECKSUM: the sum of the
department totals we parse for a fund must equal that fund's declared total.

Output: frontend/public/data/budget_history.json

Run:  python scripts/parse_budget_appropriations.py [--strict]
"""

import os
import re
import json
import sqlite3
import argparse
from datetime import datetime, timezone
from pathlib import Path

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
OUTPUT = ROOT / "frontend" / "public" / "data" / "budget_history.json"

# Canonical spending classes (line-item categories within a department). Each
# entry maps a leading-prefix (as it appears in the ordinance, possibly with a
# suffix like "Personal Services-Employee Benefits") to its display name.
CLASS_CANON = [
    ("personal services", "Personal Services"),
    ("purchase of services", "Purchase of Services"),
    ("materials", "Materials, Supplies and Equipment"),
    ("contributions", "Contributions, Indemnities and Taxes"),
    ("debt service", "Debt Service"),
    ("payments to other funds", "Payments to Other Funds"),
    ("advances", "Advances and Miscellaneous Payments"),
]

# Legistar page-break boilerplate, injected mid-text (even between a subsection
# number and its "TO THE", or between two class lines). Must be stripped first.
BOILER_RE = re.compile(
    r"City of Philadelphia\s+Printed on\s+\S+\s+Page\s+\d+\s+of\s+\d+\s+powered by Legistar\S*",
    re.IGNORECASE,
)
FILE_HDR_RE = re.compile(r"File\s*#:\s*[^\n,]+,\s*Version:\s*\d+", re.IGNORECASE)


def _strip_boilerplate(text: str) -> str:
    text = BOILER_RE.sub("\n", text)
    text = FILE_HDR_RE.sub("\n", text)
    return text


# A fund declaration. Robust to three drifts seen across 27 years:
#   - number before OR after the word "dollars"
#       "(2,830,455,918) two billion ... dollars are hereby made from the GENERAL FUND"
#       "... thousand dollars (883,898,000) are hereby made from the WATER FUND"
#   - the fund NAME wrapping across a newline
#       "... from the HEALTHCHOICES BEHAVIORAL HEALTH\nREVENUE FUND"
#   - "are hereby made from" OR "authorized ... to be paid from" (Municipal Pension Fund)
# A missed declaration makes the PRIOR fund absorb this one, so this must not miss any.
FUND_DECL_RE = re.compile(
    r"\(([\d,]{6,})\)[^)]*?(?:made|paid)\s+from\s+the\s+([A-Z][A-Z0-9 \-&'/,\r\n]*?FUND)\b",
    re.IGNORECASE | re.DOTALL,
)

# Each fund's appropriations live under one "SECTION N." header. Bounding a fund
# segment at the next SECTION header (rather than the next fund declaration) stops
# a fund from bleeding into the next one when a declaration's phrasing is missed.
SECTION_HDR_RE = re.compile(r"\bSECTION\s+\d+\b", re.IGNORECASE)

# A department subsection header. Format drifts wildly across 27 years:
#   "2.1  TO THE COUNCIL"                  (clean, early years)
#   "2.30TO THE STREETS"                   (number jammed to text)
#   "2.1 . . . . . TO THE\n\n\nCOUNCIL"    (dot leaders between number and TO THE,
#                                           name on a later line)
# So: number, then any run of whitespace/dot-leaders, then "TO THE".
DEPT_START_RE = re.compile(r"\b\d+\.\d+[\s.]*TO\s+THE\b", re.IGNORECASE)

# A "Total ... amount" line (tolerates dot leaders and an optional $).
TOTAL_RE = re.compile(r"Total[\s.]*\$?\s*([\d,]{4,})")

# A class line: "<label> .... $ 1,234,567" — label may carry a suffix
# ("Personal Services-Employee Benefits"); a run of 3+ dot/space leaders then the
# amount (which may sit on the next line) separates label from figure.
CLASS_LINE_RE = re.compile(r"([A-Za-z][A-Za-z ,/&'\-]+?)[\s.]{3,}\$?\s*([\d,]{2,})(?=\s|$)")


def _class_amounts(body: str) -> dict:
    """Sum each department's spending classes, bucketed to the canonical set.

    Only the portion before the department's Total line is scanned, so a Total
    figure (or a merged neighbour) can't leak in.
    """
    cut = re.split(r"Total[\s.]*\$?\s*[\d,]{4,}", body, maxsplit=1)[0]
    out: dict[str, int] = {}
    for m in CLASS_LINE_RE.finditer(cut):
        label = m.group(1).strip().lower()
        amt = int(m.group(2).replace(",", ""))
        for prefix, canon in CLASS_CANON:
            if label.startswith(prefix):
                out[canon] = out.get(canon, 0) + amt
                break
    return out


def _clean_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", raw).strip()
    name = name.strip(" .-:")
    return name


def parse_bill(full_text: str) -> list[dict]:
    """Return a list of fund dicts: {fund, declared_total, parsed_total, checksum_ok, departments[]}."""
    full_text = _strip_boilerplate(full_text)
    decls = list(FUND_DECL_RE.finditer(full_text))
    section_starts = [s.start() for s in SECTION_HDR_RE.finditer(full_text)]
    funds = []
    for i, m in enumerate(decls):
        declared = int(m.group(1).replace(",", ""))
        fund = _clean_name(m.group(2)).upper()
        seg_start = m.end()
        # End at the next SECTION header after this declaration, falling back to the
        # next fund declaration (or end of text) if none is found.
        nxt_section = next((p for p in section_starts if p > seg_start), None)
        nxt_decl = decls[i + 1].start() if i + 1 < len(decls) else len(full_text)
        seg_end = min(nxt_section, nxt_decl) if nxt_section else nxt_decl
        segment = full_text[seg_start:seg_end]

        # Split the fund segment into department subsections.
        starts = list(DEPT_START_RE.finditer(segment))
        dept_map: dict[str, dict] = {}
        for j, ds in enumerate(starts):
            d_start = ds.end()
            d_end = starts[j + 1].start() if j + 1 < len(starts) else len(segment)
            body = segment[d_start:d_end]
            # Name = text up to the first class keyword or Total.
            nm = re.split(
                r"\n\s*(?:Personal Services|Purchase of Services|Materials|Contributions|Debt Service|Payments to|Advances|Total)\b",
                body,
                maxsplit=1,
                flags=re.IGNORECASE,
            )[0]
            name = _clean_name(nm)
            if not name:
                continue
            totals = TOTAL_RE.findall(body)
            if not totals:
                continue
            # Each department prints exactly one "Total". If the head regex misses a
            # neighbouring department, its "Total" falls into this body too — so sum
            # every Total here rather than dropping all but the last. This keeps the
            # fund total exact even when a head is occasionally unmatched.
            total = sum(int(t.replace(",", "")) for t in totals)
            classes = _class_amounts(body)
            # Same department can appear in multiple subsections — accumulate.
            if name in dept_map:
                dept_map[name]["total"] += total
                for k, v in classes.items():
                    dept_map[name]["classes"][k] = dept_map[name]["classes"].get(k, 0) + v
            else:
                dept_map[name] = {"name": name, "total": total, "classes": classes}

        departments = sorted(dept_map.values(), key=lambda d: -d["total"])
        parsed_total = sum(d["total"] for d in departments)
        funds.append({
            "fund": fund,
            "declared_total": declared,
            "parsed_total": parsed_total,
            "checksum_ok": parsed_total == declared,
            "checksum_delta": parsed_total - declared,
            "departments": departments,
        })
    return funds


def _fiscal_year(title: str) -> int | None:
    m = re.search(r"Fiscal Year\s+(\d{4})", title, re.IGNORECASE)
    return int(m.group(1)) if m else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="Exit non-zero if any fund fails checksum")
    args = ap.parse_args()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """SELECT id, bill_number, title, substr(introduced_date,1,10) AS intro, full_text
           FROM legislation
           WHERE lower(title) LIKE 'adopting the operating budget%' AND full_text IS NOT NULL
           ORDER BY introduced_date"""
    ).fetchall()
    conn.close()

    # Group candidate bills by fiscal year; keep every candidate for now.
    by_fy: dict[int, list[dict]] = {}
    for r in rows:
        fy = _fiscal_year(r["title"])
        if not fy:
            continue
        parsed = parse_bill(r["full_text"])
        by_fy.setdefault(fy, []).append({
            "fiscal_year": fy,
            "bill_number": r["bill_number"],
            "bill_id": r["id"],
            "introduced": r["intro"],
            "funds": parsed,
            "_ok_funds": sum(1 for f in parsed if f["checksum_ok"]),
            "_n_funds": len(parsed),
        })

    # Per FY, pick the candidate with the most clean-checksum funds (ties -> latest introduced).
    years = []
    revisions = []
    for fy in sorted(by_fy):
        cands = sorted(by_fy[fy], key=lambda x: (x["_ok_funds"], x["introduced"]))
        chosen = cands[-1]
        for c in cands[:-1]:
            revisions.append({"fiscal_year": fy, "bill_number": c["bill_number"],
                              "ok_funds": c["_ok_funds"], "n_funds": c["_n_funds"]})
        years.append(chosen)

    # A fund total is "verified" if it matches the bill's own declared total within
    # a small tolerance (source PDFs carry occasional OCR/rounding artifacts of a few
    # hundred to a few hundred-thousand dollars on multi-billion-dollar budgets).
    TOL_ABS, TOL_FRAC = 500_000, 0.001  # $500k or 0.1%, whichever is larger

    def _material(f):
        tol = max(TOL_ABS, TOL_FRAC * f["declared_total"])
        return abs(f["checksum_delta"]) > tol

    for y in years:
        for f in y["funds"]:
            f["verified"] = not _material(f)
        y["complete"] = all(f["verified"] for f in y["funds"])

    # Report
    print(f"Parsed {len(years)} fiscal years (FY{years[0]['fiscal_year']}-FY{years[-1]['fiscal_year']})")
    all_ok = True
    for y in years:
        bad = [f for f in y["funds"] if _material(f)]
        flag = "OK " if not bad else f"!! {len(bad)} fund(s) off"
        gf = next((f for f in y["funds"] if f["fund"] == "GENERAL FUND"), None)
        gf_str = f"GF={gf['declared_total']:,}" if gf else "GF=?"
        print(f"  FY{y['fiscal_year']} {y['bill_number']:9} funds={y['_n_funds']:<2} {gf_str:22} {flag}")
        if bad:
            all_ok = False
            for f in bad:
                print(f"        off: {f['fund']:28} declared={f['declared_total']:>14,} parsed={f['parsed_total']:>14,} delta={f['checksum_delta']:>+13,}")
    if revisions:
        print(f"\n  ({len(revisions)} superseded/revised bill(s) set aside: " +
              ", ".join(f"FY{r['fiscal_year']}:{r['bill_number']}" for r in revisions) + ")")

    # Write dataset (strip internal fields)
    for y in years:
        y.pop("_ok_funds", None); y.pop("_n_funds", None)
    all_funds = sorted({f["fund"] for y in years for f in y["funds"]})
    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "Philadelphia annual operating-budget ordinances (Legistar)",
        "fiscal_years": [y["fiscal_year"] for y in years],
        "funds": all_funds,
        "years": years,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nWrote {OUTPUT}  ({OUTPUT.stat().st_size/1024:.0f} KB)")

    if args.strict and not all_ok:
        raise SystemExit("Some funds failed checksum (see above).")


if __name__ == "__main__":
    main()
