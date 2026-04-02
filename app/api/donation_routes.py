"""API routes for Stripe donations."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Donation
from app.models.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/donations", tags=["donations"])

DONATION_MIN = 1
DONATION_MAX = 10_000


class CheckoutRequest(BaseModel):
    amount_usd: int  # e.g. 10


@router.get("/config")
async def get_config():
    """Return the Stripe publishable key for the frontend."""
    settings = get_settings()
    if not settings.stripe_publishable_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    return {"publishable_key": settings.stripe_publishable_key}


@router.post("/checkout")
async def create_checkout(body: CheckoutRequest, db: Session = Depends(get_db)):
    """Create a Stripe Checkout session and return the redirect URL."""
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    if not (DONATION_MIN <= body.amount_usd <= DONATION_MAX):
        raise HTTPException(status_code=400, detail=f"Amount must be between ${DONATION_MIN} and ${DONATION_MAX}")

    try:
        import stripe
        stripe.api_key = settings.stripe_secret_key

        base = settings.frontend_base_url.rstrip("/")
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": body.amount_usd * 100,  # cents
                    "product_data": {
                        "name": "Common Ground — Support Philadelphia Civic Tech",
                        "description": (
                            "Your donation keeps Common Ground free and open for all Philadelphians. "
                            "We track City Council legislation and provide AI-powered perspectives."
                        ),
                    },
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=f"{base}/donate/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/donate",
        )
        return {"url": session.url}
    except Exception as e:
        logger.error(f"Stripe checkout error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create checkout session")


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """Handle Stripe webhook events (payment confirmation)."""
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        import stripe
        stripe.api_key = settings.stripe_secret_key

        if settings.stripe_webhook_secret:
            event = stripe.Webhook.construct_event(payload, sig_header, settings.stripe_webhook_secret)
        else:
            import json
            event = json.loads(payload)
    except Exception as e:
        logger.warning(f"Stripe webhook signature error: {e}")
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        amount_cents = session.get("amount_total", 0)
        donor_email = session.get("customer_details", {}).get("email") or session.get("customer_email")

        donation = Donation(
            id=f"don_{uuid.uuid4().hex[:12]}",
            amount=amount_cents / 100,
            donor_email=donor_email,
            donation_type="one-time",
            stripe_payment_id=session.get("payment_intent") or session.get("id"),
        )
        db.add(donation)
        db.commit()
        logger.info(f"Donation recorded: ${amount_cents / 100:.2f} from {donor_email}")

    return {"received": True}
