"""Insights and analytics API routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, extract, case
from sqlalchemy.orm import Session
from app.models.database import get_db
from app.models import Legislation

router = APIRouter(prefix="/api/insights", tags=["insights"])

STATUS_ORDER = [
    "introduced",
    "in_committee",
    "signed_into_law",
    "failed",
    "vetoed",
    "withdrawn",
    "tabled",
]

STATUS_LABELS = {
    "introduced":      "Introduced",
    "in_committee":    "In Committee",
    "signed_into_law": "Signed into Law",
    "failed":          "Failed",
    "vetoed":          "Vetoed",
    "withdrawn":       "Withdrawn",
    "tabled":          "Tabled",
}


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

    # Reshape into {year: {status: count}}
    by_year: dict[int, dict[str, int]] = {}
    all_years: set[int] = set()
    for row in rows:
        year = int(row.year)
        all_years.add(year)
        if year not in by_year:
            by_year[year] = {}
        by_year[year][row.status or "unknown"] = row.count

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

    total = db.query(func.count(Legislation.id)).filter(Legislation.level == "local").scalar()
    active = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        Legislation.status.in_(["introduced", "in_committee"]),
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
        "bills_this_year": this_year,
        "bills_last_year": last_year,
        "signed_into_law": signed,
        "pass_rate": pass_rate,
        "avg_impact_score": round(float(avg_impact), 1) if avg_impact else None,
        "years_from": int(years_covered[0]) if years_covered[0] else current_year,
        "years_to": int(years_covered[1]) if years_covered[1] else current_year,
        "last_fetched_at": last_fetched.isoformat() if last_fetched else None,
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
            "not_passed": terminal - signed,
            "pass_rate": round(signed / terminal, 3) if terminal else 0.0,
        })

    return {"committees": committees, "year": year}
