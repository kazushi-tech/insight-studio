"""Paid-pilot authorization boundary for Market Lens."""

from __future__ import annotations

import logging
import time

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from web.app.auth import verify_admin_or_integration
from web.app.repositories.file_asset_repository import FileAssetRepository
from web.app.routers.creative_asset_routes import create_asset_router


JWT_SECRET = "unit-test-shared-jwt-secret-at-least-32-bytes"


@pytest.fixture(autouse=True)
def isolated_auth_environment(monkeypatch):
    import web.app.auth as auth_module

    original_keys = set(auth_module.API_KEYS)
    auth_module.API_KEYS.clear()
    for name in (
        "API_KEYS",
        "INTEGRATION_API_KEYS",
        "JWT_SECRET",
        "VERCEL",
        "RENDER",
        "RENDER_SERVICE_ID",
        "RENDER_EXTERNAL_URL",
        "APP_ENV",
        "ENVIRONMENT",
        "ENV",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("ALLOW_INSECURE_DEV_AUTH", "false")
    yield
    auth_module.API_KEYS.clear()
    auth_module.API_KEYS.update(original_keys)


def _admin_token(secret: str = JWT_SECRET) -> str:
    return jwt.encode(
        {
            "typ": "auth",
            "role": "admin",
            "exp": int(time.time()) + 300,
        },
        secret,
        algorithm="HS256",
    )


def _case_user_token(secret: str = JWT_SECRET) -> str:
    return jwt.encode(
        {
            "typ": "auth",
            "role": "case_user",
            "case_id": "petasite",
            "dataset_id": "analytics_123",
            "exp": int(time.time()) + 300,
        },
        secret,
        algorithm="HS256",
    )


def _protected_client() -> TestClient:
    app = FastAPI()

    @app.get("/api/health")
    async def health():
        return {"ok": True}

    @app.get(
        "/api/protected",
        dependencies=[Depends(verify_admin_or_integration)],
    )
    async def protected():
        return {"ok": True}

    return TestClient(app)


def test_ads_admin_jwt_is_allowed(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", JWT_SECRET)
    response = _protected_client().get(
        "/api/protected",
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )
    assert response.status_code == 200


def test_case_user_jwt_is_forbidden(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", JWT_SECRET)
    response = _protected_client().get(
        "/api/protected",
        headers={"Authorization": f"Bearer {_case_user_token()}"},
    )
    assert response.status_code == 403
    assert "Administrator access" in response.json()["detail"]


def test_configured_integration_api_key_is_allowed(monkeypatch):
    monkeypatch.setenv("INTEGRATION_API_KEYS", "pilot-integration-key")
    response = _protected_client().get(
        "/api/protected",
        headers={"X-API-Key": "pilot-integration-key"},
    )
    assert response.status_code == 200


@pytest.mark.parametrize("compromised_key", ["test_key_123", "prod_key_456"])
def test_previously_committed_integration_keys_are_never_accepted(
    monkeypatch,
    compromised_key,
):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv(
        "INTEGRATION_API_KEYS",
        f"pilot-integration-key,{compromised_key}",
    )
    client = _protected_client()

    assert client.get(
        "/api/protected",
        headers={"X-API-Key": compromised_key},
    ).status_code == 401
    assert client.get(
        "/api/protected",
        headers={"X-API-Key": "pilot-integration-key"},
    ).status_code == 200


@pytest.mark.parametrize("platform_marker", ["RENDER", "VERCEL"])
def test_managed_deploy_without_auth_configuration_fails_closed(
    monkeypatch,
    platform_marker,
):
    monkeypatch.setenv(platform_marker, "true")
    # Even an accidental dev override must never open a managed deployment.
    monkeypatch.setenv("ALLOW_INSECURE_DEV_AUTH", "true")
    client = _protected_client()

    response = client.get("/api/protected")
    assert response.status_code == 503
    assert client.get("/api/health").status_code == 200


def test_invalid_credential_is_never_logged_or_echoed(monkeypatch, caplog):
    monkeypatch.setenv("JWT_SECRET", JWT_SECRET)
    supplied_secret = "customer-secret-that-must-not-appear"

    with caplog.at_level(logging.DEBUG):
        response = _protected_client().get(
            "/api/protected",
            headers={"Authorization": f"Bearer {supplied_secret}"},
        )

    assert response.status_code == 401
    assert supplied_secret not in response.text
    assert supplied_secret not in caplog.text


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/assets"),
        ("get", "/api/assets/000000000000"),
        ("get", "/api/assets/000000000000/download"),
        ("delete", "/api/assets/000000000000"),
    ],
)
def test_every_creative_asset_operation_requires_auth(
    monkeypatch,
    tmp_path,
    method,
    path,
):
    monkeypatch.setenv("JWT_SECRET", JWT_SECRET)
    app = FastAPI()
    app.include_router(
        create_asset_router(FileAssetRepository(base_dir=tmp_path / "assets"))
    )
    response = getattr(TestClient(app), method)(path)
    assert response.status_code == 401


def test_all_data_bearing_market_lens_routes_have_the_paid_pilot_gate():
    from web.app.main import app

    protected_prefixes = (
        "/api/scan",
        "/api/scans",
        "/api/assets",
        "/api/reviews",
        "/api/discovery",
        "/api/generation",
        "/api/watchlists",
        "/api/jobs",
        "/api/delivery",
        "/api/admin",
        "/api/integrations",
        "/api/exports",
        "/api/usage",
    )
    protected_routes = [
        route
        for route in app.routes
        if isinstance(route, APIRoute)
        and route.path.startswith(protected_prefixes)
    ]

    assert protected_routes
    for route in protected_routes:
        dependency_calls = {dependency.call for dependency in route.dependant.dependencies}
        assert verify_admin_or_integration in dependency_calls, route.path
