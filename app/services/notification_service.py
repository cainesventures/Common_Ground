"""Decide which hearing reminders and status alerts to send, and send them.

Runs every 30 minutes inside the API process (main.py) and on demand. Each
PushWatch remembers what its reader was last told, so a change goes out
exactly once no matter how often this runs:

  status   the bill's status differs from watch.last_status
           -> "Bill 260516 is now Signed into Law"
  hearing  the bill has a hearing in the next 30 hours that this watch has not
           been told about -> "Hearing tomorrow, 10:00 AM: Committee on Rules"

Watches live in users.db, bills in content.db, so the bills are fetched in one
query by id rather than joined.
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models import Legislation, PushSubscription, PushWatch
from app.services import webpush

logger = logging.getLogger(__name__)
PHILLY = ZoneInfo("America/New_York")
HEARING_LEAD = timedelta(hours=30)

STATUS_LABEL = {
    "introduced": "Introduced", "in_committee": "In Committee",
    "awaiting_mayor": "Awaiting the Mayor", "signed_into_law": "Signed into Law",
    "failed": "Failed", "vetoed": "Vetoed", "lapsed": "Lapsed",
}


def _title(bill: Legislation) -> str:
    return bill.headline or bill.plain_title or bill.title or f"Bill {bill.bill_number}"


def hearing_at(bill: Legislation) -> datetime | None:
    """The hearing as an aware datetime. Legistar gives a date and a separate
    "10:00 AM"; with no parseable time, assume 9:00 AM so the reminder still
    goes out the day before."""
    if not bill.next_hearing_date:
        return None
    d = bill.next_hearing_date
    hour, minute = 9, 0
    m = re.match(r"\s*(\d{1,2}):(\d{2})\s*([AP]M)", bill.next_hearing_time or "", re.I)
    if m:
        hour = int(m.group(1)) % 12 + (12 if m.group(3).upper() == "PM" else 0)
        minute = int(m.group(2))
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=PHILLY)


def _when(dt: datetime, now: datetime) -> str:
    local_now = now.astimezone(PHILLY)
    day = "today" if dt.date() == local_now.date() else (
        "tomorrow" if dt.date() == (local_now + timedelta(days=1)).date() else dt.strftime("%A"))
    return f"{day}, {dt.strftime('%I:%M %p').lstrip('0')}"


def messages_for(watch: PushWatch, bill: Legislation, now: datetime) -> list[tuple[str, dict]]:
    """What this watch should be told now, as (kind, payload). Pure: no I/O,
    so the rules are unit-testable."""
    out = []
    url = f"/philadelphia/legislation/{bill.id}"
    if bill.status and watch.last_status and bill.status != watch.last_status:
        label = STATUS_LABEL.get(bill.status, bill.status.replace("_", " ").title())
        out.append(("status", {
            "title": f"Bill {bill.bill_number} is now {label}",
            "body": _title(bill),
            "url": url,
            "tag": f"status-{bill.id}",
        }))
    when = hearing_at(bill)
    if when and now < when <= now + HEARING_LEAD and watch.last_hearing_notified != bill.next_hearing_date:
        body = bill.next_hearing_body or "Committee hearing"
        out.append(("hearing", {
            "title": f"Hearing {_when(when, now)}: {body}",
            "body": f"{_title(bill)}. Residents can testify at public hearings.",
            "url": url,
            "tag": f"hearing-{bill.id}",
        }))
    return out


def dispatch(db: Session, now: datetime | None = None) -> dict:
    """Send everything that is due. Returns counts for logging."""
    now = now or datetime.now(timezone.utc)
    sent = dead = failed = 0
    if not webpush.configured():
        return {"sent": 0, "dead": 0, "failed": 0, "skipped": "VAPID keys not set"}

    watches = db.query(PushWatch).all()
    if not watches:
        return {"sent": 0, "dead": 0, "failed": 0}
    bills = {b.id: b for b in db.query(Legislation).filter(
        Legislation.id.in_({w.bill_id for w in watches})).all()}
    subs = {s.id: s for s in db.query(PushSubscription).all()}
    gone: set[str] = set()

    for w in watches:
        bill, sub = bills.get(w.bill_id), subs.get(w.subscription_id)
        if not bill or not sub or sub.id in gone:
            continue
        for kind, payload in messages_for(w, bill, now):
            try:
                webpush.send(sub.endpoint, sub.p256dh, sub.auth, payload)
                sent += 1
                sub.last_sent_at = now.replace(tzinfo=None)
            except webpush.Gone:
                gone.add(sub.id)
                dead += 1
                break
            except Exception as e:  # one bad endpoint must not stop the rest
                failed += 1
                logger.warning("push failed for watch %s: %s", w.id, e)
                continue
            # Record only after a successful send, so a transient failure retries.
            if kind == "status":
                w.last_status = bill.status
            else:
                w.last_hearing_notified = bill.next_hearing_date
        # A watch created before the bill had a status still needs a baseline.
        if w.last_status is None and bill.status:
            w.last_status = bill.status

    for sid in gone:
        db.query(PushWatch).filter(PushWatch.subscription_id == sid).delete()
        db.query(PushSubscription).filter(PushSubscription.id == sid).delete()
    db.commit()
    result = {"sent": sent, "dead": dead, "failed": failed}
    if sent or dead or failed:
        logger.info("notifications dispatched: %s", result)
    return result
