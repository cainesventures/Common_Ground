"""Service for generating AI vote predictions for election candidates."""

import json
import logging
import re
import uuid
from sqlalchemy.orm import Session

from app.models import CandidateVotePrediction

logger = logging.getLogger(__name__)

PREDICTION_SYSTEM_PROMPT = """You are a civic analyst predicting how a Philadelphia City Council candidate might vote on a bill.
This is speculative analysis for educational purposes — NOT a factual claim about the candidate's positions.

Given a candidate's profile and a bill description, output ONLY valid JSON in this exact format:
{"predicted_vote": "support" | "oppose" | "uncertain", "reasoning": "One sentence explaining the prediction based on party/background/stated positions."}

No markdown, no extra text — just the JSON object."""


def generate_prediction(candidate, bill, db: Session) -> CandidateVotePrediction:
    """Generate (or return cached) AI vote prediction for a candidate on a bill."""
    from app.services.ai_provider import get_ai_provider

    # Return cached prediction if it exists
    existing = db.query(CandidateVotePrediction).filter_by(
        candidate_id=candidate.id,
        bill_id=bill.id,
    ).first()
    if existing:
        return existing

    provider = get_ai_provider()

    candidate_context = f"""Candidate: {candidate.name}
District: {candidate.district}
Party: {candidate.party or 'Unknown'}
Office sought: {candidate.office_sought or 'Philadelphia City Council'}
Incumbent: {'Yes' if candidate.is_incumbent else 'No'}
Background: {candidate.bio or 'No bio available'}
Known positions: {candidate.known_positions or 'None on record'}"""

    bill_context = f"""Bill: {bill.bill_number} — {bill.plain_title or bill.title}
Summary: {bill.summary or bill.description or 'No summary available'}
Tags: {bill.tags or 'None'}"""

    user_prompt = f"{candidate_context}\n\nBill under consideration:\n{bill_context}"

    try:
        response = provider.complete(
            system_prompt=PREDICTION_SYSTEM_PROMPT,
            user_prompt=user_prompt,
        )
        match = re.search(r'\{.*\}', response, re.DOTALL)
        data = json.loads(match.group(0)) if match else {}
    except Exception as e:
        logger.warning(f"AI prediction failed for candidate {candidate.id} bill {bill.id}: {e}")
        data = {}

    predicted_vote = data.get("predicted_vote", "uncertain")
    if predicted_vote not in ("support", "oppose", "uncertain"):
        predicted_vote = "uncertain"

    pred = CandidateVotePrediction(
        id=f"pred_{uuid.uuid4().hex[:12]}",
        candidate_id=candidate.id,
        bill_id=bill.id,
        predicted_vote=predicted_vote,
        reasoning=data.get("reasoning", "Insufficient data to make a prediction."),
        ai_provider=type(provider).__name__,
        ai_model=getattr(provider, "model", ""),
    )
    db.add(pred)
    db.commit()
    db.refresh(pred)
    return pred
