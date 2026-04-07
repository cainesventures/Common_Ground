"""Legislation ingestion service."""

import asyncio
import logging
from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Legislation, Councilmember, BillVoteRecord
from app.integrations.congress_gov import CongressGovIntegration
from app.integrations.open_states import OpenStatesIntegration
from app.integrations.legistar import LegistarClient
from app.config import get_settings

logger = logging.getLogger(__name__)

CATEGORY_TAGS = [
    "housing", "zoning", "transportation", "public safety", "budget",
    "education", "environment", "health", "parks", "business",
    "infrastructure", "labor", "technology", "social services",
]


def _ai_plain_title(bill, provider) -> str:
    """Ask the AI for a short, plain-English name for a bill (max ~8 words)."""
    text = bill.title or ""
    if bill.description:
        text += "\n" + bill.description[:400]

    system = (
        "You rename city council bills in plain English for everyday citizens. "
        "Given the official bill title and description, write a SHORT human-friendly name "
        "(5-10 words max, no jargon, no bill numbers). "
        "Respond with ONLY the plain-English name, nothing else."
    )
    try:
        result = provider.complete(system_prompt=system, user_prompt=text)
        # Strip quotes, newlines, leading/trailing whitespace
        return result.strip().strip('"\'').strip()[:120]
    except Exception as e:
        logger.warning(f"Plain title failed for bill {bill.id}: {e}")
    return ""


