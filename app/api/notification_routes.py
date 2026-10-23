"""Web Push sign-up for hearing reminders and bill status alerts.

No account needed: a browser's push subscription is the identity. A reader
taps "Notify me" on a bill, the browser hands us its subscription, and the
dispatcher (app/services/notification_service.py) sends at most one message
per status change and one per upcoming hearing.
"""
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.models import Legislation, PushSubscription, PushWatch
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


def _check_endpoint(endpoint: str) -> None:
    u = urlparse(endpoint)
    host = (u.hostname or "").lower()
    if u.scheme != "https" or not any(host == h.lstrip(".") or host.endswith(h) for h in PUSH_HOSTS):
        raise HTTPException(status_code=400, detail="Unsupported push service")


@router.get("/vapid-public-key")
async def vapid_public_key():
    key = webpush.public_key()
    if not key:
        raise HTTPException(status_code=503, detail="Notifications are not set up")
    return {"key": key}


@router.post("/watch")
@limiter.limit("20/minute")
async def watch(request: Request, body: WatchRequest, db: Session = Depends(get_db)):
    """Follow a bill on this device. Idempotent."""
    _check_endpoint(body.subscription.endpoint)
    bill = db.query(Legislation).filter(Legislation.id == body.bill_id).first()
    if not bill:
        raise HTTPException(status_code=404, detail="Bill not found")

    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == body.subscription.endpoint).first()
    if sub:
        # Browsers rotate keys occasionally; keep the latest.
        sub.p256dh, sub.auth = body.subscription.keys.p256dh, body.subscription.keys.auth
    else:
        sub = PushSubscription(id=str(uuid.uuid4()), endpoint=body.subscription.endpoint,
                               p256dh=body.subscription.keys.p256dh, auth=body.subscription.keys.auth)
        db.add(sub)
        db.flush()

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
        if not db.query(PushWatch).filter(PushWatch.subscription_id == sub.id).count():
            db.delete(sub)
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
