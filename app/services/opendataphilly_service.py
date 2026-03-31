"""
Philadelphia city context data for enriching bill analysis and perspectives.

Provides tag-matched statistics from:
  - U.S. Census Bureau ACS 2022
  - City of Philadelphia FY2025 Operating Budget
  - Department annual reports

Data is static and organized by topic category. Tags on each bill are mapped
to relevant categories so AI prompts and the detail page receive targeted stats.
"""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Static Philadelphia statistics by topic category
# ---------------------------------------------------------------------------

_PHILLY: dict[str, dict[str, Any]] = {
    "general": {
        "label": "Philadelphia Overview",
        "stats": {
            "Population": "1,576,251",
            "Median household income": "$52,649",
            "Poverty rate": "21.8%",
            "Unemployment rate": "6.2%",
            "Adults with bachelor's degree": "32.4%",
        },
        "source": "U.S. Census Bureau ACS 2022",
    },
    "housing": {
        "label": "Housing",
        "stats": {
            "Total housing units": "694,338",
            "Owner-occupied": "222,000",
            "Renter-occupied": "267,000",
            "Vacancy rate": "11.6%",
            "Median home value": "$210,000",
            "Median gross rent": "$1,150/mo",
            "Cost-burdened renters": "53%",
        },
        "source": "U.S. Census Bureau ACS 2022",
    },
    "zoning": {
        "label": "Land Use & Zoning",
        "stats": {
            "Total parcels": "586,000",
            "Residential zoning": "62% of land",
            "Commercial zoning": "8% of land",
            "Industrial zoning": "6% of land",
            "Last major zoning code update": "2012",
        },
        "source": "Philadelphia City Planning Commission",
    },
    "education": {
        "label": "Education",
        "stats": {
            "School District schools": "218",
            "District enrollment": "119,000 students",
            "Graduation rate": "74.8%",
            "Chronically absent students": "27%",
            "School District FY2025 budget": "$4.5 billion",
        },
        "source": "School District of Philadelphia 2024",
    },
    "transportation": {
        "label": "Transportation",
        "stats": {
            "SEPTA weekday ridership": "700,000",
            "Lane miles of road": "2,600",
            "Bike lane miles": "350",
            "Traffic fatalities (2023)": "141",
            "Streets Dept FY2025 budget": "$169 million",
        },
        "source": "SEPTA, PennDOT, Vision Zero 2023",
    },
    "public_safety": {
        "label": "Public Safety",
        "stats": {
            "Police districts": "21",
            "Homicides (2023)": "406",
            "Sworn police officers": "6,200",
            "Fire stations": "62",
            "Police Dept FY2025 budget": "$885 million",
        },
        "source": "Philadelphia Police Dept 2023 Annual Report",
    },
    "health": {
        "label": "Public Health",
        "stats": {
            "Uninsured residents": "10.8%",
            "Life expectancy": "73.6 years",
            "Opioid overdose deaths (2023)": "1,420",
            "Health Dept FY2025 budget": "$383 million",
        },
        "source": "Philadelphia Dept of Public Health 2023",
    },
    "environment": {
        "label": "Environment",
        "stats": {
            "Tree canopy coverage": "20%",
            "Parks & recreation acreage": "10,600 acres",
            "Neighborhoods with heat island effect": "12",
            "Water Dept FY2025 budget": "$827 million",
        },
        "source": "Philadelphia Parks & Recreation, City Budget FY2025",
    },
    "budget": {
        "label": "City Budget",
        "stats": {
            "Total FY2025 operating budget": "$6.3 billion",
            "General Fund": "$5.6 billion",
            "Police Dept": "$885 million",
            "Human Services": "$520 million",
            "Fire Dept": "$298 million",
        },
        "source": "City of Philadelphia FY2025 Operating Budget",
    },
    "labor": {
        "label": "Labor & Employment",
        "stats": {
            "Total employed residents": "697,000",
            "Union membership": "14.2%",
            "PA state minimum wage": "$7.25/hr",
            "City wage tax (residents)": "3.75%",
            "City wage tax (non-residents)": "3.44%",
        },
        "source": "BLS 2023, City of Philadelphia Revenue Dept",
    },
    "business": {
        "label": "Business Climate",
        "stats": {
            "Total business licenses": "95,000",
            "Small businesses (<50 employees)": "97.2%",
            "Business privilege tax rate": "1.415%",
            "Net income tax rate": "6.20%",
            "Commercial vacancy rate": "14.5%",
        },
        "source": "City of Philadelphia Commerce Dept 2023",
    },
    "social_services": {
        "label": "Social Services",
        "stats": {
            "SNAP recipients": "260,000",
            "Medicaid recipients": "540,000",
            "Homeless count (2023)": "5,765",
            "Human Services FY2025 budget": "$520 million",
        },
        "source": "City of Philadelphia Dept of Human Services 2023",
    },
    "parks": {
        "label": "Parks & Recreation",
        "stats": {
            "Parks acreage": "10,600 acres",
            "Recreation centers": "180",
            "Playgrounds": "300+",
            "Parks & Rec FY2025 budget": "$110 million",
        },
        "source": "Philadelphia Parks & Recreation 2023",
    },
    "infrastructure": {
        "label": "Infrastructure",
        "stats": {
            "Structurally deficient bridges": "12%",
            "Streets needing repair": "1,200 miles",
            "Water main miles": "3,300",
            "Capital budget FY2025": "$2.1 billion",
        },
        "source": "City of Philadelphia Streets Dept, Capital Program FY2025",
    },
    "technology": {
        "label": "Technology & Digital Access",
        "stats": {
            "Broadband access": "80.1% of households",
            "Digital literacy program participants (2023)": "45,000",
            "Active smart city initiatives": "12",
        },
        "source": "City of Philadelphia OIT 2023",
    },
}

