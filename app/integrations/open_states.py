"""OpenStates API integration for state legislation."""

import httpx
import logging
import re
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

BASE_URL = "https://v3.openstates.org"


class OpenStatesIntegration:
    """Integration with OpenStates API v3 for state bills."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key

    def _headers(self) -> Dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["X-API-KEY"] = self.api_key
        return headers

    async def get_bills_by_state(self, state: str, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Fetch recent bills from a specific state.

        Args:
            state: State abbreviation (e.g., 'ca', 'ny') — lowercased automatically
            limit: Number of bills to fetch

        Returns:
            List of bill data dictionaries (with abstracts/sponsors/sources included)
        """
        jurisdiction = state.lower()
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(
                    f"{BASE_URL}/bills",
                    headers=self._headers(),
                    params={
                        "jurisdiction": jurisdiction,
                        "limit": limit,
                        "sort": "updated_desc",
                        "include": "abstracts,sponsors,sources",
                    },
                )
                response.raise_for_status()
                return response.json().get("results", [])
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenStates HTTP {e.response.status_code} fetching {state} bills: {e.response.text[:200]}")
            return []
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.error(f"OpenStates connection error fetching {state} bills: {e}")
            return []

    async def get_bill(self, bill_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetch detailed information about a specific bill by its OCD ID.

        Args:
            bill_id: OpenStates OCD ID (ocd-bill/...)

        Returns:
            Detailed bill information or None
        """
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(
                    f"{BASE_URL}/bills/{bill_id}",
                    headers=self._headers(),
                    params={"include": "abstracts,sponsors,sources,votes,actions"},
                )
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenStates HTTP {e.response.status_code} fetching bill {bill_id}: {e.response.text[:200]}")
            return None
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.error(f"OpenStates connection error fetching bill {bill_id}: {e}")
            return None

    @staticmethod
    def _stable_id(bill: Dict[str, Any]) -> str:
        """
        Build a stable, human-readable ID from bill data.

        Format: openstates_{state}_{identifier_slug}
        Example: openstates_pa_hb1234
        """
        jurisdiction = bill.get("jurisdiction", {})
        # jurisdiction may be a dict with "name" or a plain string
        if isinstance(jurisdiction, dict):
            state = jurisdiction.get("id", "")
            # OCD jurisdiction ID format: ocd-jurisdiction/country:us/state:pa/government
            match = re.search(r"state:([a-z]{2})", state)
            state_code = match.group(1) if match else jurisdiction.get("name", "unknown").lower()[:2]
        else:
            state_code = str(jurisdiction).lower()[:2]

        identifier = bill.get("identifier", "unknown")
        # Normalize: "HB 1234" → "hb1234"
        slug = re.sub(r"\s+", "", identifier).lower()
        return f"openstates_{state_code}_{slug}"

    @staticmethod
    def parse_bill_data(bill: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse raw OpenStates bill data into our Legislation model format.

        Args:
            bill: Raw bill data from OpenStates (with abstracts/sponsors/sources)

        Returns:
            Dict ready to pass to Legislation(**parsed)
        """
        # Best available description: first abstract text
        abstracts = bill.get("abstracts") or []
        description = abstracts[0].get("abstract", "").strip() if abstracts else None

        # Full text: join all abstracts if multiple
        full_text = "\n\n".join(a.get("abstract", "") for a in abstracts if a.get("abstract")) or None

        # Primary sponsor
        sponsors = bill.get("sponsors") or []
        primary = next((s for s in sponsors if s.get("primary")), sponsors[0] if sponsors else None)
        sponsor_name = primary.get("name") if primary else None

        # External URL: first source
        sources = bill.get("sources") or []
        external_url = sources[0].get("url") if sources else None

        return {
            "id": OpenStatesIntegration._stable_id(bill),
            "source": "open_states",
            "level": "state",
            "bill_number": bill.get("identifier", ""),
            "title": bill.get("title", ""),
            "description": description,
            "full_text": full_text,
            "sponsor": sponsor_name,
            "status": bill.get("latest_action_description") or bill.get("latest_action", {}).get("description", ""),
            "introduced_date": bill.get("first_action_date") or bill.get("introduced_date"),
            "external_url": external_url,
        }
