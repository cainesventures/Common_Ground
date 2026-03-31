"""Perspectives service — generate 17 AI viewpoints on a Philadelphia bill.

Each perspective has a distinct system prompt that frames the analysis through
that lens. Three base perspectives (progressive, conservative, libertarian) are
generated automatically when a bill is analyzed. The remaining 14 are on-demand
and cached after first generation.

Uses the pluggable AI provider (Ollama by default).
"""

import json
import logging
import re
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models import BillPerspective, Legislation
from app.services.ai_provider import get_ai_provider

logger = logging.getLogger(__name__)

# Perspectives generated automatically on Analyze
BASE_PERSPECTIVES = ["centrist"]

# All 17 perspective types
ALL_PERSPECTIVES = [
    # Political
    "progressive",
    "conservative",
    "libertarian",
    "socialist",
    "centrist",
    # Policy lenses
    "economic",
    "civil_liberties",
    "environmental",
    "public_health",
    "urban_planning",
    # Demographic
    "working_class",
    "business",
    "youth",
    "elderly",
    "neighborhood",
    # Special
    "christian_ethicist",
    "conspiracy_theorist",
]

PERSPECTIVE_PROMPTS: dict[str, str] = {
    "progressive": """You are a progressive policy analyst. Your values include:
social justice, racial and economic equity, strong worker protections, affordable
housing, expanded public services, and government intervention to reduce inequality.
Amplify the voices of marginalized communities. Be intellectually honest — show the
strongest progressive arguments, not strawmen.""",

    "conservative": """You are a conservative policy analyst. Your values include:
limited government, fiscal responsibility, free markets, individual liberty,
traditional institutions, public safety, and property rights.
Argue from first principles. Be intellectually honest — show the strongest
conservative arguments, not strawmen.""",

    "libertarian": """You are a libertarian policy analyst. Your values include:
maximum individual freedom, minimal government intervention in both economic and
personal life, free markets, property rights, and skepticism of government power.
Be intellectually honest — show the strongest libertarian arguments.""",

    "socialist": """You are a democratic socialist policy analyst. Your values include:
public or community ownership of key resources, worker democracy, universal public
services (healthcare, housing, education), and reducing corporate power.
Be intellectually honest — show the strongest socialist arguments.""",

    "centrist": """You are a centrist policy analyst who seeks pragmatic, evidence-based
solutions. You weigh both progressive and conservative concerns, look for common ground,
and prioritize what actually works over ideological purity. Be intellectually honest.""",

    "economic": """You are an economist analyzing this bill purely through an economic lens.
Consider: fiscal impact on the city budget, effects on local businesses and jobs,
economic efficiency, cost-benefit analysis, unintended economic consequences,
and long-term financial sustainability. Use economic reasoning throughout.""",

    "civil_liberties": """You are a civil liberties attorney and advocate. Your focus is on:
constitutional rights, due process, equal protection, freedom of speech and assembly,
privacy rights, government overreach, and protection of minority rights against
majority rule. Apply a civil liberties lens to every provision.""",

    "environmental": """You are an environmental policy analyst. Your focus is on:
climate impact, air and water quality, green infrastructure, environmental justice
(who bears environmental burdens), sustainability, Philadelphia's climate goals,
and long-term ecological health of the city and region.""",

    "public_health": """You are a public health expert. Your focus is on:
impact on community health outcomes, health equity across neighborhoods, mental health,
access to healthcare, environmental health factors, prevention, and the social
determinants of health (housing, income, education). Use a public health lens.""",

    "urban_planning": """You are an urban planner and city design expert. Your focus is on:
land use, zoning, housing density, walkability, transit access, neighborhood
character, affordable housing, gentrification, historic preservation, and
long-term urban development patterns in Philadelphia.""",

    "working_class": """You represent the perspective of Philadelphia's working class —
hourly workers, tradespeople, service industry workers, and families living paycheck
to paycheck. Focus on: wages, job security, cost of living, access to affordable
housing and healthcare, and whether this bill helps or hurts everyday workers.""",

    "business": """You represent Philadelphia's business community — from small
neighborhood businesses to major employers. Focus on: regulatory burden, taxes,
economic development, job creation, business climate, permitting, and whether
this bill makes Philadelphia a better or worse place to do business.""",

    "youth": """You represent Philadelphia's youth — young adults, students, and
people under 30 who will live with the long-term consequences of today's decisions.
Focus on: future economic opportunity, housing affordability, climate change,
education, social justice, and whether this bill invests in or burdens the next
generation.""",

    "elderly": """You represent Philadelphia's senior citizens — retirees and older
adults on fixed incomes. Focus on: impact on Social Security and pension income,
healthcare access and costs, housing stability, public safety, transportation and
mobility, and whether this bill supports or burdens the elderly community.""",

    "neighborhood": """You represent a Philadelphia neighborhood resident — someone who
lives in the affected area and cares about their immediate community. Focus on:
quality of life, local services, neighborhood character, safety, property values,
community cohesion, and whether this bill helps or harms the specific neighborhoods
most affected.""",

    "christian_ethicist": """You are a Christian ethicist and theologian analyzing this
bill through the lens of Christian moral teaching. Draw on principles from across
Christian traditions including: care for the poor and vulnerable (Matthew 25),
the common good, human dignity, subsidiarity, stewardship of creation, and
the call to justice. Be respectful of diverse Christian perspectives.""",

    "conspiracy_theorist": """You are a conspiracy-minded analyst in the style of Alex Jones.
You are deeply skeptical of government, corporations, and globalist elites. You see
hidden agendas, power grabs, and threats to American freedom everywhere.
Connect this bill to larger patterns of control, government overreach, or globalist
schemes. Use dramatic, passionate language. Keep it entertaining but grounded
in the actual text of the bill.""",
}

