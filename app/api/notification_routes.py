"""Web Push sign-up for hearing reminders, bill status alerts and new blog posts.

No account needed: a browser's push subscription is the identity. A reader
taps "Notify me" on a bill, or the bell on the blog, the browser hands us its
subscription, and the dispatcher (app/services/notification_service.py) sends
at most one message per status change, one per upcoming hearing and one per
new post.
"""
import json
import re
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.models import Legislation, PushSubscription, PushTopicFollow, PushWatch
from app.models.database import get_db
from app.rate_limit import limiter
from app.services import webpush

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

# The dispatcher POSTs to whatever endpoint is stored, so an unchecked one
# would let anyone point our server at an arbitrary URL (SSRF). Only the real
# browser push services are accepted.
PUSH_HOSTS = (
    "fcm.googleapis.com",          # Chrome, Edge (Chromium), Android
    ".push.services.mozilla.com",  # Firefox
    ".push.apple.com",             # Safari, iOS home-screen apps
    ".notify.windows.com",         # legacy Edge / Windows
)
MAX_WATCHES_PER_DEVICE = 200
BLOG_TOPIC = "blog"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,199}$")


class Keys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=200)
    auth: str = Field(min_length=8, max_length=100)


class Subscription(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: Keys


class WatchRequest(BaseModel):
    subscription: Subscription
    bill_id: str = Field(max_length=100)


class StatusRequest(BaseModel):
    endpoint: str = Field(max_length=1000)
    bill_id: str = Field(max_length=100)


class BlogFollowRequest(BaseModel):
    subscription: Subscription
    # The posts the reader can already see on the page. They become the
    # baseline, so the first alert is the next post, not one just read.
    known: list[str] = Field(default_factory=list, max_length=500)


class EndpointRequest(BaseModel):
    endpoint: str = Field(max_length=1000)


def _check_endpoint(endpoint: str) -> None:
    u = urlparse(endpoint)
    host = (u.hostname or "").lower()
    if u.scheme != "https" or not any(host == h.lstrip(".") or host.endswith(h) for h in PUSH_HOSTS):
        raise HTTPException(status_code=400, detail="Unsupported push service")


def _upsert_subscription(db: Session, s: Subscription) -> PushSubscription:
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == s.endpoint).first()
    if sub:
        # Browsers rotate keys occasionally; keep the latest.
        sub.p256dh, sub.auth = s.keys.p256dh, s.keys.auth
    else:
        sub = PushSubscription(id=str(uuid.uuid4()), endpoint=s.endpoint,
                               p256dh=s.keys.p256dh, auth=s.keys.auth)
        db.add(sub)
        db.flush()
    return sub


def _drop_if_unused(db: Session, sub: PushSubscription) -> None:
    """Forget a device once it follows nothing at all. Checking only bills here
    would delete a device that still wants blog alerts."""
    if (not db.query(PushWatch).filter(PushWatch.subscription_id == sub.id).count()
            and not db.query(PushTopicFollow).filter(PushTopicFollow.subscription_id == sub.id).count()):
        db.delete(sub)


@router.get("/vapid-public-key")
async def vapid_public_key():
    # "Not configured" is a state, not a failure: a 503 here was reported to
    # Sentry on every page view of a live bill. The bell hides when key is null.
    key = webpush.public_key()
    return {"key": key, "enabled": bool(key)}


@router.post("/watch")
@limiter.limit("20/minute")
async def watch(request: Request, body: WatchRequest, db: Session = Depends(get_db)):
    """Follow a bill on this device. Idempotent."""
    _check_endpoint(body.subscription.endpoint)
    bill = db.query(Legislation).filter(Legislation.id == body.bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    sub = _upsert_subscription(db, body.subscription)
    existing = db.query(PushWatch).filter(PushWatch.subscription_id == sub.id,
                                          PushWatch.bill_id == bill.id).first()
    if not existing:
        if db.query(PushWatch).filter(PushWatch.subscription_id == sub.id).count() >= MAX_WATCHES_PER_DEVICE:
            raise HTTPException(status_code=429, detail="This device is following too many bills")
        # Baseline = what the reader sees now, so only later changes notify.
        db.add(PushWatch(subscription_id=sub.id, bill_id=bill.id, last_status=bill.status,
                         last_hearing_notified=None))
    db.commit()
    return {"watching": True}


@router.post("/unwatch")
@limiter.limit("20/minute")
async def unwatch(request: Request, body: StatusRequest, db: Session = Depends(get_db)):
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    if sub:
        db.query(PushWatch).filter(PushWatch.subscription_id == sub.id,
                                   PushWatch.bill_id == body.bill_id).delete()
        _drop_if_unused(db, sub)
        db.commit()
    return {"watching": False}


@router.post("/status")
@limiter.limit("60/minute")
async def status(request: Request, body: StatusRequest, db: Session = Depends(get_db)):
    """Is this device following this bill? POST so the endpoint stays out of URLs and logs."""
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    watching = bool(sub and db.query(PushWatch).filter(PushWatch.subscription_id == sub.id,
                                                       PushWatch.bill_id == body.bill_id).first())
    return {"watching": watching}


@router.post("/blog/follow")
@limiter.limit("20/minute")
async def follow_blog(request: Request, body: BlogFollowRequest, db: Session = Depends(get_db)):
    """Get an alert on this device when a new blog post goes live. Idempotent."""
    _check_endpoint(body.subscription.endpoint)
    sub = _upsert_subscription(db, body.subscription)
    existing = db.query(PushTopicFollow).filter(PushTopicFollow.subscription_id == sub.id,
                                                PushTopicFollow.topic == BLOG_TOPIC).first()
    if not existing:
        # Slugs come from the page, so keep only well-formed ones. With none,
        # the dispatcher takes the baseline from the live site instead.
        known = sorted({s for s in body.known if SLUG_RE.match(s)})
        db.add(PushTopicFollow(subscription_id=sub.id, topic=BLOG_TOPIC,
                               seen=json.dumps(known) if known else None))
    db.commit()
    return {"following": True}


@router.post("/blog/unfollow")
@limiter.limit("20/minute")
async def unfollow_blog(request: Request, body: EndpointRequest, db: Session = Depends(get_db)):
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    if sub:
        db.query(PushTopicFollow).filter(PushTopicFollow.subscription_id == sub.id,
                                         PushTopicFollow.topic == BLOG_TOPIC).delete()
        _drop_if_unused(db, sub)
        db.commit()
    return {"following": False}


@router.post("/blog/status")
@limiter.limit("60/minute")
async def blog_status(request: Request, body: EndpointRequest, db: Session = Depends(get_db)):
    """Is this device following the blog? POST so the endpoint stays out of URLs and logs."""
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    following = bool(sub and db.query(PushTopicFollow).filter(PushTopicFollow.subscription_id == sub.id,
                                                              PushTopicFollow.topic == BLOG_TOPIC).first())
    return {"following": following}
