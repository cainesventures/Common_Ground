"""Legislation ingestion service."""

import logging
from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Legislation
from app.integrations.congress_gov import CongressGovIntegration
from app.integrations.open_states import OpenStatesIntegration
from app.integrations.legistar import LegistarClient
from app.config import get_settings

logger = logging.getLogger(__name__)


class LegislationIngestionService:
    """Service for fetching and storing legislation from multiple sources."""
    
    def __init__(self, db: Session):
        self.db = db
        settings = get_settings()
        self.congress_gov = CongressGovIntegration()
        self.open_states = OpenStatesIntegration(api_key=settings.openstates_api_key or None)
    
    async def ingest_federal_legislation(self, congress: int = 118, limit: int = 20) -> int:
        """
        Fetch and store federal legislation from Congress.gov.
        
        Args:
            congress: Congress session number
            limit: Number of bills to fetch
            
        Returns:
            Number of bills ingested
        """
        bills = await self.congress_gov.get_bills(congress, limit)
        count = 0

        for bill in bills:
            try:
                parsed = CongressGovIntegration.parse_bill_data(bill)

                # Fetch CRS summary and store as full_text
                bill_type = bill.get("type", "")
                bill_number = bill.get("number")
                if bill_type and bill_number:
                    summary = await self.congress_gov.get_bill_summaries(congress, bill_type, bill_number)
                    if summary:
                        parsed["full_text"] = summary
                        # Also use as description if none exists
                        if not parsed.get("description"):
                            parsed["description"] = summary[:500]

                # Check if bill already exists
                existing = self.db.query(Legislation).filter(
                    Legislation.id == parsed["id"]
                ).first()

                if existing:
                    for key, value in parsed.items():
                        setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                else:
                    legislation = Legislation(**parsed)
                    self.db.add(legislation)

                count += 1
            except Exception as e:
                logger.error(f"Error ingesting bill: {e}")
                continue

        self.db.commit()
        logger.info(f"Ingested {count} federal bills")
        return count
    
    async def ingest_state_legislation(self, state: str, limit: int = 20) -> int:
        """
        Fetch and store state legislation from OpenStates.
        
        Args:
            state: State abbreviation (e.g., 'CA', 'NY')
            limit: Number of bills to fetch
            
        Returns:
            Number of bills ingested
        """
        bills = await self.open_states.get_bills_by_state(state, limit)
        count = 0
        
        for bill in bills:
            try:
                parsed = OpenStatesIntegration.parse_bill_data(bill)
                
                existing = self.db.query(Legislation).filter(
                    Legislation.id == parsed["id"]
                ).first()
                
                if existing:
                    for key, value in parsed.items():
                        setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                else:
                    legislation = Legislation(**parsed)
                    self.db.add(legislation)
                
                count += 1
            except Exception as e:
                logger.error(f"Error ingesting bill: {e}")
                continue
        
        self.db.commit()
        logger.info(f"Ingested {count} bills from {state}")
        return count
    
    async def ingest_local_legislation(self, city: str, limit: int = 20) -> dict:
        """
        Fetch and store local/municipal legislation via the Legistar API.

        Args:
            city:  Legistar client slug (e.g. "Philadelphia", "nyc", "Seattle")
            limit: Number of matters to fetch

        Returns:
            Dict with ingested/updated counts and metadata.
        """
        settings = get_settings()
        client = LegistarClient(api_key=settings.legistar_api_key)
        raw_matters = await client.get_matters(city, limit)
        ingested = 0
        updated = 0

        for raw in raw_matters:
            try:
                parsed = LegistarClient.parse_matter_data(raw, city)

                existing = self.db.query(Legislation).filter(
                    Legislation.id == parsed["id"]
                ).first()

                if existing:
                    for key, value in parsed.items():
                        setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    updated += 1
                else:
                    self.db.add(Legislation(**parsed))
                    ingested += 1

            except Exception as e:
                logger.error(f"Error ingesting Legistar matter: {e}")
                continue

        self.db.commit()
        logger.info(f"Legistar [{city}]: ingested {ingested} new, updated {updated}")
        return {"ingested": ingested, "updated": updated, "source": "legistar", "city": city}

    def search_legislation(self, query: str, limit: int = 20, offset: int = 0, level: str = ""):
        """
        Search for legislation by title or bill number.

        Args:
            query: Search query
            limit: Maximum number of results
            offset: Number of results to skip
            level: Filter by level (federal, state, local)

        Returns:
            Tuple of (results list, total count)
        """
        base_query = self.db.query(Legislation)
        if query:
            base_query = base_query.filter(
                (Legislation.title.ilike(f"%{query}%")) |
                (Legislation.bill_number.ilike(f"%{query}%"))
            )
        if level:
            base_query = base_query.filter(Legislation.level == level)
        total = base_query.count()
        results = base_query.offset(offset).limit(limit).all()
        return results, total
