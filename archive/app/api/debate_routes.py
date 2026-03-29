"""API routes for debate management."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.models.database import get_db
from app.services.debate_service import DebateService
from app.models import Debate, DebateMessage, DebateVideo, Rating
from app.config import get_settings
from app.auth import require_paid_tier
from typing import List, Optional
import json
import logging

logger = logging.getLogger(__name__)
settings = get_settings()

VALID_SHARE_PLATFORMS = {"twitter", "facebook", "linkedin", "reddit", "email", "copy"}
VALID_FORMATS = {"json", "html", "embed"}

router = APIRouter(prefix="/api/debates", tags=["debates"])


class DebateCreateRequest(BaseModel):
    """Request to create a new debate."""
    legislation_id: str
    topic: str
    agent_ids: List[str]
    max_turns: int = 5
    research_enabled: bool = True
    is_public: bool = True
    # Per-agent conviction: {agent_id: 1-5}  (paid tier only; defaults to 3)
    participant_settings: Optional[dict] = None


class DebateResponse(BaseModel):
    """Response model for debate."""
    id: str
    legislation_id: str
    title: str
    topic: str
    status: str
    turn_count: int
    max_turns: int
    research_enabled: bool
    is_public: bool


@router.post("/create")
async def create_debate(
    request: DebateCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_paid_tier),
):
    """Create a new debate about legislation."""
    try:
        service = DebateService(db)
        debate = await service.create_debate(
            legislation_id=request.legislation_id,
            topic=request.topic,
            agent_ids=request.agent_ids,
            max_turns=request.max_turns,
            research_enabled=request.research_enabled,
            participant_settings=request.participant_settings,
        )

        debate.is_public = request.is_public
        debate.created_by_user_id = current_user.id
        db.commit()
        
        return {
            "success": True,
            "debate": {
                "id": debate.id,
                "legislation_id": debate.legislation_id,
                "title": debate.title,
                "status": debate.status,
                "turn_count": debate.turn_count,
                "max_turns": debate.max_turns,
                "research_enabled": debate.research_enabled,
                "is_public": debate.is_public
            }
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error creating debate: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/auto-generate")
async def trigger_auto_generate(
    max_debates: int = 5,
    lookback_hours: int = 48,
    _user=Depends(require_paid_tier),
):
    """Manually trigger the auto-debate pipeline (dev/admin use)."""
    from app.tasks import auto_generate_debates
    task = auto_generate_debates.delay(max_debates=max_debates, lookback_hours=lookback_hours)
    return {"success": True, "task_id": task.id, "message": f"Auto-debate task queued (max {max_debates} debates)"}


@router.post("/{debate_id}/research")
async def run_research_phase(
    debate_id: str,
    db: Session = Depends(get_db)
):
    """Run the research phase for all agents in the debate."""
    try:
        service = DebateService(db)
        success = await service.run_research_phase(debate_id)
        
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        if not debate:
            raise HTTPException(status_code=404, detail="Debate not found")
        
        return {
            "success": success,
            "debate_status": debate.status,
            "research_data": debate.research_data
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error in research phase for {debate_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{debate_id}/turn")
async def run_debate_turn(
    debate_id: str,
    db: Session = Depends(get_db)
):
    """Run one turn of a debate."""
    try:
        service = DebateService(db)
        is_continuing = await service.run_debate_turn(debate_id)
        
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        if not debate:
            raise HTTPException(status_code=404, detail="Debate not found")
        
        return {
            "success": True,
            "debate_continues": is_continuing,
            "turn_count": debate.turn_count,
            "status": debate.status
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error running turn for {debate_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{debate_id}/run-all")
async def run_full_debate(
    debate_id: str,
    db: Session = Depends(get_db)
):
    """Run all turns of a debate until completion."""
    try:
        service = DebateService(db)
        
        # First run research if enabled
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        if debate and debate.research_enabled and debate.status == "researching":
            await service.run_research_phase(debate_id)
        
        # Then run all debate turns
        turn_count = 0
        while True:
            is_continuing = await service.run_debate_turn(debate_id)
            turn_count += 1
            if not is_continuing:
                break
        
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        
        return {
            "success": True,
            "turns_completed": turn_count,
            "status": debate.status if debate else "not_found"
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error running full debate {debate_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


VALID_SORT = {"newest", "most_viewed", "most_shared"}
VALID_STATUS_FILTER = {"active", "completed", "failed", "researching", "pending"}
VALID_LEVEL_FILTER = {"federal", "state", "local"}


@router.get("/list")
async def list_debates(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    legislation_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="Filter by debate status: active, completed, failed"),
    level: Optional[str] = Query(None, description="Filter by legislation level: federal, state, local"),
    tag: Optional[str] = Query(None, description="Filter by topic tag e.g. 'Immigration'"),
    sort: str = Query("newest", description="Sort order: newest, most_viewed, most_shared"),
    db: Session = Depends(get_db),
):
    """List debates with optional filtering and sorting."""
    from app.models import Legislation

    if status and status not in VALID_STATUS_FILTER:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_STATUS_FILTER))}")
    if level and level not in VALID_LEVEL_FILTER:
        raise HTTPException(status_code=400, detail=f"Invalid level. Must be one of: {', '.join(sorted(VALID_LEVEL_FILTER))}")
    if sort not in VALID_SORT:
        raise HTTPException(status_code=400, detail=f"Invalid sort. Must be one of: {', '.join(sorted(VALID_SORT))}")

    try:
        query = db.query(Debate).filter(Debate.is_public == True, Debate.turn_count > 0)

        if legislation_id:
            query = query.filter(Debate.legislation_id == legislation_id)
        if status:
            query = query.filter(Debate.status == status)
        if level:
            query = query.join(Legislation, Debate.legislation_id == Legislation.id).filter(Legislation.level == level)
        if tag:
            if not level:  # avoid double-join
                query = query.join(Legislation, Debate.legislation_id == Legislation.id)
            query = query.filter(Legislation.tags.ilike(f'%"{tag}"%'))

        if sort == "most_viewed":
            query = query.order_by(Debate.view_count.desc(), Debate.created_at.desc())
        elif sort == "most_shared":
            query = query.order_by(Debate.share_count.desc(), Debate.created_at.desc())
        else:
            query = query.order_by(Debate.created_at.desc())

        total = query.count()
        debates = query.offset(offset).limit(limit).all()

        return {
            "success": True,
            "debates": [
                {
                    "id": d.id,
                    "legislation_id": d.legislation_id,
                    "legislation_level": d.legislation.level if d.legislation else None,
                    "legislation_bill_number": d.legislation.bill_number if d.legislation else None,
                    "legislation_title": d.legislation.title if d.legislation else None,
                    "legislation_tags": json.loads(d.legislation.tags) if d.legislation and d.legislation.tags else [],
                    "title": d.title,
                    "topic": d.topic,
                    "status": d.status,
                    "turn_count": d.turn_count,
                    "max_turns": d.max_turns,
                    "is_public": d.is_public,
                    "view_count": d.view_count,
                    "share_count": d.share_count,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                }
                for d in debates
            ],
            "total": total,
            "limit": limit,
            "offset": offset,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing debates: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{debate_id}")
async def get_debate(
    debate_id: str,
    db: Session = Depends(get_db)
):
    """Get debate details and all messages with avg ratings."""
    from sqlalchemy import func

    try:
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        if not debate:
            raise HTTPException(status_code=404, detail="Debate not found")

        messages = db.query(DebateMessage).filter(
            DebateMessage.debate_id == debate_id
        ).order_by(DebateMessage.turn_number).all()

        # Fetch avg ratings for all messages in one query
        rated_rows = (
            db.query(
                Rating.message_id,
                func.avg(Rating.persuasiveness_score).label("persuasiveness"),
                func.avg(Rating.logical_soundness_score).label("logical_soundness"),
                func.avg(Rating.factual_accuracy_score).label("factual_accuracy"),
                func.avg(Rating.relevance_score).label("relevance"),
                func.avg(Rating.overall_score).label("overall"),
                func.count(Rating.id).label("count"),
            )
            .filter(Rating.message_id.in_([m.id for m in messages]))
            .group_by(Rating.message_id)
            .all()
        )
        ratings_by_msg = {
            r.message_id: {
                "persuasiveness": round(r.persuasiveness or 0, 1),
                "logical_soundness": round(r.logical_soundness or 0, 1),
                "factual_accuracy": round(r.factual_accuracy or 0, 1),
                "relevance": round(r.relevance or 0, 1),
                "overall": round(r.overall or 0, 1),
                "count": r.count,
            }
            for r in rated_rows
        }

        return {
            "success": True,
            "debate": {
                "id": debate.id,
                "legislation_id": debate.legislation_id,
                "legislation": {
                    "id": debate.legislation.id,
                    "title": debate.legislation.title,
                    "bill_number": debate.legislation.bill_number,
                    "sponsor": debate.legislation.sponsor,
                    "sponsor_party": debate.legislation.sponsor_party,
                    "sponsor_state": debate.legislation.sponsor_state,
                    "introduced_date": debate.legislation.introduced_date.isoformat() if debate.legislation.introduced_date else None,
                    "status": debate.legislation.status,
                    "external_url": debate.legislation.external_url,
                } if debate.legislation else None,
                "title": debate.title,
                "topic": debate.topic,
                "status": debate.status,
                "turn_count": debate.turn_count,
                "max_turns": debate.max_turns,
                "research_enabled": debate.research_enabled,
                "is_public": debate.is_public,
                "participating_agents": [
                    {"id": a.id, "name": a.name, "persona": a.persona}
                    for a in debate.participating_agents
                ],
                "messages": [
                    {
                        "id": msg.id,
                        "agent_id": msg.agent_id,
                        "agent": {"name": msg.agent.name, "persona": msg.agent.persona} if msg.agent else None,
                        "turn_number": msg.turn_number,
                        "position": msg.position,
                        "argument": msg.argument,
                        "argument_variants": json.loads(msg.argument_variants) if msg.argument_variants else None,
                        "citations": msg.citations,
                        "ratings": ratings_by_msg.get(msg.id),
                        "created_at": msg.created_at.isoformat() if msg.created_at else None,
                    }
                    for msg in messages
                ],
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching debate {debate_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/public/{debate_id}")
async def get_public_debate(
    debate_id: str,
    format: str = Query("json", description="Response format: json, html, or embed"),
    db: Session = Depends(get_db)
):
    """
    Get public debate data for sharing.
    
    Supports multiple formats:
    - json: API response
    - html: Rich HTML page for social sharing
    - embed: Minimal HTML for embedding
    """
    if format not in VALID_FORMATS:
        raise HTTPException(status_code=400, detail=f"Invalid format. Must be one of: {', '.join(sorted(VALID_FORMATS))}")

    try:
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        if not debate or not debate.is_public:
            raise HTTPException(status_code=404, detail="Debate not found or not public")

        messages = db.query(DebateMessage).filter(
            DebateMessage.debate_id == debate_id
        ).order_by(DebateMessage.turn_number).all()
        
        # Get average ratings for each message
        message_ratings = {}
        for msg in messages:
            ratings = db.query(Rating).filter(Rating.message_id == msg.id).all()
            if ratings:
                avg_scores = {
                    "persuasiveness": sum(r.persuasiveness_score or 0 for r in ratings) / len(ratings),
                    "logical_soundness": sum(r.logical_soundness_score or 0 for r in ratings) / len(ratings),
                    "factual_accuracy": sum(r.factual_accuracy_score or 0 for r in ratings) / len(ratings),
                    "relevance": sum(r.relevance_score or 0 for r in ratings) / len(ratings),
                    "overall": sum(r.overall_score or 0 for r in ratings) / len(ratings)
                }
                message_ratings[msg.id] = avg_scores
        
        debate_data = {
            "id": debate.id,
            "title": debate.title,
            "topic": debate.topic,
            "legislation_title": debate.legislation.title,
            "legislation_summary": debate.legislation.description,
            "status": debate.status,
            "turn_count": debate.turn_count,
            "max_turns": debate.max_turns,
            "created_at": debate.created_at.isoformat() if debate.created_at else None,
            "messages": [
                {
                    "id": msg.id,
                    "agent_name": msg.agent.name if msg.agent else None,
                    "agent_persona": msg.agent.persona if msg.agent else None,
                    "turn_number": msg.turn_number,
                    "position": msg.position,
                    "argument": msg.argument,
                    "ratings": message_ratings.get(msg.id, {}),
                    "created_at": msg.created_at.isoformat() if msg.created_at else None
                }
                for msg in messages
            ]
        }
        
        base = settings.app_base_url.rstrip("/")
        if format == "html":
            return await get_debate_html(debate_data, base)
        elif format == "embed":
            return await get_debate_embed(debate_data)
        else:
            return {
                "success": True,
                "debate": debate_data,
                "share_url": f"{base}/api/debates/public/{debate_id}?format=html",
                "embed_url": f"{base}/api/debates/public/{debate_id}?format=embed"
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error fetching public debate {debate_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


async def get_debate_html(debate_data: dict, base_url: str = ""):
    """Generate rich HTML page for social sharing."""
    from fastapi.responses import HTMLResponse

    if not base_url:
        base_url = get_settings().app_base_url.rstrip("/")

    # Generate Open Graph and Twitter Card meta tags
    title = f"AI Debate: {debate_data['title']}"
    description = f"AI agents debate: {debate_data['topic']} - {debate_data['legislation_title'][:100]}..."
    share_url = f"{base_url}/api/debates/public/{debate_data['id']}?format=html"
    preview_image = f"{base_url}/static/ai-debate-preview.png"
    
    # Create debate summary
    debate_summary = f"""
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
        <h1>{debate_data['title']}</h1>
        <h2>{debate_data['topic']}</h2>
        <p><strong>Legislation:</strong> {debate_data['legislation_title']}</p>
        <p><strong>Status:</strong> {debate_data['status']} ({debate_data['turn_count']}/{debate_data['max_turns']} turns)</p>
        
        <div style="margin: 20px 0;">
            <h3>Debate Arguments:</h3>
    """
    
    for msg in debate_data['messages']:
        ratings = msg.get('ratings', {})
        rating_text = ""
        if ratings:
            rating_text = f" | Rating: {ratings.get('overall', 0):.1f}/10"
        
        debate_summary += f"""
            <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px;">
                <h4>Turn {msg['turn_number']}: {msg['agent_name']} ({msg['position']})</h4>
                <p>{msg['argument'][:300]}{'...' if len(msg['argument']) > 300 else ''}</p>
                <small style="color: #666;">{rating_text}</small>
            </div>
        """
    
    debate_summary += """
        </div>
        
        <div style="text-align: center; margin: 20px 0;">
            <p>View full debate and share your thoughts!</p>
            <a href="#" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Full Debate</a>
        </div>
    </div>
    """
    
    html_content = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{title}</title>
        
        <!-- Open Graph / Facebook -->
        <meta property="og:type" content="article">
        <meta property="og:url" content="{share_url}">
        <meta property="og:title" content="{title}">
        <meta property="og:description" content="{description}">
        <meta property="og:image" content="{preview_image}">

        <!-- Twitter -->
        <meta property="twitter:card" content="summary_large_image">
        <meta property="twitter:url" content="{share_url}">
        <meta property="twitter:title" content="{title}">
        <meta property="twitter:description" content="{description}">
        <meta property="twitter:image" content="{preview_image}">
        
        <style>
            body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
            .debate-container {{ max-width: 800px; margin: 0 auto; padding: 20px; }}
            .debate-header {{ text-align: center; margin-bottom: 30px; }}
            .message {{ border: 1px solid #e0e0e0; padding: 15px; margin: 10px 0; border-radius: 8px; }}
            .message h4 {{ margin-top: 0; color: #2c3e50; }}
            .position-pro {{ border-left: 4px solid #27ae60; }}
            .position-con {{ border-left: 4px solid #e74c3c; }}
            .position-neutral {{ border-left: 4px solid #3498db; }}
            .ratings {{ font-size: 0.9em; color: #7f8c8d; margin-top: 10px; }}
            .share-buttons {{ text-align: center; margin: 30px 0; }}
            .share-button {{ display: inline-block; margin: 0 10px; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }}
        </style>
    </head>
    <body>
        <div class="debate-container">
            <div class="debate-header">
                <h1>{debate_data['title']}</h1>
                <h2>{debate_data['topic']}</h2>
                <p><strong>Legislation:</strong> {debate_data['legislation_title']}</p>
                <p><strong>Status:</strong> {debate_data['status']} ({debate_data['turn_count']}/{debate_data['max_turns']} turns)</p>
            </div>
            
            <h3>AI Debate Arguments:</h3>
    """
    
    for msg in debate_data['messages']:
        ratings = msg.get('ratings', {})
        rating_html = ""
        if ratings:
            rating_html = f"""
            <div class="ratings">
                <strong>Ratings:</strong> 
                Persuasiveness: {ratings.get('persuasiveness', 0):.1f}/10 | 
                Logic: {ratings.get('logical_soundness', 0):.1f}/10 | 
                Accuracy: {ratings.get('factual_accuracy', 0):.1f}/10 | 
                Overall: {ratings.get('overall', 0):.1f}/10
            </div>
            """
        
        position_class = f"position-{msg['position'].lower()}"
        html_content += f"""
            <div class="message {position_class}">
                <h4>Turn {msg['turn_number']}: {msg['agent_name']} 
                    <span style="font-size: 0.8em; color: #666;">({msg['position']})</span>
                </h4>
                <p>{msg['argument']}</p>
                {rating_html}
            </div>
        """
    
    html_content += """
            <div class="share-buttons">
                <h3>Share This AI Debate</h3>
                <a href="#" onclick="shareOnTwitter()" class="share-button">Share on Twitter</a>
                <a href="#" onclick="shareOnFacebook()" class="share-button">Share on Facebook</a>
                <a href="#" onclick="shareOnLinkedIn()" class="share-button">Share on LinkedIn</a>
                <a href="#" onclick="copyLink()" class="share-button">Copy Link</a>
            </div>
            
            <div style="text-align: center; margin: 30px 0; font-size: 0.9em; color: #666;">
                <p>This AI debate was generated by Common Ground - AI Debate Platform</p>
                <p>Humans can share and discuss, but cannot comment directly on the platform.</p>
            </div>
        </div>
        
        <script>
            function shareOnTwitter() {
                const url = encodeURIComponent(window.location.href);
                const text = encodeURIComponent("{title} - AI agents debate legislation!");
                window.open(`https://twitter.com/intent/tweet?url=${url}&text=${text}`, '_blank');
            }
            
            function shareOnFacebook() {
                const url = encodeURIComponent(window.location.href);
                window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank');
            }
            
            function shareOnLinkedIn() {
                const url = encodeURIComponent(window.location.href);
                window.open(`https://www.linkedin.com/sharing/share-offer?url=${url}`, '_blank');
            }
            
            function copyLink() {
                navigator.clipboard.writeText(window.location.href);
                alert('Link copied to clipboard!');
            }
        </script>
    </body>
    </html>
    """
    
    return HTMLResponse(content=html_content)


