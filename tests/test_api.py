"""Tests for API endpoints via FastAPI TestClient.

The agent and debate suites that used to live here were removed along with the
debate engine (commit d8f59ff). Two of those tests were still "passing" only
because a deleted route 404s, which is exactly what they asserted.
"""

from tests.conftest import make_legislation


# ---------------------------------------------------------------------------
# Health endpoints
# ---------------------------------------------------------------------------

def test_health_endpoint(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


def test_health_reports_deploy_markers(client):
    """/health must carry the deploy markers publish.ps1 waits on.

    `publish.ps1` polls this endpoint until `db_version` matches the
    DB_RESTORE_VERSION it just set, and only then purges the Cloudflare cache.
    Before these fields existed it tested `status == "healthy"`, which the OLD
    container answers identically -- so the purge raced the rollout and could
    refill the edge from pre-publish data for a fresh hour.

    Both markers are None here (no Railway env, no .restore_version file), so
    this pins the contract -- the keys are present and `status` is unchanged --
    rather than the values. Dropping either key would silently send the
    publish pipeline back to its liveness-only behaviour.
    """
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "healthy"
    assert "db_version" in body
    assert "commit" in body


def test_deploy_markers_read_the_restore_version_file(tmp_path, monkeypatch):
    """`db_version` comes from .restore_version beside the content DB.

    The Railway start command writes that file only after `litestream restore`
    succeeds (railway.toml), which is what makes it proof that this instance
    restored the snapshot rather than merely that a container started.
    """
    import main

    # Trailing newline on purpose: the start command writes it with `echo`,
    # so the reader has to strip it.
    (tmp_path / ".restore_version").write_text(
        "20261012-161328\n", encoding="utf-8")
    monkeypatch.setattr(
        main.settings, "database_url", f"sqlite:///{tmp_path / 'content.db'}"
    )
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "d712e66abcdef123")

    markers = main._read_deploy_markers()
    assert markers["db_version"] == "20261012-161328"
    assert markers["commit"] == "d712e66"   # shortened


def test_deploy_markers_tolerate_a_missing_file(tmp_path, monkeypatch):
    """Local dev and a first-ever deploy have no marker file; neither is an error."""
    import main

    monkeypatch.setattr(
        main.settings, "database_url", f"sqlite:///{tmp_path / 'content.db'}"
    )
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)

    markers = main._read_deploy_markers()
    assert markers == {"commit": None, "db_version": None}


def test_health_db_endpoint(client):
    r = client.get("/health/db")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health_ai_unreachable_provider(client, monkeypatch):
    """/health/ai reports an unreachable provider as a 200 with status "error".

    The provider is stubbed. This test used to make a real call to whatever
    AI_PROVIDER pointed at, which on this dev box meant every `pytest` run
    pulled llama3.1:8b (5 GB) into an 8 GB card that is also driving the
    desktop, and waited out a cold model load -- 71s observed for this test
    alone, ~9 min for the suite. A test suite has no business touching the
    GPU.

    Stubbing also makes it deterministic. The outcome used to depend on
    whether Ollama happened to be running: "ok" on the dev box, "error" on CI,
    so the assertion had to accept either and proved little. Now the failing
    path is the one under test, and it is asserted exactly.
    """
    import app.services.ai_provider as ai

    class Unreachable:
        def complete(self, system_prompt: str, user_prompt: str) -> str:
            raise ConnectionError("connection refused")

    monkeypatch.setattr(ai, "get_ai_provider", lambda: Unreachable())

    r = client.get("/health/ai")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "error"
    assert body["provider"] == "Unreachable"
    assert "refused" in body["reason"]


def test_health_ai_reports_ok_when_provider_answers(client, monkeypatch):
    """The success path, which nothing covered before."""
    import app.services.ai_provider as ai

    class Fine:
        def complete(self, system_prompt: str, user_prompt: str) -> str:
            return "OK"

    monkeypatch.setattr(ai, "get_ai_provider", lambda: Fine())

    r = client.get("/health/ai")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "provider": "Fine"}


# ---------------------------------------------------------------------------
# Legislation routes
# ---------------------------------------------------------------------------

def test_search_legislation_empty_query(client):
    """An empty q is a browse-everything request, not a validation error."""
    r = client.get("/api/legislation/search?q=")
    assert r.status_code == 200
    assert "results" in r.json()


def test_search_legislation_too_long(client):
    r = client.get(f"/api/legislation/search?q={'x' * 201}")
    assert r.status_code == 422


def test_search_legislation_valid(client):
    r = client.get("/api/legislation/search?q=healthcare")
    assert r.status_code == 200
    data = r.json()
    assert "total" in data
    assert "results" in data


