"""Rules for hearing reminders / status alerts, and the push endpoint allow-list."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.notification_routes import _check_endpoint
from app.services.notification_service import hearing_at, messages_for

# 2026-10-26 14:00 UTC = 10:00 AM Monday in Philadelphia (EDT).
NOW = datetime(2026, 10, 26, 14, 0, tzinfo=timezone.utc)


def bill(**kw):
    base = dict(id="b1", bill_number="260516", status="in_committee", headline="A bill",
                plain_title=None, title="T", next_hearing_date=None, next_hearing_time=None,
                next_hearing_body=None)
    base.update(kw)
    return SimpleNamespace(**base)


def watch(**kw):
    base = dict(id=1, last_status="in_committee", last_hearing_notified=None)
    base.update(kw)
    return SimpleNamespace(**base)


def test_status_change_notifies_once():
    b = bill(status="signed_into_law")
    msgs = messages_for(watch(), b, NOW)
    assert [k for k, _ in msgs] == ["status"]
    assert "Signed into Law" in msgs[0][1]["title"]
    # Already told: nothing.
    assert messages_for(watch(last_status="signed_into_law"), b, NOW) == []


def test_hearing_tomorrow_notifies_with_local_time():
    b = bill(next_hearing_date=datetime(2026, 10, 27), next_hearing_time="10:00 AM",
             next_hearing_body="Committee on Rules")
    (kind, p), = messages_for(watch(), b, NOW)
    assert kind == "hearing"
    assert p["title"] == "Hearing tomorrow, 10:00 AM: Committee on Rules"


def test_hearing_too_far_away_or_already_told_is_silent():
    far = bill(next_hearing_date=datetime(2026, 10, 30), next_hearing_time="10:00 AM")
    assert messages_for(watch(), far, NOW) == []
    soon = bill(next_hearing_date=datetime(2026, 10, 27), next_hearing_time="10:00 AM")
    assert messages_for(watch(last_hearing_notified=datetime(2026, 10, 27)), soon, NOW) == []


def test_past_hearing_is_silent():
    past = bill(next_hearing_date=datetime(2026, 10, 26), next_hearing_time="9:00 AM")
    assert messages_for(watch(), past, NOW) == []


def test_hearing_time_parsing_handles_pm_and_missing():
    assert hearing_at(bill(next_hearing_date=datetime(2026, 10, 27), next_hearing_time="2:00 PM")).hour == 14
    assert hearing_at(bill(next_hearing_date=datetime(2026, 10, 27), next_hearing_time="")).hour == 9


@pytest.mark.parametrize("url", [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
])
def test_real_push_services_allowed(url):
    _check_endpoint(url)


@pytest.mark.parametrize("url", [
    "http://fcm.googleapis.com/fcm/send/abc",       # not https
    "https://169.254.169.254/latest/meta-data",     # SSRF target
    "https://evilfcm.googleapis.com.attacker.io/x",  # suffix trick
    "https://localhost:8000/api/admin",
])
def test_anything_else_rejected(url):
    with pytest.raises(HTTPException):
        _check_endpoint(url)