async def get_debate_embed(debate_data: dict):
    """Generate minimal HTML for embedding in other websites."""
    from fastapi.responses import HTMLResponse
    
    embed_html = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Embedded AI Debate</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 0; padding: 10px; background: #f8f9fa; }}
            .embed-container {{ max-width: 100%; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }}
            .embed-header {{ padding: 15px; border-bottom: 1px solid #e9ecef; }}
            .embed-title {{ margin: 0; font-size: 16px; color: #2c3e50; }}
            .embed-subtitle {{ margin: 5px 0 0 0; font-size: 14px; color: #6c757d; }}
            .embed-messages {{ max-height: 400px; overflow-y: auto; padding: 15px; }}
            .embed-message {{ margin-bottom: 15px; padding: 10px; border-radius: 5px; border-left: 3px solid; }}
            .embed-message.pro {{ border-left-color: #27ae60; background: #f8fff9; }}
            .embed-message.con {{ border-left-color: #e74c3c; background: #fff8f8; }}
            .embed-message.neutral {{ border-left-color: #3498db; background: #f8fdff; }}
            .embed-agent {{ font-weight: bold; font-size: 14px; }}
            .embed-position {{ font-size: 12px; color: #666; margin-left: 5px; }}
            .embed-argument {{ margin: 8px 0; font-size: 14px; line-height: 1.4; }}
            .embed-footer {{ padding: 10px 15px; border-top: 1px solid #e9ecef; text-align: center; background: #f8f9fa; }}
            .embed-link {{ color: #007bff; text-decoration: none; font-size: 14px; }}
        </style>
    </head>
    <body>
        <div class="embed-container">
            <div class="embed-header">
                <h3 class="embed-title">{debate_data['title']}</h3>
                <p class="embed-subtitle">{debate_data['topic']}</p>
            </div>
            
            <div class="embed-messages">
    """
    
    for msg in debate_data['messages'][:5]:  # Limit to first 5 messages for embed
        position_class = msg['position'].lower()
        embed_html += f"""
                <div class="embed-message {position_class}">
                    <div class="embed-agent">
                        {msg['agent_name']} 
                        <span class="embed-position">({msg['position']})</span>
                    </div>
                    <div class="embed-argument">{msg['argument'][:200]}{'...' if len(msg['argument']) > 200 else ''}</div>
                </div>
        """
    
    embed_html += f"""
            </div>
            
            <div class="embed-footer">
                <a href="/debates/public/{debate_data['id']}" class="embed-link" target="_blank">
                    View Full AI Debate →
                </a>
            </div>
        </div>
    </body>
    </html>
    """
    
    return HTMLResponse(content=embed_html)


@router.post("/{debate_id}/track-share")
async def track_debate_share(
    debate_id: str,
    platform: str = Query(..., description=f"Social platform: {', '.join(sorted(VALID_SHARE_PLATFORMS))}"),
    db: Session = Depends(get_db)
):
    """Track when a debate is shared on social media."""
    if platform not in VALID_SHARE_PLATFORMS:
        raise HTTPException(status_code=400, detail=f"Invalid platform. Must be one of: {', '.join(sorted(VALID_SHARE_PLATFORMS))}")

    try:
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        if not debate or not debate.is_public:
            raise HTTPException(status_code=404, detail="Debate not found or not public")

        debate.share_count += 1
        db.commit()

        return {
            "success": True,
            "share_count": debate.share_count,
            "platform": platform
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error tracking share for {debate_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{debate_id}/track-view")
async def track_debate_view(
    debate_id: str,
    db: Session = Depends(get_db)
):
    """Track when a debate is viewed (for analytics)."""
    try:
        debate = db.query(Debate).filter(Debate.id == debate_id).first()
        if not debate or not debate.is_public:
            raise HTTPException(status_code=404, detail="Debate not found or not public")

        debate.view_count += 1
        db.commit()

        return {
            "success": True,
            "view_count": debate.view_count
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error tracking view for {debate_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{debate_id}/messages/{message_id}/rate")
async def rate_message(
    debate_id: str,
    message_id: str,
    rater_agent_id: str,
    db: Session = Depends(get_db)
):
    """Have an agent rate another's argument."""
    try:
        service = DebateService(db)
        rating = await service.rate_message(message_id, rater_agent_id)

        return {
            "success": True,
            "rating": {
                "id": rating.id,
                "message_id": rating.message_id,
                "rater_agent_id": rating.rater_agent_id,
                "persuasiveness_score": rating.persuasiveness_score,
                "logical_soundness_score": rating.logical_soundness_score,
                "factual_accuracy_score": rating.factual_accuracy_score,
                "relevance_score": rating.relevance_score,
                "overall_score": rating.overall_score
            }
        }
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error rating message {message_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{debate_id}/run-background")
async def run_debate_background(
    debate_id: str,
    db: Session = Depends(get_db)
):
    """
    Dispatch a full debate to run as a background Celery task.

    Returns immediately with a task_id you can poll via GET /{debate_id}/task-status.
    Requires Redis and a running Celery worker:
      celery -A app.celery_app worker --loglevel=info
    """
    debate = db.query(Debate).filter(Debate.id == debate_id).first()
    if not debate:
        raise HTTPException(status_code=404, detail="Debate not found")

    try:
        from app.tasks import run_debate_background as _task
        task = _task.delay(debate_id)
        return {
            "success": True,
            "debate_id": debate_id,
            "task_id": task.id,
            "message": "Debate queued. Poll /task-status?task_id=... for progress."
        }
    except Exception as e:
        logger.error(f"Failed to queue background debate {debate_id}: {e}")
        raise HTTPException(
            status_code=503,
            detail="Background task queue unavailable. Ensure Redis is running. Use /run-all for synchronous execution."
        )


@router.post("/{debate_id}/generate-video")
async def generate_debate_video(
    debate_id: str,
    provider: str = Query(None, description="Video provider (default: heygen)"),
    db: Session = Depends(get_db),
):
    """
    Queue AI talking-head video generation for a completed debate.

    Requires a Celery worker and a configured video provider API key.
    Returns immediately with a video_id you can poll via GET /{debate_id}/video.

    The debate must be in 'completed' status before video generation can start.
    """
    debate = db.query(Debate).filter(Debate.id == debate_id).first()
    if not debate:
        raise HTTPException(status_code=404, detail="Debate not found")

    if debate.status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Debate is not yet completed (current status: '{debate.status}'). "
                   "Run the debate to completion before generating a video."
        )

    provider_name = provider or settings.default_video_provider

    if provider_name == "heygen" and not settings.heygen_api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "HEYGEN_API_KEY is not configured. "
                "Set it in your .env file to enable video generation."
            ),
        )

    try:
        from app.models import DebateVideo
        from uuid import uuid4

        video_record = DebateVideo(
            id=f"video_{uuid4().hex[:12]}",
            debate_id=debate_id,
            status="pending",
            provider=provider_name,
        )
        db.add(video_record)
        db.flush()  # Get the ID before committing

        from app.tasks import generate_debate_video as _task
        task = _task.delay(debate_id, video_record.id, provider_name)

        video_record.celery_task_id = task.id
        db.commit()

        return {
            "success": True,
            "video_id": video_record.id,
            "debate_id": debate_id,
            "task_id": task.id,
            "status": "pending",
            "provider": provider_name,
            "message": "Video generation queued. Poll GET /{debate_id}/video for status.",
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to queue video generation for {debate_id}: {e}")
        raise HTTPException(
            status_code=503,
            detail="Video generation queue unavailable. Ensure Redis and a Celery worker are running.",
        )


@router.get("/{debate_id}/video")
async def get_debate_video(
    debate_id: str,
    db: Session = Depends(get_db),
):
    """Get the latest video generation record for a debate."""
    debate = db.query(Debate).filter(Debate.id == debate_id).first()
    if not debate:
        raise HTTPException(status_code=404, detail="Debate not found")

    video = (
        db.query(DebateVideo)
        .filter(DebateVideo.debate_id == debate_id)
        .order_by(DebateVideo.created_at.desc())
        .first()
    )
    if not video:
        raise HTTPException(status_code=404, detail="No video found for this debate")

    return {
        "success": True,
        "video": {
            "video_id": video.id,
            "debate_id": debate_id,
            "status": video.status,
            "provider": video.provider,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "error_message": video.error_message,
            "created_at": video.created_at.isoformat() if video.created_at else None,
            "completed_at": video.completed_at.isoformat() if video.completed_at else None,
        },
    }


@router.get("/{debate_id}/task-status")
async def get_task_status(
    debate_id: str,
    task_id: str = Query(..., description="Celery task ID returned by /run-background"),
    db: Session = Depends(get_db)
):
    """Poll the status of a background debate task."""
    debate = db.query(Debate).filter(Debate.id == debate_id).first()
    if not debate:
        raise HTTPException(status_code=404, detail="Debate not found")

    try:
        from app.celery_app import celery_app
        from celery.result import AsyncResult
        result = AsyncResult(task_id, app=celery_app)
        return {
            "task_id": task_id,
            "debate_id": debate_id,
            "state": result.state,
            "debate_status": debate.status,
            "turn_count": debate.turn_count,
            "result": result.result if result.state == "SUCCESS" else None,
            "error": str(result.result) if result.state == "FAILURE" else None,
        }
    except Exception as e:
        logger.error(f"Failed to get task status {task_id}: {e}")
        raise HTTPException(status_code=503, detail="Task queue unavailable")
