"""Insights and analytics API routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, extract, case
from sqlalchemy.orm import Session
from app.models.database import get_db
from app.models import Legislation, BillVoteRecord, Councilmember
from app.services.name_matching import surname as _last_name, strip_title as _short_name
from app.tag_categories import categories_for_tags

router = APIRouter(prefix="/api/insights", tags=["insights"])

STATUS_ORDER = [
    "introduced",
    "in_committee",
    "awaiting_mayor",
    "died_in_committee",
    "lapsed",
    "signed_into_law",
    "failed",
    "vetoed",
    "withdrawn",
    "tabled",
]

STATUS_LABELS = {
    "introduced":      "Introduced",
    "in_committee":    "In Committee",
    "awaiting_mayor":  "Awaiting Mayor",
    "died_in_committee": "Died in Committee",
    "lapsed":          "Lapsed",
    "signed_into_law": "Signed into Law",
    "failed":          "Failed",
    "vetoed":          "Vetoed",
    "withdrawn":       "Withdrawn",
    "tabled":          "Tabled",
}


def current_term_start(year: int | None = None) -> int:
    """First year of the current Philadelphia City Council term.

    Terms run four calendar years starting the January after each municipal
    election (2020–2023, 2024–2027, ...). Pending legislation dies when the
    term ends, so a bill still "introduced"/"in_committee" from a prior term
    is dead — Legistar just never updates its status. "died_in_committee" is
    derived from that rule at read time; it is never written to the DB.
    """
    from datetime import datetime
    y = year or datetime.utcnow().year
    return y - (y % 4)


@router.get("/status-by-year")
async def get_status_by_year(
    from_year: int = Query(default=0, description="Start year (0 = all years)"),
    to_year:   int = Query(default=0, description="End year (0 = current)"),
    tag:       str = Query(default="", max_length=60),
    db: Session = Depends(get_db),
):
    """
    Returns bill counts broken down by year and status.
    Used by the insights timeline funnel chart.
    """
    from sqlalchemy import or_
    from datetime import datetime

    current_year = datetime.utcnow().year
    effective_from = from_year if from_year else 2000
    effective_to   = to_year   if to_year   else current_year

    q = (
        db.query(
            extract("year", Legislation.introduced_date).label("year"),
            Legislation.status,
            func.count(Legislation.id).label("count"),
        )
        .filter(
            Legislation.introduced_date.isnot(None),
            Legislation.level == "local",
            extract("year", Legislation.introduced_date) >= effective_from,
            extract("year", Legislation.introduced_date) <= effective_to,
        )
    )

    if tag:
        tag_list = [t.strip() for t in tag.split(",") if t.strip()]
        q = q.filter(or_(*[Legislation.tags.ilike(f'%"{t}"%') for t in tag_list]))

    rows = q.group_by("year", Legislation.status).order_by("year").all()

    term_start = current_term_start()

    # Reshape into {year: {status: count}}. Non-terminal bills from prior
    # council terms are reclassified as died_in_committee (see helper above).
    by_year: dict[int, dict[str, int]] = {}
    all_years: set[int] = set()
    for row in rows:
        year = int(row.year)
        all_years.add(year)
        if year not in by_year:
            by_year[year] = {}
        status = row.status or "unknown"
        if year < term_start and status in ("introduced", "in_committee", "awaiting_mayor"):
            status = "died_in_committee"
        by_year[year][status] = by_year[year].get(status, 0) + row.count

    years_sorted = sorted(all_years)

    result = []
    for year in years_sorted:
        counts = by_year.get(year, {})
        total = sum(counts.values())
        entry = {"year": year, "total": total}
        for status in STATUS_ORDER:
            entry[status] = counts.get(status, 0)
        # catch any statuses not in STATUS_ORDER
        entry["other"] = sum(v for k, v in counts.items() if k not in STATUS_ORDER)
        result.append(entry)

    return {
        "years": result,
        "statuses": STATUS_ORDER,
        "status_labels": STATUS_LABELS,
        "from_year": effective_from,
        "to_year": effective_to,
        "all_from_year": min(all_years) if all_years else effective_from,
    }


@router.get("/tag-by-year")
async def get_tag_by_year(
    from_year: int = Query(default=0),
    to_year:   int = Query(default=0),
    top_n:     int = Query(default=10, le=25),
    db: Session = Depends(get_db),
):
    """Top N tags by bill count per year."""
    from datetime import datetime
    import json

    current_year = datetime.utcnow().year
    effective_from = from_year if from_year else 2000
    effective_to   = to_year   if to_year   else current_year

    bills = (
        db.query(
            extract("year", Legislation.introduced_date).label("year"),
            Legislation.tags,
        )
        .filter(
            Legislation.introduced_date.isnot(None),
            Legislation.level == "local",
            Legislation.tags.isnot(None),
            Legislation.analyzed_at.isnot(None),
            extract("year", Legislation.introduced_date) >= effective_from,
            extract("year", Legislation.introduced_date) <= effective_to,
        )
        .all()
    )

    from collections import defaultdict, Counter
    year_tag_counts: dict[int, Counter] = defaultdict(Counter)
    for row in bills:
        year = int(row.year)
        try:
            tags = json.loads(row.tags) if row.tags.startswith("[") else [t.strip() for t in row.tags.split(",")]
            for tag in tags:
                tag = tag.strip()
                if tag:
                    year_tag_counts[year][tag] += 1
        except Exception:
            pass

    # Find global top_n tags across all years
    global_counts: Counter = Counter()
    for counter in year_tag_counts.values():
        global_counts.update(counter)
    top_tags = [tag for tag, _ in global_counts.most_common(top_n)]

    years_sorted = sorted(year_tag_counts.keys())
    result = []
    for year in years_sorted:
        entry = {"year": year}
        for tag in top_tags:
            entry[tag] = year_tag_counts[year].get(tag, 0)
        result.append(entry)

    return {"years": result, "tags": top_tags}


@router.get("/summary")
async def get_insights_summary(db: Session = Depends(get_db)):
    """High-level summary stats for the insights page hero section."""
    from datetime import datetime

    current_year = datetime.utcnow().year
    TERMINAL = ["signed_into_law", "failed", "vetoed", "withdrawn", "tabled"]

    term_start = current_term_start(current_year)

    total = db.query(func.count(Legislation.id)).filter(Legislation.level == "local").scalar()
    # Only bills from the current council term can still move; older
    # non-terminal bills died when their term ended.
    active = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        Legislation.status.in_(["introduced", "in_committee", "awaiting_mayor"]),
        extract("year", Legislation.introduced_date) >= term_start,
    ).scalar()
    died_in_committee = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        Legislation.status.in_(["introduced", "in_committee", "awaiting_mayor"]),
        extract("year", Legislation.introduced_date) < term_start,
    ).scalar()
    this_year = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        extract("year", Legislation.introduced_date) == current_year,
    ).scalar()
    last_year = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        extract("year", Legislation.introduced_date) == current_year - 1,
    ).scalar()
    signed = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        Legislation.status == "signed_into_law",
    ).scalar()
    terminal_total = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        Legislation.status.in_(TERMINAL),
    ).scalar()
    avg_impact = db.query(func.avg(Legislation.impact_score)).filter(
        Legislation.level == "local",
        Legislation.impact_score.isnot(None),
        Legislation.analyzed_at.isnot(None),
    ).scalar()
    years_covered = db.query(
        func.min(extract("year", Legislation.introduced_date)),
        func.max(extract("year", Legislation.introduced_date)),
    ).filter(Legislation.level == "local", Legislation.introduced_date.isnot(None)).first()
    last_fetched = db.query(func.max(Legislation.last_updated)).filter(
        Legislation.level == "local"
    ).scalar()

    pass_rate = round(signed / terminal_total, 3) if terminal_total else 0.0

    return {
        "total_bills": total,
        "active_bills": active,
        "died_in_committee": died_in_committee,
        "current_term_start": term_start,
        "bills_this_year": this_year,
        "bills_last_year": last_year,
        "signed_into_law": signed,
        "pass_rate": pass_rate,
        "avg_impact_score": round(float(avg_impact), 1) if avg_impact else None,
        "years_from": int(years_covered[0]) if years_covered[0] else current_year,
        "years_to": int(years_covered[1]) if years_covered[1] else current_year,
        "last_fetched_at": last_fetched.isoformat() + "Z" if last_fetched else None,  # naive UTC, see /stats
    }


@router.get("/impact-by-year")
async def get_impact_by_year(
    from_year: int = Query(default=0),
    to_year:   int = Query(default=0),
    db: Session = Depends(get_db),
):
    """Bill type and impact level breakdown per year."""
    from datetime import datetime

    current_year = datetime.utcnow().year
    effective_from = from_year if from_year else 2000
    effective_to   = to_year   if to_year   else current_year

    rows = (
        db.query(
            extract("year", Legislation.introduced_date).label("year"),
            Legislation.bill_type,
            Legislation.impact_level,
            func.count(Legislation.id).label("count"),
        )
        .filter(
            Legislation.introduced_date.isnot(None),
            Legislation.level == "local",
            Legislation.analyzed_at.isnot(None),
            extract("year", Legislation.introduced_date) >= effective_from,
            extract("year", Legislation.introduced_date) <= effective_to,
        )
        .group_by("year", Legislation.bill_type, Legislation.impact_level)
        .order_by("year")
        .all()
    )

    by_year: dict[int, dict] = {}
    for row in rows:
        year = int(row.year)
        if year not in by_year:
            by_year[year] = {
                "year": year,
                "total": 0,
                "bill_type": {"substantive": 0, "ceremonial": 0, "procedural": 0, "unknown": 0},
                "impact_level": {"high": 0, "medium": 0, "low": 0},
            }
        by_year[year]["total"] += row.count
        bt = row.bill_type or "unknown"
        il = row.impact_level
        if bt in by_year[year]["bill_type"]:
            by_year[year]["bill_type"][bt] += row.count
        else:
            by_year[year]["bill_type"]["unknown"] += row.count
        if il in by_year[year]["impact_level"]:
            by_year[year]["impact_level"][il] += row.count

    return {"years": sorted(by_year.values(), key=lambda x: x["year"])}


@router.get("/sponsor-leaderboard")
async def get_sponsor_leaderboard(
    year:  int = Query(default=0, description="Year filter (0 = all time)"),
    limit: int = Query(default=15, le=50),
    db: Session = Depends(get_db),
):
    """Top sponsors ranked by bill volume and pass rate."""
    from sqlalchemy import extract

    TERMINAL = ["signed_into_law", "failed", "vetoed", "withdrawn", "tabled"]

    q = (
        db.query(
            Legislation.sponsor,
            func.count(Legislation.id).label("total"),
            func.sum(case((Legislation.status == "signed_into_law", 1), else_=0)).label("signed"),
            func.sum(case((Legislation.status.in_(TERMINAL), 1), else_=0)).label("terminal"),
            func.avg(
                case((Legislation.impact_score.isnot(None), Legislation.impact_score), else_=None)
            ).label("avg_impact"),
        )
        .filter(
            Legislation.level == "local",
            Legislation.sponsor.isnot(None),
            Legislation.sponsor != "",
        )
    )
    if year:
        q = q.filter(extract("year", Legislation.introduced_date) == year)

    rows = (
        q.group_by(Legislation.sponsor)
        .order_by(func.count(Legislation.id).desc())
        .limit(limit)
        .all()
    )

    sponsors = []
    for row in rows:
        terminal = int(row.terminal or 0)
        signed = int(row.signed or 0)
        sponsors.append({
            "sponsor": row.sponsor,
            "total": int(row.total),
            "signed_into_law": signed,
            "not_passed": terminal - signed,
            "pass_rate": round(signed / terminal, 3) if terminal else 0.0,
            "avg_impact_score": round(float(row.avg_impact), 1) if row.avg_impact else None,
        })

    return {"sponsors": sponsors, "year": year}


@router.get("/committee-activity")
async def get_committee_activity(
    year:  int = Query(default=0, description="Year filter (0 = all time)"),
    top_n: int = Query(default=12, le=30),
    db: Session = Depends(get_db),
):
    """Top committees by bill volume with pass rate breakdown."""
    from sqlalchemy import extract

    TERMINAL = ["signed_into_law", "failed", "vetoed", "withdrawn", "tabled"]

    q = (
        db.query(
            Legislation.committee,
            func.count(Legislation.id).label("total"),
            func.sum(case((Legislation.status == "signed_into_law", 1), else_=0)).label("signed"),
            func.sum(case((Legislation.status == "in_committee", 1), else_=0)).label("in_committee"),
            func.sum(case((Legislation.status == "introduced", 1), else_=0)).label("introduced"),
            func.sum(case((Legislation.status == "awaiting_mayor", 1), else_=0)).label("awaiting_mayor"),
            func.sum(case((Legislation.status.in_(TERMINAL), 1), else_=0)).label("terminal"),
        )
        .filter(
            Legislation.level == "local",
            Legislation.committee.isnot(None),
            Legislation.committee != "",
        )
    )
    if year:
        q = q.filter(extract("year", Legislation.introduced_date) == year)

    rows = (
        q.group_by(Legislation.committee)
        .order_by(func.count(Legislation.id).desc())
        .limit(top_n)
        .all()
    )

    committees = []
    for row in rows:
        terminal = int(row.terminal or 0)
        signed = int(row.signed or 0)
        committees.append({
            "committee": row.committee,
            "total": int(row.total),
            "signed_into_law": signed,
            "in_committee": int(row.in_committee or 0),
            "introduced": int(row.introduced or 0),
            "awaiting_mayor": int(row.awaiting_mayor or 0),
            "not_passed": terminal - signed,
            "pass_rate": round(signed / terminal, 3) if terminal else 0.0,
        })

    return {"committees": committees, "year": year}


# ── Roll-call vote analytics ─────────────────────────────────────────────────
# Council roll calls are overwhelmingly unanimous — only ~4% of voted bills
# ever draw a Nay. These endpoints surface that contested minority, plus
# per-member voting profiles and pairwise agreement, all computed from
# bill_vote_records. Note: action_date is not populated on vote records, so
# year filters go through the bill's introduced_date.

def _nay_count():
    return func.sum(case((BillVoteRecord.vote == "Nays", 1), else_=0))


@router.get("/contested-bills")
async def get_contested_bills(
    year:  int = Query(default=0, description="Year filter (0 = all time)"),
    sort:  str = Query(default="nays", pattern="^(nays|closest|recent)$"),
    limit: int = Query(default=15, le=50),
    db: Session = Depends(get_db),
):
    """Bills whose roll call drew at least one Nay, with the vote split and dissenters."""
    agg = (
        db.query(
            BillVoteRecord.legislation_id.label("lid"),
            func.sum(case((BillVoteRecord.vote == "Yea", 1), else_=0)).label("yeas"),
            _nay_count().label("nays"),
            func.group_concat(
                case((BillVoteRecord.vote == "Nays", BillVoteRecord.voter_name), else_=None), "|"
            ).label("dissenters"),
        )
        .group_by(BillVoteRecord.legislation_id)
        .having(_nay_count() > 0)
        .subquery()
    )

    q = (
        db.query(
            Legislation.id,
            Legislation.bill_number,
            Legislation.plain_title,
            Legislation.headline,
            Legislation.title,
            Legislation.status,
            Legislation.impact_score,
            Legislation.introduced_date,
            agg.c.yeas,
            agg.c.nays,
            agg.c.dissenters,
        )
        .join(agg, agg.c.lid == Legislation.id)
        .filter(Legislation.level == "local")
    )
    if year:
        q = q.filter(extract("year", Legislation.introduced_date) == year)

    total = q.count()

    if sort == "closest":
        q = q.order_by((agg.c.yeas - agg.c.nays).asc(), agg.c.nays.desc())
    elif sort == "recent":
        q = q.order_by(Legislation.introduced_date.desc())
    else:
        q = q.order_by(agg.c.nays.desc(), (agg.c.yeas - agg.c.nays).asc())

    bills = []
    for row in q.limit(limit).all():
        bills.append({
            "id": row.id,
            "bill_number": row.bill_number,
            "title": row.plain_title or row.headline or row.title,
            "status": row.status,
            "impact_score": row.impact_score,
            "year": row.introduced_date.year if row.introduced_date else None,
            "yeas": int(row.yeas),
            "nays": int(row.nays),
            "dissenters": sorted(row.dissenters.split("|")) if row.dissenters else [],
        })

    return {"bills": bills, "total_contested": total, "year": year, "sort": sort}


@router.get("/voting-records")
async def get_voting_records(db: Session = Depends(get_db)):
    """Per-member voting profile: volume, dissent, and attendance across all roll calls."""
    contested_lids = (
        db.query(BillVoteRecord.legislation_id)
        .group_by(BillVoteRecord.legislation_id)
        .having(_nay_count() > 0)
        .subquery()
    )

    rows = (
        db.query(
            BillVoteRecord.voter_name,
            func.count(BillVoteRecord.id).label("total"),
            func.sum(case((BillVoteRecord.vote == "Yea", 1), else_=0)).label("yeas"),
            _nay_count().label("nays"),
            func.sum(case((BillVoteRecord.vote == "Abstain", 1), else_=0)).label("abstains"),
            func.sum(case((BillVoteRecord.vote == "Absent", 1), else_=0)).label("absents"),
            func.sum(case((BillVoteRecord.vote == "Present", 1), else_=0)).label("presents"),
            func.max(BillVoteRecord.councilmember_id).label("cm_id"),
        )
        .group_by(BillVoteRecord.voter_name)
        .all()
    )

    contested_rows = (
        db.query(BillVoteRecord.voter_name, func.count(BillVoteRecord.id))
        .filter(
            BillVoteRecord.legislation_id.in_(contested_lids),
            BillVoteRecord.vote.in_(["Yea", "Nays"]),
        )
        .group_by(BillVoteRecord.voter_name)
        .all()
    )
    contested_votes = dict(contested_rows)

    current_members = {m.id: m for m in db.query(Councilmember).all()}

    # Merge voter_name variants of the same person ("Councilmember Johnson" /
    # "Council President Johnson") via their councilmember linkage.
    merged: dict[str, dict] = {}
    for row in rows:
        cm = current_members.get(row.cm_id)
        key = row.cm_id if cm else f"name:{row.voter_name}"
        entry = merged.setdefault(key, {
            "voter_name": row.voter_name,
            "short_name": cm.name if cm else _short_name(row.voter_name),
            "is_current": cm is not None,
            "councilmember_id": cm.id if cm else None,
            "district": cm.district if cm else None,
            "party": cm.party if cm else None,
            "total_votes": 0, "yeas": 0, "nays": 0,
            "abstains": 0, "absents": 0, "presents": 0,
            "contested_votes": 0,
        })
        entry["total_votes"] += int(row.total)
        entry["yeas"]      += int(row.yeas or 0)
        entry["nays"]      += int(row.nays or 0)
        entry["abstains"]  += int(row.abstains or 0)
        entry["absents"]   += int(row.absents or 0)
        entry["presents"]  += int(row.presents or 0)
        entry["contested_votes"] += int(contested_votes.get(row.voter_name, 0))

    members = list(merged.values())
    for m in members:
        # share of this member's contested-bill votes where they were the dissent
        m["dissent_rate"] = round(m["nays"] / m["contested_votes"], 3) if m["contested_votes"] else 0.0

    members.sort(key=lambda m: m["total_votes"], reverse=True)
    return {"members": members}


@router.get("/agreement-matrix")
async def get_agreement_matrix(
    min_shared:   int = Query(default=5,  ge=1, description="Min shared contested votes for a pair to score"),
    max_voters:   int = Query(default=18, le=30),
    current_only: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    """Pairwise agreement between members on contested bills (the only votes that differentiate)."""
    from collections import defaultdict
    from itertools import combinations

    contested_lids = (
        db.query(BillVoteRecord.legislation_id)
        .group_by(BillVoteRecord.legislation_id)
        .having(_nay_count() > 0)
        .subquery()
    )

    q = db.query(
        BillVoteRecord.legislation_id,
        BillVoteRecord.voter_name,
        BillVoteRecord.vote,
        BillVoteRecord.councilmember_id,
    ).filter(
        BillVoteRecord.legislation_id.in_(contested_lids),
        BillVoteRecord.vote.in_(["Yea", "Nays"]),
    )

    current_members = {m.id: m for m in db.query(Councilmember).all()}

    # Resolve each voter_name to a canonical person: the linked councilmember
    # when available (merges title variants), otherwise the raw name.
    name_to_cm: dict[str, str] = {}
    for voter, cm_id in (
        db.query(BillVoteRecord.voter_name, func.max(BillVoteRecord.councilmember_id))
        .group_by(BillVoteRecord.voter_name).all()
    ):
        if cm_id in current_members:
            name_to_cm[voter] = cm_id

    by_bill: dict[str, dict[str, str]] = defaultdict(dict)
    vote_counts: dict[str, int] = defaultdict(int)
    display: dict[str, str] = {}
    for lid, voter, vote, _cm_id in q.all():
        key = name_to_cm.get(voter, voter)
        by_bill[lid][key] = vote
        vote_counts[key] += 1
        if key in current_members:
            display[key] = current_members[key].name
        else:
            display[key] = _short_name(voter)

    if current_only:
        eligible = [v for v in vote_counts if v in current_members]
    else:
        eligible = list(vote_counts)
    voters = sorted(eligible, key=lambda v: vote_counts[v], reverse=True)[:max_voters]
    voters.sort(key=lambda v: _last_name(display[v]))
    index = {v: i for i, v in enumerate(voters)}

    shared = [[0] * len(voters) for _ in voters]
    agreed = [[0] * len(voters) for _ in voters]
    for votes in by_bill.values():
        present = [v for v in votes if v in index]
        for a, b in combinations(present, 2):
            i, j = index[a], index[b]
            shared[i][j] += 1
            shared[j][i] += 1
            if votes[a] == votes[b]:
                agreed[i][j] += 1
                agreed[j][i] += 1

    matrix: list[list[float | None]] = []
    for i in range(len(voters)):
        row: list[float | None] = []
        for j in range(len(voters)):
            if i == j:
                row.append(1.0)
            elif shared[i][j] >= min_shared:
                row.append(round(agreed[i][j] / shared[i][j], 3))
            else:
                row.append(None)
        matrix.append(row)

    return {
        "voters": [
            {
                "voter_name": display[v],
                "short_name": display[v],
                "is_current": v in current_members,
                "contested_votes": vote_counts[v],
            }
            for v in voters
        ],
        "matrix": matrix,
        "min_shared": min_shared,
    }


# The window the published corpus figures are quoted over. 2026 bills are
# still moving, so including them would make the headline number drift
# downward every time Council votes on something.
LAPSED_FROM_YEAR = 2000
LAPSED_TO_YEAR = 2025

# Outcomes worth comparing vote coverage across, in the order they are shown.
# "lapsed" is last because it is the punchline.
_OUTCOME_ORDER = ["vetoed", "signed_into_law", "failed", "lapsed"]

# The "who and where" breakdowns stop at the last completed council term,
# which is a narrower window than the headline totals above.
#
# A bill from the sitting 2024-2027 term cannot have lapsed yet -- lapsing is
# what happens when the term ends -- so including those bills puts them in the
# denominator with no chance of landing in the numerator. That biases every
# currently serving member downward, and not evenly: it hits whoever has been
# introducing bills lately. Measured, it moved Council President Johnson from
# 19.9% to 14.4% and Bass from 26.9% to 21.6%, which is large enough to
# reorder the ranking. Restricting to terms that have actually ended is the
# only way these rates compare like with like.
LAPSED_CLOSED_TO_YEAR = 2023

# Floors for appearing in a rate ranking at all. A rate over a handful of
# bills is noise, and a ranking sorted by noise puts whoever introduced three
# bills at the top.
MIN_COMMITTEE_BILLS = 50
MIN_SPONSOR_BILLS = 80
MIN_TAG_BILLS = 60
MIN_CATEGORY_BILLS = 60

# Legistar writes the same person two ways depending on whether they held the
# presidency, so "Council President Clarke" and "Councilmember Clarke" are
# 775 and 599 bills by one member. Grouping on the raw string splits their
# record in half and understates it.
_SPONSOR_TITLES = ("Council President ", "Councilmember ", "Council member ")


def _tag_label(tag: str) -> str:
    """'historic-preservation' -> 'Historic preservation'."""
    text = tag.replace("-", " ").replace("_", " ").strip()
    return text[:1].upper() + text[1:] if text else text


def _normalize_sponsor(raw: str) -> str:
    name = (raw or "").strip()
    for title in _SPONSOR_TITLES:
        if name.startswith(title):
            name = name[len(title):]
            break
    return name.strip()


def _roll_call_subquery(db: Session):
    """Per-bill roll-call size, as a joinable subquery."""
    return (
        db.query(
            BillVoteRecord.legislation_id.label("legislation_id"),
            func.count(BillVoteRecord.id).label("cnt"),
        )
        .group_by(BillVoteRecord.legislation_id)
        .subquery()
    )


@router.get("/lapsed-without-vote")
async def get_lapsed_without_vote(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    term: int = Query(0, description="Filter to one council term by its start year (0 = all)"),
    db: Session = Depends(get_db),
):
    """Bills that lapsed without a single recorded vote, plus the context.

    Backs /philadelphia/legislation/lapsed. The finding: of the 8,465 bills
    introduced 2000-2025, 1,624 lapsed with an empty roll call, so dying
    unvoted is the ordinary way a Philadelphia bill dies rather than a fate
    reserved for controversial ones. 90% of bills signed into law carry a roll
    call; 3% of lapsed bills do.

    Counts are computed here rather than stored, so the page cannot drift from
    the database the way a hardcoded figure in prose would.

    Grouping is by four-year council term, not by year, and that is deliberate:
    vote-record coverage dips hard in 2019 (124 of 271 signed bills) for
    reasons that look like a Legistar gap rather than a change in Council's
    behaviour, and a year-by-year chart would show a false cliff there. The
    2016-2019 term absorbs it.
    """
    rc = _roll_call_subquery(db)
    year_col = extract("year", Legislation.introduced_date)

    def _scoped(q):
        return q.filter(
            Legislation.level == "local",
            Legislation.introduced_date.isnot(None),
            year_col >= LAPSED_FROM_YEAR,
            year_col <= LAPSED_TO_YEAR,
        )

    no_vote = (rc.c.cnt.is_(None)) | (rc.c.cnt == 0)

    corpus_total = _scoped(db.query(func.count(Legislation.id))).scalar() or 0

    # Vote coverage per outcome. One pass, grouped by status.
    rows = _scoped(
        db.query(
            Legislation.status,
            func.count(Legislation.id),
            func.sum(case((no_vote, 0), else_=1)),
        ).outerjoin(rc, rc.c.legislation_id == Legislation.id)
    ).group_by(Legislation.status).all()

    by_status = {s: (int(n), int(w or 0)) for s, n, w in rows}
    vote_rate = []
    for status in _OUTCOME_ORDER:
        total, with_vote = by_status.get(status, (0, 0))
        if not total:
            continue
        vote_rate.append({
            "status": status,
            "label": STATUS_LABELS.get(status, status),
            "total": total,
            "with_vote": with_vote,
            "without_vote": total - with_vote,
            "pct_with_vote": round(100.0 * with_vote / total, 1),
        })

    lapsed_total, lapsed_with_vote = by_status.get("lapsed", (0, 0))
    lapsed_no_vote = lapsed_total - lapsed_with_vote

    # The headline set, grouped into council terms. Terms start on years
    # divisible by four -- same rule as current_term_start().
    term_rows = _scoped(
        db.query(year_col.label("y"), func.count(Legislation.id))
        .outerjoin(rc, rc.c.legislation_id == Legislation.id)
        .filter(Legislation.status == "lapsed", no_vote)
    ).group_by("y").all()

    terms: dict[int, int] = {}
    for y, n in term_rows:
        start = int(y) - (int(y) % 4)
        terms[start] = terms.get(start, 0) + int(n)
    by_term = [
        {"start": s, "end": s + 3, "count": terms[s], "label": f"{s}–{s + 3}"}
        for s in sorted(terms)
    ]

    # Who and where: lapse-without-vote rates by committee and by sponsor,
    # over completed council terms only (see LAPSED_CLOSED_TO_YEAR).
    def _closed(q):
        return q.filter(
            Legislation.level == "local",
            Legislation.introduced_date.isnot(None),
            year_col >= LAPSED_FROM_YEAR,
            year_col <= LAPSED_CLOSED_TO_YEAR,
        )

    def _rate_rows(group_col, floor, normalize=None):
        raw = _closed(
            db.query(
                group_col,
                func.count(Legislation.id),
                func.sum(case((Legislation.status == "lapsed", case((no_vote, 1), else_=0)), else_=0)),
            ).outerjoin(rc, rc.c.legislation_id == Legislation.id)
            .filter(group_col.isnot(None), group_col != "")
        ).group_by(group_col).all()

        merged: dict[str, list[int]] = {}
        for key, total, died in raw:
            k = normalize(key) if normalize else (key or "").strip()
            if not k:
                continue
            slot = merged.setdefault(k, [0, 0])
            slot[0] += int(total)
            slot[1] += int(died or 0)

        rows = [
            {
                "key": k,
                "label": k,
                "total": t,
                "died": d,
                "pct": round(100.0 * d / t, 1),
            }
            for k, (t, d) in merged.items()
            if t >= floor
        ]
        rows.sort(key=lambda r: (-r["pct"], -r["total"]))
        return rows

    by_committee = _rate_rows(Legislation.committee, MIN_COMMITTEE_BILLS)
    by_sponsor = _rate_rows(Legislation.sponsor, MIN_SPONSOR_BILLS, _normalize_sponsor)

    # Subject matter, keyed on the tag vocabulary itself rather than on the
    # coarse category buckets the legislation filter uses.
    #
    # Those buckets cannot carry this. _TAG_TO_CATEGORY in legislation_routes
    # keys its tags with spaces ('public safety') while the tags actually
    # written on bills are hyphenated ('public-safety'), so three of its
    # categories match essentially nothing and a fourth, 'civil rights', is 111
    # election bills out of 114 and would have been published under a label
    # that is not what it contains. Tags say what they are.
    import json as _json

    tag_rows = _closed(
        db.query(Legislation.tags, Legislation.status, rc.c.cnt)
        .outerjoin(rc, rc.c.legislation_id == Legislation.id)
        .filter(Legislation.tags.isnot(None), Legislation.tags != "", Legislation.tags != "[]")
    ).all()

    tag_tot: dict[str, int] = {}
    tag_died: dict[str, int] = {}
    for tags_json, status, cnt in tag_rows:
        try:
            parsed = _json.loads(tags_json)
        except Exception:
            continue
        died_here = status == "lapsed" and not cnt
        # A bill carries several tags; de-duplicate so one bill counts once per
        # tag, never twice because it was tagged 'housing' and 'Housing'.
        for t in {str(x).lower().strip() for x in parsed if isinstance(x, str) and str(x).strip()}:
            tag_tot[t] = tag_tot.get(t, 0) + 1
            if died_here:
                tag_died[t] = tag_died.get(t, 0) + 1

    # The same pass, bucketed into the coarse categories the legislation
    # filter uses, so a reader can click a bar and land on exactly those bills.
    # Kept alongside the tag breakdown rather than replacing it: categories are
    # what the filter understands, tags are where the sharp findings are
    # (ethics at 59% disappears into 'government' at this grain).
    cat_tot: dict[str, int] = {}
    cat_died: dict[str, int] = {}
    for tags_json, status, cnt in tag_rows:
        try:
            parsed = _json.loads(tags_json)
        except Exception:
            continue
        died_here = status == "lapsed" and not cnt
        for category in categories_for_tags(parsed):
            cat_tot[category] = cat_tot.get(category, 0) + 1
            if died_here:
                cat_died[category] = cat_died.get(category, 0) + 1

    by_category = [
        {
            "key": c,
            "label": c[:1].upper() + c[1:],
            "total": n,
            "died": cat_died.get(c, 0),
            "pct": round(100.0 * cat_died.get(c, 0) / n, 1),
        }
        for c, n in cat_tot.items()
        if n >= MIN_CATEGORY_BILLS
    ]
    by_category.sort(key=lambda r: (-r["pct"], -r["total"]))

    by_tag = [
        {
            "key": t,
            "label": _tag_label(t),
            "total": n,
            "died": tag_died.get(t, 0),
            "pct": round(100.0 * tag_died.get(t, 0) / n, 1),
        }
        for t, n in tag_tot.items()
        if n >= MIN_TAG_BILLS
    ]
    by_tag.sort(key=lambda r: (-r["pct"], -r["total"]))

    closed_total = _closed(db.query(func.count(Legislation.id))).scalar() or 0
    closed_died = _closed(
        db.query(func.count(Legislation.id))
        .outerjoin(rc, rc.c.legislation_id == Legislation.id)
        .filter(Legislation.status == "lapsed", no_vote)
    ).scalar() or 0

    # The bills themselves, newest first.
    bills_q = _scoped(
        db.query(Legislation)
        .outerjoin(rc, rc.c.legislation_id == Legislation.id)
        .filter(Legislation.status == "lapsed", no_vote)
    )
    if term:
        bills_q = bills_q.filter(year_col >= term, year_col <= term + 3)

    bills_total = bills_q.with_entities(func.count(Legislation.id)).scalar() or 0
    bills = (
        bills_q.order_by(Legislation.introduced_date.desc())
        .limit(limit).offset(offset).all()
    )

    return {
        "success": True,
        "totals": {
            "corpus": corpus_total,
            "lapsed": lapsed_total,
            "lapsed_without_vote": lapsed_no_vote,
            "from_year": LAPSED_FROM_YEAR,
            "to_year": LAPSED_TO_YEAR,
        },
        "vote_rate_by_outcome": vote_rate,
        "by_term": by_term,
        "who_and_where": {
            # Narrower window than "totals" on purpose; see
            # LAPSED_CLOSED_TO_YEAR. The frontend states it rather than
            # quietly presenting both as the same span.
            "from_year": LAPSED_FROM_YEAR,
            "to_year": LAPSED_CLOSED_TO_YEAR,
            "baseline_pct": round(100.0 * closed_died / closed_total, 1) if closed_total else None,
            "baseline_total": closed_total,
            "min_committee_bills": MIN_COMMITTEE_BILLS,
            "min_sponsor_bills": MIN_SPONSOR_BILLS,
            "min_tag_bills": MIN_TAG_BILLS,
            "min_category_bills": MIN_CATEGORY_BILLS,
            "by_committee": by_committee,
            "by_sponsor": by_sponsor,
            "by_tag": by_tag,
            "by_category": by_category,
        },
        "bills": {
            "total": bills_total,
            "limit": limit,
            "offset": offset,
            "term": term or None,
            "results": [
                {
                    "id": b.id,
                    "bill_number": b.bill_number,
                    "title": b.title,
                    "plain_title": b.plain_title,
                    "headline": b.headline,
                    "sponsor": b.sponsor,
                    "committee": b.committee,
                    "introduced_date": b.introduced_date.isoformat() if b.introduced_date else None,
                    "term_start": b.introduced_date.year - (b.introduced_date.year % 4) if b.introduced_date else None,
                }
                for b in bills
            ],
        },
    }


@router.get("/subject-output")
async def get_subject_output(db: Session = Depends(get_db)):
    """What Council actually turns into law, by subject.

    The companion to /lapsed-without-vote, and deliberately NOT its mirror.

    A pass *rate* by subject carries almost no information here, because it is
    very nearly 100 minus the lapse rate: across tags above the floor, every
    status other than "signed into law" and "lapsed with no roll call"
    accounts for 2.0% of bills on average and never more than 5.6%. Ranking
    subjects by pass rate just redraws the lapsed chart backwards.

    Volume is the part that is not already on screen. Council signs roughly
    1,900 zoning bills and 1,500 planning bills in this window against 84
    education bills, so what it spends its time on is a different question
    from what it is willing to vote on, and only counting answers it.

    Same closed window as the rankings (see LAPSED_CLOSED_TO_YEAR), so a bill
    still moving in the sitting term cannot drag a subject's rate down.
    """
    rc = _roll_call_subquery(db)
    year_col = extract("year", Legislation.introduced_date)
    no_vote = (rc.c.cnt.is_(None)) | (rc.c.cnt == 0)

    rows = (
        db.query(Legislation.tags, Legislation.status, rc.c.cnt)
        .outerjoin(rc, rc.c.legislation_id == Legislation.id)
        .filter(
            Legislation.level == "local",
            Legislation.introduced_date.isnot(None),
            year_col >= LAPSED_FROM_YEAR,
            year_col <= LAPSED_CLOSED_TO_YEAR,
            Legislation.tags.isnot(None),
            Legislation.tags != "",
            Legislation.tags != "[]",
        )
        .all()
    )

    import json as _j

    def _blank():
        return {"total": 0, "signed": 0, "died": 0}

    cats: dict[str, dict] = {}
    tags: dict[str, dict] = {}
    for tags_json, status, cnt in rows:
        try:
            parsed = _j.loads(tags_json)
        except Exception:
            continue
        signed = status == "signed_into_law"
        died = status == "lapsed" and not cnt

        keys = {str(x).lower().strip() for x in parsed if isinstance(x, str) and str(x).strip()}
        for bucket, names in ((cats, categories_for_tags(parsed)), (tags, keys)):
            for name in names:
                slot = bucket.setdefault(name, _blank())
                slot["total"] += 1
                if signed:
                    slot["signed"] += 1
                if died:
                    slot["died"] += 1

    def _rows(bucket: dict, floor: int, label):
        out = [
            {
                "key": k,
                "label": label(k),
                "total": v["total"],
                "signed": v["signed"],
                "died": v["died"],
                "pct_signed": round(100.0 * v["signed"] / v["total"], 1),
            }
            for k, v in bucket.items()
            if v["total"] >= floor
        ]
        out.sort(key=lambda r: -r["signed"])
        return out

    by_category = _rows(cats, MIN_CATEGORY_BILLS, lambda k: k[:1].upper() + k[1:])
    by_tag = _rows(tags, MIN_TAG_BILLS, _tag_label)

    return {
        "success": True,
        "from_year": LAPSED_FROM_YEAR,
        "to_year": LAPSED_CLOSED_TO_YEAR,
        "min_category_bills": MIN_CATEGORY_BILLS,
        "min_tag_bills": MIN_TAG_BILLS,
        "total_signed": sum(1 for _, st, _c in rows if st == "signed_into_law"),
        "by_category": by_category,
        "by_tag": by_tag,
    }