# Map bill tags → relevant stat category keys, in priority order
_TAG_CATEGORIES: dict[str, list[str]] = {
    "housing":         ["housing", "zoning", "general"],
    "zoning":          ["zoning", "housing", "general"],
    "transportation":  ["transportation", "infrastructure", "budget"],
    "public safety":   ["public_safety", "budget", "general"],
    "budget":          ["budget", "general"],
    "education":       ["education", "budget", "general"],
    "environment":     ["environment", "budget", "general"],
    "health":          ["health", "budget", "general"],
    "parks":           ["parks", "environment"],
    "business":        ["business", "labor", "budget"],
    "infrastructure":  ["infrastructure", "transportation", "budget"],
    "labor":           ["labor", "business", "general"],
    "technology":      ["technology", "budget"],
    "social services": ["social_services", "health", "budget"],
}

_MAX_CATEGORIES = 3


def get_bill_context(bill) -> tuple[str, list[dict]]:
    """
    Return ``(ai_context_string, display_sections)`` based on a bill's tags.

    ai_context_string  — compact text block injected into AI prompts
    display_sections   — list of ``{label, stats, source}`` dicts for the frontend

    Returns ``("", [])`` if the bill has no recognized tags.
    """
    tags: list[str] = []
    try:
        tags = json.loads(bill.tags) if bill.tags else []
    except Exception:
        pass

    # Collect unique category keys in priority order
    seen: set[str] = set()
    categories: list[str] = []
    for tag in tags:
        for cat in _TAG_CATEGORIES.get(tag.lower(), []):
            if cat not in seen:
                seen.add(cat)
                categories.append(cat)

    # Always include general context when there is something to show
    if categories and "general" not in seen:
        categories.append("general")

    categories = categories[:_MAX_CATEGORIES]

    if not categories:
        return "", []

    # Build compact AI context block
    lines = ["PHILADELPHIA CITY CONTEXT (for reference):"]
    for cat in categories:
        sec = _PHILLY[cat]
        lines.append(f"\n{sec['label']}:")
        for k, v in sec["stats"].items():
            lines.append(f"  - {k}: {v}")

    ai_context = "\n".join(lines)

    # Build frontend display sections
    display = [
        {
            "label": _PHILLY[cat]["label"],
            "stats": _PHILLY[cat]["stats"],
            "source": _PHILLY[cat]["source"],
        }
        for cat in categories
    ]

    return ai_context, display
