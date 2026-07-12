from __future__ import annotations

import sys
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
import httpx
import pandas as pd
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from starlette.requests import Request


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.platform.auth import ClerkPrincipal
from web.app.platform import runtime_access
from web.app.platform.runtime_access import RuntimeAccessError
from web.app.platform.schema import (
    app_users,
    legal_acceptances,
    legal_document_versions,
    platform_metadata,
    project_data_sources,
    project_memberships,
    projects,
    subscriptions,
    workspaces,
)
from web.app.routers.platform_v2_routes import create_platform_v2_router


NOW = datetime.now(timezone.utc)


class FakeVerifier:
    def verify(self, token: str) -> ClerkPrincipal:
        user, organization = token.split(":", 1)
        return ClerkPrincipal(
            clerk_user_id=user,
            clerk_organization_id=organization,
            issuer="https://clerk.example.test",
            authorized_party="https://insight.example.test",
            claims={"sub": user, "org_id": organization},
        )


@pytest.fixture()
def runtime_engine(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    platform_metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(sa.insert(app_users), [
            {"id": "u-editor", "clerk_user_id": "editor", "status": "active"},
            {"id": "u-viewer", "clerk_user_id": "viewer", "status": "active"},
            {"id": "u-no-legal", "clerk_user_id": "no-legal", "status": "active"},
            {"id": "u-other", "clerk_user_id": "other", "status": "active"},
        ])
        connection.execute(sa.insert(workspaces), [
            {
                "id": "w-a",
                "clerk_organization_id": "org-a",
                "slug": "workspace-a",
                "name": "Workspace A",
                "status": "active",
            },
            {
                "id": "w-b",
                "clerk_organization_id": "org-b",
                "slug": "workspace-b",
                "name": "Workspace B",
                "status": "active",
            },
        ])
        connection.execute(sa.insert(projects), [
            {
                "id": "project-a",
                "workspace_id": "w-a",
                "slug": "project-a",
                "name": "Project A",
                "status": "active",
            },
            {
                "id": "project-b",
                "workspace_id": "w-b",
                "slug": "project-b",
                "name": "Project B",
                "status": "active",
            },
        ])
        connection.execute(sa.insert(project_memberships), [
            {"workspace_id": "w-a", "project_id": "project-a", "app_user_id": "u-editor", "role": "project_editor"},
            {"workspace_id": "w-a", "project_id": "project-a", "app_user_id": "u-viewer", "role": "project_viewer"},
            {"workspace_id": "w-a", "project_id": "project-a", "app_user_id": "u-no-legal", "role": "project_editor"},
            {"workspace_id": "w-b", "project_id": "project-b", "app_user_id": "u-other", "role": "project_editor"},
        ])
        connection.execute(sa.insert(project_data_sources), [
            {
                "id": "source-a",
                "workspace_id": "w-a",
                "project_id": "project-a",
                "source_type": "ga4_bigquery",
                "gcp_project_id": "customer-gcp-a",
                "dataset_id": "analytics_a",
                "status": "active",
                "safe_config": {
                    "conversion_events": ["generate_lead"],
                    "timezone": "Asia/Tokyo",
                },
            },
            {
                "id": "source-b",
                "workspace_id": "w-b",
                "project_id": "project-b",
                "source_type": "ga4_bigquery",
                "gcp_project_id": "customer-gcp-b",
                "dataset_id": "analytics_b",
                "status": "active",
                "safe_config": None,
            },
        ])
        documents = []
        acceptances = []
        for index, key in enumerate(("terms", "privacy"), start=1):
            document_id = f"doc-{index}"
            documents.append({
                "id": document_id,
                "document_key": key,
                "version": "2026-07",
                "revision_number": 1,
                "title": key.title(),
                "public_url": f"https://insight.example.test/{key}",
                "content_sha256": "a" * 64,
                "effective_at": NOW - timedelta(days=1),
                "published_at": NOW - timedelta(days=2),
            })
            for user_id, workspace_id in (
                ("u-editor", "w-a"),
                ("u-viewer", "w-a"),
                ("u-other", "w-b"),
            ):
                acceptances.append({
                    "id": f"accept-{index}-{user_id}",
                    "app_user_id": user_id,
                    "workspace_id": workspace_id,
                    "document_version_id": document_id,
                    "subject_user_ref_hash": (f"{index}-{user_id}".encode().hex() + "0" * 64)[:64],
                    "workspace_scope_key": workspace_id,
                    "accepted_at": NOW,
                })
        connection.execute(sa.insert(legal_document_versions), documents)
        connection.execute(sa.insert(legal_acceptances), acceptances)
        connection.execute(sa.insert(subscriptions).values(
            id="pilot-a",
            workspace_id="w-a",
            provider="managed_pilot",
            provider_subscription_id="pilot-w-a",
            price_id="managed",
            plan_key="managed_pilot",
            status="managed_pilot",
            created_at=NOW,
            updated_at=NOW,
        ))

    monkeypatch.setattr(runtime_access, "get_platform_engine", lambda: engine)
    monkeypatch.setattr(runtime_access, "_verifier", lambda: FakeVerifier())
    return engine


def test_editor_resolves_only_the_server_owned_dataset(runtime_engine):
    access = runtime_access.resolve_clerk_project_runtime_access(
        "editor:org-a", "project-a"
    )
    assert access == {
        "role": "project_user",
        "workspace_id": "w-a",
        "project_id": "project-a",
        "user_id": "u-editor",
        "dataset_id": "customer-gcp-a.analytics_a",
        "cv_events": ["generate_lead"],
        "timezone": "Asia/Tokyo",
    }


@pytest.mark.parametrize(
    ("token", "project_id", "code", "status"),
    [
        ("viewer:org-a", "project-a", "project_write_forbidden", 403),
        ("no-legal:org-a", "project-a", "legal_acceptance_required", 403),
        ("other:org-b", "project-a", "project_access_forbidden", 404),
        ("editor:org-a", "", "project_scope_required", 400),
    ],
)
def test_runtime_access_fails_closed(runtime_engine, token, project_id, code, status):
    with pytest.raises(RuntimeAccessError) as exc_info:
        runtime_access.resolve_clerk_project_runtime_access(token, project_id)
    assert exc_info.value.code == code
    assert exc_info.value.status_code == status


def test_missing_subscription_blocks_report_generation(runtime_engine):
    with runtime_engine.begin() as connection:
        connection.execute(sa.delete(subscriptions))

    with pytest.raises(RuntimeAccessError) as exc_info:
        runtime_access.resolve_clerk_project_runtime_access("editor:org-a", "project-a")
    assert exc_info.value.code == "subscription_write_forbidden"
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_project_mutations_require_legal_acceptance_and_full_entitlement(
    runtime_engine,
):
    def session_dependency():
        with Session(runtime_engine, expire_on_commit=False) as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    app = FastAPI()
    app.include_router(
        create_platform_v2_router(
            session_dependency=session_dependency,
            jwt_verifier=FakeVerifier(),
            data_source_tester=lambda _source: {"connected": True},
        )
    )
    editor_headers = {"Authorization": "Bearer editor:org-a"}
    mutation_requests = (
        (
            "POST",
            "/api/projects",
            {
                "json": {"name": "Denied Project", "slug": "denied-project"},
                "headers": {**editor_headers, "Idempotency-Key": "denied-project-create"},
            },
        ),
        (
            "POST",
            "/api/projects/project-a/members",
            {
                "json": {"clerk_user_id": "viewer", "role": "project_viewer"},
                "headers": {**editor_headers, "Idempotency-Key": "denied-member-create"},
            },
        ),
        (
            "PUT",
            "/api/projects/project-a/data-source",
            {
                "json": {
                    "source_type": "ga4_bigquery",
                    "gcp_project_id": "customer-gcp-a",
                    "dataset_id": "analytics_a",
                },
                "headers": editor_headers,
            },
        ),
        (
            "POST",
            "/api/projects/project-a/data-source/test",
            {"headers": editor_headers},
        ),
    )

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        with runtime_engine.begin() as connection:
            connection.execute(
                sa.update(subscriptions).values(
                    provider="stripe",
                    plan_key="pilot",
                    status="past_due",
                    updated_at=NOW - timedelta(days=8),
                    last_provider_event_created_at=NOW - timedelta(days=8),
                )
            )
        assert (await client.get("/api/projects", headers=editor_headers)).status_code == 200
        for method, path, kwargs in mutation_requests:
            response = await client.request(method, path, **kwargs)
            assert response.status_code == 403
            assert response.json()["detail"] == "subscription_write_forbidden"

        for status in ("canceled", "unpaid"):
            with runtime_engine.begin() as connection:
                connection.execute(
                    sa.update(subscriptions).values(
                        status=status,
                        canceled_at=NOW,
                        updated_at=NOW,
                        last_provider_event_created_at=NOW,
                    )
                )
            assert (await client.get("/api/projects", headers=editor_headers)).status_code == 200
            method, path, kwargs = mutation_requests[2]
            denied = await client.request(method, path, **kwargs)
            assert denied.status_code == 403
            assert denied.json()["detail"] == "subscription_write_forbidden"

        no_legal_headers = {"Authorization": "Bearer no-legal:org-a"}
        denied_legal = await client.post(
            "/api/projects/project-a/data-source/test",
            headers=no_legal_headers,
        )
        assert denied_legal.status_code == 403
        assert denied_legal.json()["detail"] == "legal_acceptance_required"


@pytest.mark.asyncio
async def test_hybrid_bq_route_accepts_clerk_project_header_and_rejects_cross_tenant(runtime_engine):
    os.environ.setdefault("APP_PASSWORD", "runtime-access-test-password")
    os.environ.setdefault("JWT_SECRET", "runtime-access-test-jwt-secret-at-least-32-bytes")
    from web.app import backend_api
    app = backend_api.app

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        accepted = await client.get(
            "/api/bq/query_types",
            headers={
                "Authorization": "Bearer editor:org-a",
                "X-Insight-Project": "project-a",
            },
        )
        denied = await client.get(
            "/api/bq/query_types",
            headers={
                "Authorization": "Bearer other:org-b",
                "X-Insight-Project": "project-a",
            },
        )

    assert accepted.status_code == 200, accepted.text
    assert denied.status_code == 404
    assert denied.json()["error"]["code"] == "project_access_forbidden"


@pytest.mark.asyncio
async def test_project_bq_generate_returns_report_v2_with_server_runtime_policy(
    runtime_engine,
    monkeypatch,
):
    os.environ.setdefault("APP_PASSWORD", "runtime-access-test-password")
    os.environ.setdefault("JWT_SECRET", "runtime-access-test-jwt-secret-at-least-32-bytes")
    from bq import reporter as bq_reporter
    from web.app import backend_api
    from web.app.report_contract_v2 import build_report_v2

    app = backend_api.app

    captured = {}
    report_v2 = build_report_v2(
        report_id="pv:2026-07",
        project_id="project-a",
        current_period={"start": "2026-07-01", "end": "2026-07-31"},
        comparison_period={"start": "2026-06-01", "end": "2026-06-30"},
        comparison_policy="previous_month",
        metrics=[],
        generated_at="2026-07-12T00:00:00+00:00",
    )

    def fake_run_report(query_type, dataset, period, **kwargs):
        captured.update(
            query_type=query_type,
            dataset=dataset,
            period=period,
            **kwargs,
        )
        return {
            "dataframe": pd.DataFrame(
                    {
                        "event_date": ["20260701"],
                        "users": [1],
                        "sessions": [1],
                        "page_views": [1],
                        "period_users": [1],
                    "period_sessions": [1],
                    "period_page_views": [1],
                }
            ),
            "query_info": {"name": "PV"},
            "report_v2": report_v2,
        }

    backend_api._bq_cache.clear()
    monkeypatch.setattr(bq_reporter, "run_report", fake_run_report)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/api/bq/generate",
            headers={
                "Authorization": "Bearer editor:org-a",
                "X-Insight-Project": "project-a",
            },
            json={"query_type": "pv", "period": "2026-07"},
        )

    assert response.status_code == 200, response.text
    assert response.json()["report_v2"] == report_v2
    assert "csv_path" not in response.json()
    assert captured["dataset"] == "customer-gcp-a.analytics_a"
    assert captured["report_project_id"] == "project-a"
    assert captured["cv_events"] == ["generate_lead"]
    assert captured["timezone"] == "Asia/Tokyo"