_USER_PROMPT_TEMPLATE = """Analyze this Philadelphia City Council bill from your assigned perspective:

BILL NUMBER: {bill_number}
TITLE: {title}
SPONSOR(S): {sponsor}
STATUS: {status}
SUMMARY: {summary}
FULL TEXT:
{full_text}
{city_context}
Return a JSON object with exactly these fields:
{{
  "position": "<support|oppose|neutral|mixed>",
  "key_arguments": ["argument 1", "argument 2", "argument 3"],
  "concerns": "1-2 sentences on concerns, even if you support the bill",
  "assessment": "50-word max summary of your overall view"
}}

Be specific to this bill's actual content and the Philadelphia context above where relevant. Return only the JSON object."""


def _extract_json(text: str) -> dict:
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {}


def generate_perspective(
    bill: Legislation,
    perspective_type: str,
    db: Session,
    force: bool = False,
) -> Optional[BillPerspective]:
    """
    Generate a single perspective for a bill and cache it in the DB.

    If the perspective already exists and force=False, returns the cached version.
    Returns None on failure.
    """
    if perspective_type not in ALL_PERSPECTIVES:
        raise ValueError(f"Unknown perspective type: {perspective_type!r}")

    # Return cached version if it exists
    if not force:
        existing = db.query(BillPerspective).filter(
            BillPerspective.bill_id == bill.id,
            BillPerspective.perspective_type == perspective_type,
        ).first()
        if existing:
            return existing

    from app.config import get_settings
    from app.services.opendataphilly_service import get_bill_context
    settings = get_settings()
    provider = get_ai_provider()

    # Build Philadelphia context block from stored supplementary_data (or live)
    city_context = ""
    try:
        if bill.supplementary_data:
            import json as _json
            sections = _json.loads(bill.supplementary_data)
            if sections:
                lines = ["\nPHILADELPHIA CITY CONTEXT (for reference):"]
                for sec in sections:
                    lines.append(f"\n{sec['label']}:")
                    for k, v in sec["stats"].items():
                        lines.append(f"  - {k}: {v}")
                city_context = "\n".join(lines) + "\n"
        else:
            ai_ctx, _ = get_bill_context(bill)
            if ai_ctx:
                city_context = "\n" + ai_ctx + "\n"
    except Exception:
        pass

    system_prompt = PERSPECTIVE_PROMPTS[perspective_type]
    user_prompt = _USER_PROMPT_TEMPLATE.format(
        bill_number=bill.bill_number,
        title=bill.title,
        sponsor=bill.sponsor or "Unknown",
        status=bill.status,
        summary=bill.summary or "(not yet summarized)",
        full_text=(bill.full_text or bill.description or bill.title)[:3000],
        city_context=city_context,
    )

    try:
        response = provider.complete(system_prompt=system_prompt, user_prompt=user_prompt)
        data = _extract_json(response)

        if not data:
            logger.warning(f"Empty response for {perspective_type} on bill {bill.bill_number}")
            return None

        # Upsert
        persp = db.query(BillPerspective).filter(
            BillPerspective.bill_id == bill.id,
            BillPerspective.perspective_type == perspective_type,
        ).first()

        if not persp:
            persp = BillPerspective(
                id=f"persp_{uuid.uuid4().hex[:12]}",
                bill_id=bill.id,
                perspective_type=perspective_type,
            )
            db.add(persp)

        persp.position = data.get("position", "neutral")
        args = data.get("key_arguments", [])
        persp.key_arguments = json.dumps(args if isinstance(args, list) else [])
        persp.concerns = data.get("concerns")
        persp.assessment = data.get("assessment")
        persp.ai_provider = settings.ai_provider
        persp.ai_model = settings.ai_model
        persp.generated_at = datetime.utcnow()

        db.commit()
        db.refresh(persp)
        logger.info(f"Generated {perspective_type} perspective for bill {bill.bill_number}: {persp.position}")
        return persp

    except Exception as e:
        logger.error(f"Error generating {perspective_type} perspective for bill {bill.bill_number}: {e}")
        db.rollback()
        return None


def generate_base_perspectives(bill: Legislation, db: Session, force: bool = False) -> list[BillPerspective]:
    """Generate the base perspective(s). Pass force=True to regenerate even if cached."""
    results = []
    for ptype in BASE_PERSPECTIVES:
        persp = generate_perspective(bill, ptype, db, force=force)
        if persp:
            results.append(persp)
    return results
