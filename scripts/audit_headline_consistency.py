"""Find AI headlines, ledes and summaries that contradict each other or the bill.

A live review on 2026-10-23 found readers seeing, one under the other:
  "Plan to Pour $1 Billion into City Infrastructure" / a summary about a
  $7.59 billion budget; "FY2027 Budget Signed into Law" / "pending council
  approval"; a Kensington headline over a summary about Fishtown. On a site
  whose pitch is accuracy, each of these is a credibility leak, so this lists
  every bill that trips one of four checks:

  money    a dollar figure in the headline that appears nowhere in the summary
           or bill text, when the summary does state figures of its own
  status   a bill signed into law whose summary still describes it as pending
  place    a Philadelphia neighborhood named in the headline that appears
           nowhere in the bill's title, description or full text
  loaded   editorializing words in AI text ("chaos", "towering", ...), which
           read as the site taking a side

It only reads. Output: a CSV in logs/ plus counts. Feed the ids to the regen
script (behind the GPU guard) rather than editing text by hand.

    python scripts/audit_headline_consistency.py
"""
import csv
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "common_ground_test.db"

sys.path.insert(0, str(ROOT))
from app.services.headline_checks import amounts, loaded_words, unsupported_places  # noqa: E402

PENDING = re.compile(
    r"pending (?:city )?council approval|if (?:passed|approved|enacted)|awaiting (?:council|final) approval"
    r"|has not yet been (?:passed|approved|signed)|is expected to be voted|proposed budget",
    re.I,
)

def main() -> None:
    con = sqlite3.connect(DB)
    rows = con.execute(
        "SELECT id, bill_number, status, headline, lede, summary, title, description, full_text "
        "FROM legislation WHERE level='local' AND headline IS NOT NULL"
    ).fetchall()

    findings = []
    for bid, num, status, headline, lede, summary, title, desc, full in rows:
        source = " ".join(filter(None, [title, desc, full]))
        h_amt = amounts(headline)
        if h_amt:
            s_amt = amounts(summary) | amounts(lede)
            missing = {a for a in h_amt if a not in s_amt and a not in amounts(source)}
            if missing and s_amt:
                findings.append((bid, num, status, "money",
                                 f"headline ${sorted(missing)} not in summary ${sorted(s_amt)[:4]}", headline))
        if status == "signed_into_law" and summary and PENDING.search(summary):
            findings.append((bid, num, status, "status", PENDING.search(summary).group(0), headline))
        places = unsupported_places(headline, source)
        if places:
            findings.append((bid, num, status, "place", f"{places[0]} not in bill text", headline))
        for field, text in (("headline", headline), ("lede", lede), ("summary", summary)):
            words = loaded_words(text)
            if words:
                findings.append((bid, num, status, "loaded", f"{field}: {words[0]}", headline))

    out = ROOT / "logs" / f"headline-audit-{datetime.now():%Y%m%d}.csv"
    out.parent.mkdir(exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "bill_number", "status", "check", "detail", "headline"])
        w.writerows(findings)

    by_check: dict[str, int] = {}
    for f_ in findings:
        by_check[f_[3]] = by_check.get(f_[3], 0) + 1
    print(f"{len(rows)} bills checked, {len(findings)} findings, "
          f"{len({f_[0] for f_ in findings})} distinct bills -> {out.relative_to(ROOT)}")
    for k, v in sorted(by_check.items()):
        print(f"  {k:7} {v}")
    sys.stdout.reconfigure(encoding="utf-8")
    for check in ("money", "status", "place", "loaded"):
        sample = [f_ for f_ in findings if f_[3] == check][:3]
        for f_ in sample:
            print(f"  [{check}] {f_[1]} ({f_[2]}): {f_[4]} | {f_[5][:90]}")


if __name__ == "__main__":
    main()
