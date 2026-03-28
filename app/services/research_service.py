"""Research service for debate agents.

Provider hierarchy (in priority order):
  1. DuckDuckGo  — free, no API key, general web search
  2. Wikipedia   — free, no API key, factual background

Future paid hooks (configured via env vars):
  - PERPLEXITY_API_KEY  → PerplexityProvider
  - TAVILY_API_KEY      → TavilyProvider

Usage:
    service = ResearchService.from_env()
    results = await service.search("minimum wage effects on small business", num_results=5)
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class ResearchResult:
    title: str
    url: str
    snippet: str
    source_type: str          # "web", "wikipedia", "perplexity", "tavily"
    provider: str             # human-readable provider name
    score: float = 0.0        # relevance score when available


# ── Provider abstraction ───────────────────────────────────────────────────────

class BaseResearchProvider(ABC):
    @abstractmethod
    async def search(self, query: str, num_results: int = 5) -> list[ResearchResult]:
        """Search and return structured results."""
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        ...


# ── DuckDuckGo (free, no key) ─────────────────────────────────────────────────

class DuckDuckGoProvider(BaseResearchProvider):
    """Uses the duckduckgo-search Python package.  No API key required."""

    @property
    def name(self) -> str:
        return "DuckDuckGo"

    async def search(self, query: str, num_results: int = 5) -> list[ResearchResult]:
        try:
            from duckduckgo_search import DDGS

            results: list[ResearchResult] = []
            # DDGS is synchronous; run in thread pool to avoid blocking
            import asyncio
            loop = asyncio.get_event_loop()

            def _sync_search():
                with DDGS() as ddgs:
                    return list(ddgs.text(query, max_results=num_results))

            raw = await loop.run_in_executor(None, _sync_search)

            for item in raw:
                results.append(ResearchResult(
                    title=item.get("title", ""),
                    url=item.get("href", ""),
                    snippet=item.get("body", ""),
                    source_type="web",
                    provider=self.name,
                ))
            return results

        except ImportError:
            logger.warning("duckduckgo-search not installed. Run: pip install duckduckgo-search")
            return []
        except Exception as e:
            logger.warning(f"DuckDuckGo search failed for '{query}': {e}")
            return []


# ── Wikipedia (free, no key) ──────────────────────────────────────────────────

class WikipediaProvider(BaseResearchProvider):
    """Searches Wikipedia via its public REST API.  No API key required."""

    SEARCH_URL = "https://en.wikipedia.org/w/api.php"
    SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"

    @property
    def name(self) -> str:
        return "Wikipedia"

    async def search(self, query: str, num_results: int = 3) -> list[ResearchResult]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Step 1: search for page titles
                search_resp = await client.get(self.SEARCH_URL, params={
                    "action": "query",
                    "list": "search",
                    "srsearch": query,
                    "srlimit": num_results,
                    "format": "json",
                    "utf8": 1,
                })
                search_resp.raise_for_status()
                pages = search_resp.json().get("query", {}).get("search", [])

                results: list[ResearchResult] = []
                for page in pages[:num_results]:
                    title = page.get("title", "")
                    snippet = page.get("snippet", "").replace('<span class="searchmatch">', "").replace("</span>", "")
                    url = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
                    results.append(ResearchResult(
                        title=title,
                        url=url,
                        snippet=snippet,
                        source_type="wikipedia",
                        provider=self.name,
                        score=1.0,
                    ))
                return results

        except Exception as e:
            logger.warning(f"Wikipedia search failed for '{query}': {e}")
            return []


# ── Perplexity (paid — future hook) ───────────────────────────────────────────

class PerplexityProvider(BaseResearchProvider):
    """Perplexity AI research provider.

    Requires PERPLEXITY_API_KEY.  Not active until the key is set.
    Model: sonar-small-online (cheapest tier with live web access).
    """

    API_URL = "https://api.perplexity.ai/chat/completions"
    MODEL = "sonar-small-online"

    def __init__(self, api_key: str):
        self.api_key = api_key

    @property
    def name(self) -> str:
        return "Perplexity"

    async def search(self, query: str, num_results: int = 5) -> list[ResearchResult]:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    self.API_URL,
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json={
                        "model": self.MODEL,
                        "messages": [{"role": "user", "content": query}],
                        "return_citations": True,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                citations = data.get("citations", [])

                results = [ResearchResult(
                    title=f"Perplexity: {query[:60]}",
                    url=citations[0] if citations else "",
                    snippet=content[:500],
                    source_type="web",
                    provider=self.name,
                    score=1.0,
                )]
                # Also surface individual citation URLs as results
                for url in citations[1:num_results]:
                    results.append(ResearchResult(
                        title=url,
                        url=url,
                        snippet="",
                        source_type="web",
                        provider=self.name,
                    ))
                return results
        except Exception as e:
            logger.warning(f"Perplexity search failed: {e}")
            return []


# ── Tavily (paid — future hook) ────────────────────────────────────────────────

class TavilyProvider(BaseResearchProvider):
    """Tavily AI research provider.

    Requires TAVILY_API_KEY.  Not active until the key is set.
    Purpose-built for AI agent research workflows.
    """

    API_URL = "https://api.tavily.com/search"

    def __init__(self, api_key: str):
        self.api_key = api_key

    @property
    def name(self) -> str:
        return "Tavily"

    async def search(self, query: str, num_results: int = 5) -> list[ResearchResult]:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    self.API_URL,
                    json={
                        "api_key": self.api_key,
                        "query": query,
                        "max_results": num_results,
                        "include_answer": False,
                        "search_depth": "basic",
                    },
                )
                resp.raise_for_status()
                data = resp.json()

                return [
                    ResearchResult(
                        title=r.get("title", ""),
                        url=r.get("url", ""),
                        snippet=r.get("content", ""),
                        source_type="web",
                        provider=self.name,
                        score=r.get("score", 0.0),
                    )
                    for r in data.get("results", [])
                ]
        except Exception as e:
            logger.warning(f"Tavily search failed: {e}")
            return []


# ── ResearchService ────────────────────────────────────────────────────────────

class ResearchService:
    """Orchestrates one or more providers.

    Results from all active providers are merged and deduplicated by URL.
    """

    def __init__(self, providers: list[BaseResearchProvider]):
        self.providers = providers

    @classmethod
    def from_env(cls) -> "ResearchService":
        """Build a ResearchService from environment variables.

        Active by default (no key needed):
          - DuckDuckGoProvider
          - WikipediaProvider

        Activated when keys are present:
          - PerplexityProvider  (PERPLEXITY_API_KEY)
          - TavilyProvider      (TAVILY_API_KEY)
        """
        import os
        providers: list[BaseResearchProvider] = [
            DuckDuckGoProvider(),
            WikipediaProvider(),
        ]
        if key := os.getenv("PERPLEXITY_API_KEY"):
            providers.insert(0, PerplexityProvider(key))  # highest priority
            logger.info("Perplexity research provider active")
        if key := os.getenv("TAVILY_API_KEY"):
            providers.insert(0, TavilyProvider(key))
            logger.info("Tavily research provider active")

        return cls(providers)

    async def search(self, query: str, num_results: int = 5) -> list[ResearchResult]:
        """Run the query across all providers, dedup by URL, return top results."""
        all_results: list[ResearchResult] = []
        seen_urls: set[str] = set()

        for provider in self.providers:
            try:
                results = await provider.search(query, num_results=num_results)
                for r in results:
                    if r.url and r.url not in seen_urls:
                        seen_urls.add(r.url)
                        all_results.append(r)
            except Exception as e:
                logger.warning(f"Provider {provider.name} failed: {e}")

        # Prioritise scored results, then take top N
        all_results.sort(key=lambda r: r.score, reverse=True)
        return all_results[:num_results]

    async def research_for_agent(
        self,
        agent_name: str,
        agent_persona: str,
        legislation_title: str,
        legislation_description: str,
        topic: str,
        num_results: int = 5,
    ) -> list[ResearchResult]:
        """Search for information to support a specific agent's perspective."""
        query = (
            f"{topic} {legislation_title} "
            f"evidence arguments {agent_persona}"
        )
        return await self.search(query, num_results=num_results)

    async def research_for_moderator(
        self,
        legislation_title: str,
        legislation_description: str,
        full_text: Optional[str] = None,
    ) -> list[ResearchResult]:
        """Gather factual background for the moderator's bill introduction."""
        query = f"{legislation_title} bill summary analysis facts"
        return await self.search(query, num_results=8)

    @staticmethod
    def format_for_prompt(results: list[ResearchResult]) -> str:
        """Format research results as a compact string for insertion into AI prompts."""
        if not results:
            return "No external research available."
        lines = ["Research sources:"]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. {r.title}")
            if r.snippet:
                lines.append(f"   {r.snippet[:200]}")
            if r.url:
                lines.append(f"   Source: {r.url}")
        return "\n".join(lines)

    @staticmethod
    def to_citations(results: list[ResearchResult]) -> list[dict]:
        """Serialise results to the citation JSON schema used by DebateMessage."""
        return [
            {
                "title": r.title,
                "url": r.url,
                "snippet": r.snippet[:300] if r.snippet else "",
                "source_type": r.source_type,
                "provider": r.provider,
            }
            for r in results
            if r.url
        ]
