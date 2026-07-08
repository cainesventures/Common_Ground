"""Scrape Philadelphia City Council election candidates from Ballotpedia."""

import logging
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

BALLOTPEDIA_SEARCH = "https://ballotpedia.org/Philadelphia_City_Council_elections,_{year}"
BALLOTPEDIA_COUNCIL = "https://ballotpedia.org/Philadelphia_City_Council"
HEADERS = {
    "User-Agent": "CommonGround/1.0 civic-research-tool (+https://opencommonground.com)",
    "Accept": "text/html,application/xhtml+xml",
}


def _fetch(url: str) -> Optional[BeautifulSoup]:
    try:
        resp = httpx.get(url, headers=HEADERS, timeout=20, follow_redirects=True)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "lxml")
    except Exception as e:
        logger.warning(f"Fetch failed {url}: {e}")
        return None


def _scrape_candidate_page(url: str) -> Dict[str, Any]:
    """Scrape an individual Ballotpedia candidate page for bio and positions."""
    details: Dict[str, Any] = {}
    soup = _fetch(url)
    if not soup:
        return details

    # Biography section
    bio_section = soup.find("span", {"id": "Biography"}) or soup.find("span", {"id": "Background"})
    if bio_section:
        paras = []
        el = bio_section.find_parent("h2") or bio_section.find_parent("h3")
        if el:
            for sib in el.find_next_siblings():
                if sib.name in ("h2", "h3"):
                    break
                if sib.name == "p":
                    text = sib.get_text(strip=True)
                    if text:
                        paras.append(text)
        if paras:
            details["bio"] = " ".join(paras[:3])  # first 3 paragraphs

    # Campaign website link
    for a in soup.find_all("a", href=True):
        text = a.get_text(strip=True).lower()
        href = a["href"]
        if "campaign" in text or "official" in text or "website" in text:
            if href.startswith("http") and "ballotpedia" not in href:
                details["website_url"] = href
                break

    # Try to find a campaign website in the infobox
    infobox = soup.find("table", class_=re.compile(r"infobox|wikitable"))
    if infobox and "website_url" not in details:
        for row in infobox.find_all("tr"):
            cells = row.find_all(["th", "td"])
            if len(cells) >= 2:
                label = cells[0].get_text(strip=True).lower()
                if "website" in label or "campaign" in label:
                    link = cells[1].find("a", href=True)
                    if link and link["href"].startswith("http") and "ballotpedia" not in link["href"]:
                        details["website_url"] = link["href"]
                        break

    # Known positions / campaign issues
    positions = []
    for span_id in ("Campaign_themes", "Key_issues", "Positions", "Platform", "Issues"):
        section = soup.find("span", {"id": span_id})
        if section:
            el = section.find_parent("h2") or section.find_parent("h3")
            if el:
                for sib in el.find_next_siblings():
                    if sib.name in ("h2", "h3"):
                        break
                    if sib.name in ("p", "li"):
                        text = sib.get_text(strip=True)
                        if text:
                            positions.append(text)
            break
    if positions:
        details["known_positions"] = "; ".join(positions[:5])

    return details