@pytest.mark.asyncio
async def test_project_user_neon_rejects_filesystem_pack_and_cross_tenant_dataset(
    runtime_engine,
):
    os.environ.setdefault("APP_PASSWORD", "runtime-access-test-password")
    os.environ.setdefault("JWT_SECRET", "runtime-access-test-jwt-secret-at-least-32-bytes")
    from web.app.backend_api import app

    headers = {
        "Authorization": "Bearer editor:org-a",
        "X-Insight-Project": "project-a",
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        path_response = await client.post(
            "/api/insights/neon/generate",
            headers=headers,
            json={
                "message": "他案件の内容を表示して",
                "point_pack_path": "other-customer/private.md",
                "analysis_mode": "deterministic",
            },
        )
        dataset_response = await client.post(
            "/api/insights/neon/generate",
            headers=headers,
            json={
                "message": "数字を確認して",
                "point_pack_md": "## 根拠\n- セッション: 1",
                "datasetId": "customer-gcp-b.analytics_b",
                "analysis_mode": "deterministic",
            },
        )

    assert path_response.status_code == 403
    assert path_response.json()["error"]["code"] == "access_denied"
    assert "private.md" not in path_response.text
    assert dataset_response.status_code == 403
    assert dataset_response.json()["error"]["code"] == "access_denied"
    assert "analytics_b" not in dataset_response.text


def test_project_user_ai_payload_uses_server_scope_and_provider_policy(
    runtime_engine,
    monkeypatch,
):
    from web.app import backend_api

    monkeypatch.setenv("ADS_PROJECT_ANALYSIS_PROVIDER", "google")
    monkeypatch.setenv("ADS_PROJECT_ANALYSIS_MODE", "deterministic")
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/insights/neon/generate",
            "headers": [],
        }
    )
    claims = runtime_access.resolve_clerk_project_runtime_access(
        "editor:org-a",
        "project-a",
    )
    request.state.auth_claims = claims
    payload = {
        "message": "確認して",
        "point_pack_md": "## 根拠\n- セッション: 1",
        "datasetId": "managed",
        "provider": "anthropic",
        "model": "attacker-selected-model",
        "api_key": "attacker-key",
        "analysis_mode": "deep",
        "workflow": "multi_agent_v1",
        "temperature": 1.0,
        "analysis_context_meta": {"datasetId": "managed"},
    }

    provider, mode = backend_api._scope_project_user_ai_payload(
        request,
        payload,
        claims,
    )

    assert provider == "google"
    assert mode == "deterministic"
    assert payload["provider"] == "google"
    assert payload["model"] == "gemini-3.1-flash-lite"
    assert payload["analysis_mode"] == "deterministic"
    assert payload["workflow"] == "legacy"
    assert payload["temperature"] == 0.3
    assert payload["datasetId"] == "customer-gcp-a.analytics_a"
    assert payload["bq_project_id"] == "customer-gcp-a"
    assert payload["data_source"] == "bq"
    assert "api_key" not in payload


