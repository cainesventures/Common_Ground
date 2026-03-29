"""Moderator AI agent.

The moderator is a structural role — not a debator. It:
  1. Opens every debate with a plain-English bill introduction
  2. After each debator turn, checks for unsupported factual claims
  3. Closes the debate with a neutral summary

The moderator uses a dedicated system prompt focused on neutrality and
factual accuracy. It never takes a pro/con position.

A single shared "Moderator" Agent row is created in the DB on first use
(see `get_or_create_moderator`). This avoids FK issues on DebateMessage.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MODERATOR_AGENT_ID = "agent_moderator_sys"

MODERATOR_SYSTEM_PROMPT = """You are an impartial debate moderator with deep expertise in legislative analysis.

Your responsibilities:
- Present facts clearly and in plain English that anyone can understand
- Never take a political position or show bias toward any side
- Identify unsupported or misleading claims respectfully but directly
- Summarise accurately without editorialising
- Use simple, accessible language — avoid jargon

You are not a debator. You are the voice of clarity and fairness."""


def get_or_create_moderator(db: Session):
    """Return the shared Moderator Agent DB row, creating it if absent."""
    from app.models import Agent

    agent = db.query(Agent).filter(Agent.id == MODERATOR_AGENT_ID).first()
    if not agent:
        agent = Agent(
            id=MODERATOR_AGENT_ID,
            name="Moderator",
            description="Impartial AI moderator — introduces bills, fact-checks arguments, summarises debates.",
            persona="Impartial fact-based moderator",
            system_prompt=MODERATOR_SYSTEM_PROMPT,
            agent_type="claude",
            is_active=True,
        )
        db.add(agent)
        db.commit()
        logger.info("Created system moderator agent")
    return agent


class ModeratorAgent:
    """Wraps an AI provider (Claude or Gemini) to perform moderator-specific tasks."""

    def __init__(self):
        from app.config import get_settings
        settings = get_settings()
        self._backend = None
        self._num_gpu = settings.ollama_num_gpu_layers

        # Prefer Ollama (local, no quota limits), then Claude, then Gemini
        if settings.ollama_url:
            self._backend = "ollama"
            base = settings.ollama_url.rstrip("/")
            if "/v1/" in base:
                base = base.split("/v1/")[0]
            self._ollama_url = f"{base}/v1/chat/completions"
            self._ollama_model = "llama3.1:8b"
            logger.info("Moderator using Ollama backend")

        if self._backend is None and settings.anthropic_api_key:
            try:
                from anthropic import Anthropic
                self._claude = Anthropic(api_key=settings.anthropic_api_key)
                self._claude_model = settings.default_model
                self._backend = "claude"
                logger.info("Moderator using Claude backend")
            except Exception:
                logger.warning("Moderator: Claude client unavailable")

        if self._backend is None and settings.gemini_api_key:
            try:
                from google import genai
                from google.genai import types as genai_types
                self._backend = "gemini"
                self._gemini_client = genai.Client(api_key=settings.gemini_api_key)
                self._gemini_types = genai_types
                self._gemini_model = "gemini-2.5-flash"
                logger.info("Moderator using Gemini backend")
            except ImportError:
                logger.warning("Moderator: google-genai not installed")

    def _call(self, prompt: str, max_tokens: int = 800) -> str:
        if self._backend == "gemini":
            try:
                response = self._gemini_client.models.generate_content(
                    model=self._gemini_model,
                    contents=prompt,
                    config=self._gemini_types.GenerateContentConfig(
                        system_instruction=MODERATOR_SYSTEM_PROMPT,
                        temperature=0.2,
                    ),
                )
                return response.text
            except Exception as e:
                logger.error(f"Moderator Gemini call failed: {e}")
                return f"Moderator error: {e}"

        if self._backend == "claude":
            try:
                response = self._claude.messages.create(
                    model=self._claude_model,
                    max_tokens=max_tokens,
                    system=MODERATOR_SYSTEM_PROMPT,
                    temperature=0.2,
                    messages=[{"role": "user", "content": prompt}],
                )
                return response.content[0].text
            except Exception as e:
                logger.error(f"Moderator Claude call failed: {e}")
                return f"Moderator error: {e}"

        if self._backend == "ollama":
            try:
                import httpx
                messages = [
                    {"role": "system", "content": MODERATOR_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ]
                with httpx.Client(timeout=120) as client:
                    resp = client.post(
                        self._ollama_url,
                        json={"model": self._ollama_model, "messages": messages,
                              "stream": False, "temperature": 0.2,
                              "options": {"num_gpu": self._num_gpu}},
                    )
                    resp.raise_for_status()
                    return resp.json()["choices"][0]["message"]["content"]
            except Exception as e:
                logger.error(f"Moderator Ollama call failed: {e}")
                return f"Moderator error: {e}"

        return "Moderator unavailable — no AI backend configured."

    async def introduce_bill(
        self,
        legislation_title: str,
        legislation_description: Optional[str],
        full_text: Optional[str],
        research_sources: list[dict],
        topic: str,
    ) -> dict:
        """Generate a plain-English bill introduction to open the debate."""
        sources_block = ""
        if research_sources:
            sources_block = "\n\nBackground research:\n"
            for i, s in enumerate(research_sources[:5], 1):
                sources_block += f"{i}. {s.get('title', '')}: {s.get('snippet', '')[:200]}\n"

        bill_block = f"Bill: {legislation_title}\n"
        if legislation_description:
            bill_block += f"Description: {legislation_description}\n"
        if full_text:
            bill_block += f"\nFull text excerpt:\n{full_text[:1500]}\n"

        prompt = f"""You are opening a debate on the following legislation.

