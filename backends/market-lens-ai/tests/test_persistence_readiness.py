from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from web.app.routers.health_routes import (
    configure_analysis_worker_readiness,
    configure_repository_readiness,
    router,
)


def _configure_inline_worker() -> None:
    configure_analysis_worker_readiness(
        lambda: {"mode": "inline", "required": False, "ready": True}
    )


def test_health_fails_closed_when_managed_persistence_is_unavailable():
    app = FastAPI()
    app.include_router(router)
    try:
        _configure_inline_worker()
        configure_repository_readiness(lambda: False)
        response = TestClient(app).get("/api/health")

        assert response.status_code == 503
        assert response.json()["ok"] is False
        assert response.json()["persistence"] == "unavailable"
    finally:
        configure_repository_readiness(lambda: True)


def test_health_exposes_deployment_sha_without_secret_configuration(monkeypatch):
    monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", "a" * 40)
    app = FastAPI()
    app.include_router(router)
    _configure_inline_worker()
    configure_repository_readiness(lambda: True)

    response = TestClient(app).get("/api/health")

    assert response.status_code == 200
    assert response.json()["deployment_sha"] == "a" * 40
    assert response.json()["commit"] == "a" * 40