@pytest.mark.asyncio
async def test_project_user_missing_server_provider_key_never_requests_customer_key(
    runtime_engine,
    monkeypatch,
):
    os.environ.setdefault("APP_PASSWORD", "runtime-access-test-password")
    os.environ.setdefault("JWT_SECRET", "runtime-access-test-jwt-secret-at-least-32-bytes")
    from web.app import backend_api

    monkeypatch.setenv("ADS_PROJECT_ANALYSIS_PROVIDER", "google")
    monkeypatch.setenv("ADS_PROJECT_ANALYSIS_MODE", "economy")
    for env_name in (
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
    ):
        monkeypatch.delenv(env_name, raising=False)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=backend_api.app),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/api/insights/neon/generate",
            headers={
                "Authorization": "Bearer editor:org-a",
                "X-Insight-Project": "project-a",
                "X-Gemini-API-Key": "attacker-controlled-key",
            },
            json={
                "message": "数字を確認して",
                "point_pack_md": "## 根拠\n- セッション: 1",
                "analysis_mode": "deterministic",
            },
        )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "analysis_provider_unavailable"
    assert "APIキー" not in response.text
    assert "attacker-controlled-key" not in response.text


def test_safe_compare_path_rejects_prefix_sibling_traversal(tmp_path, monkeypatch):
    from web.app import backend_api

    compare_root = tmp_path / "compare"
    sibling = tmp_path / "compare-private"
    compare_root.mkdir()
    sibling.mkdir()
    allowed = compare_root / "allowed.md"
    private = sibling / "private.md"
    allowed.write_text("allowed", encoding="utf-8")
    private.write_text("private", encoding="utf-8")
    monkeypatch.setattr(backend_api, "_COMPARE", compare_root)

    assert backend_api._safe_compare_path("allowed.md") == allowed.resolve()
    with pytest.raises(ValueError, match="invalid path"):
        backend_api._safe_compare_path("../compare-private/private.md")
