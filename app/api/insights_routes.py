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

    total = db.query(func.count(Legislation.id)).filter(Legislation.level == "local").scalar()
    active = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        Legislation.status.in_(["introduced", "in_committee"]),
    ).scalar()
    this_year = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        extract("year", Legislation.introduced_date) == current_year,
    ).scalar()
    signed = db.query(func.count(Legislation.id)).filter(
        Legislation.level == "local",
        Legislation.status == "signed_into_law",
    ).scalar()
    years_covered = db.query(
        func.min(extract("year", Legislation.introduced_date)),
        func.max(extract("year", Legislation.introduced_date)),
    ).filter(Legislation.level == "local", Legislation.introduced_date.isnot(None)).first()

    return {
        "total_bills": total,
        "active_bills": active,
        "bills_this_year": this_year,
        "signed_into_law": signed,
        "years_from": int(years_covered[0]) if years_covered[0] else current_year,
        "years_to": int(years_covered[1]) if years_covered[1] else current_year,
    }
