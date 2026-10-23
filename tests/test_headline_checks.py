"""Checks that gate AI headline output, and the 600-char title repair."""
from app.integrations.legistar_scraper import best_title
from app.services.headline_checks import amounts, headline_problems, unsupported_places


def test_place_named_in_headline_but_not_bill_is_flagged():
    src = "Amending traffic regulations for Hermit Street between Ridge Avenue and Manayunk Avenue."
    assert unsupported_places("Hermit Street Goes One-Way in Roxborough", src) == ["Roxborough"]
    # Named in the bill: fine.
    assert unsupported_places("One-Way Change Near Manayunk Avenue", src) == []


def test_longer_neighborhood_reported_once():
    assert unsupported_places("New rules in East Passyunk", "a bill") == ["East Passyunk"]


def test_loaded_words_flagged_but_ordinary_verbs_are_not():
    assert headline_problems("Council Cracks Down on Sidewalk Vendors", "vendors") != []
    assert headline_problems("Council Limits Sidewalk Vending Hours", "vendors") == []


def test_money_compares_by_value():
    assert amounts("$1.3 billion") == amounts("$1,300,000,000")
    # Headline figure absent from both bill and summary, summary has its own.
    assert headline_problems("City Plans $1 Billion Upgrade", "budget", "A $7.59 billion budget") != []
    assert headline_problems("City Plans $7.59 Billion Budget", "budget", "A $7.59 billion budget") == []


def test_best_title_repairs_grid_truncation_from_full_text():
    cut = "Authorizing the Commissioner to acquire land for park purposes under certain terms and co"
    full = "Title:\nAuthorizing the Commissioner to acquire land for park\npurposes under certain terms and conditions.\nSponsors:\nX"
    assert best_title(cut, None, "\n" + full).endswith("terms and conditions.")


def test_best_title_never_replaces_a_different_title():
    assert best_title("A zoning bill", "A completely different bill title", None) == "A zoning bill"
    assert best_title(None, "Fresh title", None) == "Fresh title"
