"""API routes for site metrics.

Dev-tier only, both of them.

They were unauthenticated, outside the edge-cache allow-list in main.py, and
unrate-limited -- and `get_metrics` runs ten COUNT queries over 8,680 bills and
99,100 vote records, ~68ms of database work per call measured locally and
slower on Railway's volume. On a single SQLite instance that made this the
cheapest way to load the backend of anything exposed, with no account needed
and no limit to hit.

They also disclosed registered user counts, saved-bill counts and digest
opt-in numbers, which are nobody else's business.

Nothing public consumes either route: `/api/metrics` is read by /admin and
/dashboard, `/api/metrics/health` only by /admin, and no worker, workflow or
script calls them. UptimeRobot watches `/health` on the app root, which is
untouched. So requiring the dev tier costs nothing and is a better answer than
rate-limiting an endpoint that no visitor should reach at all.

The limiter stays on as defence in depth -- an admin session should not be able
to hammer the instance either, deliberately or through a runaway poll.
"""

import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import require_dev_tier
from app.models import Legislation, BillPerspective, User, BillTracking, BillVoteRecord
from app.models.database import get_db
from app.rate_limit import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/metrics", tags=["metrics"])


def _apply_date_filters(q, year: int, month: int, date_from: str, date_to: str):
    from sqlalchemy import extract
    from datetime import date
    if year:
        q = q.filter(extract("year", Legislation.introduced_date) == year)
    if month:
        q = q.filter(extract("month", Legislation.introduced_date) == month)
    if date_from:
        try:
            q = q.filter(Legislation.introduced_date >= date.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(Legislation.introduced_date <= date.fromisoformat(date_to))
        except ValueError:
            pass
    return q


@router.get("/health")
@limiter.limit("30/minute")
async def get_system_health(
    request: Request,
    _user=Depends(require_dev_tier),
):
    """Return system status: DB connectivity and current AI provider config.

    The app uses a two-database bind (content + users), so a bare ``SELECT 1``
    on the multi-bind session can't be routed to an engine.  Ping each engine
    directly instead; "ok" means both are reachable.
    """
    from app.config import get_settings
    from app.models.database import content_engine, users_engine
    settings = get_settings()

    db_status = "ok"
    for eng in (content_engine, users_engine):
        try:
            with eng.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            db_status = "error"
            break

    return {
        "db": db_status,
        "ai_provider": settings.ai_provider,
        "ai_model": settings.ai_model,
    }


@router.get("")
@limiter.limit("30/minute")
async def get_metrics(
    request: Request,
    year: int = Query(0),
    month: int = Query(0),
    date_from: str = Query(""),
    date_to: str = Query(""),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Return site-wide counts for the metrics dashboard, optionally scoped by date filter."""
    from sqlalchemy import func, or_

    scoped = year or month or date_from or date_to
    base_q = db.query(Legislation)
    if scoped:
        base_q = _apply_date_filters(base_q, year, month, date_from, date_to)

    total_bills       = base_q.count()
    analyzed_bills    = base_q.filter(Legislation.analyzed_at.isnot(None)).count()
    bills_with_news   = base_q.filter(Legislation.news_links.isnot(None)).count()
    with_plain_titles = base_q.filter(
        Legislation.plain_title.isnot(None),
        Legislation.plain_title != "",
    ).count()

    # Global counts (not date-scoped)
    bills_with_votes = db.query(BillVoteRecord.legislation_id).distinct().count()
    perspectives    = db.query(BillPerspective).count()
    users           = db.query(User).count()
    trackings       = db.query(BillTracking).count()
    digest_opted_in = db.query(User).filter(User.digest_enabled == True).count()  # noqa: E712

    position_counts = dict(
        db.query(BillPerspective.position, func.count(BillPerspective.id))
        .group_by(BillPerspective.position)
        .all()
    )

    return {
        "success": True,
        "metrics": {
            "bills": {
                "total": total_bills,
                "analyzed": analyzed_bills,
                "with_plain_titles": with_plain_titles,
                "with_news": bills_with_news,
                "with_vote_records": bills_with_votes,
                "analysis_rate_pct": round(analyzed_bills / total_bills * 100) if total_bills else 0,
                "scoped": bool(scoped),
            },
            "perspectives": {
                "total": perspectives,
                "by_position": position_counts,
            },
            "users": {
                "total": users,
                "digest_opted_in": digest_opted_in,
            },
            "tracking": {
                "total_saves": trackings,
            },
        },
    }
