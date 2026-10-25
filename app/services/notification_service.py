"""Decide which hearing reminders, status alerts and new-post alerts to send,
and send them.

Runs every 30 minutes inside the API process (main.py) and on demand. Each
PushWatch remembers what its reader was last told, so a change goes out
exactly once no matter how often this runs:

  status   the bill's status differs from watch.last_status
           -> "Bill 260516 is now Signed into Law"
  hearing  the bill has a hearing in the next 30 hours that this watch has not
           been told about -> "Hearing tomorrow, 10:00 AM: Committee on Rules"

A PushTopicFollow on "blog" does the same for posts: its seen list holds the
slugs the device knows, and anything on the live site that is not in it is new
-> "New post on Open Common Ground".

Watches live in users.db, bills in content.db, so the bills are fetched in one
query by id rather than joined. Posts come from the deployed site itself, see
fetch_blog_posts.
"""
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from app.models import Legislation, PushSubscription, PushTopicFollow, PushWatch
from app.services import webpush

logger = logging.getLogger(__name__)
PHILLY = ZoneInfo("America/New_York")
HEARING_LEAD = timedelta(hours=30)

# The deployed post list. Reading it from the live site rather than a file on
# disk means a post is announced only once its page is actually up: the API and
# the frontend deploy separately, and an alert must never link to a 404.
SITE_URL = os.getenv("PUBLIC_SITE_URL", "https://opencommonground.com").rstrip("/")
BLOG_FEED = f"{SITE_URL}/data/blog_posts.json"
BLOG_TOPIC = "blog"
# More new posts than this at once (a backlog, or a device that missed several)
# become one alert pointing at the blog instead of a burst.
MAX_BLOG_ALERTS = 3

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


def blog_messages(seen: set[str], posts: list[dict]) -> list[tuple[list[str], dict]]:
    """New-post alerts for a device that already knows `seen`, as
    (slugs covered, payload), oldest post first. Pure, like messages_for."""
    new = sorted((p for p in posts if p["slug"] not in seen),
                 key=lambda p: (p.get("date") or "", p["slug"]))
    if not new:
        return []
    if len(new) > MAX_BLOG_ALERTS:
        return [([p["slug"] for p in new], {
            "title": f"{len(new)} new posts on Open Common Ground",
            "body": new[-1].get("title") or "",
            "url": "/blog",
            "tag": "blog",
        })]
    return [([p["slug"]], {
        "title": "New post on Open Common Ground",
        "body": p.get("title") or "",
        "url": f"/blog/{p['slug']}",
        "tag": f"blog-{p['slug']}",
    }) for p in new]


def fetch_blog_posts() -> list[dict] | None:
    """The posts the live site is serving, or None when it cannot be read (the
    blog part of the run is then skipped and retried next time)."""
    try:
        r = httpx.get(BLOG_FEED, timeout=10, follow_redirects=True)
        r.raise_for_status()
        return [p for p in r.json().get("posts", []) if isinstance(p, dict) and p.get("slug")]
    except Exception as e:
        logger.warning("could not read blog posts from %s: %s", BLOG_FEED, e)
        return None


def dispatch(db: Session, now: datetime | None = None, posts: list[dict] | None = None) -> dict:
    """Send everything that is due. Returns counts for logging. `posts` is
    injectable for tests; by default the live site is read, and only when some
    device actually follows the blog."""
    now = now or datetime.now(timezone.utc)
    sent = dead = failed = 0
    if not webpush.configured():
        return {"sent": 0, "dead": 0, "failed": 0, "skipped": "VAPID keys not set"}

    watches = db.query(PushWatch).all()
    follows = db.query(PushTopicFollow).filter(PushTopicFollow.topic == BLOG_TOPIC).all()
    if not watches and not follows:
        return {"sent": 0, "dead": 0, "failed": 0}
    bills = {b.id: b for b in db.query(Legislation).filter(
        Legislation.id.in_({w.bill_id for w in watches})).all()} if watches else {}
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

    if follows:
        if posts is None:
            posts = fetch_blog_posts()
        if posts is not None:
            live = sorted({p["slug"] for p in posts})
            for f in follows:
                sub = subs.get(f.subscription_id)
                if not sub or sub.id in gone:
                    continue
                if f.seen is None:
                    # No baseline from the page: today's posts are not news to this device.
                    f.seen = json.dumps(live)
                    continue
                seen = set(json.loads(f.seen))
                for slugs, payload in blog_messages(seen, posts):
                    try:
                        webpush.send(sub.endpoint, sub.p256dh, sub.auth, payload)
                        sent += 1
                        sub.last_sent_at = now.replace(tzinfo=None)
                    except webpush.Gone:
                        gone.add(sub.id)
                        dead += 1
                        break
                    except Exception as e:
                        failed += 1
                        logger.warning("push failed for blog follow %s: %s", f.id, e)
                        continue
                    seen.update(slugs)
                f.seen = json.dumps(sorted(seen))

    for sid in gone:
        db.query(PushWatch).filter(PushWatch.subscription_id == sid).delete()
        db.query(PushTopicFollow).filter(PushTopicFollow.subscription_id == sid).delete()
        db.query(PushSubscription).filter(PushSubscription.id == sid).delete()
    db.commit()
    result = {"sent": sent, "dead": dead, "failed": failed}
    if sent or dead or failed:
        logger.info("notifications dispatched: %s", result)
    return result
