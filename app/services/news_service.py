"""News service — fetches related news articles for a bill via Google News RSS.

No API key required. Uses the public Google News RSS search endpoint.
Results are stored as JSON in the legislation.news_links column.
"""

import json
import logging
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Optional

from app.models import Legislation

logger = logging.getLogger(__name__)

_RSS_URL = "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
_TIMEOUT = 10
_MAX_RESULTS = 5


_STOP_WORDS = {
    "a", "an", "the", "and", "or", "of", "to", "in", "for", "on", "at",
    "by", "with", "from", "into", "onto", "up", "as", "be", "is", "are",
    "was", "were", "it", "its", "this", "that", "city", "street", "avenue",
    "philadelphia", "philly", "bill", "ordinance", "resolution", "allowing",
    "amending", "providing", "establishing", "relating", "authorizing",
    "approving", "certain", "some", "few", "several", "any",
}

def _keywords_from_title(title: str, max_words: int = 4) -> list[str]:
    """Extract the most meaningful words from a title."""
    words = re.findall(r"[A-Za-z]{4,}", title)
    return [w for w in words if w.lower() not in _STOP_WORDS][:max_words]


def _build_query(bill: Legislation) -> str:
    """Build a Google News search query from bill data.

    Strategy: tags + meaningful title keywords + Philadelphia City Council.
    Avoids exact-phrase quoting which is too restrictive for news search.
    """
    tag_terms: list[str] = []
    if bill.tags:
        try:
            tag_terms = json.loads(bill.tags)[:2]
        except Exception:
            pass

    # Use plain_title keywords if available, else fall back to legal title
    source_title = bill.plain_title or bill.title or ""
    kw = _keywords_from_title(source_title)

    parts = ["Philadelphia", "City Council"]
    parts.extend(tag_terms)
    parts.extend(kw)
    return " ".join(parts)


def _parse_rss(xml_bytes: bytes, max_results: int) -> list[dict]:
    """Parse Google News RSS XML and return a list of article dicts."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        logger.warning(f"RSS parse error: {e}")
        return []

    channel = root.find("channel")
    if channel is None:
        return []

    articles = []
    for item in channel.findall("item")[:max_results]:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()

        source_el = item.find("source")
        source = source_el.text.strip() if source_el is not None and source_el.text else ""

        if title and link:
            articles.append({
                "title": title,
                "url": link,
                "source": source,
                "published": pub_date,
            })

    return articles


def fetch_bill_news(bill: Legislation, max_results: int = _MAX_RESULTS) -> list[dict]:
    """
    Fetch news articles related to a bill from Google News RSS.

    Returns a list of article dicts: {title, url, source, published}.
    Returns [] on any error (network, parse, etc.).
    """
    query = _build_query(bill)
    url = _RSS_URL.format(query=urllib.parse.quote(query))
    logger.info(f"Fetching news for bill {bill.bill_number}: {query!r}")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            xml_bytes = resp.read()
    except Exception as e:
        logger.warning(f"News fetch failed for bill {bill.id}: {e}")
        return []

    articles = _parse_rss(xml_bytes, max_results)
    logger.info(f"Found {len(articles)} news articles for bill {bill.bill_number}")
    return articles


def fetch_and_store_news(bill: Legislation, db) -> list[dict]:
    """Fetch news and persist to bill.news_links. Commits to DB."""
    articles = fetch_bill_news(bill)
    bill.news_links = json.dumps(articles)
    db.commit()
    db.refresh(bill)
    return articles
