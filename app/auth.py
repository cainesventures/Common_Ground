"""JWT authentication helpers and FastAPI dependencies.

Tokens are HS256 JWTs with a 30-day expiry.  The token is delivered to the
client as both an HttpOnly cookie (for browser sessions) and a JSON field
(for API clients).  Either delivery method is accepted on subsequent requests.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.database import get_db

TOKEN_EXPIRY_DAYS = 30
ALGORITHM = "HS256"

# Optional bearer scheme — won't auto-require the header
_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/google", auto_error=False)


def create_access_token(user_id: str) -> str:
    """Return a signed JWT for the given user_id."""
    settings = get_settings()
    payload = {
        "sub": user_id,
        "exp": datetime.utcnow() + timedelta(days=TOKEN_EXPIRY_DAYS),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def _decode_token(token: str) -> str:
    """Decode a JWT and return the user_id (sub claim).

    Raises HTTPException 401 on any validation failure.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


def get_current_user(
    bearer_token: Optional[str] = Depends(_oauth2_scheme),
    access_token: Optional[str] = Cookie(None),
    db: Session = Depends(get_db),
):
    """FastAPI dependency: return the authenticated User or raise 401.

    Accepts the JWT from either the Authorization: Bearer header or an
    ``access_token`` HttpOnly cookie.
    """
    from app.models import User

    token = bearer_token or access_token
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user_id = _decode_token(token)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_paid_tier(current_user=Depends(get_current_user)):
    """FastAPI dependency: require paid or dev tier, else 403."""
    if current_user.subscription_tier not in ("paid", "dev"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This feature requires a paid subscription. Upgrade at /pricing.",
        )
    return current_user


def _is_admin_email(email: str) -> bool:
    """True if email is in the configured ADMIN_EMAILS allowlist."""
    if not email:
        return False
    settings = get_settings()
    if not settings.admin_emails:
        return False
    allowed = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    return email.lower() in allowed


def require_dev_tier(current_user=Depends(get_current_user)):
    """FastAPI dependency: require dev tier OR admin-email allowlist, else 403."""
    if current_user.subscription_tier == "dev" or _is_admin_email(current_user.email):
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="This feature requires the developer tier. Upgrade at /pricing.",
    )


def require_bot_token(x_bot_token: Optional[str] = Header(None)):
    """FastAPI dependency: require a valid X-Bot-Token header.

    Used by service-account-style integrations (e.g. the Bluesky bot) that
    don't have a user session.  Token is configured via BOT_API_TOKEN.
    """
    settings = get_settings()
    if not settings.bot_api_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Bot token authentication not configured on this server.",
        )
    if x_bot_token != settings.bot_api_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid bot token.",
        )
    return True


def get_optional_user(
    bearer_token: Optional[str] = Depends(_oauth2_scheme),
    access_token: Optional[str] = Cookie(None),
    db: Session = Depends(get_db),
):
    """FastAPI dependency: return the authenticated User or None (no 401).

    Use on public endpoints that behave differently when the user is logged in.
    """
    from app.models import User

    token = bearer_token or access_token
    if not token:
        return None
    try:
        user_id = _decode_token(token)
        return db.query(User).filter(User.id == user_id).first()
    except HTTPException:
        return None
