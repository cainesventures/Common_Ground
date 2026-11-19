"""The "This week in Council" endpoint."""

from datetime import datetime

from app.models import Legislation


def _bill(db, n, status="introduced", introduced="2026-11-10", final=None, title=None):
    db.add(Legislation(
        id=f"b{n}", source="test", level="local", bill_number=str(n),
        title=title or f"Official title {n}", status=status,
        introduced_date=datetime.fromisoformat(introduced),
        final_date=datetime.fromisoformat(final) if final else None,
        analyzed_at=datetime(2026, 11, 13),
    ))
    db.flush()


def test_week_counts_awaiting_mayor_as_passed(client, test_db):
    _bill(test_db, 1, introduced="2026-11-12")
    _bill(test_db, 2, status="awaiting_mayor", introduced="2026-09-24", final="2026-11-12")
    _bill(test_db, 3, status="signed_into_law", introduced="2026-09-01", final="2026-11-10")
    _bill(test_db, 4, status="vetoed", introduced="2026-09-01", final="2026-11-11")
    _bill(test_db, 5, introduced="2026-11-11", title="(no title)")

    w = client.get("/api/legislation/week").json()
    assert (w["start"], w["end"]) == ("2026-11-06", "2026-11-12")
    assert [b["id"] for b in w["introduced"]] == ["b1"]  # placeholder left out
    assert {b["id"] for b in w["passed"]} == {"b2", "b3"}
    assert [b["id"] for b in w["not_passed"]] == ["b4"]
    assert {b["id"] for b in w["decided"]} == {"b2", "b3", "b4"}
    assert "brief" not in w


def test_week_rejects_bad_date(client):
    assert client.get("/api/legislation/week?end=2026-13-01").status_code == 400
