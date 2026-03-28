"""Main FastAPI application."""

import logging
import sys
from pathlib import Path
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.config import get_settings
from app.models.database import init_db, get_db
from app.api import legislation_routes, debate_routes, agent_routes, auth_routes, user_routes

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
    if not settings.anthropic_api_key:
        warnings.append("ANTHROPIC_API_KEY is not set — Claude agents will be unavailable")
    if settings.app_base_url == "http://localhost:8000" and settings.environment == "production":
        warnings.append("APP_BASE_URL is still set to localhost — sharing URLs will be broken in production")
    for msg in warnings:
        logger.warning(msg)


_validate_startup()

app = FastAPI(
    title="Common Ground",
    description="AI Debate Platform for Legislation Analysis",
    version="0.1.0",
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

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Include routers
app.include_router(auth_routes.router)
app.include_router(user_routes.router)
app.include_router(legislation_routes.router)
app.include_router(debate_routes.router)
app.include_router(agent_routes.router)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "status": "ok",
        "app": "Common Ground",
        "version": "0.1.0"
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
    """Check AI service configuration."""
    if not settings.anthropic_api_key:
        return {
            "status": "warning",
            "reason": "ANTHROPIC_API_KEY is not set — Claude agents will be unavailable"
        }
    return {
        "status": "ok",
        "model": settings.default_model
    }


_SHARE_TEMPLATE: str | None = None


def _get_share_template() -> str:
    """Read and cache the share page template."""
    global _SHARE_TEMPLATE
    if _SHARE_TEMPLATE is None:
        _SHARE_TEMPLATE = Path("static/debate_share.html").read_text(encoding="utf-8")
    return _SHARE_TEMPLATE


@app.get("/debates/share/{debate_id}")
async def share_debate_page(debate_id: str, db: Session = Depends(get_db)):
    """Serve the debate sharing page with server-rendered meta tags for social crawlers."""
    from app.models import Debate

    debate = db.query(Debate).filter(Debate.id == debate_id, Debate.is_public == True).first()

    template = _get_share_template()
    base = settings.app_base_url.rstrip("/")
    image_url = f"{base}/static/ai-debate-og.png"
    share_url = f"{base}/debates/share/{debate_id}"

    if debate:
        title = debate.title
        leg_title = debate.legislation.title if debate.legislation else ""
        description = f"AI agents debate: {debate.topic} — {leg_title[:100]}..."
    else:
        title = "AI Debate"
        description = "View this AI-generated policy debate on Common Ground."

    html = (
        template
        .replace("AI Debate: [TITLE]", f"AI Debate: {title}")
        .replace("[TITLE]", title)
        .replace("[DESCRIPTION]", description)
        .replace("[URL]", share_url)
        .replace("https://your-domain.com/static/ai-debate-og.png", image_url)
        .replace("https://your-domain.com/static/ai-debate-twitter.png", image_url)
    )

    return HTMLResponse(content=html)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )
