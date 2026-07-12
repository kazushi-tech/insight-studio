"""M-114 durable worker fallback contracts."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from web.app.auth import get_verified_owner_id, verify_admin_or_integration
from web.app.jobs.analysis_backend import (
    AnalysisJob,
    AnalysisJobStatus,
    AnalysisJobType,
    JobBackendConfigurationError,
    JobBackendMode,
    JobBackendSettings,
    MAX_ATTEMPTS,
    PostgresAnalysisJobBackend,
)
from web.app.jobs.analysis_worker import AnalysisWorker, WorkerRuntime
from web.app.routers.scan_routes import create_scan_router
from web.app.tenant_auth import TenantContext
from web.app.tenant_schema import (
    ai_usage_ledger,
    analysis_job_artifacts,
    analysis_jobs,
    app_users,
    metadata,
    projects,
    workspaces,
)


APP_USER = "10000000-0000-0000-0000-000000000001"
WORKSPACE = "20000000-0000-0000-0000-000000000001"
PROJECT = "30000000-0000-0000-0000-000000000001"


def _context() -> TenantContext:
    return TenantContext(
        auth_kind="clerk",
        owner_id="clerk:user_A",
        workspace_id=WORKSPACE,
        project_id=PROJECT,
        app_user_id=APP_USER,
    )


@pytest.fixture()
def durable_backend():
    engine = sa.create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with engine.begin() as connection:
        connection.execute(
            sa.insert(app_users).values(
                id=APP_USER,
                clerk_user_id="user_A",
                status="active",
            )
        )
        connection.execute(
            sa.insert(workspaces).values(
                id=WORKSPACE,
                slug="tenant-a",
                name="Tenant A",
                status="active",
            )
        )
        connection.execute(
            sa.insert(projects).values(
                id=PROJECT,
                workspace_id=WORKSPACE,
                slug="project-a",
                name="Project A",
                status="active",
            )
        )
    backend = PostgresAnalysisJobBackend(factory)
    return backend, factory


def test_common_job_types_enqueue_and_payload_credentials_are_rejected(durable_backend):
    backend, _factory = durable_backend
    for job_type in AnalysisJobType:
        job = backend.enqueue(job_type, {"kind": job_type.value}, context=_context())
        assert job.job_type == job_type
        assert job.status == AnalysisJobStatus.queued

    with pytest.raises(Exception) as exc_info:
        backend.enqueue(
            AnalysisJobType.scan,
            {"urls": ["https://example.com"], "api_key": "must-not-persist"},
            context=_context(),
        )
    assert getattr(exc_info.value, "status_code", None) == 422


def test_idempotency_replays_same_request_and_conflicts_on_change(durable_backend):
    backend, factory = durable_backend
    first = backend.enqueue(
        AnalysisJobType.scan,
        {"urls": ["https://example.com"]},
        idempotency_key="idem-1",
        context=_context(),
    )
    replay = backend.enqueue(
        AnalysisJobType.scan,
        {"urls": ["https://example.com"]},
        idempotency_key="idem-1",
        context=_context(),
    )
    assert replay.id == first.id
    with factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(analysis_jobs)) == 1

    with pytest.raises(Exception) as exc_info:
        backend.enqueue(
            AnalysisJobType.scan,
            {"urls": ["https://changed.example.com"]},
            idempotency_key="idem-1",
            context=_context(),
        )
    assert getattr(exc_info.value, "status_code", None) == 409


def test_claim_uses_postgres_skip_locked_and_lease_progress(durable_backend):
    backend, _factory = durable_backend
    sql = str(
        backend.claim_statement().compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    ).upper()
    assert "FOR UPDATE SKIP LOCKED" in sql

    queued = backend.enqueue(
        AnalysisJobType.discovery,
        {"brand_url": "https://example.com"},
        context=_context(),
    )
    claimed = backend.claim_next("worker-1")
    assert claimed is not None and claimed.id == queued.id
    assert claimed.attempts == 1
    assert backend.heartbeat(
        claimed.id,
        "worker-1",
        stage="analyze",
        progress_pct=73,
    )
    polled = backend.get(claimed.id, context=_context())
    assert polled is not None
    assert polled.stage == "analyze"
    assert polled.progress_pct == 73
    assert not backend.heartbeat(claimed.id, "other-worker")


def test_expired_lease_reclaims_and_retry_stops_at_three(durable_backend):
    backend, factory = durable_backend
    job = backend.enqueue(AnalysisJobType.scan, {"urls": []}, context=_context())
    claimed = backend.claim_next("worker-1")
    assert claimed is not None

    old = datetime.now(timezone.utc) - timedelta(seconds=61)
    with factory() as session, session.begin():
        session.execute(
            sa.update(analysis_jobs)
            .where(analysis_jobs.c.id == job.id)
            .values(heartbeat_at=old)
        )
    reclaimed = backend.claim_next("worker-2")
    assert reclaimed is not None and reclaimed.attempts == 2
    assert backend.fail(
        job.id,
        "worker-2",
        {"code": "temporary"},
        retryable=True,
    )
    third = backend.claim_next("worker-3")
    assert third is not None and third.attempts == MAX_ATTEMPTS
    assert backend.fail(
        job.id,
        "worker-3",
        {"code": "temporary"},
        retryable=True,
    )
    final = backend.get(job.id, context=_context())
    assert final is not None and final.status == AnalysisJobStatus.failed


def test_cancel_prevents_late_worker_completion(durable_backend):
    backend, _factory = durable_backend
    job = backend.enqueue(AnalysisJobType.scan, {"urls": []}, context=_context())
    assert backend.claim_next("worker-1") is not None
    canceled = backend.cancel(job.id, context=_context())
    assert canceled is not None and canceled.status == AnalysisJobStatus.canceled
    assert not backend.complete(job.id, "worker-1", {"report_md": "late"})


@pytest.mark.asyncio
async def test_cancel_during_handler_stops_next_paid_step_and_persistence(durable_backend):
    backend, factory = durable_backend
    queued = backend.enqueue(
        AnalysisJobType.creative_review,
        {"review_kind": "banner", "provider": "anthropic"},
        context=_context(),
    )
    entered_first_step = asyncio.Event()
    release_first_step = asyncio.Event()
    paid_steps: list[str] = []

    async def handler(_job, progress):
        await progress("paid_step_1", 30)
        paid_steps.append("paid_step_1")
        entered_first_step.set()
        await release_first_step.wait()
        # Cancellation must be observed before another provider/paid step.
        await progress("paid_step_2", 60)
        paid_steps.append("paid_step_2")
        return {
            "review": {"score": 90},
            "token_usage": {"input_tokens": 10, "output_tokens": 5},
        }

    worker = AnalysisWorker(
        backend,
        {AnalysisJobType.creative_review: handler},
        runtime=WorkerRuntime(worker_id="worker-cancel-race"),
    )
    worker_task = asyncio.create_task(worker.run_once())
    await asyncio.wait_for(entered_first_step.wait(), timeout=2)
    canceled = backend.cancel(queued.id, context=_context())
    assert canceled is not None and canceled.status == AnalysisJobStatus.canceled
    release_first_step.set()
    assert await asyncio.wait_for(worker_task, timeout=2)

    final = backend.get(queued.id, context=_context())
    assert final is not None and final.status == AnalysisJobStatus.canceled
    assert paid_steps == ["paid_step_1"]
    with factory() as session:
        assert session.scalar(
            sa.select(sa.func.count()).select_from(analysis_job_artifacts)
        ) == 0
        assert session.scalar(
            sa.select(sa.func.count()).select_from(ai_usage_ledger)
        ) == 0


def test_canceled_lease_cannot_write_artifact_or_usage(durable_backend):
    backend, factory = durable_backend
    queued = backend.enqueue(
        AnalysisJobType.compare,
        {"asset_id": "a"},
        context=_context(),
    )
    claimed = backend.claim_next("worker-1")
    assert claimed is not None and claimed.id == queued.id
    canceled = backend.cancel(queued.id, context=_context())
    assert canceled is not None and canceled.status == AnalysisJobStatus.canceled

    assert backend.record_artifact(
        claimed,
        artifact_type="compare_result",
        storage_kind="database",
        storage_ref=f"analysis_jobs/{claimed.id}/result",
    ) is None
    assert not backend.record_ai_usage(
        claimed,
        provider="anthropic",
        model="model-a",
        operation="compare",
        input_tokens=100,
        output_tokens=20,
    )
    with factory() as session:
        assert session.scalar(
            sa.select(sa.func.count()).select_from(analysis_job_artifacts)
        ) == 0
        assert session.scalar(
            sa.select(sa.func.count()).select_from(ai_usage_ledger)
        ) == 0


def test_artifact_and_usage_ledger_are_retry_idempotent(durable_backend):
    backend, factory = durable_backend
    queued = backend.enqueue(AnalysisJobType.compare, {"asset_id": "a"}, context=_context())
    job = backend.claim_next("worker-1")
    assert job is not None and job.id == queued.id

    artifact_1 = backend.record_artifact(
        job,
        artifact_type="compare_result",
        storage_kind="database",
        storage_ref=f"analysis_jobs/{job.id}/result",
    )
    artifact_2 = backend.record_artifact(
        job,
        artifact_type="compare_result",
        storage_kind="database",
        storage_ref=f"analysis_jobs/{job.id}/result",
    )
    assert artifact_1 == artifact_2
    assert backend.record_ai_usage(
        job,
        provider="anthropic",
        model="model-a",
        operation="compare",
        input_tokens=100,
        output_tokens=20,
    )
    assert not backend.record_ai_usage(
        job,
        provider="anthropic",
        model="model-a",
        operation="compare",
        input_tokens=100,
        output_tokens=20,
    )
    with factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(analysis_job_artifacts)) == 1
        assert session.scalar(sa.select(sa.func.count()).select_from(ai_usage_ledger)) == 1
        usage = session.execute(sa.select(ai_usage_ledger)).mappings().one()
        assert usage["input_tokens"] == 100
        assert usage["output_tokens"] == 20


@pytest.mark.asyncio
async def test_worker_completes_job_and_persists_one_artifact_and_usage(durable_backend):
    backend, factory = durable_backend
    job = backend.enqueue(
        AnalysisJobType.creative_review,
        {"review_kind": "banner", "provider": "anthropic"},
        context=_context(),
    )

    async def handler(_job, progress):
        assert await progress("analyzing", 50)
        return {"review": {"score": 80}, "token_usage": {"input_tokens": 4, "output_tokens": 2}}

    worker = AnalysisWorker(
        backend,
        {AnalysisJobType.creative_review: handler},
        runtime=WorkerRuntime(worker_id="worker-1"),
    )
    assert await worker.run_once()
    completed = backend.get(job.id, context=_context())
    assert completed is not None and completed.status == AnalysisJobStatus.succeeded
    assert completed.result == {
        "review": {"score": 80},
        "token_usage": {"input_tokens": 4, "output_tokens": 2},
    }
    with factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(analysis_job_artifacts)) == 1
        assert session.scalar(sa.select(sa.func.count()).select_from(ai_usage_ledger)) == 1

    with pytest.raises(ValueError, match="fixed at 2"):
        AnalysisWorker(
            backend,
            {AnalysisJobType.creative_review: handler},
            runtime=WorkerRuntime(worker_id="bad", concurrency=1),
        )


def test_worker_and_workflow_configuration_fail_closed(monkeypatch):
    monkeypatch.setenv("MARKET_LENS_JOB_BACKEND", "worker")
    monkeypatch.setenv("MARKET_LENS_WORKER_ENABLED", "1")
    monkeypatch.setenv("MARKET_LENS_WORKFLOW_ENABLED", "1")
    with pytest.raises(JobBackendConfigurationError, match="simultaneously"):
        JobBackendSettings.from_env()

    monkeypatch.setenv("MARKET_LENS_JOB_BACKEND", "workflow")
    monkeypatch.delenv("MARKET_LENS_WORKER_ENABLED", raising=False)
    monkeypatch.delenv("MARKET_LENS_WORKFLOW_ENABLED", raising=False)
    monkeypatch.delenv("MARKET_LENS_WORKFLOW_ENDPOINT", raising=False)
    monkeypatch.delenv("MARKET_LENS_WORKFLOW_TOKEN", raising=False)
    with pytest.raises(JobBackendConfigurationError, match="requires endpoint and token"):
        JobBackendSettings.from_env()

    monkeypatch.setenv("MARKET_LENS_JOB_BACKEND", "inline")
    monkeypatch.setenv("MARKET_LENS_WORKER_ENABLED", "1")
    with pytest.raises(JobBackendConfigurationError, match="Worker flag conflicts"):
        JobBackendSettings.from_env()

    monkeypatch.delenv("MARKET_LENS_WORKER_ENABLED", raising=False)
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(JobBackendConfigurationError, match="forbidden"):
        JobBackendSettings.from_env()


def _fake_job(job_id: str = "abc123def456") -> AnalysisJob:
    now = datetime.now(timezone.utc)
    return AnalysisJob(
        id=job_id,
        workspace_id=WORKSPACE,
        project_id=PROJECT,
        created_by_user_id=APP_USER,
        owner_id="owner",
        job_type=AnalysisJobType.scan,
        status=AnalysisJobStatus.queued,
        stage="queued",
        progress_pct=0,
        payload={"urls": ["https://example.com"]},
        attempts=0,
        heartbeat_at=None,
        started_at=None,
        completed_at=None,
        created_at=now,
        updated_at=now,
        result=None,
        error=None,
    )


def test_worker_mode_post_preserves_shape_without_asyncio_create_task(monkeypatch):
    import web.app.routers.scan_routes as scan_routes

    class Backend:
        mode = JobBackendMode.worker

        def enqueue(self, *_args, **_kwargs):
            return _fake_job()

    def forbidden_create_task(*_args, **_kwargs):
        raise AssertionError("web process must not create analysis tasks in worker mode")

    monkeypatch.setattr(scan_routes, "validate_urls", lambda _urls: [])
    monkeypatch.setattr(
        scan_routes,
        "asyncio",
        SimpleNamespace(create_task=forbidden_create_task),
    )
    app = FastAPI()
    app.include_router(
        create_scan_router(
            repo=object(),
            job_repo=None,
            analysis_job_backend=Backend(),
        )
    )
    app.dependency_overrides[verify_admin_or_integration] = lambda: "admin"
    app.dependency_overrides[get_verified_owner_id] = lambda: "owner"
    response = TestClient(app).post(
        "/api/scan/jobs",
        json={"urls": ["https://example.com"]},
        headers={"Idempotency-Key": "req-1"},
    )
    assert response.status_code == 202
    assert response.json() == {
        "job_id": "abc123def456",
        "status": "queued",
        "stage": "queued",
        "poll_url": "/api/scan/jobs/abc123def456",
        "retry_after_sec": 3,
    }

    sync_response = TestClient(app).post(
        "/api/scan",
        json={"urls": ["https://example.com"]},
    )
    assert sync_response.status_code == 409


def test_unavailable_backend_fails_closed_instead_of_running_inline(monkeypatch):
    import web.app.routers.scan_routes as scan_routes

    class UnavailableBackend:
        mode = None

    monkeypatch.setattr(scan_routes, "validate_urls", lambda _urls: [])
    app = FastAPI()
    app.include_router(
        create_scan_router(
            repo=object(),
            job_repo=object(),
            analysis_job_backend=UnavailableBackend(),
        )
    )
    app.dependency_overrides[verify_admin_or_integration] = lambda: "admin"
    app.dependency_overrides[get_verified_owner_id] = lambda: "owner"
    response = TestClient(app).post(
        "/api/scan/jobs",
        json={"urls": ["https://example.com"]},
    )
    assert response.status_code == 503


def test_usage_budget_route_keeps_its_endpoint_after_middleware_registration():
    from web.app.main import app

    route = next(route for route in app.routes if getattr(route, "path", None) == "/api/usage/budget")
    assert route.endpoint.__name__ == "get_gemini_budget"
