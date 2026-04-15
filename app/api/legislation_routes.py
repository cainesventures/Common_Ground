"""API routes for legislation management."""

import asyncio
import json as _json
import logging
import re
import uuid as _uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from fastapi.responses import StreamingResponse
from app.models.database import get_db
from app.services.legislation_service import LegislationIngestionService, sync_vote_records
from app.models import Legislation, LegislationVote, BillPerspective, BillVoteRecord
from app.auth import require_dev_tier, get_optional_user
from app.services.perspectives_service import ALL_PERSPECTIVES


def _sse(data: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {_json.dumps(data)}\n\n"


def _sse_stream(gen):
    """Wrap an async generator and return a StreamingResponse for SSE."""
    return StreamingResponse(gen(), media_type="text/event-stream")

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/legislation", tags=["legislation"])

_GENERIC_DESCRIPTIONS = {'bill', 'ordinance', 'resolution', 'motion', 'order', ''}

def _display_description(leg) -> str | None:
    """Return the best available short description for a bill card."""
    if leg.description and leg.description.strip().lower() not in _GENERIC_DESCRIPTIONS:
        return leg.description
    if leg.full_text:
        text = leg.full_text
        # Skip boilerplate up to "Tally", then skip the title duplicate
        idx = text.lower().find("tally")
        if idx != -1:
            text = text[idx + len("tally"):]
            # After Tally, the title is repeated — jump to the first WHEREAS/SECTION/BE IT
            for marker in ("WHEREAS", "SECTION", "BE IT"):
                m = text.find(marker)
                if m != -1:
                    text = text[m:]
                    break
            else:
                # No known marker found — skip first paragraph as fallback
                para_end = text.find("\n\n")
                if para_end != -1:
                    text = text[para_end:].lstrip()
        return text[:300].strip() or None
    return None

VALID_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC",
}


