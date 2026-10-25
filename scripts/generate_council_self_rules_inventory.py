"""Build the coded inventory behind the post on bills about Council's own rules.

WHY THIS EXISTS
---------------
The post "A Councilmember Plans to Retire Between Terms..." makes a counted
claim: on six subjects (hiring relatives, outside income, term limits, public
money for campaigns, a redistricting commission, DROP for elected officials),
27 of 28 bills introduced 2000 through 2023 never got a recorded vote. Outside
reviewers asked, fairly, how the universe was built and whether the subjects
were picked after looking at outcomes. They were, and the post says so. This
file is the answer to the rest: every bill that changes a rule governing the
city's elected officials or the people who deal with them, coded by subject,
with outcome, Legistar tally and the official link, published as
frontend/public/data/council-self-rules-2000-2023.csv so anyone can recount.

TRAPS IT HANDLES (each nearly shipped)
--------------------------------------
- status == 'lapsed' includes bills voted DOWN on the floor (000505 failed
  7-10, 030710 7-7, 051023 8-8). Lapsed is not the same as never voted.
- bill_vote_records can disagree with Legistar (040772-AA: 12-5 in the table,
  "Pass 16:1" in Legistar). Tallies here are parsed from the action history in
  full_text, newest action first, never from bill_vote_records.
- Some 2019-2021 Legistar texts carry no tallies at all (190083-A, 210080);
  those rows say so instead of guessing.
- The coding (C below) is judgment. Rows marked "not counted" explain why, so
  a reader can disagree with a call instead of having to find it.

Usage:
    python scripts/generate_council_self_rules_inventory.py
"""
import csv
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "common_ground_test.db"
OUT = ROOT / "frontend" / "public" / "data" / "council-self-rules-2000-2023.csv"

NEVER = "Never got a recorded vote (counted)"
DROPC = "DROP for elected officials (counted)"
PASSED = "Subject that became law on recorded votes"
LOOSE = "Loosened rules, or kept them loose"
MEMBER = "Rule on members that passed"
MAPS = "District maps (required every census)"
OTHER = "Other ethics or campaign finance change"
NOTCOUNT = "Coded but not counted (see note)"
CONTEXT = "DROP for all employees (context)"
LATER = "After 2023, mentioned in the post"

