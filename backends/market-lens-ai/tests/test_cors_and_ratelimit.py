"""Tests for Fix-1 (CORS headers) and Fix-2 (rate limit on DELETE/PATCH)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from web.app.main import app, _rate_store


@pytest.fixture
def client():
    _rate_store.clear()
    return TestClient(app)


# ---------------------------------------------------------------------------
# Fix-1: CORS — PATCH method + Authorization / X-API-Key headers allowed
# ---------------------------------------------------------------------------

class TestCORSHeaders:
    """Verify that CORS preflight allows PATCH, Authorization, and X-API-Key."""

    def _preflight(self, client, method: str, headers: str) -> dict:
        """Send an OPTIONS preflight request and return response."""
        return client.options(
            "/api/watchlists/test123",
            headers={
                "Origin": "http://localhost:3001",
                "Access-Control-Request-Method": method,
                "Access-Control-Request-Headers": headers,
            },
        )

    def test_cors_allows_patch_method(self, client):
        resp = self._preflight(client, "PATCH", "Content-Type")
        assert resp.status_code == 200
        allowed = resp.headers.get("access-control-allow-methods", "")
        assert "PATCH" in allowed

    def test_cors_allows_authorization_header(self, client):
        resp = self._preflight(client, "POST", "Content-Type,Authorization")
        assert resp.status_code == 200
        allowed = resp.headers.get("access-control-allow-headers", "")
        assert "Authorization" in allowed or "authorization" in allowed.lower()

    def test_cors_allows_x_api_key_header(self, client):
        resp = self._preflight(client, "POST", "Content-Type,X-API-Key")
        assert resp.status_code == 200
        allowed = resp.headers.get("access-control-allow-headers", "")
        assert "X-API-Key" in allowed or "x-api-key" in allowed.lower()

    def test_cors_allows_delete_method(self, client):
        resp = self._preflight(client, "DELETE", "Content-Type")
        assert resp.status_code == 200
        allowed = resp.headers.get("access-control-allow-methods", "")
        assert "DELETE" in allowed


# ---------------------------------------------------------------------------
# Fix-2: Rate limit applies to DELETE and PATCH, not just POST
# ---------------------------------------------------------------------------

class TestRateLimitDeletePatch:
    """Verify rate limiting applies to DELETE and PATCH methods."""

    def _exhaust_rate_limit(self, client, method: str, path: str):
        """Send requests until rate limit is exhausted, return last response."""
        from web.app.main import _rate_max
        for i in range(_rate_max):
            if method == "DELETE":
                resp = client.delete(path)
            elif method == "PATCH":
                resp = client.patch(path, json={})
            else:
                resp = client.post(path, json={})
        # One more request should be rate limited
        if method == "DELETE":
            return client.delete(path)
        elif method == "PATCH":
            return client.patch(path, json={})
        return client.post(path, json={})

    def test_delete_rate_limited(self, client):
        resp = self._exhaust_rate_limit(client, "DELETE", "/api/watchlists/test123")
        assert resp.status_code == 429

    def test_patch_rate_limited(self, client):
        resp = self._exhaust_rate_limit(client, "PATCH", "/api/watchlists/test123")
        assert resp.status_code == 429

    def test_post_still_rate_limited(self, client):
        """Regression: POST should still be rate limited after the change."""
        resp = self._exhaust_rate_limit(client, "POST", "/api/watchlists")
        assert resp.status_code == 429


# ---------------------------------------------------------------------------
# Fix-4: Watchlist global limit
# ---------------------------------------------------------------------------

class TestWatchlistGlobalLimit:
    """Verify global watchlist cap (100) across all projects."""

    def test_global_limit_409(self, client, monkeypatch):
        """When global limit is reached, new creation returns 409."""
        from web.app.routers import watchlist_routes
        monkeypatch.setattr(watchlist_routes, "_MAX_WATCHLISTS_GLOBAL", 2)

        # Create 2 watchlists in different projects
        r1 = client.post("/api/watchlists", json={"name": "W1", "project_id": "pA"})
        assert r1.status_code == 200
        r2 = client.post("/api/watchlists", json={"name": "W2", "project_id": "pB"})
        assert r2.status_code == 200

        # Third should hit global limit even with a new project_id
        r3 = client.post("/api/watchlists", json={"name": "W3", "project_id": "pC"})
        assert r3.status_code == 409
        assert "Global" in r3.json()["detail"]
