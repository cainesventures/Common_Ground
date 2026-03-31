"""API routes for site metrics."""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.models import Legislation, BillPerspective, User, BillTracking
from app.models.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("")
async def get_metrics(db: Session = Depends(get_db)):
    """Return site-wide counts for the metrics dashboard."""
    total_bills      = db.query(Legislation).count()
    analyzed_bills   = db.query(Legislation).filter(Legislation.analyzed_at.isnot(None)).count()
    local_bills      = db.query(Legislation).filter(Legislation.level == "local").count()
    perspectives     = db.query(BillPerspective).count()
    users            = db.query(User).count()
    trackings        = db.query(BillTracking).count()
    digest_opted_in  = db.query(User).filter(User.digest_enabled == True).count()  # noqa: E712

    # Bills with news articles
    bills_with_news = db.query(Legislation).filter(Legislation.news_links.isnot(None)).count()

    # Perspective breakdown by position
    from sqlalchemy import func
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
                "local": local_bills,
                "with_news": bills_with_news,
                "analysis_rate_pct": round(analyzed_bills / total_bills * 100) if total_bills else 0,
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
