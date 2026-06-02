"""Admin-only endpoints.

Access requires either:
  - subscription_tier == "dev" on the user row, OR
  - The user's email is listed in the ADMIN_EMAILS env var (comma-separated).

The allowlist survives DB resets so admins always have access.
"""

import logging
import os
import subprocess
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.database import get_db
from app.models import User, BillTracking, LegislationVote, CouncilmemberVote, BlueskyPost, Donation
from app.auth import require_dev_tier, _is_admin_email, require_bot_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/stats")
async def admin_stats(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """High-level counts across the user-side DB."""
    now = datetime.utcnow()
    cutoff_30d = now - timedelta(days=30)
    cutoff_7d = now - timedelta(days=7)

    user_count = db.query(func.count(User.id)).scalar() or 0
    active_30d = db.query(func.count(User.id)).filter(User.last_login >= cutoff_30d).scalar() or 0
    signups_30d = db.query(func.count(User.id)).filter(User.created_at >= cutoff_30d).scalar() or 0
    signups_7d = db.query(func.count(User.id)).filter(User.created_at >= cutoff_7d).scalar() or 0

    tier_counts = dict(
        db.query(User.subscription_tier, func.count(User.id))
          .group_by(User.subscription_tier)
          .all()
    )

    tracking_count = db.query(func.count(BillTracking.id)).scalar() or 0
    vote_count = db.query(func.count(LegislationVote.id)).scalar() or 0
    cm_vote_count = db.query(func.count(CouncilmemberVote.id)).scalar() or 0
    bluesky_post_count = db.query(func.count(BlueskyPost.id)).scalar() or 0
    donation_count = db.query(func.count(Donation.id)).scalar() or 0

    return {
        "users": {
            "total": user_count,
            "active_30d": active_30d,
            "signups_30d": signups_30d,
            "signups_7d": signups_7d,
            "by_tier": tier_counts,
        },
        "engagement": {
            "tracked_bills": tracking_count,
            "bill_votes": vote_count,
            "councilmember_votes": cm_vote_count,
        },
        "operations": {
            "bluesky_posts": bluesky_post_count,
            "donations": donation_count,
        },
        "generated_at": now.isoformat() + "Z",
    }


@router.get("/users")
async def admin_users(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    sort: str = Query("created_at", description="Sort field: created_at | last_login | email"),
    order: str = Query("desc", description="asc or desc"),
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """List users with profile + activity counts.  Tracking and vote counts
    are computed per-user with subqueries — fine for our scale.
    """
    sort_col = {
        "created_at": User.created_at,
        "last_login": User.last_login,
        "email": User.email,
    }.get(sort, User.created_at)
    sort_col = sort_col.desc() if order == "desc" else sort_col.asc()

    total = db.query(func.count(User.id)).scalar() or 0
    users = db.query(User).order_by(sort_col).offset(offset).limit(limit).all()

    # Per-user counts in one query each (small N).  Could optimize with
    # CTE/group-by if user count grows past a few thousand.
    track_counts = dict(
        db.query(BillTracking.user_id, func.count(BillTracking.id))
          .filter(BillTracking.user_id.in_([u.id for u in users]) if users else False)
          .group_by(BillTracking.user_id)
          .all()
    )
    vote_counts = dict(
        db.query(LegislationVote.user_id, func.count(LegislationVote.id))
          .filter(LegislationVote.user_id.in_([u.id for u in users]) if users else False)
          .group_by(LegislationVote.user_id)
          .all()
    )

    rows = []
    for u in users:
        rows.append({
            "id": u.id,
            "email": u.email,
            "display_name": u.display_name,
            "avatar_url": u.avatar_url,
            "subscription_tier": u.subscription_tier,
            "is_admin_via_allowlist": _is_admin_email(u.email),
            "digest_enabled": u.digest_enabled,
            "digest_frequency": u.digest_frequency,
            "digest_min_impact": u.digest_min_impact,
            "created_at": u.created_at.isoformat() + "Z" if u.created_at else None,
            "last_login": u.last_login.isoformat() + "Z" if u.last_login else None,
            "tracked_bills_count": track_counts.get(u.id, 0),
            "bill_votes_count": vote_counts.get(u.id, 0),
        })

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "users": rows,
    }


@router.post("/trigger-backup")
async def trigger_backup(_bot=Depends(require_bot_token)):
    """Run a one-shot Litestream snapshot of users.db to Backblaze B2.

    Triggered by the nightly GitHub Actions workflow.  Uses bot-token auth
    (X-Bot-Token header) so the same secret we already share with the bot
    works here too.

    Why this exists: we removed continuous `litestream replicate -exec`
    from railway.toml because its 15s L0-retention loop blew through
    Backblaze's free Class C cap.  Instead, we trigger backups on a
    controlled cadence (daily) and own the cost budget that way.

    Only users.db is backed up — content.db's source of truth is dev,
    and is restored from B2 via publish.ps1, so there's nothing useful
    to back up on the prod side.
    """
    # Dedicated single-DB config — see litestream.backup-users.yml for the
    # rationale.  Litestream v0.5's CLI doesn't accept `-config FILE PATH`
    # together (positional path triggers "direct" mode which wants a URL).
    config_path = "/app/litestream.backup-users.yml"
    db_path = "/data/users.db"

    if not os.path.exists(config_path):
        raise HTTPException(status_code=503, detail=f"Litestream config not found at {config_path}")
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail=f"users.db not found at {db_path}")

    started_at = datetime.utcnow()
    try:
        result = subprocess.run(
            [
                "litestream", "replicate",
                "-config", config_path,
                "-once",
                "-force-snapshot",
            ],
            timeout=300,  # 5 min ceiling — users.db is tiny, should finish in seconds
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="litestream binary not on PATH")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="litestream replicate timed out (>5min)")

    elapsed = (datetime.utcnow() - started_at).total_seconds()
    ok = result.returncode == 0
    payload = {
        "success": ok,
        "elapsed_sec": round(elapsed, 2),
        "exit_code": result.returncode,
        "stdout_tail": (result.stdout or "")[-800:],
        "stderr_tail": (result.stderr or "")[-800:],
    }
    if ok:
        logger.info(f"users.db backup completed in {elapsed:.1f}s")
    else:
        logger.warning(f"users.db backup failed (exit {result.returncode}): {result.stderr[:300]}")
    return payload
