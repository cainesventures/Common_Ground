"""Rules for hearing reminders / status alerts / new-post alerts, and the push
endpoint allow-list."""
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.notification_routes import _check_endpoint
from app.models import PushSubscription, PushTopicFollow
from app.services import notification_service, webpush
from app.services.notification_service import blog_messages, dispatch, hearing_at, messages_for
from tests.conftest import make_legislation

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


# --- New blog posts -----------------------------------------------------------

SUB = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc",
       "keys": {"p256dh": "B" * 65, "auth": "A" * 16}}


def post(slug, date="2026-10-24", title=None):
    return {"slug": slug, "date": date, "title": title or f"Post {slug}"}


def test_new_post_alerts_once():
    posts = [post("old", "2026-10-01"), post("new", "2026-10-24", "Three Bills")]
    (slugs, p), = blog_messages({"old"}, posts)
    assert slugs == ["new"]
    assert p["url"] == "/blog/new" and p["body"] == "Three Bills"
    assert blog_messages({"old", "new"}, posts) == []


def test_several_new_posts_arrive_oldest_first():
    posts = [post("b", "2026-10-20"), post("a", "2026-10-10")]
    assert [s for s, _ in blog_messages(set(), posts)] == [["a"], ["b"]]


def test_a_backlog_collapses_into_one_alert():
    posts = [post(f"p{i}", f"2026-10-1{i}") for i in range(5)]
    (slugs, p), = blog_messages(set(), posts)
    assert len(slugs) == 5
    assert p["url"] == "/blog" and p["title"].startswith("5 new posts")


@pytest.fixture
def sent(monkeypatch):
    """Capture what would be pushed instead of calling a push service."""
    out = []
    monkeypatch.setattr(webpush, "configured", lambda: True)
    monkeypatch.setattr(webpush, "send", lambda endpoint, p256dh, auth, payload, ttl=0: out.append(payload))
    return out


def follow_blog(db, seen):
    db.add(PushSubscription(id="s1", endpoint=SUB["endpoint"], p256dh="x", auth="y"))
    db.flush()
    db.add(PushTopicFollow(subscription_id="s1", topic="blog",
                           seen=None if seen is None else json.dumps(seen)))
    db.commit()


def test_dispatch_sends_each_new_post_once(test_db, sent):
    follow_blog(test_db, ["old"])
    posts = [post("old"), post("new")]
    dispatch(test_db, posts=posts)
    assert [p["url"] for p in sent] == ["/blog/new"]
    dispatch(test_db, posts=posts)
    assert len(sent) == 1


def test_dispatch_takes_a_silent_baseline_when_the_page_sent_none(test_db, sent):
    follow_blog(test_db, None)
    dispatch(test_db, posts=[post("old")])
    assert sent == []
    dispatch(test_db, posts=[post("old"), post("new")])
    assert [p["url"] for p in sent] == ["/blog/new"]


def test_unreadable_site_skips_the_blog_and_keeps_state(test_db, sent, monkeypatch):
    monkeypatch.setattr(notification_service, "fetch_blog_posts", lambda: None)
    follow_blog(test_db, ["old"])
    dispatch(test_db)
    assert sent == []
    assert test_db.query(PushTopicFollow).one().seen == json.dumps(["old"])


def test_a_dead_device_loses_its_blog_follow(test_db, monkeypatch):
    monkeypatch.setattr(webpush, "configured", lambda: True)

    def gone(*a, **k):
        raise webpush.Gone("x")

    monkeypatch.setattr(webpush, "send", gone)
    follow_blog(test_db, [])
    dispatch(test_db, posts=[post("new")])
    assert test_db.query(PushTopicFollow).count() == 0
    assert test_db.query(PushSubscription).count() == 0


def test_blog_follow_status_and_unfollow(client, test_db):
    r = client.post("/api/notifications/blog/follow",
                    json={"subscription": SUB, "known": ["a-post", "Not A Slug!"]})
    assert r.status_code == 200
    # Only well-formed slugs from the page become the baseline.
    assert test_db.query(PushTopicFollow).one().seen == json.dumps(["a-post"])
    status = lambda: client.post("/api/notifications/blog/status", json={"endpoint": SUB["endpoint"]}).json()
    assert status() == {"following": True}
    client.post("/api/notifications/blog/unfollow", json={"endpoint": SUB["endpoint"]})
    assert status() == {"following": False}
    assert test_db.query(PushSubscription).count() == 0


def test_unwatching_a_bill_keeps_a_device_that_follows_the_blog(client, test_db):
    make_legislation(test_db)
    test_db.commit()
    client.post("/api/notifications/watch", json={"subscription": SUB, "bill_id": "bill_1"})
    client.post("/api/notifications/blog/follow", json={"subscription": SUB})
    client.post("/api/notifications/unwatch", json={"endpoint": SUB["endpoint"], "bill_id": "bill_1"})
    assert client.post("/api/notifications/blog/status",
                       json={"endpoint": SUB["endpoint"]}).json() == {"following": True}
    assert test_db.query(PushSubscription).count() == 1