def test_search_legislation_pagination_params(client):
    r = client.get("/api/legislation/search?q=test&limit=5&offset=0")
    assert r.status_code == 200
    assert r.json()["limit"] == 5


def test_legislation_detail_round_trip(client, test_db):
    """A seeded bill is retrievable through the public detail route."""
    make_legislation(test_db, "42")
    test_db.commit()
    r = client.get("/api/legislation/bill_42")
    assert r.status_code == 200
    assert r.json()["data"]["bill_number"] == "HR42"


def test_legislation_detail_not_found(client):
    r = client.get("/api/legislation/does_not_exist")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Protected routes
#
# These used to assert on validation errors (400/422) and were written before
# the ingest endpoints required a developer-tier account. Auth is resolved
# first now, so an unauthenticated caller never reaches the validation — which
# makes "is this endpoint actually protected?" the thing worth asserting.
# ---------------------------------------------------------------------------

def test_ingest_state_requires_auth(client):
    r = client.post("/api/legislation/ingest/state/ZZ")
    assert r.status_code in (401, 403)


def test_ingest_federal_requires_auth(client):
    r = client.post("/api/legislation/ingest/federal?congress=50")
    assert r.status_code in (401, 403)


def test_export_is_never_edge_cached(client):
    """The export can return the caller's own saved bills, so it must not be
    storable by a shared cache. See the allow-list in main.py."""
    r = client.get("/api/legislation/export?format=csv")
    assert "no-store" in r.headers.get("cache-control", "").lower()


def test_public_read_is_edge_cacheable(client):
    """Public reads carry the s-maxage that lets Cloudflare cache them."""
    r = client.get("/api/councilmembers")
    assert r.status_code == 200
    assert "s-maxage" in r.headers.get("cache-control", "").lower()


def test_credentialed_read_is_not_cacheable(client):
    """A request carrying credentials must not get a public cache header, or a
    shared cache could serve one caller's response to another."""
    r = client.get("/api/councilmembers", headers={"Authorization": "Bearer faketoken"})
    assert "s-maxage" not in r.headers.get("cache-control", "").lower()


def test_bot_token_read_is_not_cacheable(client):
    """require_bot_token reads X-Bot-Token, not Authorization — missing that
    once made a protected response publicly cacheable."""
    r = client.get("/api/councilmembers", headers={"X-Bot-Token": "faketoken"})
    assert "s-maxage" not in r.headers.get("cache-control", "").lower()


# ---------------------------------------------------------------------------
# Rate-limit identity
#
# These guard a bug that is invisible in development and total in production:
# every browser call reaches the backend through Vercel's /api/* rewrite, so
# `request.client.host` is the proxy for every visitor alike and the whole site
# shared one 30/minute bucket on /search. The fix is only a key function, so
# nothing fails loudly if it regresses -- hence tests.
# ---------------------------------------------------------------------------

def _fake_request(headers, peer="10.0.0.1"):
    class _Client:
        host = peer

    class _Request:
        def __init__(self):
            self.headers = headers
            self.client = _Client()

    return _Request()


def test_rate_limit_key_prefers_original_client():
    """The leftmost X-Forwarded-For entry is the visitor; the rest are hops."""
    from app.rate_limit import client_identifier
    req = _fake_request({"x-forwarded-for": "203.0.113.7, 198.51.100.2, 172.16.0.1"})
    assert client_identifier(req) == "203.0.113.7"


def test_rate_limit_key_distinguishes_two_visitors_behind_one_proxy():
    """The actual regression: same peer, different visitors, different keys."""
    from app.rate_limit import client_identifier
    peer = "76.76.21.21"  # stands in for the Vercel edge
    a = _fake_request({"x-forwarded-for": "203.0.113.7"}, peer=peer)
    b = _fake_request({"x-forwarded-for": "203.0.113.8"}, peer=peer)
    assert client_identifier(a) != client_identifier(b)


def test_rate_limit_key_uses_vercel_header_on_the_browser_path():
    """Header shapes as measured in prod: XFF leftmost is Vercel's egress."""
    from app.rate_limit import client_identifier
    req = _fake_request({
        "x-forwarded-for": "54.147.34.52, 152.233.47.67",
        "x-real-ip": "54.147.34.52",
        "x-vercel-forwarded-for": "203.0.113.7",
    }, peer="100.64.0.5")
    assert client_identifier(req) == "203.0.113.7"


def test_rate_limit_key_uses_cloudflare_header_on_the_api_subdomain():
    """XFF leftmost is a Cloudflare edge, which changes between requests."""
    from app.rate_limit import client_identifier
    req = _fake_request({
        "x-forwarded-for": "104.22.195.24, 152.233.47.68",
        "cf-connecting-ip": "203.0.113.7",
    }, peer="100.64.0.6")
    assert client_identifier(req) == "203.0.113.7"


