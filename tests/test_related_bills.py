"""Related bills on the bill page: subject ranking, sponsor list, exclusions.

The ranking replaced a client-side list that matched on the bill's first tag
alone. What these pin down is the behavior that made it worth replacing: a
rare shared tag outranks a common one, ceremonial resolutions stay out of a
real bill's list, and the sponsor list follows the member across titles.
"""
from datetime import datetime

from app.models import Councilmember, Legislation


def _bill(db, n, tags, sponsor="Councilmember Squilla", year=2024, bill_type="substantive", **kw):
    leg = Legislation(
        id=f"legistar_phila_{n}",
        source="legistar",
        level="local",
        city="philadelphia",
        bill_number=str(n),
        title=f"Legal title {n}",
        headline=f"Headline {n}",
        status=kw.pop("status", "signed_into_law"),
        tags=__import__("json").dumps(tags),
        sponsor=sponsor,
        introduced_date=datetime(year, 1, 1),
        bill_type=bill_type,
        **kw,
    )
    db.add(leg)
    return leg


def _filler(db, start, count, tags):
    """Bills that make a tag common, so its weight drops."""
    for i in range(count):
        _bill(db, start + i, tags, sponsor="Councilmember Nobody", year=2010)


def _related(client, n):
    r = client.get(f"/api/legislation/legistar_phila_{n}/related")
    assert r.status_code == 200
    return r.json()["data"]


def test_rare_shared_tag_outranks_common_one(client, test_db):
    _filler(test_db, 100, 20, ["zoning"])
    _bill(test_db, 1, ["zoning", "bike lanes"])
    # Shares only the common tag, and is newer, so recency alone would put it first.
    _bill(test_db, 2, ["zoning"], year=2026)
    # Shares the rare tag.
    _bill(test_db, 3, ["bike lanes"], year=2012)
    test_db.commit()

    ids = [b["id"] for b in _related(client, 1)["subject"]["bills"]]
    assert ids[0] == "legistar_phila_3"
    assert "legistar_phila_2" in ids
    assert "legistar_phila_1" not in ids


def test_ties_go_to_the_most_recent_bill(client, test_db):
    _filler(test_db, 100, 5, ["other"])
    _bill(test_db, 1, ["parking"], year=2004)
    _bill(test_db, 2, ["parking"], year=2008)
    _bill(test_db, 3, ["parking"], year=2025)
    test_db.commit()

    ids = [b["id"] for b in _related(client, 1)["subject"]["bills"]]
    assert ids == ["legistar_phila_3", "legistar_phila_2"]


def test_hyphen_and_space_spellings_are_one_subject(client, test_db):
    _filler(test_db, 100, 5, ["other"])
    _bill(test_db, 1, ["land-use"])
    _bill(test_db, 2, ["land use"])
    test_db.commit()

    ids = [b["id"] for b in _related(client, 1)["subject"]["bills"]]
    assert ids == ["legistar_phila_2"]


def test_ceremonial_bills_stay_out_of_a_substantive_bills_list(client, test_db):
    _filler(test_db, 100, 5, ["other"])
    _bill(test_db, 1, ["sports"])
    _bill(test_db, 2, ["sports"], bill_type="ceremonial")
    _bill(test_db, 3, ["sports"], bill_type="ceremonial")
    test_db.commit()

    assert _related(client, 1)["subject"]["bills"] == []
    # ...but a resolution's own page shows its own kind, and real bills too.
    ids = {b["id"] for b in _related(client, 2)["subject"]["bills"]}
    assert ids == {"legistar_phila_1", "legistar_phila_3"}


def test_sponsor_list_spans_titles_and_skips_subject_matches(client, test_db):
    _filler(test_db, 100, 5, ["other"])
    _bill(test_db, 1, ["taxes"], sponsor="Council President Johnson, Councilmember Driscoll", year=2024)
    # Same member under his earlier title; different subject.
    _bill(test_db, 2, ["parks"], sponsor="Councilmember Johnson", year=2018)
    # Same member and same subject: already in the subject list, not repeated.
    _bill(test_db, 3, ["taxes"], sponsor="Council President Johnson", year=2023)
    # Driscoll is a co-sponsor of bill 1, not its primary sponsor.
    _bill(test_db, 4, ["parks"], sponsor="Councilmember Driscoll", year=2024)
    test_db.add(Councilmember(id="cm_johnson", name="Kenyatta Johnson", term_start=2012))
    test_db.commit()

    data = _related(client, 1)
    assert [b["id"] for b in data["subject"]["bills"]] == ["legistar_phila_3"]
    sponsor = data["sponsor"]
    assert sponsor["name"] == "Council President Johnson"
    assert sponsor["filter"] == "Johnson"
    assert sponsor["councilmember_id"] == "cm_johnson"
    assert [b["id"] for b in sponsor["bills"]] == ["legistar_phila_2"]


def test_former_member_with_a_current_members_surname_is_not_linked(client, test_db):
    _filler(test_db, 100, 5, ["other"])
    _bill(test_db, 1, ["taxes"], sponsor="Councilmember Johnson", year=2003)
    test_db.add(Councilmember(id="cm_johnson", name="Kenyatta Johnson", term_start=2012))
    test_db.commit()

    assert _related(client, 1)["sponsor"]["councilmember_id"] is None


def test_see_all_tag_is_the_most_specific_one_worth_a_list(client, test_db):
    _filler(test_db, 100, 20, ["zoning"])
    _filler(test_db, 200, 4, ["bike lanes"])
    # "one-off" is on this bill only: too rare to open a list.
    _bill(test_db, 1, ["zoning", "bike lanes", "one-off"])
    test_db.commit()

    data = _related(client, 1)
    assert data["subject"]["tag"] == "bike lanes"
    assert data["tag_counts"] == {"zoning": 21, "bike lanes": 5, "one-off": 1}


def test_card_uses_the_readable_title(client, test_db):
    _filler(test_db, 100, 5, ["other"])
    _bill(test_db, 1, ["parking"])
    _bill(test_db, 2, ["parking"], plain_title="Plain title 2")
    test_db.commit()

    card = _related(client, 1)["subject"]["bills"][0]
    assert card["title"] == "Plain title 2"
    assert card["introduced_date"].startswith("2024-01-01")


def test_new_bills_are_seen_without_waiting_out_the_cache(client, test_db):
    _filler(test_db, 100, 5, ["other"])
    _bill(test_db, 1, ["parking"])
    test_db.commit()
    assert _related(client, 1)["subject"]["bills"] == []

    _bill(test_db, 2, ["parking"])
    test_db.commit()
    assert [b["id"] for b in _related(client, 1)["subject"]["bills"]] == ["legistar_phila_2"]


def test_unknown_bill_is_404(client):
    r = client.get("/api/legislation/does_not_exist/related")
    assert r.status_code == 404
