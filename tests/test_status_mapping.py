"""Legistar status strings map onto ours, and live statuses stay live."""

from app.integrations.legistar_scraper import _normalize_status
from app.services.perspectives_service import ACTIVE_STATUSES


def test_mayors_office_is_awaiting_mayor_not_introduced():
    # Unmapped, this fell through to "introduced" and a bill that had already
    # passed Council read as just filed.
    assert _normalize_status("IN MAYOR'S OFFICE") == "awaiting_mayor"


def test_known_statuses_still_map():
    assert _normalize_status("In Committee") == "in_committee"
    assert _normalize_status("LAPSED") == "lapsed"
    assert _normalize_status("ENACTED") == "signed_into_law"


def test_awaiting_mayor_counts_as_active():
    # A veto can still kill it, so it keeps its case for / against.
    assert "awaiting_mayor" in ACTIVE_STATUSES