# bill -> (subject, how it figures in the post, note)
C = {
    # The five never-voted subjects
    "010743": ("Hiring relatives", NEVER, "Reported out of committee April 2003, placed on the final passage calendar May 2003, never called"),
    "040115": ("Hiring relatives", NEVER, ""),
    "040428": ("Hiring relatives", NEVER, "Rewrite of the whole ethics code, including anti-nepotism rules"),
    "040770": ("Hiring relatives", NEVER, "Rewrite of the whole ethics code, including anti-nepotism rules"),
    "040761": ("Hiring relatives", NEVER, "Rewrite of the whole ethics code, including anti-nepotism rules"),
    "070705": ("Hiring relatives", NEVER, ""),
    "080662": ("Hiring relatives", NEVER, ""),
    "070795": ("Outside jobs and income", NEVER, ""),
    "080660": ("Outside jobs and income", NEVER, ""),
    "211021": ("Outside jobs and income", NEVER, "Would cap a councilmember's outside earned income at $25,000 a year"),
    "100010": ("Term limits", NEVER, "Council: three consecutive terms"),
    "200017": ("Term limits", NEVER, "Council: four terms, counting terms that begin in 2024 or later"),
    "220117": ("Term limits", NEVER, "Council: four terms, counting terms that begin in 2024 or later"),
    "200077": ("Term limits", NEVER, "Council and Controller term limits, bundled with a resign-to-run repeal"),
    "200078": ("Term limits", NEVER, "City Commissioners and Sheriff"),
    "070069": ("Public money for campaigns", NEVER, ""),
    "070070": ("Public money for campaigns", NEVER, "Ballot question"),
    "170680": ("Public money for campaigns", NEVER, ""),
    "170682": ("Public money for campaigns", NEVER, "Ballot question on public matching funds"),
    "180241": ("Public money for campaigns", NEVER, "Advisory ballot question"),
    "200014": ("Public money for campaigns", NEVER, "Advisory ballot question"),
    "220048": ("Public money for campaigns", NEVER, ""),
    "220362": ("Redistricting commission", NEVER, "Ballot question"),
    # DROP
    "040269": ("DROP for elected officials", DROPC, "Officials first taking office on or after January 2, 2006"),
    "080020": ("DROP for elected officials", DROPC, "Exempts officials already enrolled or with 8 years of city service"),
    "090209": ("DROP for elected officials", DROPC, "No exemptions"),
    "100542": ("DROP for elected officials", DROPC, "Would end DROP for everyone not already enrolled"),
    "100095": ("DROP for elected officials", DROPC, "Conforms to state Act 44 of 2009; officials already serving keep DROP"),
    # Subjects that became law
    "000505": ("Campaign contribution limits", PASSED, ""),
    "030562": ("Campaign contribution limits", PASSED, ""),
    "080663": ("Campaign contribution limits", PASSED, "Would have lowered the limits"),
    "130078": ("Campaign contribution limits", PASSED, "Would have applied the limits to sitting officials year-round"),
    "050168": ("Campaign contribution limits", PASSED, "Limits for other city offices"),
    "050301-A": ("Campaign contribution limits", PASSED, "Limits for other city offices"),
    "051097": ("Campaign contribution limits", PASSED, "Limits for other city offices"),
    "000356": ("Pay to play", PASSED, ""),
    "000357": ("Pay to play", PASSED, "Ballot question"),
    "020823": ("Pay to play", PASSED, ""),
    "020824": ("Pay to play", PASSED, "Ballot question"),
    "030710": ("Pay to play", PASSED, ""),
    "040002": ("Pay to play", PASSED, ""),
    "040772-AA": ("Pay to play", PASSED, "No-bid contracts and city aid"),
    "051023": ("Pay to play", PASSED, "Competitively bid contracts"),
    "050613": ("Pay to play", PASSED, "City financial assistance"),
    "130585": ("Pay to play", PASSED, ""),
    "190786-AA": ("Pay to play", PASSED, "Revisions"),
    "040267": ("Board of Ethics", PASSED, "Ballot question"),
    "040762": ("Board of Ethics", PASSED, "Ballot question"),
    "050460": ("Board of Ethics", PASSED, "Ballot question"),
    "040769": ("Board of Ethics", PASSED, "Ballot question that created the Board"),
    "051024": ("Board of Ethics", PASSED, "Board powers and penalties, including mandatory ethics training for city officers and employees"),
    "110072": ("Board of Ethics", PASSED, "Adjudication"),
    "100125": ("Board of Ethics", PASSED, "Penalties"),
    "050577": ("Ethics training", PASSED, "Training became law in 2005 through 051024"),
    "070271": ("Ethics training", PASSED, "Training became law in 2005 through 051024"),
    "170013": ("Ethics training", PASSED, "Training became law in 2005 through 051024"),
    "050461": ("Lobbyist registration", PASSED, ""),
    "070172": ("Lobbyist registration", PASSED, ""),
    "080661": ("Lobbyist registration", PASSED, ""),
    "100127": ("Lobbyist registration", PASSED, ""),
    "110556": ("Lobbyist registration", PASSED, "Amendments"),
    "070828": ("Gifts", PASSED, ""),
    "080658": ("Gifts", PASSED, ""),
    "140054-A": ("Gifts", PASSED, "Binds members of Council"),
    # Loosening or keeping
    "030641": ("Pay for elected officials", LOOSE, "Raise plus automatic cost-of-living increases"),
    "140056": ("Pay for elected officials", LOOSE, "Majority deputy whip"),
    "060617": ("Resign to run", LOOSE, "Ballot question; voters said no in 2007"),
    "130701-AA": ("Resign to run", LOOSE, "Ballot question; voters said no in 2014"),
    "040155": ("Resign to run", LOOSE, "Bundled with electing the Council President at large"),
    "120248": ("Resign to run", LOOSE, "Would have made officials of other governments resign to run for city office"),
    "100122": ("Fundraising", LOOSE, "Transition and inauguration committees"),
    "100124": ("Fundraising", LOOSE, "Litigation funds"),
    "100126": ("Fundraising", LOOSE, "Sample ballot spending not counted as a contribution"),
    "050057": ("Campaign contribution limits", LOOSE, "Would have repealed the 2003 limits"),
    "110443": ("DROP", LOOSE, "Kept DROP and trimmed its costs; heard the same day as 100542"),
    # Rules on members that passed
    "060433-A": ("Residency", MEMBER, "Ballot question: district members must live in the district"),
    "110716": ("Ethics code", MEMBER, "Family-member ethics rules extended to life partners"),
    "220360": ("Ethics code", MEMBER, "Retaliation and interference with Board of Ethics cases"),
    "140743": ("Pensions", MEMBER, "Applies to officials elected later"),
    # District maps
    "010529": ("District maps", MAPS, ""), "010523": ("District maps", MAPS, ""), "010650": ("District maps", MAPS, ""),
    "010646": ("District maps", MAPS, ""), "020761-A": ("District maps", MAPS, ""), "110547": ("District maps", MAPS, ""),
    "110546": ("District maps", MAPS, ""), "110661": ("District maps", MAPS, ""), "220003": ("District maps", MAPS, ""),
    "220444": ("District maps", MAPS, "Counts prisoners at home addresses"),
    # Other ethics and campaign finance changes
    "050014": ("Campaign finance disclosure", OTHER, ""), "060629": ("Campaign finance", OTHER, ""),
    "070044": ("Campaign finance", OTHER, "Self-funding candidates"), "070068": ("Campaign finance", OTHER, "Self-funding candidates"),
    "080659": ("Campaign finance", OTHER, "Political committees raising money for officials"),
    "110073": ("Campaign finance", OTHER, ""), "130082": ("Campaign finance disclosure", OTHER, ""),
    "150368": ("Campaign finance disclosure", OTHER, ""), "170681": ("Campaign finance", OTHER, ""),
    "180240": ("Campaign finance", OTHER, ""),
    "190083-A": ("Campaign finance", OTHER, "Final tally missing from the Legistar text in our copy"),
    "220049": ("Campaign finance", OTHER, ""), "220361": ("Campaign finance", OTHER, ""),
    "160514": ("Ethics code", OTHER, "Conflict-of-interest restatement"), "210954": ("Ethics code", OTHER, "Financial interest disclosure"),
    "220047": ("Ethics code", OTHER, "Conflict-of-interest revisions"), "210080": ("Ethics code", OTHER, "Statements of financial interests; final tally missing from the Legistar text in our copy"),
    # Coded but not counted
    "070459-A": ("Charter Inspector General", NOTCOUNT, "Not counted: the record does not show whether the office would have covered Council. Reached the final passage calendar in 2007"),
    "080007": ("Charter Inspector General", NOTCOUNT, "Not counted: unclear whether the office would have covered Council"),
    "100123": ("Charter Inspector General", NOTCOUNT, "Not counted: unclear whether the office would have covered Council"),
    "220050": ("Charter Inspector General", NOTCOUNT, "Not counted: unclear whether the office would have covered Council"),
    "020076": ("Redistricting process", NOTCOUNT, "Not counted: the amendment's text is in a resolution that is not in the record"),
    "040116": ("Redistricting process", NOTCOUNT, "Not counted: the amendment's text is in a resolution that is not in the record"),
    "080646": ("Council elections", NOTCOUNT, "At-large nominations; direction unclear"),
    "220046": ("Candidacy", NOTCOUNT, "Age requirement for city office"),
    # DROP for all employees, context for the DROP list
    "020622": ("DROP", CONTEXT, ""), "020623": ("DROP", CONTEXT, ""), "030610": ("DROP", CONTEXT, "Replaces one test DROP with another"),
    "060506": ("DROP", CONTEXT, ""), "060695": ("DROP", CONTEXT, ""), "090188": ("DROP", CONTEXT, ""),
    "110003": ("DROP", CONTEXT, ""), "140206": ("DROP", CONTEXT, ""), "180821": ("DROP", CONTEXT, "New employees only"),
    # Later
    "241056": ("Resign to run", LATER, "Passed 2026, then repealed by 260263 before the May 2026 ballot"),
    "260263": ("Resign to run", LATER, "Repealed 241056 in April 2026"),
}

