"""Main FastAPI application."""

import logging
import sys
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.config import get_settings
from app.models.database import init_db, get_db
from app.api import legislation_routes, auth_routes, user_routes, councilmember_routes, metrics_routes, donation_routes, hearings_routes, election_routes

settings = get_settings()

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def _validate_startup():
    """Validate required configuration before accepting traffic."""
    warnings = []
    if settings.app_base_url == "http://localhost:8000" and settings.environment == "production":
        warnings.append("APP_BASE_URL is still set to localhost — sharing URLs will be broken in production")
    if settings.jwt_secret == "change-me-in-production" and settings.environment == "production":
        raise RuntimeError("JWT_SECRET must be set to a secure random value in production — refusing to start")
    for msg in warnings:
        logger.warning(msg)


_validate_startup()

app = FastAPI(
    title="Common Ground",
    description="Philadelphia City Council Legislation Tracker",
    version="0.2.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
)

# CORS — allow the Next.js frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
init_db()

# Include routers
app.include_router(auth_routes.router)
app.include_router(user_routes.router)
app.include_router(legislation_routes.router)
app.include_router(councilmember_routes.router)
app.include_router(metrics_routes.router)
app.include_router(donation_routes.router)
app.include_router(hearings_routes.router)
app.include_router(election_routes.router)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "ok",
        "app": "Common Ground",
        "version": "0.2.0"
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/health/db")
async def health_db(db: Session = Depends(get_db)):
    """Check database connectivity."""
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        raise HTTPException(status_code=503, detail="Database unavailable")


@app.get("/health/ai")
async def health_ai():
    """Check AI provider configuration and connectivity."""
    from app.services.ai_provider import get_ai_provider
    try:
        provider = get_ai_provider()
        # Actually test connectivity with a minimal prompt
        provider.complete(system_prompt="Reply with the word OK only.", user_prompt="ping")
        return {"status": "ok", "provider": type(provider).__name__}
    except Exception as e:
        return {"status": "error", "provider": type(get_ai_provider()).__name__ if True else "", "reason": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
