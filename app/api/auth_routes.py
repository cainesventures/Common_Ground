"""Google OAuth 2.0 authentication routes.

Flow:
  1. Client sends user to GET /api/auth/google
  2. Google redirects back to GET /api/auth/google/callback?code=...
  3. Server exchanges code for user info, upserts User row, returns JWT
     — as an HttpOnly cookie (for browser clients)
     — and in the JSON response body (for API / SPA clients)

To register the OAuth app:
  https://console.cloud.google.com/ → APIs & Services → Credentials
  Authorized redirect URI: {APP_URL}/api/auth/google/callback
"""

import logging
from datetime import datetime
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user
from app.config import get_settings
from app.models import User
from app.models.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
SCOPES = "openid email profile"


def _redirect_uri() -> str:
    settings = get_settings()
    return f"{settings.app_url}/api/auth/google/callback"


@router.get("/google")
async def google_login():
    """Redirect the browser to Google's OAuth consent screen."""
    settings = get_settings()
    if not settings.google_client_id:
        raise HTTPException(
            status_code=503,
            detail="GOOGLE_CLIENT_ID is not configured. Set it in your .env file.",
        )

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "select_account",
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(url=f"{GOOGLE_AUTH_URL}?{query}")


@router.get("/google/callback")
async def google_callback(
    code: str = Query(...),
    response: Response = None,
    db: Session = Depends(get_db),
):
    """Exchange the Google auth code for a JWT and create/update the User row."""
    settings = get_settings()

    # Exchange code for access token
    async with httpx.AsyncClient(timeout=15.0) as client:
        token_resp = await client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
        if token_resp.status_code != 200:
            logger.error(f"Google token exchange failed: {token_resp.text}")
            raise HTTPException(status_code=400, detail="Google OAuth token exchange failed")

        access_token = token_resp.json().get("access_token")

        # Fetch user info from Google
        info_resp = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if info_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to fetch user info from Google")

        info = info_resp.json()

    google_id = info.get("sub")
    email = info.get("email")
    if not google_id or not email:
        raise HTTPException(status_code=400, detail="Google did not return a user ID or email")

    # Upsert User
    user = db.query(User).filter(User.google_id == google_id).first()
    if user:
        user.display_name = info.get("name", user.display_name)
        user.avatar_url = info.get("picture", user.avatar_url)
        user.last_login = datetime.utcnow()
    else:
        user = User(
            id=f"user_{uuid4().hex[:12]}",
            google_id=google_id,
            email=email,
            display_name=info.get("name"),
            avatar_url=info.get("picture"),
            last_login=datetime.utcnow(),
        )
        db.add(user)

    db.commit()
    db.refresh(user)

    jwt_token = create_access_token(user.id)

    # Redirect the browser to the frontend so the SPA can store the token.
    # Works in both dev (localhost:3000) and production.
    redirect = RedirectResponse(
        url=f"{settings.frontend_url.rstrip('/')}/auth/callback?token={jwt_token}",
        status_code=302,
    )
    redirect.set_cookie(
        key="access_token",
        value=jwt_token,
        httponly=True,
        samesite="lax",
        max_age=30 * 24 * 3600,
        secure=settings.environment == "production",
    )
    return redirect

    # Fallback JSON response (for API clients / tests — unreachable via browser flow)
    if response is not None:
        response.set_cookie(
            key="access_token",
            value=jwt_token,
            httponly=True,
            samesite="lax",
            max_age=30 * 24 * 3600,
            secure=settings.environment == "production",
        )

    return {
        "success": True,
        "access_token": jwt_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
        },
    }


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    return {
        "success": True,
        "user": {
            "id": current_user.id,
            "email": current_user.email,
            "display_name": current_user.display_name,
            "avatar_url": current_user.avatar_url,
            "subscription_tier": current_user.subscription_tier,
            "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
        },
    }


@router.post("/logout")
async def logout(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie("access_token")
    return {"success": True, "message": "Logged out"}