NAMES = {
    "Councilmember Nutter": "Michael Nutter", "Councilmember Rizzo": "Frank Rizzo Jr.", "Councilmember Blackwell": "Jannie Blackwell",
    "Councilmember Kenney": "Jim Kenney", "Councilmember Goode": "W. Wilson Goode Jr.", "Councilmember Domb": "Allan Domb",
    "Council President Clarke": "Darrell Clarke", "Councilmember Clarke": "Darrell Clarke", "Councilmember Tasco": "Marian Tasco",
    "Councilmember Ortiz": "Angel Ortiz", "Councilmember Cohen": "David Cohen", "Councilmember Johnson": "Kenyatta Johnson",
    "Councilmember Thomas": "Isaiah Thomas", "Councilmember Jones": "Curtis Jones Jr.", "Councilmember Henon": "Bobby Henon",
    "Council President Verna": "Anna Verna", "Councilmember O'Neill": "Brian O'Neill", "Councilmember DiCicco": "Frank DiCicco",
    "Councilmember Greenlee": "William Greenlee", "Councilmember Oh": "David Oh", "Councilmember Miller": "Donna Reed Miller",
    "Councilmember Campbell": "Carol Ann Campbell",
}


def sponsor_name(raw, year):
    raw = (raw or "").strip()
    if raw == "Councilmember Green":
        return "Derek Green" if year >= 2016 else "Bill Green"
    if "nchez" in raw:
        return "Maria Quiñones Sánchez"
    return NAMES.get(raw, raw)


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("\ufffd", '"')).strip()


