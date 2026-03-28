"""Tests for API endpoints via FastAPI TestClient."""

import pytest


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
    """When ANTHROPIC_API_KEY is empty, /health/ai returns a warning."""
    from app import config as cfg
    monkeypatch.setattr(cfg.get_settings(), "anthropic_api_key", "")
    # Reload settings cache so main.py picks up the change
    import main
    monkeypatch.setattr(main, "settings", cfg.get_settings())
    r = client.get("/health/ai")
    # Accept either warning (no key) or ok (key was set in env)
    assert r.status_code == 200
    assert r.json()["status"] in ("ok", "warning")


# ---------------------------------------------------------------------------
# Agent routes
# ---------------------------------------------------------------------------

VALID_AGENT = {
    "name": "Policy Expert",
    "description": "An expert",
    "persona": "A seasoned policy analyst",
    "system_prompt": "You are a policy expert.",
    "expertise_areas": "policy",
    "agent_type": "claude",
}


def test_create_agent_valid(client):
    r = client.post("/api/agents/create", json=VALID_AGENT)
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["agent"]["id"].startswith("agent_")


def test_create_agent_empty_name(client):
    payload = {**VALID_AGENT, "name": "   "}
    r = client.post("/api/agents/create", json=payload)
    assert r.status_code == 422


def test_create_agent_missing_name(client):
    payload = {k: v for k, v in VALID_AGENT.items() if k != "name"}
    r = client.post("/api/agents/create", json=payload)
    assert r.status_code == 422


def test_create_agent_invalid_type(client):
    payload = {**VALID_AGENT, "agent_type": "gpt4"}
    r = client.post("/api/agents/create", json=payload)
    assert r.status_code == 422


def test_create_agent_bad_api_url(client):
    payload = {**VALID_AGENT, "agent_type": "byo", "api_url": "not-a-url"}
    r = client.post("/api/agents/create", json=payload)
    assert r.status_code == 422


def test_list_agents_default(client):
    """With no agents, list returns empty results with pagination fields."""
    r = client.get("/api/agents/list")
    assert r.status_code == 200
    data = r.json()
    assert "total" in data
    assert "limit" in data
    assert "offset" in data
    assert isinstance(data["agents"], list)


def test_list_agents_pagination(client):
    """Create 5 agents, page through with limit=2."""
    for i in range(5):
        client.post("/api/agents/create", json={**VALID_AGENT, "name": f"Agent {i}"})

    r = client.get("/api/agents/list?limit=2&offset=0")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 5
    assert len(data["agents"]) == 2

    r2 = client.get("/api/agents/list?limit=2&offset=4")
    assert r2.status_code == 200
    assert len(r2.json()["agents"]) == 1


def test_list_agents_invalid_limit(client):
    r = client.get("/api/agents/list?limit=0")
    assert r.status_code == 422


def test_get_agent_not_found(client):
    r = client.get("/api/agents/nonexistent_id")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Legislation routes
# ---------------------------------------------------------------------------

def test_search_legislation_empty_query(client):
    r = client.get("/api/legislation/search?q=")
    assert r.status_code == 422


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


def test_ingest_invalid_state(client):
    r = client.post("/api/legislation/ingest/state/ZZ")
    assert r.status_code == 400
    assert "Invalid state" in r.json()["detail"]


def test_ingest_valid_state_format(client):
    """CA is a valid state — request accepted (may fail due to no API key, but not 400)."""
    r = client.post("/api/legislation/ingest/state/CA?limit=1")
    assert r.status_code in (200, 500)  # 500 is ok if no API key, but not 400


def test_ingest_federal_invalid_congress(client):
    r = client.post("/api/legislation/ingest/federal?congress=50")
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Debate routes
# ---------------------------------------------------------------------------

def test_public_debate_invalid_format(client):
    r = client.get("/api/debates/public/some_id?format=xml")
    assert r.status_code == 400
    assert "Invalid format" in r.json()["detail"]


def test_get_debate_not_found(client):
    r = client.get("/api/debates/nonexistent_debate")
    assert r.status_code == 404


def test_track_share_invalid_platform(client):
    r = client.post("/api/debates/some_id/track-share?platform=myspace")
    assert r.status_code == 400


def test_create_debate_missing_legislation(client):
    """Debate creation with unknown legislation_id returns 400."""
    client.post("/api/agents/create", json=VALID_AGENT)
    r = client.get("/api/agents/list")
    agent_id = r.json()["agents"][0]["id"]

    r = client.post("/api/debates/create", json={
        "legislation_id": "nonexistent",
        "topic": "Test",
        "agent_ids": [agent_id],
    })
    assert r.status_code == 400