{bill_block}{sources_block}

Debate topic: {topic}

Write a concise, neutral introduction (150–200 words) that:
1. Explains what this bill actually does in plain English
2. States the key facts — who it affects, what it changes, what it costs (if known)
3. Notes any significant context (why it was introduced, current status)
4. Does NOT express any opinion for or against

Your introduction should be accessible to someone with no prior knowledge of this bill."""

        text = self._call(prompt, max_tokens=600)
        citations = [
            {"title": s.get("title", ""), "url": s.get("url", ""),
             "snippet": s.get("snippet", "")[:300], "source_type": s.get("source_type", "web")}
            for s in research_sources if s.get("url")
        ]
        return {"argument": text, "citations": citations, "position": "moderator"}

    async def generate_debate_title(
        self,
        bill_number: str,
        bill_title: str,
        bill_description: str,
    ) -> str:
        """Generate a punchy, click-worthy debate headline (no bill number in the title)."""
        prompt = (
            f"Write a single engaging, attention-grabbing debate headline for this legislation.\n\n"
            f"Bill: {bill_number} — {bill_title}\n"
            f"Description: {bill_description[:400]}\n\n"
            f"Requirements:\n"
            f"- 8–12 words, question form preferred (e.g. 'Is America's Border Broken Beyond Repair?')\n"
            f"- Opinionated-sounding but not partisan\n"
            f"- Do NOT include the bill number or formal bill name\n"
            f"- Return ONLY the headline text, no quotes, no explanation"
        )
        result = self._call(prompt, max_tokens=60)
        return result.strip().strip('"').strip("'") or f"Debate: {bill_number or bill_title[:60]}"

    async def generate_complexity_variants(self, expert_text: str, is_moderator: bool = False) -> dict:
        """Produce a plain-language variant of an argument or moderator statement."""
        if is_moderator:
            simple_prompt = (
                "Rewrite the following moderator statement in plain, accessible language — "
                "clear and neutral, like someone explaining the facts simply to a general audience. "
                "80–100 words. One paragraph. Stay strictly neutral, no opinions. "
                "Do NOT wrap in quotation marks. "
                "Do NOT open with meta phrases like 'Here is a summary' — just start writing.\n\n"
                f"Statement:\n{expert_text}"
            )
        else:
            simple_prompt = (
                "Rewrite the following policy argument as if the speaker is explaining it to a friend over coffee — "
                "conversational, direct, and human. 80–100 words. No jargon, no bullet points, one paragraph. "
                "Keep their stance and their single strongest point. Use 'I' where natural. "
                "Sound like a real person, not a policy brief. "
                "Do NOT wrap the response in quotation marks. "
                "Do NOT open with meta phrases like 'Here is a summary' — just start talking.\n\n"
                f"Argument:\n{expert_text}"
            )
        simple = self._call(simple_prompt, max_tokens=300)
        return {"simple": simple, "expert": expert_text}

    async def fact_check(
        self,
        argument: str,
        agent_name: str,
        research_sources: list[dict],
        previous_moderator_checks: list[str],
    ) -> Optional[dict]:
        """Review an argument for unsupported factual claims.

        Returns None if no significant issues are found (no message inserted).
        """
        sources_block = ""
        if research_sources:
            sources_block = "\nKnown facts from research:\n"
            for i, s in enumerate(research_sources[:6], 1):
                sources_block += f"{i}. {s.get('title', '')}: {s.get('snippet', '')[:200]}\n"

        prior_block = ""
        if previous_moderator_checks:
            prior_block = f"\nPrevious moderator notes (avoid repeating):\n" + "\n".join(previous_moderator_checks[-2:])

        prompt = f"""{agent_name} just made this argument:

\"\"\"{argument}\"\"\"
{sources_block}{prior_block}

As the moderator, review this argument for factual accuracy.

Rules:
- Only interject if there is a specific, clearly unsupported or misleading factual claim
- If the argument is broadly reasonable, respond with exactly: NO_INTERJECT
- If you do interject, be brief (2–4 sentences), factual, and neutral
- Do not repeat corrections already made above
- Never comment on the quality of the argument or take sides

Respond with either NO_INTERJECT or your brief factual correction."""

        text = self._call(prompt, max_tokens=300)

        if "NO_INTERJECT" in text.upper() or not text.strip():
            return None

        return {"argument": text, "citations": [], "position": "moderator"}

    async def close_debate(
        self,
        legislation_title: str,
        all_arguments: list[dict],
        research_sources: list[dict],
    ) -> dict:
        """Generate a neutral closing summary of the debate."""
        args_block = "\n\n".join(
            f"{a.get('agent_name', 'Agent')} ({a.get('position', '')}): {a.get('argument', '')[:600]}"
            for a in all_arguments
            if a.get("position") != "moderator"
        )

        prompt = f"""The debate on "{legislation_title}" has concluded.

Arguments made:
{args_block}

Write a concise, neutral closing summary (150–200 words) that:
1. Identifies the strongest points made on each side — only summarize what was actually argued above, do not invent or add points not present
2. Notes any factual claims that remained contested
3. States what questions remain unresolved
4. Does NOT declare a winner or express an opinion

Your summary should help readers understand what was debated and what they should research further."""

        text = self._call(prompt, max_tokens=600)
        citations = [
            {"title": s.get("title", ""), "url": s.get("url", ""),
             "snippet": s.get("snippet", "")[:300], "source_type": s.get("source_type", "web")}
            for s in research_sources if s.get("url")
        ]
        return {"argument": text, "citations": citations, "position": "moderator"}