ACTION = re.compile(r"(VETO OVERRIDDEN|READ AND PASSED|PASSED|FAILED)\s+CITY COUNCIL\s+(\d{1,2}/\d{1,2}/\d{4})\s+\d+\s+(Pass|Fail) (\d+):(\d+)")


def outcome_and_vote(status, full_text):
    t = re.sub(r"\s+", " ", full_text or "")
    i = t.find("Action By Date")
    hist = t[i:i + 4000] if i >= 0 else ""
    m = ACTION.search(hist)  # Legistar lists newest action first
    vote = f"{m.group(4)}-{m.group(5)}" if m else ""
    overridden = "VETO OVERRIDDEN" in hist
    if status == "signed_into_law":
        if overridden:
            return "Enacted over veto", vote
        if "NO ACTION TAKEN" in hist and "POCKET" not in hist:
            return "Became law without signature", vote
        return "Signed into law", vote
    if status == "lapsed":
        return ("Failed on the floor", vote) if m and m.group(3) == "Fail" else ("Lapsed, no recorded vote", "")
    if status == "vetoed":
        return "Vetoed", vote
    if status == "failed":
        return "Failed", vote
    return status, vote


con = sqlite3.connect(DB)
rows = []
for bn, (subject, role, note) in C.items():
    r = con.execute(
        "select id, substr(introduced_date,1,4), sponsor, title, status, full_text, external_url from legislation where bill_number=? and level='local'",
        (bn,),
    ).fetchone()
    assert r, bn
    lid, year, sponsor, title, status, ft, ext = r
    outcome, vote = outcome_and_vote(status, ft)
    if bn == "241056":
        outcome = "Repealed before the ballot"
    rows.append({
        "bill_number": bn, "introduced": year, "sponsor": sponsor_name(sponsor, int(year)),
        "subject": subject, "role_in_post": role, "outcome": outcome, "recorded_vote": vote,
        "note": note, "official_title": clean(title), "legistar_url": ext or "",
        "site_url": f"https://opencommonground.com/philadelphia/legislation/{lid}",
    })

rows.sort(key=lambda x: (list(dict.fromkeys(v[1] for v in C.values())).index(x["role_in_post"]), x["subject"], x["introduced"], x["bill_number"]))
with open(OUT, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

# Checks the post depends on
counted = [x for x in rows if x["role_in_post"] in (NEVER, DROPC)]
unvoted = [x for x in counted if x["outcome"] == "Lapsed, no recorded vote"]
members = {x["sponsor"] for x in unvoted}
print("rows", len(rows))
print("counted on six subjects:", len(counted), "| no recorded vote:", len(unvoted), "| members:", len(members), sorted(members))
print("bills on the five never-voted subjects:", len([x for x in rows if x["role_in_post"] == NEVER]))
for x in rows:
    if x["role_in_post"] in (NEVER, DROPC) and x["outcome"] != "Lapsed, no recorded vote":
        print("  not unvoted:", x["bill_number"], x["outcome"], x["recorded_vote"])
for subject in ["Campaign contribution limits", "Pay to play", "Board of Ethics", "Lobbyist registration", "Gifts", "Ethics training"]:
    sub = [x for x in rows if x["subject"] == subject]
    print(f"  {subject}: {len(sub)} bills; laws: {[x['bill_number']+' '+x['recorded_vote'] for x in sub if x['outcome'] in ('Signed into law','Enacted over veto','Became law without signature')]}; floor losses: {[x['bill_number']+' '+x['recorded_vote'] for x in sub if x['outcome']=='Failed on the floor']}")
print("em dashes:", sum(v.count("\u2014") for x in rows for v in x.values()))
missing_vote = [x["bill_number"] for x in rows if x["outcome"] in ("Signed into law", "Enacted over veto") and not x["recorded_vote"]]
print("enacted without a parsed tally:", missing_vote)
