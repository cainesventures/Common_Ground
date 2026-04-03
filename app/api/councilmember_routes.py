"""API routes for Philadelphia City Council members."""

import json
import logging
import urllib.request
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.models.database import get_db
from app.auth import require_dev_tier
from app.services.councilmember_service import (
    get_all_councilmembers,
    get_councilmember,
    get_councilmember_bills,
    scrape_and_upsert_councilmembers,
)

# Known Philadelphia City Council district GeoJSON sources (tried in order)
_DISTRICT_GEOJSON_URLS = [
    # OpenDataPhilly / City of Philadelphia ArcGIS
    "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/Council_Districts_2024/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
    "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
    "https://services1.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/City_Council_Districts/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
    # OpenDataPhilly CKAN direct download
    "https://opendata.arcgis.com/datasets/9298c2f3fa3241fbb176ff1cd84e2d26_0.geojson",
]

_geojson_cache: dict | None = None


def _next_election_year() -> int:
    """Philadelphia City Council elections every 4 years in odd years: 2019, 2023, 2027…"""
    current = datetime.utcnow().year
    base = 2019
    cycles_elapsed = (current - base) // 4
    candidate = base + (cycles_elapsed + 1) * 4
    return candidate if candidate > current else candidate + 4

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/councilmembers", tags=["councilmembers"])


@router.get("/districts-geojson")
async def get_districts_geojson():
    """Proxy Philadelphia City Council district boundaries GeoJSON.

    Tries multiple known sources and caches the first successful response
    in memory for the lifetime of the process.
    """
    global _geojson_cache
    if _geojson_cache is not None:
        return JSONResponse(content=_geojson_cache)

    last_error = None
    for url in _DISTRICT_GEOJSON_URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            if data.get("features"):
                logger.info(f"Loaded district GeoJSON from {url} ({len(data['features'])} features)")
                _geojson_cache = data
                return JSONResponse(content=data)
        except Exception as e:
            last_error = e
            logger.warning(f"District GeoJSON source failed ({url}): {e}")

    raise HTTPException(status_code=502, detail=f"Could not fetch district boundaries: {last_error}")


@router.post("/scrape")
async def scrape_councilmembers(
    db: Session = Depends(get_db),
    _user=Depends(require_dev_tier),
):
    """Scrape all 17 current Philadelphia council member profiles from phlcouncil.com."""
    try:
        members = await scrape_and_upsert_councilmembers(db)
        return {
            "success": True,
            "scraped": len(members),
            "members": [{"id": m.id, "name": m.name, "district": m.district} for m in members],
        }
    except Exception as e:
        logger.error(f"Error scraping councilmembers: {e}")
        raise HTTPException(status_code=500, detail=f"Scrape failed: {e}")


@router.get("")
async def list_councilmembers(db: Session = Depends(get_db)):
    """List all Philadelphia City Council members."""
    members = get_all_councilmembers(db)
    return {
        "success": True,
        "total": len(members),
        "members": [
            {
                "id": m.id,
                "name": m.name,
                "district": m.district,
                "party": m.party,
                "email": m.email,
                "phone": m.phone,
                "photo_url": m.photo_url,
                "bills_sponsored": get_councilmember_bills(db, m.name, limit=1, offset=0)[1],
                "profile_url": m.profile_url,
                "term_start": m.term_start,
                "years_serving": (datetime.utcnow().year - m.term_start) if m.term_start else None,
                "next_election": _next_election_year(),
                "years_until_election": _next_election_year() - datetime.utcnow().year,
            }
            for m in members
        ],
    }


@router.get("/{member_id}")
async def get_member(
    member_id: str,
    bills_page: int = Query(1, ge=1),
    bills_limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get a single council member with their sponsored bills."""
    member = get_councilmember(db, member_id)
    if not member:
        raise HTTPException(status_code=404, detail="Council member not found")

    _, total = get_councilmember_bills(db, member.name, limit=1, offset=0)
    offset = (bills_page - 1) * bills_limit
    bills, _ = get_councilmember_bills(db, member.name, limit=bills_limit, offset=offset)

    return {
        "success": True,
        "member": {
            "id": member.id,
            "name": member.name,
            "district": member.district,
            "party": member.party,
            "email": member.email,
            "phone": member.phone,
            "photo_url": member.photo_url,
            "bio": member.bio,
            "profile_url": member.profile_url,
            "bills_sponsored": total,
            "term_start": member.term_start,
            "years_serving": (datetime.utcnow().year - member.term_start) if member.term_start else None,
            "next_election": _next_election_year(),
            "years_until_election": _next_election_year() - datetime.utcnow().year,
            "updated_at": member.updated_at.isoformat() if member.updated_at else None,
        },
        "bills": {
            "total": total,
            "page": bills_page,
            "limit": bills_limit,
            "results": [
                {
                    "id": b.id,
                    "bill_number": b.bill_number,
                    "title": b.title,
                    "status": b.status,
                    "introduced_date": b.introduced_date.isoformat() if b.introduced_date else None,
                    "impact_level": b.impact_level,
                    "analyzed_at": b.analyzed_at.isoformat() if b.analyzed_at else None,
                }
                for b in bills
            ],
        },
    }