def scrape_candidates(election_year: int = 2026) -> List[Dict[str, Any]]:
    """
    Scrape Philadelphia City Council candidates from Ballotpedia.
    Returns a list of candidate dicts ready to upsert into the DB.
    """
    candidates = []

    # Build URL list: requested year → recent past years → generic council page
    # Ballotpedia pages for future elections are often not created yet
    fallback_years = [y for y in [2025, 2023, 2021] if y != election_year]
    urls_to_try = (
        [BALLOTPEDIA_SEARCH.format(year=election_year)]
        + [BALLOTPEDIA_SEARCH.format(year=y) for y in fallback_years]
        + [BALLOTPEDIA_COUNCIL]
    )

    soup = None
    used_url = None
    actual_year = election_year
    for url in urls_to_try:
        candidate_soup = _fetch(url)
        if candidate_soup:
            # Verify the page actually has content (not a 404 shell)
            body_text = candidate_soup.get_text()
            if "does not exist" in body_text or len(body_text.strip()) < 500:
                logger.info(f"Skipping empty/404 page: {url}")
                continue
            soup = candidate_soup
            used_url = url
            # Extract year from URL if it's a year-specific page
            m = re.search(r'_(\d{4})$', url)
            if m:
                actual_year = int(m.group(1))
            logger.info(f"Loaded candidate page from {url} (year={actual_year})")
            break

    if not soup:
        logger.error("Could not fetch any Ballotpedia page for candidates")
        return [], election_year, None

    found: Dict[str, Dict[str, Any]] = {}  # keyed by name to deduplicate

    # Pattern 1: election page tables with candidates
    for table in soup.find_all("table", class_=re.compile(r"wikitable|infobox")):
        rows = table.find_all("tr")
        headers = [th.get_text(strip=True).lower() for th in (rows[0].find_all(["th", "td"]) if rows else [])]
        col_name = next((i for i, h in enumerate(headers) if "candidate" in h or "name" in h), None)
        col_district = next((i for i, h in enumerate(headers) if "district" in h or "seat" in h or "position" in h), None)
        col_party = next((i for i, h in enumerate(headers) if "party" in h), None)

        for row in rows[1:]:
            cells = row.find_all(["td", "th"])
            if not cells:
                continue
            name_cell = cells[col_name] if col_name is not None and col_name < len(cells) else cells[0]
            name = name_cell.get_text(strip=True)
            if not name or len(name) < 3 or name.lower() in ("candidate", "name"):
                continue

            candidate_url = None
            link = name_cell.find("a", href=True)
            if link:
                href = link["href"]
                candidate_url = href if href.startswith("http") else f"https://ballotpedia.org{href}"

            district_raw = ""
            if col_district is not None and col_district < len(cells):
                district_raw = cells[col_district].get_text(strip=True)

            party = ""
            if col_party is not None and col_party < len(cells):
                party = cells[col_party].get_text(strip=True)

            district = _normalize_district(district_raw)
            found[name] = {
                "name": name,
                "district": district or "At-Large",
                "party": party or None,
                "ballotpedia_url": candidate_url,
                "election_year": actual_year,
            }

    # Pattern 2: election page with candidate name links in prose / lists
    if not found:
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if not href.startswith("/") and not href.startswith("https://ballotpedia.org"):
                continue
            name = a.get_text(strip=True)
            if not name or len(name.split()) < 2 or len(name) > 60:
                continue
            # Heuristic: skip navigation/category links
            if any(skip in name.lower() for skip in ("city council", "philadelphia", "ballotpedia", "election", "district", "wikipedia")):
                continue
            # Only links that look like person names (at least first + last)
            full_url = href if href.startswith("http") else f"https://ballotpedia.org{href}"
            if name not in found:
                found[name] = {
                    "name": name,
                    "district": "At-Large",
                    "party": None,
                    "ballotpedia_url": full_url,
                    "election_year": actual_year,
                }

    # Scrape individual pages for additional details
    results = []
    for name, base in found.items():
        details: Dict[str, Any] = {}
        if base.get("ballotpedia_url"):
            logger.info(f"Scraping candidate page: {base['ballotpedia_url']}")
            details = _scrape_candidate_page(base["ballotpedia_url"])

        candidate = {
            "id": f"cand_{uuid.uuid4().hex[:12]}",
            "name": name,
            "district": base.get("district", "At-Large"),
            "party": base.get("party"),
            "bio": details.get("bio"),
            "website_url": details.get("website_url"),
            "known_positions": details.get("known_positions"),
            "office_sought": _office_for_district(base.get("district", "At-Large")),
            "election_year": actual_year,
            "is_incumbent": False,
            "photo_url": None,
        }
        results.append(candidate)

    logger.info(f"Scraped {len(results)} candidates from Ballotpedia (source: {used_url})")
    return results, actual_year, used_url


def _normalize_district(raw: str) -> str:
    if not raw:
        return ""
    raw = raw.strip()
    if "at-large" in raw.lower() or "at large" in raw.lower():
        return "At-Large"
    # Extract number
    m = re.search(r'\d+', raw)
    if m:
        return f"District {m.group(0)}"
    return raw


def _office_for_district(district: str) -> str:
    if district == "At-Large":
        return "Philadelphia City Council At-Large"
    m = re.search(r'\d+', district)
    if m:
        return f"Philadelphia City Council District {m.group(0)}"
    return "Philadelphia City Council"
