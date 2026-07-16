"""Public failure envelope, cache, and hostile-origin regression tests."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import httpx
import pytest


os.environ.setdefault("APP_PASSWORD", "test-secret-pw-42")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx")
os.environ.setdefault("DATA_PROVIDER", "mock")

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.api_errors import normalize_legacy_failure
from web.app import backend_api as api
from web.app.backend_api import app
from web.app.platform_db import reset_platform_engine_for_tests


def test_legacy_failure_discards_provider_and_path_details():
    result = normalize_legacy_failure(
        {
            "ok": False,
            "error": "query_error",
            "message": "SELECT secret FROM x; C:\\private\\key.json API key=abc",
        },
        500,
    )

    assert result["error"]["code"] == "query_error"
    serialized = str(result)
    assert "SELECT" not in serialized
    assert "private" not in serialized
    assert "abc" not in serialized


@pytest.mark.anyio
async def test_unauthenticated_response_uses_canonical_envelope():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/cases")

    assert response.status_code == 401
    problem = response.json()["error"]
    assert problem["code"] == "authentication_required"
    assert problem["category"] == "authentication"
    assert problem["retryable"] is False
    assert problem["request_id"] == response.headers["x-request-id"]
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.anyio
async def test_hostile_vercel_origin_is_not_reflected():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.options(
            "/api/cases",
            headers={
                "Origin": "https://insight-studio-evil.vercel.app",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.headers.get("access-control-allow-origin") is None


@pytest.mark.anyio
async def test_auth_response_is_private_no_store():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post("/api/auth/login", json={"password": "wrong"})

    assert response.status_code == 401
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.anyio
async def test_readiness_fails_closed_without_managed_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    reset_platform_engine_for_tests()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/platform/readiness")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"


@pytest.mark.anyio
async def test_local_liveness_is_separate_from_platform_readiness(monkeypatch):
    monkeypatch.setattr(api, "_IS_PRODUCTION", False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    reset_platform_engine_for_tests()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        health = await client.get("/api/ads/health")
        readiness = await client.get("/api/platform/readiness")

    assert health.status_code == 200
    assert health.json()["ok"] is True
    assert health.json()["status"] == "healthy"
    assert readiness.status_code == 503
    assert readiness.json()["error"]["code"] == "database_unavailable"


@pytest.mark.anyio
async def test_production_health_stays_fail_closed_without_managed_database(monkeypatch):
    monkeypatch.setattr(api, "_IS_PRODUCTION", True)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    reset_platform_engine_for_tests()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        health = await client.get("/api/ads/health")

    assert health.status_code == 503
    assert health.json()["ok"] is False
    assert health.json()["persistence"] == "unavailable"
