"""Build AI debator system prompts from user-defined policy stances.

Users choose a value 1–5 on each policy dimension (buttons/sliders in the UI).
This module converts those numeric choices into a coherent Claude system prompt
that makes the AI agent argue from the user's perspective.

All stance labels are pre-defined server-side — no free text input from users.
"""

from typing import Dict, List

# ─── Policy dimensions ────────────────────────────────────────────────────────
# Each dimension has 5 labelled positions.  The UI renders these as a 5-button
# row or a slider.  Values are stored as integers 1–5.

DIMENSIONS: List[Dict] = [
    {
        "key": "economy",
        "label": "Economic Policy",
        "description": "How should economic activity be managed?",
        "positions": {
            1: "strongly free-market (minimal regulation, lower taxes, private enterprise)",
            2: "lean free-market (light regulation, competitive markets)",
            3: "mixed economy (balanced regulation and market forces)",
            4: "lean government-led (active regulation, social safety nets)",
            5: "strongly government-led (robust public sector, significant redistribution)",
        },
    },
    {
        "key": "environment",
        "label": "Environment & Climate",
        "description": "How should we balance economic growth and environmental protection?",
        "positions": {
            1: "prioritize economic growth (industry-friendly, skeptical of climate regulation)",
            2: "lean growth-first (modest environmental rules, market-based solutions)",
            3: "balanced (moderate climate policy, green incentives)",
            4: "lean climate-first (strong environmental standards, clean energy investment)",
            5: "climate emergency (aggressive decarbonization, strict regulation)",
        },
    },
    {
        "key": "healthcare",
        "label": "Healthcare",
        "description": "How should healthcare be financed and delivered?",
        "positions": {
            1: "fully private market (competition, consumer choice, minimal public role)",
            2: "lean private (regulated private insurance, limited public programs)",
            3: "mixed system (public-private partnership, expanded but not universal coverage)",
            4: "lean universal (strong public option, expanded Medicaid)",
            5: "universal coverage (single-payer or government-guaranteed healthcare for all)",
        },
    },
    {
        "key": "immigration",
        "label": "Immigration",
        "description": "What approach should the country take toward immigration?",
        "positions": {
            1: "strict limits (significantly reduced legal immigration, strong border enforcement)",
            2: "lean restrictive (merit-based selection, tighter enforcement)",
            3: "balanced (maintain current levels with targeted reforms)",
            4: "lean welcoming (expanded pathways, humane enforcement)",
            5: "open and welcoming (broad legal pathways, comprehensive immigration reform)",
        },
    },
    {
        "key": "social",
        "label": "Social Policy",
        "description": "What values should guide social and cultural policy?",
        "positions": {
            1: "traditional values (emphasize family, faith, and established institutions)",
            2: "lean traditional (respect tradition while allowing gradual change)",
            3: "centrist (pragmatic, case-by-case social policy)",
            4: "lean progressive (expand civil rights, reduce systemic inequality)",
            5: "strongly progressive (prioritize equity, inclusion, and structural reform)",
        },
    },
    {
        "key": "government",
        "label": "Role of Government",
        "description": "How large and active should government be?",
        "positions": {
            1: "minimal government (very limited federal role, maximum local/individual autonomy)",
            2: "lean limited (reduced federal scope, strong states' rights)",
            3: "moderate (government active in core areas: defense, infrastructure, safety nets)",
            4: "lean expansive (broad federal programs, strong public institutions)",
            5: "expansive government (large public sector, extensive social programs)",
        },
    },
]

# Build a quick lookup dict
_DIM_BY_KEY: Dict[str, Dict] = {d["key"]: d for d in DIMENSIONS}
VALID_KEYS = set(_DIM_BY_KEY.keys())


def build_persona_prompt(stances: Dict[str, int], display_name: str = "the user") -> str:
    """Convert stance choices (1–5 per dimension) into a Claude system prompt.

    Args:
        stances:      Dict mapping dimension key → integer 1–5.
        display_name: The user's chosen display name (used in persona framing).

    Returns:
        A system_prompt string suitable for an Agent.
    """
    lines = [
        f"You are {display_name}'s Personal AI Debator on Common Ground.",
        "Your role is to argue for legislation positions that reflect the following political views.",
        "Be clear, concise, and persuasive. Keep each argument under 300 words.",
        "Use facts and evidence where possible. Do not be rude or inflammatory.",
        "",
        "Your political stances:",
    ]

    for dim in DIMENSIONS:
        key = dim["key"]
        score = stances.get(key)
        if score is None:
            continue
        score = max(1, min(5, int(score)))  # clamp to 1–5
        position_label = dim["positions"][score]
        lines.append(f"- {dim['label']}: {position_label}")

    lines += [
        "",
        "When debating legislation:",
        "- Argue from these values consistently across all topics.",
        "- Acknowledge strong opposing points briefly before rebutting them.",
        "- Cite real data or credible sources when making factual claims.",
        "- Never reveal that you are an AI unless directly asked.",
    ]

    return "\n".join(lines)


def validate_stances(stances: Dict[str, int]) -> List[str]:
    """Return a list of validation error messages (empty if valid)."""
    errors = []
    for key in VALID_KEYS:
        if key not in stances:
            errors.append(f"Missing stance for dimension '{key}'")
        elif not isinstance(stances[key], int) or not (1 <= stances[key] <= 5):
            errors.append(f"Stance for '{key}' must be an integer 1–5")
    extra = set(stances.keys()) - VALID_KEYS
    for key in extra:
        errors.append(f"Unknown dimension key '{key}'")
    return errors
