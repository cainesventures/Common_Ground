"""Legistar/Granicus API integration for local/municipal legislation.

Legistar is used by ~70% of large US cities (Philadelphia, NYC, Chicago, etc.).
Each city has a unique client slug, e.g.:
  - Philadelphia → "Philadelphia"
  - New York City → "nyc"
  - Seattle       → "Seattle"

API explorer: https://webapi.legistar.com/Help
"""

import httpx
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

BASE_URL = "https://webapi.legistar.com/v1"

# Map Legistar status names to our internal status enum values.
STATUS_MAP: Dict[str, str] = {
    "new": "introduced",
    "referred": "in_committee",
    "in committee": "in_committee",
    "adopted": "signed_into_law",
    "approved": "signed_into_law",
    "passed": "signed_into_law",
    "enacted": "signed_into_law",
    "failed": "failed",
    "defeated": "failed",
    "vetoed": "vetoed",
    "tabled": "failed",
    "withdrawn": "failed",
}


class LegistarClient:
    """Client for the Legistar Web API."""

    def __init__(self, api_key: str = ""):
        self.api_key = api_key
        self.base_url = BASE_URL

    def _headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def get_matters(
        self,
        client: str,
        limit: int = 20,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Fetch matters (bills/resolutions/ordinances) for a city.

        Args:
            client: Legistar city slug (e.g. "Philadelphia", "nyc")
            limit:  Max number of items to return
            offset: Number of items to skip (for pagination)

        Returns:
            List of raw matter dicts from Legistar.
        """
        url = f"{self.base_url}/{client}/matters"
        params: Dict[str, Any] = {
            "$top": limit,
            "$skip": offset,
            "$orderby": "MatterLastModifiedUtc desc",
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as http:
                response = await http.get(url, params=params, headers=self._headers())
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPStatusError, httpx.TimeoutException, httpx.ConnectError) as e:
            logger.error(f"Legistar API error for client '{client}': {e}")
            return []

    async def get_matter(self, client: str, matter_id: int) -> Optional[Dict[str, Any]]:
        """Fetch a single matter by ID."""
        url = f"{self.base_url}/{client}/matters/{matter_id}"
        try:
            async with httpx.AsyncClient(timeout=30.0) as http:
                response = await http.get(url, headers=self._headers())
                response.raise_for_status()
                return response.json()
        except (httpx.HTTPStatusError, httpx.TimeoutException, httpx.ConnectError) as e:
            logger.error(f"Legistar API error fetching matter {matter_id} for '{client}': {e}")
            return None

    @staticmethod
    def parse_matter_data(raw: Dict[str, Any], client: str) -> Dict[str, Any]:
        """
        Map a raw Legistar matter dict to our Legislation model fields.

        Args:
            raw:    Raw matter JSON from Legistar API
            client: City slug used as part of the generated ID

        Returns:
            Dict suitable for constructing a Legislation ORM object.
        """
        matter_id = raw.get("MatterId", "")

        # Map status
        raw_status = (raw.get("MatterStatusName") or "").lower()
        status = "introduced"
        for key, val in STATUS_MAP.items():
            if key in raw_status:
                status = val
                break

        # Parse introduced date
        intro_raw = raw.get("MatterIntroDate")
        introduced_date: Optional[datetime] = None
        if intro_raw:
            try:
                # Legistar returns ISO 8601 strings like "2023-01-15T00:00:00"
                introduced_date = datetime.fromisoformat(intro_raw.rstrip("Z"))
            except ValueError:
                pass

        return {
            "id": f"legistar_{client.lower()}_{matter_id}",
            "source": "legistar",
            "level": "local",
            "bill_number": raw.get("MatterFile") or f"#{matter_id}",
            "title": raw.get("MatterTitle") or "(no title)",
            "description": raw.get("MatterBodyName"),
            "full_text": raw.get("MatterText"),
            "sponsor": raw.get("MatterSponsorNames"),
            "status": status,
            "introduced_date": introduced_date,
            "external_url": f"{BASE_URL}/{client}/matters/{matter_id}",
        }