def _ai_tag_bill(bill, provider) -> list:
    """Call the AI provider to assign 1-3 category tags to a bill."""
    import json, re
    text = (bill.title or "")
    if bill.description:
        text += "\n" + bill.description[:600]

    system = (
        "You categorize city council bills. "
        f"Pick 1-3 tags from this exact list only: {', '.join(CATEGORY_TAGS)}. "
        'Respond with ONLY a JSON array like ["housing"] or ["budget", "infrastructure"]. '
        "No explanation, no other text."
    )
    try:
        response = provider.complete(system_prompt=system, user_prompt=text)
        match = re.search(r"\[.*?\]", response, re.DOTALL)
        if match:
            tags = json.loads(match.group())
            return [t for t in tags if t in CATEGORY_TAGS][:3]
    except Exception as e:
        logger.warning(f"Auto-tag failed for bill {bill.id}: {e}")
    return []


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
    
    async def ingest_local_legislation(self, city: str, limit: int = 20, **kwargs) -> dict:
        """
        Fetch and store local/municipal legislation.

        For Philadelphia, uses the Playwright scraper (Legistar REST API is IP-restricted).
        For other cities, uses the Legistar REST API directly.

        Args:
            city:  Legistar client slug (e.g. "philadelphia", "nyc", "Seattle")
            limit: Number of matters to fetch

        Returns:
            Dict with ingested/updated counts and metadata.
        """
        if city.lower() == "philadelphia":
            bulk = kwargs.get("bulk", False)
            return await self._ingest_philadelphia(limit, bulk=bulk)

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

    async def _ingest_philadelphia(self, limit: int = 20, bulk: bool = False) -> dict:
        """
        Scrape Philadelphia City Council bills from phila.legistar.com.

        Two modes:
        - bulk=True  : Excel export → all ~8,500 bills at once (no detail pages).
                       Bills stored with title/status/date only; sponsors + full text
                       fetched later when a bill is analyzed.
        - bulk=False : Playwright row scrape → up to `limit` bills with full details
                       (sponsors + PDF full text) fetched immediately.
        """
        from app.integrations.legistar_scraper import PhilaLegistarScraper
        import tempfile, os

        scraper = PhilaLegistarScraper(headless=True)
        loop = asyncio.get_event_loop()

        if bulk:
            logger.info("Philadelphia bulk ingest via Excel export ...")
            tmp = tempfile.mktemp(suffix=".xls")
            try:
                await loop.run_in_executor(None, lambda: scraper.export_to_excel(tmp))
                rows = PhilaLegistarScraper.parse_excel_export(tmp)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)

            # Convert Excel rows to Legislation dicts using scraper's own parser
            bills = [scraper._parse_row(row) for row in rows]
        else:
            logger.info(f"Philadelphia scrape (limit={limit}) ...")
            fetch_details = limit <= 20
            bills = await loop.run_in_executor(
                None, lambda: scraper.scrape_bills(
                    limit=limit,
                    fetch_details=fetch_details,
                    allowed_types=["Bill"],
                )
            )

        ingested = 0
        updated = 0

        for parsed in bills:
            try:
                existing = self.db.query(Legislation).filter(
                    Legislation.id == parsed["id"]
                ).first()

                if existing:
                    for key, value in parsed.items():
                        if value is not None:
                            setattr(existing, key, value)
                    existing.updated_at = datetime.utcnow()
                    updated += 1
                else:
                    self.db.add(Legislation(**parsed))
                    ingested += 1

            except Exception as e:
                logger.error(f"Error storing Philadelphia bill: {e}")
                continue

        self.db.commit()
        logger.info(f"Philadelphia: ingested {ingested} new, updated {updated}")
        source = "legistar_bulk_excel" if bulk else "legistar_scraper"
        return {"ingested": ingested, "updated": updated, "source": source, "city": "philadelphia"}

    def search_legislation(
        self,
        query: str,
        limit: int = 20,
        offset: int = 0,
        level: str = "",
        analyzed: Optional[bool] = None,
        tag: str = "",
        impact: str = "",
        year: Optional[int] = None,
        month: Optional[int] = None,
        status: Optional[str] = None,
        sponsor: Optional[str] = None,
        has_votes: Optional[bool] = None,
    ):
        """Search for legislation with optional filters."""
        from sqlalchemy import extract
        base_query = self.db.query(Legislation)
        if query:
            base_query = base_query.filter(
                (Legislation.title.ilike(f"%{query}%")) |
                (Legislation.bill_number.ilike(f"%{query}%"))
            )
        if level:
            base_query = base_query.filter(Legislation.level == level)
        if analyzed is True:
            base_query = base_query.filter(Legislation.analyzed_at.isnot(None))
        elif analyzed is False:
            base_query = base_query.filter(Legislation.analyzed_at.is_(None))
        if tag:
            base_query = base_query.filter(Legislation.tags.ilike(f'%"{tag}"%'))
        if impact:
            base_query = base_query.filter(Legislation.impact_level == impact)
        if year:
            base_query = base_query.filter(
                extract("year", Legislation.introduced_date) == year
            )
        if month:
            base_query = base_query.filter(
                extract("month", Legislation.introduced_date) == month
            )
        if status:
            base_query = base_query.filter(Legislation.status == status)
        if sponsor:
            base_query = base_query.filter(Legislation.sponsor.ilike(f"%{sponsor}%"))
        if has_votes:
            from sqlalchemy import exists
            base_query = base_query.filter(
                exists().where(BillVoteRecord.legislation_id == Legislation.id)
            )
        total = base_query.count()
        results = (
            base_query
            .order_by(Legislation.introduced_date.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return results, total

    def tag_untagged_bills(self) -> dict:
        """Use AI to assign category tags to all bills that have none."""
        import json

        untagged = (
            self.db.query(Legislation)
            .filter(
                (Legislation.tags.is_(None))
                | (Legislation.tags == "")
                | (Legislation.tags == "[]")
            )
            .all()
        )
        if not untagged:
            return {"tagged": 0, "total": 0}

        from app.services.ai_provider import get_ai_provider
        provider = get_ai_provider()
        tagged = 0

        for bill in untagged:
            tags = _ai_tag_bill(bill, provider)
            if tags:
                bill.tags = json.dumps(tags)
                tagged += 1

        self.db.commit()
        logger.info(f"Auto-tagged {tagged}/{len(untagged)} bills")
        return {"tagged": tagged, "total": len(untagged)}

    def generate_plain_titles(self) -> dict:
        """Use AI to generate plain-English names for bills that don't have one yet."""
        untitled = (
            self.db.query(Legislation)
            .filter(
                (Legislation.plain_title.is_(None)) | (Legislation.plain_title == "")
            )
            .all()
        )
        if not untitled:
            return {"generated": 0, "total": 0}

        from app.services.ai_provider import get_ai_provider
        provider = get_ai_provider()
        generated = 0

        for bill in untitled:
            plain = _ai_plain_title(bill, provider)
            if plain:
                bill.plain_title = plain
                generated += 1

        self.db.commit()
        logger.info(f"Generated plain titles for {generated}/{len(untitled)} bills")
        return {"generated": generated, "total": len(untitled)}

    async def sync_bill_statuses(self) -> dict:
        """Re-fetch status from Legistar for bills that are still in-flight (introduced or in_committee).

        Bills that have reached a terminal state (signed_into_law, failed, vetoed) are skipped.
        Only applies to bills ingested from Legistar (id starts with 'legistar_').
        """
        from app.integrations.legistar import LegistarClient, STATUS_MAP

        in_flight = (
            self.db.query(Legislation)
            .filter(
                Legislation.status.in_(["introduced", "in_committee"]),
                Legislation.id.like("legistar_%"),
            )
            .all()
        )

        if not in_flight:
            return {"checked": 0, "updated": 0}

        client = LegistarClient()
        updated = 0

        async with __import__("httpx").AsyncClient(timeout=30.0) as http:
            for bill in in_flight:
                # Extract Legistar matter ID from our internal ID: legistar_philadelphia_12345
                parts = bill.id.split("_")
                if len(parts) < 3:
                    continue
                try:
                    matter_id = int(parts[-1])
                except ValueError:
                    continue

                try:
                    url = f"https://webapi.legistar.com/v1/Philadelphia/matters/{matter_id}"
                    resp = await http.get(url, headers={"Accept": "application/json"})
                    if resp.status_code != 200:
                        continue
                    raw = resp.json()
                    raw_status = (raw.get("MatterStatusName") or "").lower()
                    new_status = "introduced"
                    for key, val in STATUS_MAP.items():
                        if key in raw_status:
                            new_status = val
                            break
                    if new_status != bill.status:
                        logger.info(f"Status change: {bill.bill_number} {bill.status!r} → {new_status!r}")
                        bill.status = new_status
                        updated += 1
                except Exception as e:
                    logger.warning(f"Status sync failed for {bill.id}: {e}")

        if updated:
            self.db.commit()

        logger.info(f"Status sync complete: checked={len(in_flight)}, updated={updated}")
        return {"checked": len(in_flight), "updated": updated}


async def sync_vote_records(legislation_id: str, db: Session) -> dict:
    """Fetch official roll call votes from phila.legistar.com and store as BillVoteRecord rows.

    Uses the bill's stored external_url to scrape the LegislationDetail page with
    Playwright (same approach as other Legistar scraping in this app), then upserts
    individual member votes into the bill_vote_records table.

    Returns a dict with counts: {"fetched": N, "matched": N, "upserted": N}
    """
    from app.integrations.legistar_scraper import PhilaLegistarScraper

    bill = db.query(Legislation).filter(Legislation.id == legislation_id).first()
    if not bill or not bill.external_url:
        return {"fetched": 0, "matched": 0, "upserted": 0}

    scraper = PhilaLegistarScraper(headless=True)
    raw_votes = await asyncio.to_thread(scraper.scrape_vote_history, bill.external_url)

    if not raw_votes:
        return {"fetched": 0, "matched": 0, "upserted": 0}

    # Build last-name → councilmember lookup
    councilmembers = db.query(Councilmember).all()
    name_map: dict = {}
    for cm in councilmembers:
        last = cm.name.split()[-1].lower()
        name_map[last] = cm

    matched = 0
    upserted = 0

    VOTE_NORMALIZE = {
        "ayes": "Yea", "aye": "Yea", "yes": "Yea", "yea": "Yea",
        "noes": "Nay", "nay": "Nay", "no": "Nay",
        "abstain": "Abstain", "abstained": "Abstain",
        "absent": "Absent",
    }

    for v in raw_votes:
        voter_name = v["voter_name"]  # "Councilmember Bass" / "Council President Johnson"
        # Strip title prefix — last word is always the last name
        last_name = voter_name.split()[-1].strip().lower() if voter_name else ""
        cm = name_map.get(last_name)
        # Normalize vote value from Legistar web format to our canonical format
        v["vote"] = VOTE_NORMALIZE.get(v["vote"].lower(), v["vote"])
        if cm:
            matched += 1

        action_date = None
        if v.get("action_date"):
            try:
                action_date = datetime.fromisoformat(v["action_date"].rstrip("Z"))
            except (ValueError, AttributeError):
                pass

        existing = db.query(BillVoteRecord).filter(
            BillVoteRecord.legislation_id == legislation_id,
            BillVoteRecord.voter_name == voter_name,
        ).first()

        if existing:
            existing.vote = v["vote"]
            existing.councilmember_id = cm.id if cm else None
            existing.action_date = action_date
            existing.result = v.get("result")
        else:
            import uuid
            record = BillVoteRecord(
                id=f"bvr_{uuid.uuid4().hex[:12]}",
                legislation_id=legislation_id,
                councilmember_id=cm.id if cm else None,
                voter_name=voter_name,
                vote=v["vote"],
                action_date=action_date,
                result=v.get("result"),
            )
            db.add(record)
        upserted += 1

    db.commit()
    return {"fetched": len(raw_votes), "matched": matched, "upserted": upserted}