@router.post("/ingest/federal")
async def ingest_federal_legislation(
    congress: int = Query(118, ge=100, le=120, description="Congress session number (100-120)"),
    limit: int = Query(20, ge=1, le=250, description="Number of bills to fetch"),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and ingest federal bills from Congress.gov."""
    try:
        service = LegislationIngestionService(db)
        count = await service.ingest_federal_legislation(congress, limit)
        return {"success": True, "bills_ingested": count}
    except Exception as e:
        logger.error(f"Error ingesting federal legislation (congress={congress}): {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/ingest/state/{state}")
async def ingest_state_legislation(
    state: str,
    limit: int = Query(20, ge=1, le=250, description="Number of bills to fetch"),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and ingest bills from a specific state via OpenStates."""
    state_upper = state.upper()
    if state_upper not in VALID_STATES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid state abbreviation: '{state}'. Must be a valid US state/territory code."
        )

    try:
        service = LegislationIngestionService(db)
        count = await service.ingest_state_legislation(state_upper, limit)
        return {"success": True, "bills_ingested": count}
    except Exception as e:
        logger.error(f"Error ingesting state legislation (state={state_upper}): {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


_CITY_SLUG_RE = re.compile(r"^[a-zA-Z0-9\-]+$")


@router.post("/ingest/local/{city}")
async def ingest_local_legislation(
    city: str,
    limit: int = Query(20, ge=1, le=250, description="Number of matters to fetch (ignored when bulk=true)"),
    bulk: bool = Query(False, description="Philadelphia only: export all ~8500 bills via Excel in one shot"),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and ingest city/municipal legislation.

    For Philadelphia, pass ``bulk=true`` to export all ~8,500 bills at once via
    Excel export (ignores ``limit``). Individual bill analysis (sponsors, full text)
    is deferred until the Analyze button is clicked per bill.

    For other cities, uses the Legistar REST API with the city slug.
    """
    city = city.strip()
    if not city or len(city) > 50 or not _CITY_SLUG_RE.match(city):
        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid city slug. Must be 1–50 alphanumeric characters or hyphens "
                "(e.g. 'philadelphia', 'nyc', 'los-angeles')."
            ),
        )

    try:
        service = LegislationIngestionService(db)
        result = await service.ingest_local_legislation(city, limit, bulk=bulk)
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Error ingesting local legislation for city={city!r}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/list")
async def list_legislation(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    level: str = Query("", max_length=20),
    db: Session = Depends(get_db)
):
    """List all legislation with pagination."""
    try:
        service = LegislationIngestionService(db)
        results, total = service.search_legislation("", limit=limit, offset=offset, level=level)
        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "results": [
                {"id": leg.id, "bill_number": leg.bill_number, "title": leg.title,
                 "plain_title": leg.plain_title, "source": leg.source, "status": leg.status,
                 "level": leg.level, "introduced_date": leg.introduced_date.isoformat() if leg.introduced_date else None,
                 "impact_level": leg.impact_level, "bill_type": leg.bill_type, "tags": leg.tags,
                 "analyzed_at": leg.analyzed_at.isoformat() if leg.analyzed_at else None,
                 "next_hearing_date": leg.next_hearing_date.isoformat() if leg.next_hearing_date else None}
                for leg in results
            ]
        }
    except Exception as e:
        logger.error(f"Error listing legislation: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/tag-counts")
async def get_tag_counts(
    q: str = Query('', max_length=200),
    level: str = Query("", max_length=20),
    analyzed: str = Query(""),
    impact: str = Query("", max_length=20),
    status: str = Query("", max_length=40),
    sponsor: str = Query("", max_length=100),
    year: int = Query(0),
    month: int = Query(0),
    db: Session = Depends(get_db),
):
    """Return tag counts scoped to the current filters."""
    import json
    from collections import Counter
    from sqlalchemy import extract

    base_query = db.query(Legislation.tags).filter(
        Legislation.tags.isnot(None),
        Legislation.tags != "",
        Legislation.tags != "[]",
    )
    if q:
        base_query = base_query.filter(
            (Legislation.title.ilike(f"%{q}%")) |
            (Legislation.bill_number.ilike(f"%{q}%"))
        )
    if level:
        base_query = base_query.filter(Legislation.level == level)
    if analyzed == "true":
        base_query = base_query.filter(Legislation.analyzed_at.isnot(None))
    elif analyzed == "false":
        base_query = base_query.filter(Legislation.analyzed_at.is_(None))
    if impact:
        base_query = base_query.filter(Legislation.impact_level == impact)
    if status:
        from sqlalchemy import or_
        status_list = [s.strip() for s in status.split(',') if s.strip()]
        base_query = base_query.filter(Legislation.status.in_(status_list))
    if sponsor:
        base_query = base_query.filter(Legislation.sponsor.ilike(f"%{sponsor}%"))
    if year:
        base_query = base_query.filter(extract("year", Legislation.introduced_date) == year)
    if month:
        base_query = base_query.filter(extract("month", Legislation.introduced_date) == month)

    rows = base_query.all()
    counter: Counter = Counter()
    for (tags_json,) in rows:
        try:
            tags = json.loads(tags_json)
            if isinstance(tags, list):
                for t in tags:
                    if isinstance(t, str) and t:
                        counter[t] += 1
        except Exception:
            pass

    return {
        "tags": [{"tag": tag, "count": count} for tag, count in counter.most_common()]
    }


@router.get("/year-counts")
async def get_year_counts(
    q: str = Query('', max_length=200),
    analyzed: str = Query(""),
    tag: str = Query("", max_length=60),
    impact: str = Query("", max_length=20),
    status: str = Query("", max_length=40),
    sponsor: str = Query("", max_length=100),
    db: Session = Depends(get_db),
):
    """Return bill counts grouped by introduction year, sorted ascending."""
    from sqlalchemy import func, extract

    base = db.query(
        extract("year", Legislation.introduced_date).label("year"),
        func.count(Legislation.id).label("count"),
    ).filter(Legislation.introduced_date.isnot(None), Legislation.level == "local")

    if q:
        base = base.filter(
            (Legislation.title.ilike(f"%{q}%")) | (Legislation.bill_number.ilike(f"%{q}%"))
        )
    if analyzed == "true":
        base = base.filter(Legislation.analyzed_at.isnot(None))
    elif analyzed == "false":
        base = base.filter(Legislation.analyzed_at.is_(None))
    if tag:
        from sqlalchemy import or_
        tag_list = [t.strip() for t in tag.split(',') if t.strip()]
        base = base.filter(or_(*[Legislation.tags.ilike(f'%"{t}"%') for t in tag_list]))
    if impact:
        base = base.filter(Legislation.impact_level == impact)
    if status:
        status_list = [s.strip() for s in status.split(',') if s.strip()]
        base = base.filter(Legislation.status.in_(status_list))
    if sponsor:
        base = base.filter(Legislation.sponsor.ilike(f"%{sponsor}%"))

    rows = base.group_by("year").order_by("year").all()
    return {"years": [{"year": int(row.year), "count": row.count} for row in rows]}


@router.get("/month-counts")
async def get_month_counts(
    year: int = Query(...),
    q: str = Query('', max_length=200),
    analyzed: str = Query(""),
    tag: str = Query("", max_length=60),
    impact: str = Query("", max_length=20),
    status: str = Query("", max_length=40),
    sponsor: str = Query("", max_length=100),
    db: Session = Depends(get_db),
):
    """Return bill counts grouped by month for a given year, sorted ascending."""
    from sqlalchemy import func, extract

    base = db.query(
        extract("month", Legislation.introduced_date).label("month"),
        func.count(Legislation.id).label("count"),
    ).filter(
        Legislation.introduced_date.isnot(None),
        Legislation.level == "local",
        extract("year", Legislation.introduced_date) == year,
    )

    if q:
        base = base.filter(
            (Legislation.title.ilike(f"%{q}%")) | (Legislation.bill_number.ilike(f"%{q}%"))
        )
    if analyzed == "true":
        base = base.filter(Legislation.analyzed_at.isnot(None))
    elif analyzed == "false":
        base = base.filter(Legislation.analyzed_at.is_(None))
    if tag:
        from sqlalchemy import or_
        tag_list = [t.strip() for t in tag.split(',') if t.strip()]
        base = base.filter(or_(*[Legislation.tags.ilike(f'%"{t}"%') for t in tag_list]))
    if impact:
        base = base.filter(Legislation.impact_level == impact)
    if status:
        status_list = [s.strip() for s in status.split(',') if s.strip()]
        base = base.filter(Legislation.status.in_(status_list))
    if sponsor:
        base = base.filter(Legislation.sponsor.ilike(f"%{sponsor}%"))

    rows = base.group_by("month").order_by("month").all()
    return {"months": [{"month": int(row.month), "count": row.count} for row in rows]}


@router.get("/count")
async def count_legislation(
    year: int = Query(0),
    month: int = Query(0),
    date_from: str = Query(""),
    date_to: str = Query(""),
    analyzed: str = Query(""),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Count bills matching the given date/analysis filters (for admin preview)."""
    from sqlalchemy import extract
    q = db.query(Legislation).filter(Legislation.level == "local")
    if analyzed == "true":
        q = q.filter(Legislation.analyzed_at.isnot(None))
    elif analyzed == "false":
        q = q.filter(Legislation.analyzed_at.is_(None))
    q = _apply_date_filters(q, year, month, date_from, date_to)
    return {"count": q.count()}


@router.get("/export")
async def export_legislation(
    format: str = Query("csv", pattern="^(csv|json)$"),
    q: str = Query("", max_length=200),
    analyzed: str = Query("true"),
    tag: str = Query(""),
    impact: str = Query(""),
    status: str = Query(""),
    sponsor: str = Query(""),
    year: int = Query(0),
    month: int = Query(0),
    tracked_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_user),
):
    """Export legislation as CSV or JSON. Pass tracked_only=true for the current user's saved bills."""
    import csv
    import io
    from app.models import BillTracking

    analyzed_filter: Optional[bool] = None
    if analyzed == "true":
        analyzed_filter = True
    elif analyzed == "false":
        analyzed_filter = False

    if format == "json":
        base_q = db.query(Legislation).options(joinedload(Legislation.perspectives))
    else:
        base_q = db.query(Legislation)

    if tracked_only:
        if not current_user:
            raise HTTPException(status_code=401, detail="Login required for tracked bills export")
        tracked_ids = [r.bill_id for r in db.query(BillTracking.bill_id).filter(BillTracking.user_id == current_user.id).all()]
        base_q = base_q.filter(Legislation.id.in_(tracked_ids))
    if q:
        base_q = base_q.filter(
            Legislation.title.ilike(f"%{q}%") | Legislation.bill_number.ilike(f"%{q}%")
        )
    if analyzed_filter is True:
        base_q = base_q.filter(Legislation.analyzed_at.isnot(None))
    elif analyzed_filter is False:
        base_q = base_q.filter(Legislation.analyzed_at.is_(None))
    if tag:
        from sqlalchemy import or_
        tag_list = [t.strip() for t in tag.split(',') if t.strip()]
        base_q = base_q.filter(or_(*[Legislation.tags.ilike(f'%"{t}"%') for t in tag_list]))
    if impact:
        base_q = base_q.filter(Legislation.impact_level == impact)
    if status:
        status_list = [s.strip() for s in status.split(',') if s.strip()]
        base_q = base_q.filter(Legislation.status.in_(status_list))
    if sponsor:
        base_q = base_q.filter(Legislation.sponsor.ilike(f"%{sponsor}%"))
    if year:
        from sqlalchemy import extract
        base_q = base_q.filter(extract("year", Legislation.introduced_date) == year)
    if month:
        from sqlalchemy import extract
        base_q = base_q.filter(extract("month", Legislation.introduced_date) == month)

    bills = base_q.order_by(Legislation.introduced_date.desc()).all()

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Bill Number", "Title", "Status", "Introduced Date",
            "Impact Level", "Impact Score", "Bill Type",
            "Tags", "Sponsor", "Summary", "External URL",
        ])
        for b in bills:
            try:
                tags = ", ".join(_json.loads(b.tags)) if b.tags else ""
            except Exception:
                tags = b.tags or ""
            writer.writerow([
                b.bill_number,
                b.plain_title or b.title,
                b.status,
                b.introduced_date.strftime("%Y-%m-%d") if b.introduced_date else "",
                b.impact_level or "",
                b.impact_score or "",
                b.bill_type or "",
                tags,
                b.sponsor or "",
                b.summary or "",
                b.external_url or "",
            ])
        filename = "tracked-bills.csv" if tracked_only else "legislation.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # JSON — includes perspectives
    def _persp(p: BillPerspective) -> dict:
        try:
            args = _json.loads(p.key_arguments) if p.key_arguments else []
        except Exception:
            args = []
        return {
            "type": p.perspective_type,
            "position": p.position,
            "assessment": p.assessment,
            "key_arguments": args,
            "concerns": p.concerns,
        }

    data = []
    for b in bills:
        try:
            tags = _json.loads(b.tags) if b.tags else []
        except Exception:
            tags = []
        try:
            city_context = _json.loads(b.supplementary_data) if b.supplementary_data else None
        except Exception:
            city_context = None
        data.append({
            "bill_number": b.bill_number,
            "title": b.plain_title or b.title,
            "original_title": b.title,
            "status": b.status,
            "introduced_date": b.introduced_date.strftime("%Y-%m-%d") if b.introduced_date else None,
            "impact_level": b.impact_level,
            "impact_score": b.impact_score,
            "bill_type": b.bill_type,
            "tags": tags,
            "sponsor": b.sponsor,
            "summary": b.summary,
            "full_text": b.full_text,
            "city_context": city_context,
            "external_url": b.external_url,
            "perspectives": [_persp(p) for p in sorted(b.perspectives, key=lambda x: x.perspective_type)],
        })
    filename = "tracked-bills.json" if tracked_only else "legislation.json"
    return StreamingResponse(
        iter([_json.dumps({"exported": len(data), "bills": data}, indent=2)]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/search")
async def search_legislation(
    q: str = Query('', max_length=200),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    level: str = Query("", max_length=20),
    analyzed: str = Query("", description="Filter: 'true' = analyzed, 'false' = pending, '' = all"),
    tag: str = Query("", max_length=200),
    impact: str = Query("", max_length=20),
    status: str = Query("", max_length=200),
    sponsor: str = Query("", max_length=100),
    year: int = Query(0, description="Filter by introduction year (0 = all)"),
    month: int = Query(0, description="Filter by introduction month 1-12 (0 = all)"),
    has_votes: bool = Query(False, description="Only return bills with cached roll call votes"),
    city: str = Query("", max_length=50, description="City slug filter (e.g. 'philadelphia', 'chicago'). Defaults to 'philadelphia' for local searches."),
    db: Session = Depends(get_db)
):
    """Search for legislation with optional filters."""
    try:
        analyzed_filter: Optional[bool] = None
        if analyzed == "true":
            analyzed_filter = True
        elif analyzed == "false":
            analyzed_filter = False

        # Default local searches to Philadelphia so other cities' data stays hidden
        effective_city = city or ('philadelphia' if level == 'local' else '')

        service = LegislationIngestionService(db)
        results, total = service.search_legislation(
            q, limit=limit, offset=offset, level=level, analyzed=analyzed_filter, tag=tag, impact=impact,
            year=year or None, month=month or None, status=status or None, sponsor=sponsor or None,
            has_votes=has_votes or None, city=effective_city or None,
        )
        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "results": [
                {
                    "id": leg.id,
                    "bill_number": leg.bill_number,
                    "title": leg.title,
                    "plain_title": leg.plain_title,
                    "source": leg.source,
                    "status": leg.status,
                    "level": leg.level,
                    "tags": leg.tags,
                    "description": _display_description(leg),
                    "summary": leg.summary,
                    "impact_level": leg.impact_level,
                    "impact_score": leg.impact_score,
                    "bill_type": leg.bill_type,
                    "analyzed_at": leg.analyzed_at.isoformat() if leg.analyzed_at else None,
                    "introduced_date": leg.introduced_date.isoformat() if leg.introduced_date else None,
                    "next_hearing_date": leg.next_hearing_date.isoformat() if leg.next_hearing_date else None,
                }
                for leg in results
            ]
        }
    except Exception as e:
        logger.error(f"Error searching legislation (q={q!r}): {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/plain-titles")
async def generate_plain_titles(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Generate plain-English names for all bills that don't have one."""
    try:
        service = LegislationIngestionService(db)
        result = service.generate_plain_titles()
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Error generating plain titles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync-statuses")
async def sync_bill_statuses(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Re-fetch status from Legistar for all in-flight (introduced/in_committee) bills."""
    try:
        service = LegislationIngestionService(db)
        result = await service.sync_bill_statuses()
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Error syncing bill statuses: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tag-all")
async def tag_all_bills(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Auto-tag all untagged bills using AI."""
    try:
        service = LegislationIngestionService(db)
        result = service.tag_untagged_bills()
        return {"success": True, **result}
    except Exception as e:
        logger.error(f"Error auto-tagging bills: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/fetch-news-all")
async def fetch_news_all_bills(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and store news articles for all bills."""
    from app.services.news_service import fetch_and_store_news
    bills = db.query(Legislation).filter(Legislation.level == "local").all()
    fetched = 0
    total_articles = 0
    for bill in bills:
        try:
            articles = fetch_and_store_news(bill, db)
            total_articles += len(articles)
            fetched += 1
        except Exception as e:
            logger.warning(f"News fetch failed for {bill.bill_number}: {e}")
    return {"success": True, "bills_processed": fetched, "total_articles": total_articles}


@router.post("/analyze-all")
async def analyze_all_bills(
    force: bool = Query(False, description="Re-analyze bills that have already been analyzed"),
    force_perspectives: bool = Query(False, description="Force-regenerate base perspectives even if cached"),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Analyze local bills. By default skips already-analyzed bills; use force=true to re-analyze all."""
    from app.services.bill_research_service import analyze_bill
    from app.services.perspectives_service import generate_base_perspectives

    q = db.query(Legislation).filter(Legislation.level == "local")
    if not force:
        q = q.filter(Legislation.analyzed_at.is_(None))
    bills = q.all()

    analyzed = 0
    failed = 0
    for bill in bills:
        try:
            analyze_bill(bill, db)
            generate_base_perspectives(bill, db, force=force_perspectives)
            analyzed += 1
        except Exception as e:
            logger.warning(f"Analyze-all failed for {bill.bill_number}: {e}")
            failed += 1

    return {"success": True, "analyzed": analyzed, "failed": failed, "total": len(bills)}


@router.post("/generate-all-perspectives")
async def generate_all_perspectives_bulk(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Generate all 17 perspectives for every analyzed local bill (skips cached ones)."""
    from app.services.perspectives_service import generate_perspective as _gen

    bills = db.query(Legislation).filter(
        Legislation.level == "local",
        Legislation.analyzed_at.isnot(None),
    ).all()

    generated = 0
    failed = 0
    for bill in bills:
        for ptype in ALL_PERSPECTIVES:
            try:
                persp = _gen(bill, ptype, db)
                if persp:
                    generated += 1
                else:
                    failed += 1
            except Exception as e:
                logger.warning(f"Perspective {ptype} failed for {bill.bill_number}: {e}")
                failed += 1

    return {"success": True, "generated": generated, "failed": failed, "bills_processed": len(bills)}


@router.post("/backfill-vote-records")
async def backfill_vote_records(
    year: int = Query(0),
    month: int = Query(0),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch official roll call votes from Legistar for all local bills. Dev-tier only.

    Scoped by year/month if provided. Skips non-Legistar bills.
    Returns counts of fetched, matched, and upserted records.
    """
    q = db.query(Legislation).filter(Legislation.level == "local")
    q = _apply_date_filters(q, year, month, "", "")
    bills = q.all()

    total_fetched = total_matched = total_upserted = 0
    errors = 0
    for bill in bills:
        if not bill.id.startswith("legistar_"):
            continue
        try:
            result = await sync_vote_records(bill.id, db)
            total_fetched  += result["fetched"]
            total_matched  += result["matched"]
            total_upserted += result["upserted"]
        except Exception as e:
            logger.warning(f"backfill vote records failed for {bill.id}: {e}")
            errors += 1

    return {
        "success": True,
        "bills_processed": len(bills),
        "fetched": total_fetched,
        "matched": total_matched,
        "upserted": total_upserted,
        "errors": errors,
    }


@router.post("/backfill-city-context")
async def backfill_city_context(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Populate supplementary_data for all analyzed bills that don't have it yet."""
    from app.services.opendataphilly_service import get_bill_context
    import json as _json
    bills = db.query(Legislation).filter(
        Legislation.analyzed_at.isnot(None),
        Legislation.tags.isnot(None),
    ).all()
    updated = 0
    skipped = 0
    for bill in bills:
        if bill.supplementary_data:
            skipped += 1
            continue
        try:
            _, display_sections = get_bill_context(bill)
            if display_sections:
                bill.supplementary_data = _json.dumps(display_sections)
                updated += 1
        except Exception as e:
            logger.warning(f"Context backfill failed for {bill.bill_number}: {e}")
    db.commit()
    return {"success": True, "updated": updated, "skipped": skipped}


# ── Streaming (SSE) endpoints ─────────────────────────────────────────────────

def _apply_date_filters(q, year: int, month: int, date_from: str, date_to: str):
    """Apply year/month/date_from/date_to filters to a Legislation query."""
    from sqlalchemy import extract
    if year:
        q = q.filter(extract("year", Legislation.introduced_date) == year)
    if month:
        q = q.filter(extract("month", Legislation.introduced_date) == month)
    if date_from:
        try:
            from datetime import date
            q = q.filter(Legislation.introduced_date >= date.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            from datetime import date
            q = q.filter(Legislation.introduced_date <= date.fromisoformat(date_to))
        except ValueError:
            pass
    return q


@router.get("/stream/analyze-all")
async def stream_analyze_all_bills(
    force: bool = Query(False),
    force_perspectives: bool = Query(False),
    year: int = Query(0),
    month: int = Query(0),
    date_from: str = Query(""),
    date_to: str = Query(""),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream analyze-all progress as Server-Sent Events."""
    from app.services.bill_research_service import analyze_bill
    from app.services.perspectives_service import generate_base_perspectives

    async def gen():
        q = db.query(Legislation).filter(Legislation.level == "local")
        if not force:
            q = q.filter(Legislation.analyzed_at.is_(None))
        q = _apply_date_filters(q, year, month, date_from, date_to)
        bills = q.all()
        total = len(bills)
        yield _sse({"current": 0, "total": total, "message": f"Found {total} bills to analyze", "done": False})
        await asyncio.sleep(0)
        analyzed = failed = 0
        for i, bill in enumerate(bills, 1):
            yield _sse({"current": i, "total": total, "message": f"Analyzing {bill.bill_number}…", "done": False})
            await asyncio.sleep(0)
            try:
                await asyncio.get_event_loop().run_in_executor(None, lambda b=bill: (analyze_bill(b, db), generate_base_perspectives(b, db, force=force_perspectives)))
                analyzed += 1
            except Exception as e:
                logger.warning(f"stream analyze failed for {bill.bill_number}: {e}")
                failed += 1
        yield _sse({"current": total, "total": total, "message": f"Done — {analyzed} analyzed, {failed} failed", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.get("/stream/analyze-all-full")
async def stream_analyze_all_full(
    force: bool = Query(False),
    year: int = Query(0),
    month: int = Query(0),
    date_from: str = Query(""),
    date_to: str = Query(""),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream analyze + all 17 perspectives per bill as Server-Sent Events."""
    from app.services.bill_research_service import analyze_bill
    from app.services.perspectives_service import generate_perspective as _gen

    async def gen():
        q = db.query(Legislation).filter(Legislation.level == "local")
        if not force:
            q = q.filter(Legislation.analyzed_at.is_(None))
        q = _apply_date_filters(q, year, month, date_from, date_to)
        bills = q.all()
        total_bills = len(bills)
        # Each bill = 1 analyze step + 17 perspective steps
        total_ops = total_bills * (1 + len(ALL_PERSPECTIVES))
        yield _sse({"current": 0, "total": total_ops, "message": f"Found {total_bills} bills — {total_ops} operations total", "done": False})
        await asyncio.sleep(0)
        current = analyzed = failed = 0
        for bill in bills:
            current += 1
            yield _sse({"current": current, "total": total_ops, "message": f"Analyzing {bill.bill_number}…", "done": False})
            await asyncio.sleep(0)
            try:
                await asyncio.get_event_loop().run_in_executor(None, lambda b=bill: analyze_bill(b, db))
                analyzed += 1
            except Exception as e:
                logger.warning(f"full-analyze failed for {bill.bill_number}: {e}")
                failed += 1
                current += len(ALL_PERSPECTIVES)  # skip perspectives for this bill
                continue
            for ptype in ALL_PERSPECTIVES:
                current += 1
                yield _sse({"current": current, "total": total_ops, "message": f"{bill.bill_number} — {ptype}", "done": False})
                await asyncio.sleep(0)
                try:
                    await asyncio.get_event_loop().run_in_executor(None, lambda b=bill, p=ptype: _gen(b, p, db))
                except Exception as e:
                    logger.warning(f"perspective {ptype} failed for {bill.bill_number}: {e}")
                    failed += 1
        yield _sse({"current": total_ops, "total": total_ops, "message": f"Done — {analyzed} bills analyzed, {failed} failures", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.get("/stream/generate-all-perspectives")
async def stream_generate_all_perspectives(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream bulk perspective generation as Server-Sent Events."""
    from app.services.perspectives_service import generate_perspective as _gen

    async def gen():
        bills = db.query(Legislation).filter(
            Legislation.level == "local",
            Legislation.analyzed_at.isnot(None),
        ).all()
        total_ops = len(bills) * len(ALL_PERSPECTIVES)
        yield _sse({"current": 0, "total": total_ops, "message": f"Generating perspectives for {len(bills)} bills ({total_ops} total)…", "done": False})
        await asyncio.sleep(0)
        generated = failed = current = 0
        for bill in bills:
            for ptype in ALL_PERSPECTIVES:
                current += 1
                yield _sse({"current": current, "total": total_ops, "message": f"{bill.bill_number} — {ptype}", "done": False})
                await asyncio.sleep(0)
                try:
                    result = await asyncio.get_event_loop().run_in_executor(None, lambda b=bill, p=ptype: _gen(b, p, db))
                    generated += 1 if result else 0
                    failed += 0 if result else 1
                except Exception as e:
                    logger.warning(f"stream perspective {ptype} failed for {bill.bill_number}: {e}")
                    failed += 1
        yield _sse({"current": total_ops, "total": total_ops, "message": f"Done — {generated} generated, {failed} skipped/failed", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.get("/stream/tag-all")
async def stream_tag_all(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream auto-tagging progress as Server-Sent Events."""
    from app.services.legislation_service import _ai_tag_bill
    from app.services.ai_provider import get_ai_provider

    async def gen():
        import json as _j
        from sqlalchemy import or_
        bills = db.query(Legislation).filter(
            or_(Legislation.tags.is_(None), Legislation.tags == "", Legislation.tags == "[]")
        ).all()
        total = len(bills)
        yield _sse({"current": 0, "total": total, "message": f"Found {total} untagged bills", "done": False})
        await asyncio.sleep(0)
        provider = get_ai_provider()
        tagged = failed = 0
        for i, bill in enumerate(bills, 1):
            yield _sse({"current": i, "total": total, "message": f"Tagging {bill.bill_number}…", "done": False})
            await asyncio.sleep(0)
            try:
                tags = await asyncio.get_event_loop().run_in_executor(None, lambda b=bill: _ai_tag_bill(b, provider))
                if tags:
                    bill.tags = _j.dumps(tags)
                    tagged += 1
            except Exception as e:
                logger.warning(f"stream tag failed for {bill.bill_number}: {e}")
                failed += 1
        db.commit()
        yield _sse({"current": total, "total": total, "message": f"Done — {tagged} tagged, {failed} failed", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.get("/stream/plain-titles")
async def stream_plain_titles(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream plain-title generation progress as Server-Sent Events."""
    from app.services.legislation_service import _ai_plain_title
    from app.services.ai_provider import get_ai_provider

    async def gen():
        from sqlalchemy import or_
        bills = db.query(Legislation).filter(
            or_(Legislation.plain_title.is_(None), Legislation.plain_title == "")
        ).all()
        total = len(bills)
        yield _sse({"current": 0, "total": total, "message": f"Found {total} bills without plain titles", "done": False})
        await asyncio.sleep(0)
        provider = get_ai_provider()
        generated = failed = 0
        for i, bill in enumerate(bills, 1):
            yield _sse({"current": i, "total": total, "message": f"Generating title for {bill.bill_number}…", "done": False})
            await asyncio.sleep(0)
            try:
                plain = await asyncio.get_event_loop().run_in_executor(None, lambda b=bill: _ai_plain_title(b, provider))
                if plain:
                    bill.plain_title = plain
                    generated += 1
            except Exception as e:
                logger.warning(f"stream plain title failed for {bill.bill_number}: {e}")
                failed += 1
        db.commit()
        yield _sse({"current": total, "total": total, "message": f"Done — {generated} generated, {failed} failed", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.get("/stream/fetch-news-all")
async def stream_fetch_news_all(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream news-fetch progress for all bills as Server-Sent Events."""
    from app.services.news_service import fetch_and_store_news

    async def gen():
        bills = db.query(Legislation).filter(Legislation.level == "local").all()
        total = len(bills)
        yield _sse({"current": 0, "total": total, "message": f"Fetching news for {total} bills…", "done": False})
        await asyncio.sleep(0)
        fetched = total_articles = failed = 0
        for i, bill in enumerate(bills, 1):
            yield _sse({"current": i, "total": total, "message": f"Fetching news for {bill.bill_number}…", "done": False})
            await asyncio.sleep(0)
            try:
                articles = await asyncio.get_event_loop().run_in_executor(None, lambda b=bill: fetch_and_store_news(b, db))
                total_articles += len(articles)
                fetched += 1
            except Exception as e:
                logger.warning(f"stream news fetch failed for {bill.bill_number}: {e}")
                failed += 1
        yield _sse({"current": total, "total": total, "message": f"Done — {total_articles} articles across {fetched} bills, {failed} failed", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.get("/stream/backfill-vote-records")
async def stream_backfill_vote_records(
    year: int = Query(0),
    month: int = Query(0),
    limit: int = Query(100, ge=1, le=8500),
    force: bool = Query(False),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream roll-call vote backfill progress as Server-Sent Events. Dev-tier only."""

    VOTED_STATUSES = {"signed_into_law", "failed", "vetoed"}

    async def gen():
        q = db.query(Legislation).filter(
            Legislation.level == "local",
            Legislation.status.in_(VOTED_STATUSES),
        )
        q = _apply_date_filters(q, year, month, "", "")
        all_bills = [b for b in q.all() if b.id.startswith("legistar_")]

        if force:
            bills = all_bills[:limit]
            skip_msg = ""
        else:
            already_done = {
                row.legislation_id
                for row in db.query(BillVoteRecord.legislation_id).distinct().all()
            }
            bills = [b for b in all_bills if b.id not in already_done][:limit]
            skip_msg = f" ({len(already_done)} already cached, skipping)"

        total = len(bills)
        yield _sse({"current": 0, "total": total, "message": f"Found {total} voted bills to sync{skip_msg}", "done": False})
        await asyncio.sleep(0)

        upserted = matched = fetched = errors = 0
        for i, bill in enumerate(bills, 1):
            yield _sse({"current": i, "total": total, "message": f"Fetching votes for {bill.bill_number}…", "done": False})
            await asyncio.sleep(0)
            try:
                result = await sync_vote_records(bill.id, db)
                fetched  += result["fetched"]
                matched  += result["matched"]
                upserted += result["upserted"]
            except Exception as e:
                logger.warning(f"stream backfill vote records failed for {bill.id}: {e}")
                errors += 1

        yield _sse({"current": total, "total": total, "message": f"Done — {upserted} votes upserted, {matched} member-matched, {errors} errors", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.get("/stream/backfill-city-context")
async def stream_backfill_city_context(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream city-context backfill progress as Server-Sent Events."""
    from app.services.opendataphilly_service import get_bill_context

    async def gen():
        bills = db.query(Legislation).filter(
            Legislation.analyzed_at.isnot(None),
            Legislation.tags.isnot(None),
            Legislation.supplementary_data.is_(None),
        ).all()
        total = len(bills)
        yield _sse({"current": 0, "total": total, "message": f"Found {total} bills needing city context", "done": False})
        await asyncio.sleep(0)
        updated = failed = 0
        for i, bill in enumerate(bills, 1):
            yield _sse({"current": i, "total": total, "message": f"Backfilling context for {bill.bill_number}…", "done": False})
            await asyncio.sleep(0)
            try:
                _, display_sections = get_bill_context(bill)
                if display_sections:
                    bill.supplementary_data = _json.dumps(display_sections)
                    updated += 1
            except Exception as e:
                logger.warning(f"stream context backfill failed for {bill.bill_number}: {e}")
                failed += 1
        db.commit()
        yield _sse({"current": total, "total": total, "message": f"Done — {updated} updated, {failed} failed", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.get("/stream/backfill-sponsors")
async def stream_backfill_sponsors(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream sponsor backfill progress as SSE. One Playwright session builds the
    matter→guid map, then httpx fetches sponsor info for each bill without one."""
    from app.integrations.legistar_scraper import PhilaLegistarScraper

    async def gen():
        yield _sse({"current": 0, "total": 0, "message": "Building matter→GUID map (Playwright, ~2 min)…", "done": False})
        await asyncio.sleep(0)

        loop = asyncio.get_event_loop()
        scraper = PhilaLegistarScraper(headless=True)

        try:
            guid_map = await loop.run_in_executor(None, scraper.scrape_matter_guid_map)
        except Exception as e:
            yield _sse({"current": 0, "total": 0, "message": f"Failed to build GUID map: {e}", "done": True})
            return

        yield _sse({"current": 0, "total": 0, "message": f"GUID map built — {len(guid_map)} entries. Finding bills without sponsors…", "done": False})
        await asyncio.sleep(0)

        bills = db.query(Legislation).filter(
            (Legislation.sponsor.is_(None)) | (Legislation.sponsor == ""),
            Legislation.level == "local",
        ).all()
        total = len(bills)

        yield _sse({"current": 0, "total": total, "message": f"{total} bills need sponsors", "done": False})
        await asyncio.sleep(0)

        updated = skipped = failed = 0
        for i, bill in enumerate(bills, 1):
            # Extract matter_id from bill id: "legistar_phila_260134" → "260134"
            matter_id = bill.id.split("legistar_phila_", 1)[-1] if "legistar_phila_" in bill.id else None
            if not matter_id or not matter_id.isdigit():
                skipped += 1
                continue

            guid = guid_map.get(matter_id)
            if not guid:
                skipped += 1
                continue

            if i % 50 == 0 or i <= 3:
                yield _sse({"current": i, "total": total, "message": f"[{i}/{total}] Fetching sponsor for {bill.bill_number}…", "done": False})
                await asyncio.sleep(0)

            try:
                sponsor = await loop.run_in_executor(
                    None, PhilaLegistarScraper.fetch_sponsor_from_detail, matter_id, guid
                )
                if sponsor:
                    bill.sponsor = sponsor
                    # Also store the external_url if missing
                    if not bill.external_url:
                        bill.external_url = f"https://phila.legistar.com/LegislationDetail.aspx?ID={matter_id}&GUID={guid}"
                    updated += 1
                else:
                    skipped += 1
            except Exception as e:
                logger.warning(f"Sponsor fetch failed for {bill.bill_number}: {e}")
                failed += 1

            # Commit in batches of 200
            if i % 200 == 0:
                db.commit()

        db.commit()
        yield _sse({
            "current": total, "total": total,
            "message": f"Done — {updated} updated, {skipped} skipped (no GUID or no sponsor listed), {failed} failed",
            "done": True,
        })
        await asyncio.sleep(0)

    return _sse_stream(gen)


class VoteRequest(BaseModel):
    vote: str
    voter_token: str
    debate_id: str | None = None

    @field_validator("vote")
    @classmethod
    def valid_vote(cls, v: str) -> str:
        if v not in {"support", "oppose", "neutral"}:
            raise ValueError("vote must be 'support', 'oppose', or 'neutral'")
        return v

    @field_validator("voter_token")
    @classmethod
    def valid_uuid(cls, v: str) -> str:
        try:
            _uuid.UUID(v)
        except ValueError:
            raise ValueError("voter_token must be a valid UUID")
        return v


def _tally(rows) -> dict:
    counts = {"support": 0, "oppose": 0, "neutral": 0}
    for vote, n in rows:
        if vote in counts:
            counts[vote] = n
    counts["total"] = counts["support"] + counts["oppose"] + counts["neutral"]
    return counts


def _vote_counts(db: Session, legislation_id: str) -> dict:
    """Return member, anonymous, and combined vote counts for a bill."""
    base_q = (
        db.query(LegislationVote.vote, func.count(LegislationVote.id))
        .filter(LegislationVote.legislation_id == legislation_id)
        .group_by(LegislationVote.vote)
    )

    member = _tally(base_q.filter(LegislationVote.user_id.isnot(None)).all())
    anonymous = _tally(base_q.filter(LegislationVote.user_id.is_(None)).all())

    total = {
        "support": member["support"] + anonymous["support"],
        "oppose":  member["oppose"]  + anonymous["oppose"],
        "neutral": member["neutral"] + anonymous["neutral"],
    }
    total["total"] = total["support"] + total["oppose"] + total["neutral"]

    return {"member": member, "anonymous": anonymous, "total": total}


@router.post("/{legislation_id}/vote")
async def cast_vote(
    legislation_id: str,
    body: VoteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_optional_user),
):
    """Cast or update a Support / Oppose / Neutral vote on a piece of legislation.

    Votes are anonymous and deduplicated by ``voter_token`` (a UUID the client
    generates once and persists in localStorage).  Submitting again with the
    same token updates the existing vote rather than adding a new one.
    """
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    try:
        existing = (
            db.query(LegislationVote)
            .filter(
                LegislationVote.legislation_id == legislation_id,
                LegislationVote.voter_token == body.voter_token,
            )
            .first()
        )

        if existing:
            existing.vote = body.vote
            if body.debate_id:
                existing.debate_id = body.debate_id
            if current_user and not existing.user_id:
                existing.user_id = current_user.id
        else:
            db.add(LegislationVote(
                id=f"vote_{_uuid.uuid4().hex[:12]}",
                legislation_id=legislation_id,
                debate_id=body.debate_id,
                user_id=current_user.id if current_user else None,
                vote=body.vote,
                voter_token=body.voter_token,
            ))

        db.commit()
        return {
            "success": True,
            "vote": body.vote,
            "counts": _vote_counts(db, legislation_id),
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Error casting vote on {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{legislation_id}/votes")
async def get_votes(
    legislation_id: str,
    voter_token: str | None = Query(None, description="Your voter token (UUID) to retrieve your current vote"),
    db: Session = Depends(get_db),
):
    """Get vote tallies for a piece of legislation.

    Pass ``voter_token`` to also receive the caller's current vote.
    """
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    your_vote = None
    if voter_token:
        row = (
            db.query(LegislationVote)
            .filter(
                LegislationVote.legislation_id == legislation_id,
                LegislationVote.voter_token == voter_token,
            )
            .first()
        )
        your_vote = row.vote if row else None

    return {
        "success": True,
        "legislation_id": legislation_id,
        "counts": _vote_counts(db, legislation_id),
        "your_vote": your_vote,
    }


@router.post("/{legislation_id}/fetch-details")
async def fetch_bill_details(
    legislation_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch full text + sponsors for a bulk-imported bill via Playwright scrape."""
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    try:
        from app.integrations.legistar_scraper import PhilaLegistarScraper
        import asyncio

        scraper = PhilaLegistarScraper(headless=True)
        loop = asyncio.get_event_loop()
        parsed = await loop.run_in_executor(
            None, lambda: scraper.fetch_details_for_bill(leg.bill_number)
        )
        if not parsed:
            raise HTTPException(status_code=422, detail="Could not find bill on Legistar")

        for key, value in parsed.items():
            if value is not None and key not in ("id",):
                setattr(leg, key, value)
        from datetime import datetime
        leg.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(leg)

        return {
            "success": True,
            "bill_number": leg.bill_number,
            "has_full_text": bool(leg.full_text),
            "has_sponsor": bool(leg.sponsor),
            "external_url": leg.external_url,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"fetch-details failed for {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


PIPELINE_STEP_ORDER = ["sponsors", "analyze", "perspectives", "news", "votes"]
PIPELINE_STEP_LABELS = {
    "sponsors": "Backfill Sponsors",
    "analyze": "Analyze",
    "perspectives": "Generate Perspectives",
    "news": "Fetch News",
    "votes": "Sync Vote Records",
}


@router.get("/stream/pipeline")
async def stream_pipeline(
    steps: str = Query("analyze,perspectives"),
    force_analyze: bool = Query(False),
    perspective_types: str = Query(",".join(ALL_PERSPECTIVES)),
    year: int = Query(0),
    month: int = Query(0),
    date_from: str = Query(""),
    date_to: str = Query(""),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Run the full bill pipeline in order: analyze → perspectives → news.

    Each step skips already-processed work (idempotent). Date filter scopes all steps.
    """
    from app.services.bill_research_service import analyze_bill
    from app.services.perspectives_service import generate_perspective as _gen
    from app.services.news_service import fetch_and_store_news
    from app.services.legislation_service import _ai_plain_title, _ai_tag_bill
    from app.services.ai_provider import get_ai_provider
    from app.integrations.legistar_scraper import PhilaLegistarScraper
    from sqlalchemy import or_
    import json as _j

    requested = [s.strip() for s in steps.split(",") if s.strip()]
    enabled = [s for s in PIPELINE_STEP_ORDER if s in requested]
    ptypes = [p.strip() for p in perspective_types.split(",") if p.strip() and p in ALL_PERSPECTIVES]
    if not ptypes:
        ptypes = list(ALL_PERSPECTIVES)

    async def gen():
        total_steps = len(enabled)
        if total_steps == 0:
            yield _sse({"current": 0, "total": 0, "message": "No steps selected", "done": True})
            return

        # Get scoped bill set (used across steps; each step applies its own skip filter)
        base_q = db.query(Legislation).filter(Legislation.level == "local")
        base_q = _apply_date_filters(base_q, year, month, date_from, date_to)
        scoped_bills = base_q.order_by(Legislation.introduced_date.desc()).all()
        total_bills = len(scoped_bills)

        yield _sse({"current": 0, "total": total_bills * total_steps, "message": f"Starting pipeline: {total_steps} step(s), {total_bills} bills in scope", "done": False})
        await asyncio.sleep(0)

        overall = 0

        for step_idx, step in enumerate(enabled):
            label = PIPELINE_STEP_LABELS[step]
            step_num = f"Step {step_idx + 1}/{total_steps}"

            if step == "sponsors":
                from app.integrations.legistar_scraper import PhilaLegistarScraper as _Scraper
                bills_no_sponsor = [b for b in scoped_bills if not b.sponsor]
                step_total = len(bills_no_sponsor)
                yield _sse({"current": overall, "total": total_bills * total_steps, "message": f"{step_num} — {label}: building GUID map (Playwright ~2 min)…", "done": False})
                await asyncio.sleep(0)
                _scraper = _Scraper(headless=True)
                try:
                    guid_map = await asyncio.get_event_loop().run_in_executor(None, _scraper.scrape_matter_guid_map)
                except Exception as e:
                    yield _sse({"current": overall, "total": total_bills * total_steps, "message": f"{step_num} — {label}: GUID map failed: {e}", "done": False})
                    guid_map = {}
                yield _sse({"current": overall, "total": total_bills * total_steps, "message": f"{step_num} — {label}: {len(guid_map)} GUIDs found, fetching {step_total} sponsors…", "done": False})
                await asyncio.sleep(0)
                s_updated = 0
                for i, bill in enumerate(bills_no_sponsor, 1):
                    overall += 1
                    if i % 50 == 1:
                        yield _sse({"current": overall, "total": total_bills * total_steps, "message": f"{step_num} — {label}: [{i}/{step_total}] {bill.bill_number}", "done": False})
                        await asyncio.sleep(0)
                    matter_id = bill.id.split("legistar_phila_", 1)[-1] if "legistar_phila_" in bill.id else None
                    if not matter_id or not matter_id.isdigit():
                        continue
                    guid = guid_map.get(matter_id)
                    if not guid:
                        continue
                    try:
                        sponsor = await asyncio.get_event_loop().run_in_executor(
                            None, _Scraper.fetch_sponsor_from_detail, matter_id, guid
                        )
                        if sponsor:
                            bill.sponsor = sponsor
                            if not bill.external_url:
                                bill.external_url = f"https://phila.legistar.com/LegislationDetail.aspx?ID={matter_id}&GUID={guid}"
                            s_updated += 1
                    except Exception as e:
                        logger.warning(f"sponsor fetch failed for {bill.bill_number}: {e}")
                    if i % 200 == 0:
                        db.commit()
                db.commit()
                yield _sse({"current": overall, "total": total_bills * total_steps, "message": f"{step_num} — {label}: {s_updated} sponsors backfilled", "done": False})
                await asyncio.sleep(0)

            elif step == "analyze":
                provider = get_ai_provider()
                scraper = PhilaLegistarScraper(headless=True)
                for i, bill in enumerate(scoped_bills, 1):
                    overall += 1
                    yield _sse({"current": overall, "total": total_bills * total_steps, "message": f"{step_num} — {label}: {bill.bill_number} ({i}/{total_bills})", "done": False})
                    await asyncio.sleep(0)
                    try:
                        def _run_analyze(b=bill):
                            # 1. Fetch full text if missing
                            if not b.full_text:
                                try:
                                    parsed = scraper.fetch_details_for_bill(b.bill_number)
                                    if parsed:
                                        for k, v in parsed.items():
                                            if v is not None and k not in ("id",):
                                                setattr(b, k, v)
                                except Exception as e:
                                    logger.warning(f"fetch_details failed for {b.bill_number}: {e}")
                            # 2. Generate plain title if missing
                            if not b.plain_title:
                                try:
                                    plain = _ai_plain_title(b, provider)
                                    if plain:
                                        b.plain_title = plain
                                except Exception as e:
                                    logger.warning(f"plain_title failed for {b.bill_number}: {e}")
                            # 3. Auto-tag if missing
                            if not b.tags or b.tags in ("", "[]"):
                                try:
                                    tags = _ai_tag_bill(b, provider)
                                    if tags:
                                        b.tags = _j.dumps(tags)
                                except Exception as e:
                                    logger.warning(f"auto-tag failed for {b.bill_number}: {e}")
                            # 4. Full analysis if not done (or force)
                            if not b.analyzed_at or force_analyze:
                                analyze_bill(b, db)
                            db.commit()
                        await asyncio.get_event_loop().run_in_executor(None, _run_analyze)
                    except Exception as e:
                        logger.warning(f"pipeline analyze failed for {bill.bill_number}: {e}")

            elif step == "perspectives":
                analyzed_bills = [b for b in scoped_bills if b.analyzed_at]
                total_ops = len(analyzed_bills) * len(ptypes)
                op = 0
                for bill in analyzed_bills:
                    for ptype in ptypes:
                        op += 1
                        overall += 1
                        yield _sse({"current": overall, "total": total_bills * total_steps, "message": f"{step_num} — {label}: {bill.bill_number} / {ptype} ({op}/{total_ops})", "done": False})
                        await asyncio.sleep(0)
                        try:
                            await asyncio.get_event_loop().run_in_executor(None, lambda b=bill, p=ptype: _gen(b, p, db))
                        except Exception as e:
                            logger.warning(f"pipeline perspective {ptype} failed for {bill.bill_number}: {e}")
                # Pad overall counter if analyzed_bills < scoped_bills
                overall += (total_bills - len(analyzed_bills)) * len(ptypes)

            elif step == "news":
                for i, bill in enumerate(scoped_bills, 1):
                    overall += 1
                    yield _sse({"current": overall, "total": total_bills * total_steps, "message": f"{step_num} — {label}: {bill.bill_number} ({i}/{total_bills})", "done": False})
                    await asyncio.sleep(0)
                    try:
                        await asyncio.get_event_loop().run_in_executor(None, lambda b=bill: fetch_and_store_news(b, db))
                    except Exception as e:
                        logger.warning(f"pipeline news fetch failed for {bill.bill_number}: {e}")

            elif step == "votes":
                local_bills = [b for b in scoped_bills if b.id.startswith("legistar_")]
                for i, bill in enumerate(local_bills, 1):
                    overall += 1
                    yield _sse({"current": overall, "total": total_bills * total_steps, "message": f"{step_num} — {label}: {bill.bill_number} ({i}/{len(local_bills)})", "done": False})
                    await asyncio.sleep(0)
                    try:
                        await sync_vote_records(bill.id, db)
                    except Exception as e:
                        logger.warning(f"pipeline vote sync failed for {bill.bill_number}: {e}")
                overall += total_bills - len(local_bills)

        yield _sse({"current": total_bills * total_steps, "total": total_bills * total_steps, "message": f"Pipeline complete — {total_bills} bills processed", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.get("/stream/fetch-details-all")
async def stream_fetch_details_all(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Stream full-detail fetching for all bills missing full_text."""
    from app.integrations.legistar_scraper import PhilaLegistarScraper

    async def gen():
        bills = db.query(Legislation).filter(
            Legislation.level == "local",
            Legislation.full_text.is_(None),
        ).all()
        total = len(bills)
        yield _sse({"current": 0, "total": total, "message": f"Found {total} bills missing full text", "done": False})
        await asyncio.sleep(0)
        scraper = PhilaLegistarScraper(headless=True)
        fetched = failed = 0
        for i, bill in enumerate(bills, 1):
            yield _sse({"current": i, "total": total, "message": f"Fetching details for {bill.bill_number}…", "done": False})
            await asyncio.sleep(0)
            try:
                parsed = await asyncio.get_event_loop().run_in_executor(
                    None, lambda b=bill: scraper.fetch_details_for_bill(b.bill_number)
                )
                if parsed:
                    for key, value in parsed.items():
                        if value is not None and key not in ("id",):
                            setattr(bill, key, value)
                    fetched += 1
                else:
                    failed += 1
            except Exception as e:
                logger.warning(f"fetch-details stream failed for {bill.bill_number}: {e}")
                failed += 1
        db.commit()
        yield _sse({"current": total, "total": total, "message": f"Done — {fetched} fetched, {failed} failed", "done": True})
        await asyncio.sleep(0)

    return _sse_stream(gen)


@router.post("/{legislation_id}/analyze")
async def analyze_legislation(
    legislation_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Trigger AI analysis for a bill: summary, impact score, tags, and 3 base perspectives.

    Sets analyzed_at on success. Idempotent — safe to call multiple times.
    """
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    try:
        from app.services.bill_research_service import analyze_bill
        from app.services.perspectives_service import generate_base_perspectives

        leg = analyze_bill(leg, db)
        perspectives = generate_base_perspectives(leg, db)

        return {
            "success": True,
            "bill_number": leg.bill_number,
            "summary": leg.summary,
            "impact_score": leg.impact_score,
            "impact_level": leg.impact_level,
            "bill_type": leg.bill_type,
            "tags": leg.tags,
            "analyzed_at": leg.analyzed_at,
            "perspectives_generated": [p.perspective_type for p in perspectives],
        }
    except Exception as e:
        logger.error(f"Error analyzing legislation {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")


@router.post("/{legislation_id}/perspectives/{perspective_type}")
async def generate_perspective(
    legislation_id: str,
    perspective_type: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Generate (or return cached) a single perspective for a bill. Admin only."""
    if perspective_type not in ALL_PERSPECTIVES:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown perspective type. Valid types: {', '.join(ALL_PERSPECTIVES)}",
        )

    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    if not leg.analyzed_at:
        raise HTTPException(
            status_code=400,
            detail="Bill must be analyzed first. Use POST /analyze.",
        )

    try:
        from app.services.perspectives_service import generate_perspective as _gen
        loop = asyncio.get_event_loop()
        try:
            persp = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: _gen(leg, perspective_type, db)),
                timeout=90.0,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail=f"Generation timed out after 90s for {perspective_type}")
        if not persp:
            raise HTTPException(status_code=500, detail="Failed to generate perspective")

        return {
            "success": True,
            "perspective_type": persp.perspective_type,
            "position": persp.position,
            "key_arguments": persp.key_arguments,
            "concerns": persp.concerns,
            "assessment": persp.assessment,
            "ai_provider": persp.ai_provider,
            "ai_model": persp.ai_model,
            "generated_at": persp.generated_at,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating {perspective_type} for {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{legislation_id}/perspectives")
async def clear_perspectives(
    legislation_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Delete all generated perspectives for a bill."""
    deleted = (
        db.query(BillPerspective)
        .filter(BillPerspective.bill_id == legislation_id)
        .delete()
    )
    db.commit()
    return {"success": True, "deleted": deleted}


@router.post("/{legislation_id}/perspectives/generate-all")
async def generate_all_perspectives(
    legislation_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Generate all 17 perspectives for a bill (skips already-cached ones)."""
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")
    if not leg.analyzed_at:
        raise HTTPException(status_code=400, detail="Bill must be analyzed first.")

    from app.services.perspectives_service import generate_perspective as _gen
    generated = []
    failed = []
    for ptype in ALL_PERSPECTIVES:
        try:
            persp = _gen(leg, ptype, db)
            if persp:
                generated.append(ptype)
            else:
                failed.append(ptype)
        except Exception as e:
            logger.warning(f"Failed to generate {ptype} for {legislation_id}: {e}")
            failed.append(ptype)

    return {"success": True, "generated": generated, "failed": failed}


@router.get("/{legislation_id}/perspectives")
async def get_perspectives(
    legislation_id: str,
    db: Session = Depends(get_db),
):
    """Get all generated perspectives for a bill."""
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    perspectives = (
        db.query(BillPerspective)
        .filter(BillPerspective.bill_id == legislation_id)
        .all()
    )

    generated = {p.perspective_type for p in perspectives}
    pending = [t for t in ALL_PERSPECTIVES if t not in generated]

    return {
        "success": True,
        "bill_id": legislation_id,
        "analyzed": leg.analyzed_at is not None,
        "perspectives": [
            {
                "perspective_type": p.perspective_type,
                "position": p.position,
                "key_arguments": p.key_arguments,
                "concerns": p.concerns,
                "assessment": p.assessment,
                "generated_at": p.generated_at,
            }
            for p in perspectives
        ],
        "pending_types": pending,
    }


@router.post("/{legislation_id}/fetch-news")
async def fetch_legislation_news(
    legislation_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch and store related news articles for a bill from Google News RSS."""
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")

    try:
        from app.services.news_service import fetch_and_store_news
        articles = fetch_and_store_news(leg, db)
        return {"success": True, "articles_found": len(articles), "articles": articles}
    except Exception as e:
        logger.error(f"Error fetching news for {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail=f"News fetch failed: {e}")


@router.get("/{legislation_id}/export")
async def export_single_bill(
    legislation_id: str,
    format: str = Query("json", pattern="^(csv|json)$"),
    db: Session = Depends(get_db),
):
    """Export a single bill as CSV or JSON including full text, summary, and perspectives."""
    import csv, io
    leg = (
        db.query(Legislation)
        .options(joinedload(Legislation.perspectives))
        .filter(Legislation.id == legislation_id)
        .first()
    )
    if not leg:
        raise HTTPException(status_code=404, detail="Bill not found")

    try:
        tags = _json.loads(leg.tags) if leg.tags else []
    except Exception:
        tags = []

    safe_number = leg.bill_number.replace("/", "-").replace(" ", "_")

    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Field", "Value"])
        writer.writerow(["Bill Number",    leg.bill_number])
        writer.writerow(["Title",          leg.plain_title or leg.title])
        writer.writerow(["Official Title", leg.title])
        writer.writerow(["Status",         leg.status or ""])
        writer.writerow(["Introduced",     leg.introduced_date.strftime("%Y-%m-%d") if leg.introduced_date else ""])
        writer.writerow(["Impact Level",   leg.impact_level or ""])
        writer.writerow(["Impact Score",   leg.impact_score or ""])
        writer.writerow(["Bill Type",      leg.bill_type or ""])
        writer.writerow(["Tags",           ", ".join(tags)])
        writer.writerow(["Sponsor",        leg.sponsor or ""])
        writer.writerow(["Summary",        leg.summary or ""])
        writer.writerow(["Full Text",      leg.full_text or ""])
        writer.writerow(["External URL",   leg.external_url or ""])
        writer.writerow([])
        writer.writerow(["Perspective Type", "Position", "Assessment", "Key Arguments", "Concerns"])
        for p in sorted(leg.perspectives, key=lambda x: x.perspective_type):
            try:
                args = "; ".join(_json.loads(p.key_arguments)) if p.key_arguments else ""
            except Exception:
                args = p.key_arguments or ""
            writer.writerow([p.perspective_type, p.position or "", p.assessment or "", args, p.concerns or ""])
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{safe_number}.csv"'},
        )

    # JSON
    def _persp(p: BillPerspective) -> dict:
        try:
            args = _json.loads(p.key_arguments) if p.key_arguments else []
        except Exception:
            args = []
        return {
            "type": p.perspective_type,
            "position": p.position,
            "assessment": p.assessment,
            "key_arguments": args,
            "concerns": p.concerns,
        }

    try:
        city_context = _json.loads(leg.supplementary_data) if leg.supplementary_data else None
    except Exception:
        city_context = None

    data = {
        "bill_number": leg.bill_number,
        "title": leg.plain_title or leg.title,
        "official_title": leg.title,
        "status": leg.status,
        "introduced_date": leg.introduced_date.strftime("%Y-%m-%d") if leg.introduced_date else None,
        "impact_level": leg.impact_level,
        "impact_score": leg.impact_score,
        "bill_type": leg.bill_type,
        "tags": tags,
        "sponsor": leg.sponsor,
        "summary": leg.summary,
        "full_text": leg.full_text,
        "city_context": city_context,
        "external_url": leg.external_url,
        "perspectives": [_persp(p) for p in sorted(leg.perspectives, key=lambda x: x.perspective_type)],
    }
    return StreamingResponse(
        iter([_json.dumps(data, indent=2)]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{safe_number}.json"'},
    )


@router.get("/{legislation_id}/roll-call")
async def get_roll_call(
    legislation_id: str,
    db: Session = Depends(get_db),
):
    """Return official council roll call votes for a bill.

    Returns cached records if present.  Pass ?refresh=true to re-fetch from Legistar.
    """
    records = (
        db.query(BillVoteRecord)
        .filter(BillVoteRecord.legislation_id == legislation_id)
        .order_by(BillVoteRecord.voter_name)
        .all()
    )
    return {
        "success": True,
        "data": [
            {
                "voter_name": r.voter_name,
                "vote": r.vote,
                "councilmember_id": r.councilmember_id,
                "action_date": r.action_date,
                "result": r.result,
            }
            for r in records
        ],
    }


@router.post("/{legislation_id}/sync-votes")
async def sync_votes(
    legislation_id: str,
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Fetch official roll call votes from Legistar and cache them. Dev-tier only."""
    leg = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not leg:
        raise HTTPException(status_code=404, detail="Legislation not found")
    try:
        result = await sync_vote_records(legislation_id, db)
        return {"success": True, **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{legislation_id}")
async def get_legislation(
    legislation_id: str,
    db: Session = Depends(get_db)
):
    """Get detailed information about specific legislation."""
    try:
        leg = (
            db.query(Legislation)
            .options(joinedload(Legislation.perspectives))
            .filter(Legislation.id == legislation_id)
            .first()
        )
        if not leg:
            raise HTTPException(status_code=404, detail="Legislation not found")

        return {
            "success": True,
            "data": {
                "id": leg.id,
                "bill_number": leg.bill_number,
                "title": leg.title,
                "description": leg.description,
                "full_text": leg.full_text,
                "sponsor": leg.sponsor,
                "status": leg.status,
                "source": leg.source,
                "level": leg.level,
                "introduced_date": leg.introduced_date,
                "external_url": leg.external_url,
                "plain_title": leg.plain_title,
                "summary": leg.summary,
                "impact_score": leg.impact_score,
                "impact_level": leg.impact_level,
                "bill_type": leg.bill_type,
                "tags": leg.tags,
                "analyzed_at": leg.analyzed_at,
                "news_links": leg.news_links,
                "supplementary_data": leg.supplementary_data,
                "next_hearing_date":     leg.next_hearing_date.isoformat() if leg.next_hearing_date else None,
                "next_hearing_time":     leg.next_hearing_time,
                "next_hearing_body":     leg.next_hearing_body,
                "next_hearing_location": leg.next_hearing_location,
                "next_hearing_url":      leg.next_hearing_url,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching legislation {legislation_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
