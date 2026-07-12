"""Persistent analysis-worker liveness and operator evidence contracts."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from web.app.auth import verify_admin_or_integration
from web.app.jobs.analysis_backend import (
    AnalysisJobStatus,
    JobBackendMode,
    JobBackendSettings,
    PostgresAnalysisJobBackend,
    WorkflowAnalysisJobBackend,
)
from web.app.jobs.analysis_worker import AnalysisWorker, WorkerRuntime
from web.app.routers.admin_routes import create_admin_router
from web.app.routers.health_routes import (
    configure_analysis_worker_readiness,
    configure_repository_readiness,
    router as health_router,
)
from web.app.tenant_schema import analysis_worker_heartbeats, metadata


@pytest.fixture()
def worker_backend():
    engine = sa.create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return PostgresAnalysisJobBackend(factory), factory


def test_worker_readiness_requires_a_fresh_ready_or_busy_process(worker_backend):
    backend, factory = worker_backend

    assert backend.readiness() is False
    assert backend.worker_readiness_snapshot() == {
        "mode": "worker",
        "required": True,
        "ready": False,
        "freshness_seconds": 60,
        "fresh_workers": 0,
        "stale_workers": 0,
        "stopped_workers": 0,
        "starting_workers": 0,
        "latest_heartbeat_at": None,
        "latest_successful_job_at": None,
    }

    backend.register_worker("wrk_a", deployment_sha="a" * 40)
    starting = backend.worker_readiness_snapshot()
    assert starting["ready"] is False
    assert starting["starting_workers"] == 1

    assert backend.heartbeat_worker("wrk_a", state="ready", active_jobs=0)
    assert backend.readiness() is True
    assert backend.heartbeat_worker("wrk_a", state="busy", active_jobs=2)
    assert backend.worker_readiness_snapshot()["fresh_workers"] == 1

    expired = datetime.now(timezone.utc) - timedelta(seconds=1)
    with factory() as session, session.begin():
        session.execute(
            sa.update(analysis_worker_heartbeats)
            .where(analysis_worker_heartbeats.c.worker_id == "wrk_a")
            .values(expires_at=expired)
        )

    stale = backend.worker_readiness_snapshot(include_workers=True)
    assert stale["ready"] is False
    assert stale["stale_workers"] == 1
    assert stale["workers"][0]["state"] == "stale"
    assert backend.readiness() is False


def test_multiple_workers_stop_and_canary_completion_are_durable(worker_backend):
    backend, _factory = worker_backend
    backend.register_worker("wrk_a", deployment_sha="b" * 40)
    backend.register_worker("wrk_b", deployment_sha="c" * 40)
    assert backend.heartbeat_worker("wrk_a", state="busy", active_jobs=1)
    assert backend.heartbeat_worker("wrk_b", state="ready", active_jobs=0)
    assert backend.record_worker_job_result(
        "wrk_a",
        "canary123",
        AnalysisJobStatus.succeeded,
    )

    public = backend.worker_readiness_snapshot()
    assert public["ready"] is True
    assert public["fresh_workers"] == 2
    assert public["latest_successful_job_at"]
    assert "workers" not in public
    assert "last_job_id" not in public

    operator = backend.worker_readiness_snapshot(include_workers=True)
    evidence = {row["worker_id"]: row for row in operator["workers"]}
    assert evidence["wrk_a"]["processed_jobs"] == 1
    assert evidence["wrk_a"]["last_job_id"] == "canary123"
    assert evidence["wrk_a"]["last_job_status"] == "succeeded"
    assert evidence["wrk_a"]["deployment_sha"] == "b" * 40

    assert backend.mark_worker_stopped("wrk_a")
    stopped = backend.worker_readiness_snapshot(include_workers=True)
    assert stopped["fresh_workers"] == 1
    assert stopped["stopped_workers"] == 1
    assert {row["worker_id"]: row["state"] for row in stopped["workers"]}[
        "wrk_a"
    ] == "stopped"


def test_worker_registry_rejects_identifying_or_unsafe_values(worker_backend):
    backend, _factory = worker_backend
    with pytest.raises(ValueError, match="opaque identifier"):
        backend.register_worker("host name/process")

    backend.register_worker("wrk_safe", deployment_sha="not-a-commit-or-secret")
    details = backend.worker_readiness_snapshot(include_workers=True)
    assert details["workers"][0]["deployment_sha"] is None

    with pytest.raises(ValueError, match="ready worker"):
        backend.heartbeat_worker("wrk_safe", state="ready", active_jobs=1)
    with pytest.raises(ValueError, match="terminal"):
        backend.record_worker_job_result("wrk_safe", "job", "running")
    with pytest.raises(ValueError, match="Job evidence id"):
        backend.record_worker_job_result("wrk_safe", "unsafe job/id", "succeeded")


def test_workflow_mode_does_not_require_a_python_worker_heartbeat(worker_backend):
    _worker_backend, factory = worker_backend
    backend = WorkflowAnalysisJobBackend(
        factory,
        settings=JobBackendSettings(
            mode=JobBackendMode.workflow,
            workflow_endpoint="https://example.invalid/workflow",
            workflow_token="test-only-token",
        ),
    )

    assert backend.readiness() is True
    snapshot = backend.worker_readiness_snapshot()
    assert snapshot["required"] is False
    assert snapshot["ready"] is True


@pytest.mark.asyncio
async def test_worker_loop_registers_idle_heartbeat_and_marks_stopped(worker_backend):
    backend, _factory = worker_backend
    worker = AnalysisWorker(
        backend,
        {},
        runtime=WorkerRuntime(worker_id="wrk_loop"),
    )

    task = asyncio.create_task(worker.run_forever(poll_interval_seconds=0.01))
    for _attempt in range(50):
        await asyncio.sleep(0.01)
        if backend.worker_readiness_snapshot()["ready"]:
            break
    assert backend.worker_readiness_snapshot()["ready"] is True

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    stopped = backend.worker_readiness_snapshot(include_workers=True)
    assert stopped["ready"] is False
    assert stopped["workers"][0]["state"] == "stopped"


def test_public_health_fails_closed_without_leaking_per_worker_evidence():
    app = FastAPI()
    app.include_router(health_router)
    configure_repository_readiness(lambda: True)
    configure_analysis_worker_readiness(
        lambda: {
            "mode": "worker",
            "required": True,
            "ready": False,
            "freshness_seconds": 60,
            "fresh_workers": 0,
            "stale_workers": 1,
            "stopped_workers": 0,
            "starting_workers": 0,
            "latest_heartbeat_at": "2026-07-12T00:00:00Z",
            "latest_successful_job_at": None,
            "workers": [{"worker_id": "must-not-be-public"}],
            "last_job_id": "must-not-be-public",
        }
    )
    try:
        response = TestClient(app).get("/api/health")
        assert response.status_code == 503
        payload = response.json()
        assert payload["persistence"] == "ready"
        assert payload["analysis_worker"]["required"] is True
        assert payload["analysis_worker"]["ready"] is False
        assert "workers" not in payload["analysis_worker"]
        assert "last_job_id" not in payload["analysis_worker"]
    finally:
        configure_repository_readiness(lambda: True)
        configure_analysis_worker_readiness(
            lambda: {"mode": "inline", "required": False, "ready": True}
        )


def test_operator_endpoint_exposes_secret_free_canary_evidence(worker_backend):
    backend, _factory = worker_backend
    backend.register_worker("wrk_operator", deployment_sha="d" * 40)
    backend.heartbeat_worker("wrk_operator", state="ready", active_jobs=0)
    backend.record_worker_job_result("wrk_operator", "operator-canary", "succeeded")

    app = FastAPI()
    app.include_router(create_admin_router(analysis_job_backend=backend))
    app.dependency_overrides[verify_admin_or_integration] = lambda: "platform_admin"

    response = TestClient(app).get("/api/admin/worker-readiness")
    assert response.status_code == 200
    payload = response.json()
    assert payload["ready"] is True
    assert payload["workers"][0]["worker_id"] == "wrk_operator"
    assert payload["workers"][0]["last_job_id"] == "operator-canary"
    assert payload["workers"][0]["last_job_status"] == "succeeded"
