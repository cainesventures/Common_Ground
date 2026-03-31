"""
Email service using Resend.

Sends weekly digest emails to opted-in users summarising new and recently
analysed Philadelphia City Council bills.

Usage:
  Set RESEND_API_KEY in .env (get a free key at resend.com).
  Set EMAIL_FROM in .env if you want a custom sender address.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def _resend_client():
    """Return a configured Resend client, or raise if key is missing."""
    import resend  # lazy import — not available without pip install resend
    from app.config import get_settings
    settings = get_settings()
    if not settings.resend_api_key:
        raise RuntimeError("RESEND_API_KEY is not set in .env")
    resend.api_key = settings.resend_api_key
    return resend


def _bill_html(bill) -> str:
    """Render a single bill as an HTML snippet for the digest."""
    from app.config import get_settings
    settings = get_settings()
    base = settings.frontend_base_url.rstrip("/")
    url = f"{base}/legislation/{bill.id}"

    title = bill.plain_title or bill.title or bill.bill_number
    summary = bill.summary or bill.description or ""
    tags: list[str] = []
    try:
        tags = json.loads(bill.tags) if bill.tags else []
    except Exception:
        pass

    tag_html = "".join(
        f'<span style="display:inline-block;background:#e0f2fe;color:#0369a1;'
        f'border-radius:9999px;padding:1px 8px;font-size:11px;margin:2px 2px 0 0">'
        f'{t}</span>'
        for t in tags[:4]
    )

    impact_badge = ""
    if bill.impact_level:
        colors = {"high": "#fecaca:#b91c1c", "medium": "#fef9c3:#854d0e", "low": "#dcfce7:#166534"}
        bg, fg = colors.get(bill.impact_level, "#f3f4f6:#374151").split(":")
        impact_badge = (
            f'<span style="background:{bg};color:{fg};border-radius:4px;'
            f'padding:1px 6px;font-size:11px;font-weight:600;margin-left:8px">'
            f'{bill.impact_level.capitalize()} impact</span>'
        )

    return f"""
<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px">
  <p style="margin:0 0 4px 0;font-size:13px;color:#6b7280;font-family:monospace">{bill.bill_number}</p>
  <p style="margin:0 0 6px 0;font-size:16px;font-weight:600;color:#111827">
    <a href="{url}" style="color:#2563eb;text-decoration:none">{title}</a>
    {impact_badge}
  </p>
  {f'<p style="margin:0 0 8px 0;font-size:14px;color:#4b5563;line-height:1.5">{summary[:280]}{"…" if len(summary) > 280 else ""}</p>' if summary else ''}
  <div>{tag_html}</div>
  <p style="margin:8px 0 0 0">
    <a href="{url}" style="font-size:13px;color:#2563eb">Read perspectives →</a>
  </p>
</div>"""


def _build_digest_html(bills: list, user_display_name: str) -> str:
    """Build the full HTML body for a weekly digest email."""
    from app.config import get_settings
    settings = get_settings()
    base = settings.frontend_base_url.rstrip("/")
    now = datetime.utcnow().strftime("%B %d, %Y")
    prefs_url = f"{base}/profile"

    bills_html = "".join(_bill_html(b) for b in bills)
    count = len(bills)
    plural = "bill" if count == 1 else "bills"

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">

    <!-- Header -->
    <div style="background:#111827;border-radius:8px 8px 0 0;padding:20px 24px">
      <p style="margin:0;font-size:20px;font-weight:700;color:#f9fafb">Common Ground</p>
      <p style="margin:4px 0 0 0;font-size:13px;color:#9ca3af">Philadelphia City Council Tracker</p>
    </div>

    <!-- Body -->
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;padding:24px">
      <p style="margin:0 0 4px 0;font-size:22px;font-weight:700;color:#111827">Weekly Update</p>
      <p style="margin:0 0 20px 0;font-size:14px;color:#6b7280">{now}</p>

      <p style="font-size:15px;color:#374151;margin:0 0 20px 0">
        Hi {user_display_name}, here {"are" if count != 1 else "is"} <strong>{count} {plural}</strong>
        recently active in Philadelphia City Council with AI perspectives available.
      </p>

      {bills_html}

      <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#9ca3af;margin:0">
        You're receiving this because you opted in to weekly digests.
        <a href="{prefs_url}" style="color:#6b7280">Manage preferences</a>
      </p>
    </div>

  </div>
</body>
</html>"""


def send_digest_to_user(user, bills: list) -> bool:
    """
    Send a weekly digest email to a single user.
    Returns True on success, False on failure.
    """
    from app.config import get_settings
    settings = get_settings()

    if not bills:
        logger.info(f"No bills to send for digest to {user.email}")
        return True

    resend = _resend_client()
    html = _build_digest_html(bills, user.display_name or "there")

    try:
        resend.Emails.send({
            "from": settings.email_from,
            "to": [user.email],
            "subject": f"Weekly Philadelphia City Council Update — {datetime.utcnow().strftime('%b %d')}",
            "html": html,
        })
        logger.info(f"Digest sent to {user.email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send digest to {user.email}: {e}")
        return False


def send_weekly_digest(db: Session, lookback_days: int = 7) -> dict:
    """
    Send weekly digest to all opted-in users.

    Selects bills analyzed in the last `lookback_days` days, up to 10.
    Returns a summary dict.
    """
    from app.models import Legislation, User

    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    bills = (
        db.query(Legislation)
        .filter(
            Legislation.analyzed_at >= cutoff,
            Legislation.level == "local",
            Legislation.bill_type != "ceremonial",
        )
        .order_by(Legislation.impact_score.desc().nullslast(), Legislation.analyzed_at.desc())
        .limit(10)
        .all()
    )

    if not bills:
        return {"sent": 0, "skipped": 0, "bills_in_digest": 0, "reason": "No analyzed bills in lookback window"}

    users = db.query(User).filter(User.digest_enabled == True).all()  # noqa: E712

    sent = 0
    failed = 0
    for user in users:
        ok = send_digest_to_user(user, bills)
        if ok:
            sent += 1
        else:
            failed += 1

    return {
        "sent": sent,
        "failed": failed,
        "skipped": 0,
        "bills_in_digest": len(bills),
        "opted_in_users": len(users),
    }
