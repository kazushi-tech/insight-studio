"""Durable compare and creative-review HTTP contracts for M-114."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import pytest
import sqlalchemy as sa
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from web.app.auth import verify_admin_or_integration
from web.app.jobs.analysis_backend import (
    AnalysisJobType,
    PostgresAnalysisJobBackend,
)
from web.app.jobs.analysis_worker import AnalysisWorker, WorkerRuntime
from web.app.routers.review_routes import create_review_router
from web.app.tenant_auth import (
    TenantContext,
    clear_current_tenant_context,
    set_current_tenant_context,
)
from web.app.tenant_schema import (
    ai_usage_ledger,
    analysis_job_artifacts,
    analysis_jobs,
    app_users,
    metadata,
    projects,
    workspaces,
)


APP_USER_A = "10000000-0000-0000-0000-000000000001"
WORKSPACE_A = "20000000-0000-0000-0000-000000000001"
PROJECT_A = "30000000-0000-0000-0000-000000000001"
APP_USER_B = "10000000-0000-0000-0000-000000000002"
WORKSPACE_B = "20000000-0000-0000-0000-000000000002"
PROJECT_B = "30000000-0000-0000-0000-000000000002"


def _context(label: str) -> TenantContext:
    if label == "B":
        return TenantContext(
            auth_kind="clerk",
            owner_id="clerk:user_B",
            workspace_id=WORKSPACE_B,
            project_id=PROJECT_B,
            app_user_id=APP_USER_B,
        )
    return TenantContext(
        auth_kind="clerk",
        owner_id="clerk:user_A",
        workspace_id=WORKSPACE_A,
        project_id=PROJECT_A,
        app_user_id=APP_USER_A,
    )


@dataclass
class DurableReviewHarness:
    client: TestClient
    backend: PostgresAnalysisJobBackend
    factory: sessionmaker


@pytest.fixture()
def durable_reviews():
    engine = sa.create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with engine.begin() as connection:
        connection.execute(
            sa.insert(app_users),
            [
                {"id": APP_USER_A, "clerk_user_id": "user_A", "status": "active"},
                {"id": APP_USER_B, "clerk_user_id": "user_B", "status": "active"},
            ],
        )
        connection.execute(
            sa.insert(workspaces),
            [
                {"id": WORKSPACE_A, "slug": "tenant-a", "name": "Tenant A", "status": "active"},
                {"id": WORKSPACE_B, "slug": "tenant-b", "name": "Tenant B", "status": "active"},
            ],
        )
        connection.execute(
            sa.insert(projects),
            [
                {
                    "id": PROJECT_A,
                    "workspace_id": WORKSPACE_A,
                    "slug": "project-a",
                    "name": "Project A",
                    "status": "active",
                },
                {
                    "id": PROJECT_B,
                    "workspace_id": WORKSPACE_B,
                    "slug": "project-b",
                    "name": "Project B",
                    "status": "active",
                },
            ],
        )

    backend = PostgresAnalysisJobBackend(factory)
    app = FastAPI()
    app.include_router(
        create_review_router(
            repo=object(),
            analysis_job_backend=backend,
        )
    )

    async def authenticate(request: Request):
        context = _context(request.headers.get("X-Test-Tenant", "A"))
        request.state.tenant_context = context
        set_current_tenant_context(context)
        return "admin"

    app.dependency_overrides[verify_admin_or_integration] = authenticate
    try:
        yield DurableReviewHarness(TestClient(app), backend, factory)
    finally:
        clear_current_tenant_context()


def _compare_body(*, api_key: str | None = None):
    body = {
        "asset_id": "aabbccddeeff",
        "competitors": [
            {
                "url": "https://competitor.example/",
                "domain": "competitor.example",
                "title": "Competitor",
            }
        ],
        "provider": "anthropic",
    }
    if api_key is not None:
        body["api_key"] = api_key
    return body


def _banner_body(*, api_key: str | None = None):
    body = {
        "asset_id": "aabbccddeeff",
        "brand_info": "Brand",
        "provider": "anthropic",
    }
    if api_key is not None:
        body["api_key"] = api_key
    return body


def _ad_lp_body(*, api_key: str | None = None):
    body = {
        "asset_id": "aabbccddeeff",
        "landing_page": {"url": "https://brand.example/lp"},
        "provider": "anthropic",
    }
    if api_key is not None:
        body["api_key"] = api_key
    return body


def _valid_review(review_type: str) -> dict:
    return {
        "review_type": review_type,
        "summary": "Review summary",
        "good_points": [{"point": "Clear", "reason": "Visible hierarchy"}],
        "improvements": [
            {"point": "CTA", "reason": "Weak contrast", "action": "Increase contrast"}
        ],
        "evidence": [
            {
                "evidence_type": "competitor_public",
                "evidence_source": "public page",
                "evidence_text": "Visible comparison evidence",
            }
        ],
        "target_hypothesis": "Prospective customers",
        "message_angle": "Clear benefit",
        "rubric_scores": [
            {"rubric_id": "message_clarity", "score": 4, "comment": "Clear"}
        ],
    }


def test_compare_start_requires_idempotency_and_replays_without_duplicate(durable_reviews):
    harness = durable_reviews
    missing = harness.client.post("/api/reviews/compare/jobs", json=_compare_body())
    assert missing.status_code == 422

    headers = {"Idempotency-Key": "compare-request-1"}
    first = harness.client.post(
        "/api/reviews/compare/jobs",
        json=_compare_body(),
        headers=headers,
    )
    replay = harness.client.post(
        "/api/reviews/compare/jobs",
        json=_compare_body(),
        headers=headers,
    )
    assert first.status_code == replay.status_code == 202
    assert replay.json()["job_id"] == first.json()["job_id"]
    assert first.json()["review_type"] == "competitor_compare"

    changed = _compare_body()
    changed["brand_info"] = "A different request"
    conflict = harness.client.post(
        "/api/reviews/compare/jobs",
        json=changed,
        headers=headers,
    )
    assert conflict.status_code == 409
    with harness.factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(analysis_jobs)) == 1
        stored = session.execute(sa.select(analysis_jobs.c.request_json)).scalar_one()
        assert "api_key" not in stored["payload"]


@pytest.mark.parametrize(
    ("path", "body", "expected_type"),
    [
        ("/api/reviews/banner/jobs", _banner_body(), "banner_review"),
        ("/api/reviews/ad-lp/jobs", _ad_lp_body(), "ad_lp_review"),
    ],
)
def test_creative_start_replays_and_rejects_byok_secret(
    durable_reviews,
    path,
    body,
    expected_type,
):
    harness = durable_reviews
    headers = {"Idempotency-Key": f"{expected_type}-request-1"}
    first = harness.client.post(path, json=body, headers=headers)
    replay = harness.client.post(path, json=body, headers=headers)
    assert first.status_code == replay.status_code == 202
    assert first.json()["job_id"] == replay.json()["job_id"]
    assert first.json()["review_type"] == expected_type

    secret_body = dict(body)
    secret_body["api_key"] = "must-not-be-persisted"
    rejected = harness.client.post(
        path,
        json=secret_body,
        headers={"Idempotency-Key": f"{expected_type}-secret"},
    )
    assert rejected.status_code == 422
    with harness.factory() as session:
        rows = session.execute(sa.select(analysis_jobs.c.request_json)).scalars().all()
        assert len(rows) == 1
        assert all("api_key" not in row["payload"] for row in rows)


def test_poll_result_and_cancel_are_tenant_owned(durable_reviews):
    harness = durable_reviews
    start = harness.client.post(
        "/api/reviews/compare/jobs",
        json=_compare_body(),
        headers={"Idempotency-Key": "tenant-owned-job"},
    )
    job_id = start.json()["job_id"]
    other_tenant = {"X-Test-Tenant": "B"}
    assert harness.client.get(
        f"/api/reviews/jobs/{job_id}", headers=other_tenant
    ).status_code == 404
    assert harness.client.get(
        f"/api/reviews/jobs/{job_id}/result", headers=other_tenant
    ).status_code == 404
    assert harness.client.post(
        f"/api/reviews/jobs/{job_id}/cancel", headers=other_tenant
    ).status_code == 404

    canceled = harness.client.post(f"/api/reviews/jobs/{job_id}/cancel")
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "cancelled"
    assert harness.client.get(f"/api/reviews/jobs/{job_id}/result").status_code == 409
    repeated = harness.client.post(f"/api/reviews/jobs/{job_id}/cancel")
    assert repeated.status_code == 200
    assert repeated.json()["status"] == "cancelled"


@pytest.mark.parametrize(
    ("path", "body", "job_type", "review_type"),
    [
        (
            "/api/reviews/compare/jobs",
            _compare_body(),
            AnalysisJobType.compare,
            "competitor_compare",
        ),
        (
            "/api/reviews/banner/jobs",
            _banner_body(),
            AnalysisJobType.creative_review,
            "banner_review",
        ),
    ],
)
def test_duplicate_start_produces_one_worker_artifact_and_usage(
    durable_reviews,
    path,
    body,
    job_type,
    review_type,
):
    harness = durable_reviews
    headers = {"Idempotency-Key": f"dedupe-{review_type}"}
    first = harness.client.post(path, json=body, headers=headers)
    duplicate = harness.client.post(path, json=body, headers=headers)
    assert first.json()["job_id"] == duplicate.json()["job_id"]

    async def handler(_job, progress):
        assert await progress("analyzing", 60)
        return _valid_review(review_type)

    worker = AnalysisWorker(
        harness.backend,
        {job_type: handler},
        runtime=WorkerRuntime(worker_id=f"worker-{review_type}"),
    )
    assert asyncio.run(worker.run_once())
    assert not asyncio.run(worker.run_once())

    with harness.factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(analysis_jobs)) == 1
        assert session.scalar(
            sa.select(sa.func.count()).select_from(analysis_job_artifacts)
        ) == 1
        assert session.scalar(sa.select(sa.func.count()).select_from(ai_usage_ledger)) == 1

    job_id = first.json()["job_id"]
    poll = harness.client.get(f"/api/reviews/jobs/{job_id}")
    assert poll.status_code == 200
    assert poll.json()["status"] == "completed"
    result = harness.client.get(f"/api/reviews/jobs/{job_id}/result")
    assert result.status_code == 200
    assert result.json()["review_type"] == review_type
    assert result.json()["review"]["review_type"] == review_type
