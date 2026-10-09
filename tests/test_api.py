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


def test_health_db_endpoint(client):
    r = client.get("/health/db")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health_ai_no_key(client, monkeypatch):
    """/health/ai always makes a live call to the configured provider (see
    main.py) and reports ok or error -- there is no third "warning" outcome in
    the route, and the provider it calls is AI_PROVIDER (ollama by default),
    not anthropic_api_key, so patching that setting does not change what this
    exercises. This asserts the one thing that is actually true regardless of
    environment: the endpoint always returns 200 with a real status, even when
    no provider is reachable (as on a CI runner, which has no AI provider at
    all -- that is an "error" outcome, not a test failure)."""
    r = client.get("/health/ai")
    assert r.status_code == 200
    assert r.json()["status"] in ("ok", "error")


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
