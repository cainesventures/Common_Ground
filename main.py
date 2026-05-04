"""Main FastAPI application."""

import logging
import sys
import time
import os
import shutil
from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.config import get_settings
from app.models.database import init_db, get_db
from app.rate_limit import limiter
from app.api import legislation_routes, auth_routes, user_routes, councilmember_routes, metrics_routes, donation_routes, hearings_routes, election_routes, insights_routes

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

if settings.sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=0.1,
    )
    logger.info("Sentry initialized (environment=%s)", settings.environment)

app = FastAPI(
    title="Open Common Ground",
    description="Philadelphia City Council Legislation Tracker",
    version="0.2.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration_ms = (time.time() - start) * 1000
    logger.info("%s %s %d %.0fms", request.method, request.url.path, response.status_code, duration_ms)
    return response


# CORS — allow the Next.js frontend to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
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
app.include_router(insights_routes.router)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "ok",
        "app": "Open Common Ground",
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


@app.post("/admin/seed-db")
async def seed_db(
    file: UploadFile = File(...),
    x_upload_key: str = Header(...),
):
    """One-time endpoint to upload the SQLite DB to the volume. Remove after use."""
    if x_upload_key != settings.jwt_secret:
        raise HTTPException(status_code=403, detail="Forbidden")
    db_path = settings.database_url.replace("sqlite:///", "")
    tmp_path = db_path + ".tmp"
    with open(tmp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    os.replace(tmp_path, db_path)
    size_mb = os.path.getsize(db_path) / 1024 / 1024
    return {"status": "ok", "path": db_path, "size_mb": round(size_mb, 1)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
