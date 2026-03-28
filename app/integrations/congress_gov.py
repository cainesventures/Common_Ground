"""Congress.gov API integration for federal legislation."""

import httpx
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)

BASE_URL = "https://api.congress.gov/v3"


class CongressGovIntegration:
    """Integration with Congress.gov API for federal bills."""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.congress_api_key
        self.base_url = BASE_URL
        
    async def get_bills(self, congress: int = 118, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Fetch recent bills from Congress.gov.
        
        Args:
            congress: Congress session number (118 = 2023-2024)
            limit: Number of bills to fetch
            
        Returns:
            List of bill data dictionaries
        """
        try:
            async with httpx.AsyncClient() as client:
                url = f"{self.base_url}/bill/{congress}"
                params = {
                    "api_key": self.api_key,
                    "limit": limit,
                    "sort": "updateDate desc"
                }
                
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
                
                return data.get("bills", [])
        except (httpx.HTTPError, httpx.TimeoutException, httpx.ConnectError) as e:
            logger.error(f"Error fetching bills from Congress.gov: {e}")
            return []
    
    async def get_bill(self, congress: int, bill_type: str, bill_number: int) -> Optional[Dict[str, Any]]:
        """
        Fetch detailed information about a specific bill.
        
        Args:
            congress: Congress session number
            bill_type: Type of bill (hr, s, hjres, sjres, etc.)
            bill_number: Bill number
            
        Returns:
            Detailed bill information or None
        """
        try:
            async with httpx.AsyncClient() as client:
                url = f"{self.base_url}/bill/{congress}/{bill_type}/{bill_number}"
                params = {"api_key": self.api_key}
                
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
                
                return data.get("bill")
        except (httpx.HTTPError, httpx.TimeoutException, httpx.ConnectError) as e:
            logger.error(f"Error fetching bill {bill_type}{bill_number}: {e}")
            return None
    
    async def get_bill_summaries(self, congress: int, bill_type: str, bill_number: int) -> Optional[str]:
        """
        Fetch CRS (Congressional Research Service) summaries for a bill.
        Returns the most recent summary text, or None if unavailable.
        """
        try:
            async with httpx.AsyncClient() as client:
                url = f"{self.base_url}/bill/{congress}/{bill_type.lower()}/{bill_number}/summaries"
                params = {"api_key": self.api_key}
                response = await client.get(url, params=params, timeout=10)
                response.raise_for_status()
                summaries = response.json().get("summaries", [])
                if not summaries:
                    return None
                # Most recent summary is last in the list
                return summaries[-1].get("text")
        except Exception as e:
            logger.warning(f"Could not fetch summaries for {bill_type}{bill_number}: {e}")
            return None

    async def search_bills(self, query: str, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Search for bills by title or text.
        
        Args:
            query: Search query
            limit: Number of results to return
            
        Returns:
            List of matching bills
        """
        try:
            async with httpx.AsyncClient() as client:
                url = f"{self.base_url}/bill/search"
                params = {
                    "api_key": self.api_key,
                    "q": query,
                    "limit": limit
                }
                
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
                
                return data.get("bills", [])
        except (httpx.HTTPError, httpx.TimeoutException, httpx.ConnectError) as e:
            logger.error(f"Error searching bills: {e}")
            return []
    
    @staticmethod
    def parse_bill_data(bill: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse raw Congress.gov bill data into our format.
        
        Args:
            bill: Raw bill data from Congress.gov
            
        Returns:
            Parsed bill data
        """
        return {
            "id": f"congress_gov_{bill.get('congress')}_{bill.get('type')}_{bill.get('number')}",
            "source": "congress_gov",
            "level": "federal",
            "bill_number": f"{bill.get('type', '').upper()}{bill.get('number')}",
            "title": bill.get("title", ""),
            "description": bill.get("summaries", [{}])[0].get("text") if bill.get("summaries") else None,
            "sponsor": bill.get("sponsors", [{}])[0].get("fullName") if bill.get("sponsors") else None,
            "status": bill.get("latestAction", {}).get("actionDate", ""),
            "introduced_date": bill.get("introducedDate"),
            "external_url": bill.get("url", ""),
        }