def test_rate_limit_key_falls_back_to_peer():
    """No forwarding header -- local dev, or a direct call to Railway."""
    from app.rate_limit import client_identifier
    assert client_identifier(_fake_request({})) == "10.0.0.1"
    # Present but useless headers must not win over the peer.
    assert client_identifier(_fake_request({"x-forwarded-for": " , ,"})) == "10.0.0.1"


# ---------------------------------------------------------------------------
# Search query sanitising
#
# FTS5's query language treats punctuation as syntax, so an unsanitised search
# box is a 500 generator. Each input below raised OperationalError when passed
# to MATCH directly, and each is something a real visitor would type -- a
# councilmember's name, a bill number, a code section.
# ---------------------------------------------------------------------------

import pytest


@pytest.mark.parametrize("raw", [
    "O'Neill",          # fts5: syntax error near "'"
    "260330-A",         # no such column: A
    "14-1000",          # no such column: 1000
    '"unclosed',        # unterminated string
    "a:b",              # no such column: a
    "speed AND",        # syntax error near ""
    "NEAR(",
    "-foo",
    "tax*",
    '" OR 1=1 --',
])
def test_fts_match_never_emits_invalid_syntax(raw):
    """The sanitised expression must be executable against a real fts5 table."""
    import sqlite3
    from app.services.legislation_service import _fts_match

    expr = _fts_match(raw)
    assert expr is not None, raw

    con = sqlite3.connect(":memory:")
    con.execute("CREATE VIRTUAL TABLE t USING fts5(a, tokenize='porter unicode61')")
    con.execute("INSERT INTO t(a) VALUES ('nothing to see here')")
    # The assertion is that this does not raise.
    con.execute("SELECT count(*) FROM t WHERE t MATCH ?", (expr,)).fetchone()


@pytest.mark.parametrize("raw", ["", "   ", "!!!", "---", None])
def test_fts_match_returns_none_for_empty_input(raw):
    """No usable tokens means no text filter, not 'match nothing'."""
    from app.services.legislation_service import _fts_match
    assert _fts_match(raw) is None


def test_fts_match_builds_prefix_and_terms():
    from app.services.legislation_service import _fts_match
    assert _fts_match("speed camera") == '"speed" AND "camera"*'
    # A hyphenated bill number splits into its parts, which is how fts5
    # tokenised it on the way in, so both halves still match the row.
    assert _fts_match("251022-A") == '"251022" AND "A"*'


def test_fts_match_caps_term_count():
    """A pasted wall of text must not build an unbounded query tree."""
    from app.services.legislation_service import _fts_match
    expr = _fts_match(" ".join(f"word{i}" for i in range(50)))
    assert expr.count(" AND ") == 11  # 12 terms


# ---------------------------------------------------------------------------
# Faceted filters
#
# These exist because /facets shipped broken. A refactor deleted
# _filter_legislation outright and every test still passed, because nothing
# here called the endpoint. It 500'd in production until someone looked at it
# by hand. A smoke test over each query shape is enough to catch that class of
# mistake, which is a missing name rather than a wrong number.
# ---------------------------------------------------------------------------

def test_facets_returns_every_dimension(client, test_db):
    make_legislation(test_db, "facet1")
    test_db.commit()

    r = client.get("/api/legislation/facets?level=federal&analyzed=")
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("statuses", "sponsors", "tags", "categories"):
        assert key in body, f"{key} missing from facets response"
        assert isinstance(body[key], list)


def test_facets_accepts_the_lapsed_filter(client, test_db):
    """The died-without-a-vote filter has to narrow facets, not be ignored."""
    make_legislation(test_db, "facet2")
    test_db.commit()

    r = client.get("/api/legislation/facets?level=federal&analyzed=&lapsed_without_vote=true")
    assert r.status_code == 200, r.text
    # Nothing in the fixture is lapsed, so the filter should empty the counts
    # rather than quietly returning the unfiltered corpus.
    assert all(row["count"] == 0 for row in r.json()["statuses"]) or r.json()["statuses"] == []


def test_search_accepts_the_lapsed_filter(client, test_db):
    make_legislation(test_db, "facet3")
    test_db.commit()

    r = client.get("/api/legislation/search?level=federal&limit=1&analyzed=&lapsed_without_vote=true")
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0


def test_lapsed_without_vote_insight_endpoint(client):
    r = client.get("/api/insights/lapsed-without-vote?limit=1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "totals" in body and "by_term" in body
    assert "who_and_where" in body


def test_subject_output_insight_endpoint(client):
    r = client.get("/api/insights/subject-output")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "by_category" in body and "by_tag" in body
