"""Bill research service — AI-powered analysis of a single bill.

Called when the admin clicks "Analyze" on a bill. Generates:
  - summary        : plain-language explanation for regular citizens
  - impact_score   : 1-10 importance rating
  - impact_level   : low / medium / high
  - bill_type      : substantive / ceremonial / procedural
  - tags           : JSON list of topic tags

Uses the pluggable AI provider (Ollama by default).
"""

import json
import logging
import re
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Legislation
from app.services.ai_provider import get_ai_provider

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are a nonpartisan policy analyst helping Philadelphia citizens
understand their City Council legislation. Your job is to produce clear,
accurate, plain-language analysis that a high school student could understand.
Be concise and factual. Do not take political positions."""


def _extract_json(text: str) -> dict:
    """Extract the first JSON object from a model response."""
    # Try direct parse first
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    # Try to find a JSON block
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


def analyze_bill(bill: Legislation, db: Session) -> Legislation:
    """
    Run AI analysis on a bill and persist results.

    Updates: summary, impact_score, impact_level, bill_type, tags, analyzed_at.
    Commits to DB before returning.
    """
    provider = get_ai_provider()

    bill_text = bill.full_text or bill.description or bill.title
    user_prompt = f"""Analyze this Philadelphia City Council bill:

BILL NUMBER: {bill.bill_number}
TITLE: {bill.title}
SPONSOR(S): {bill.sponsor or 'Unknown'}
STATUS: {bill.status}
TEXT:
{bill_text[:4000]}

Return a JSON object with exactly these fields:
{{
  "summary": "2-3 sentence plain-language explanation for a regular citizen",
  "impact_score": <integer 1-10, where 10 = affects every Philadelphian>,
  "impact_level": "<low|medium|high>",
  "bill_type": "<substantive|ceremonial|procedural>",
  "tags": ["tag1", "tag2", "tag3"]
}}

bill_type guide:
- substantive: changes law, policy, spending, or zoning
- ceremonial: recognitions, commemorations, honorary naming
- procedural: administrative, housekeeping, technical amendments

impact_level guide:
- high: 7-10 — affects many residents or large budget
- medium: 4-6 — affects specific neighborhoods or groups
- low: 1-3 — minor, technical, or ceremonial

Return only the JSON object, no other text."""

    try:
        response = provider.complete(system_prompt=_SYSTEM_PROMPT, user_prompt=user_prompt)
        data = _extract_json(response)

        bill.summary = data.get("summary") or None
        bill.impact_score = int(data["impact_score"]) if data.get("impact_score") else None
        bill.impact_level = data.get("impact_level") or _derive_impact_level(bill.impact_score)
        bill.bill_type = data.get("bill_type") or None

        tags = data.get("tags", [])
        if isinstance(tags, list):
            bill.tags = json.dumps(tags)

        bill.analyzed_at = datetime.utcnow()
        bill.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(bill)
        logger.info(f"Analyzed bill {bill.bill_number}: impact={bill.impact_score}, type={bill.bill_type}")

    except Exception as e:
        logger.error(f"Error analyzing bill {bill.bill_number}: {e}")
        db.rollback()
        raise

    return bill


def _derive_impact_level(score: int | None) -> str:
    if score is None:
        return "medium"
    if score >= 7:
        return "high"
    if score >= 4:
        return "medium"
    return "low"
