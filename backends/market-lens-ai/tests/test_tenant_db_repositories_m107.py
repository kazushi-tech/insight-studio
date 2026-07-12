"""M-107 tenant-bound persistence and direct-ID isolation tests."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
import sqlalchemy as sa
from fastapi import FastAPI, Header, Request
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from web.app.auth import AuthPrincipal, verify_admin_or_integration
from web.app.models import ScanResult
from web.app.repositories.tenant_db_repository import (
    TenantDbAssetRepository,
    TenantDbDiscoveryJobRepository,
    TenantDbScanJobRepository,
    TenantDbScanRepository,
    TenantRepositoryConfigurationError,
    create_tenant_repository_bundle,
)
from web.app.routers.creative_asset_routes import create_asset_router
from web.app.routers.history_routes import create_history_router
from web.app.routers.scan_routes import create_scan_router
from web.app.schemas.creative_asset import CreativeAssetMetadata
from web.app.schemas.scan_job import ScanJobRecord, ScanJobStage, ScanJobStatus
from web.app.tenant_auth import (
    TenantContext,
    clear_current_tenant_context,
    set_current_tenant_context,
)
from web.app.tenant_schema import app_users, metadata, projects, workspaces


APP_USER_A = "10000000-0000-0000-0000-000000000001"
WORKSPACE_A = "20000000-0000-0000-0000-000000000001"
PROJECT_A = "30000000-0000-0000-0000-000000000001"
APP_USER_B = "10000000-0000-0000-0000-000000000002"
WORKSPACE_B = "20000000-0000-0000-0000-000000000002"
PROJECT_B = "30000000-0000-0000-0000-000000000002"


def _context(label: str) -> TenantContext:
    if label == "A":
        return TenantContext(
            auth_kind="clerk",
            owner_id=f"clerk:{APP_USER_A}",
            workspace_id=WORKSPACE_A,
            project_id=PROJECT_A,
            app_user_id=APP_USER_A,
            clerk_user_id="user_A",
            clerk_organization_id="org_A",
            platform_role="platform_admin",
        )
    return TenantContext(
        auth_kind="clerk",
        owner_id=f"clerk:{APP_USER_B}",
        workspace_id=WORKSPACE_B,
        project_id=PROJECT_B,
        app_user_id=APP_USER_B,
        clerk_user_id="user_B",
        clerk_organization_id="org_B",
        platform_role="platform_admin",
    )


@pytest.fixture()
def tenant_repositories():
    engine = sa.create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata.create_all(engine)  # test-only; Alembic owns production schema
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with engine.begin() as connection:
        connection.execute(
            sa.insert(app_users),
            [
                {
                    "id": APP_USER_A,
                    "clerk_user_id": "user_A",
                    "platform_role": "platform_admin",
                    "status": "active",
                },
                {
                    "id": APP_USER_B,
                    "clerk_user_id": "user_B",
                    "platform_role": "platform_admin",
                    "status": "active",
                },
            ],
        )
        connection.execute(
            sa.insert(workspaces),
            [
                {
                    "id": WORKSPACE_A,
                    "clerk_organization_id": "org_A",
                    "slug": "tenant-a",
                    "name": "Tenant A",
                    "status": "active",
                },
                {
                    "id": WORKSPACE_B,
                    "clerk_organization_id": "org_B",
                    "slug": "tenant-b",
                    "name": "Tenant B",
                    "status": "active",
                },
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
    return {
        "factory": factory,
        "scan": TenantDbScanRepository(factory),
        "scan_job": TenantDbScanJobRepository(factory),
        "discovery_job": TenantDbDiscoveryJobRepository(factory),
        "asset": TenantDbAssetRepository(factory),
    }


def _seed_tenant_a(repositories):
    now = datetime.now(timezone.utc)
    context_a = _context("A")
    set_current_tenant_context(context_a)
    repositories["scan"].save(
        ScanResult(
            run_id="aaaaaaaaaaaa",
            owner_id=context_a.owner_id,
            status="completed",
            urls=["https://example.com"],
            report_md="# Tenant A",
        )
    )
    repositories["scan_job"].save_job(
        ScanJobRecord(
            job_id="bbbbbbbbbbbb",
            owner_id=context_a.owner_id,
            urls=["https://example.com"],
            status=ScanJobStatus.completed,
            stage=ScanJobStage.complete,
            progress_pct=100,
            created_at=now,
            updated_at=now,
        )
    )
    repositories["scan_job"].save_result(
        "bbbbbbbbbbbb",
        {"run_id": "aaaaaaaaaaaa", "status": "completed"},
    )
    repositories["asset"].save(
        CreativeAssetMetadata(
            asset_id="cccccccccccc",
            file_name="banner.png",
            mime_type="image/png",
            size_bytes=4,
        ),
        b"data",
    )


def test_tenant_a_to_b_scan_job_and_asset_ids_are_invisible(tenant_repositories):
    _seed_tenant_a(tenant_repositories)
    set_current_tenant_context(_context("B"))
    assert tenant_repositories["scan"].load("aaaaaaaaaaaa") is None
    assert tenant_repositories["scan_job"].load_job("bbbbbbbbbbbb") is None
    assert tenant_repositories["scan_job"].load_result("bbbbbbbbbbbb") is None
    assert tenant_repositories["asset"].load_metadata("cccccccccccc") is None
    assert tenant_repositories["asset"].load_data("cccccccccccc") is None


def test_router_direct_ids_return_404_and_ignore_spoofed_user(tenant_repositories):
    _seed_tenant_a(tenant_repositories)
    contexts = {"A": _context("A"), "B": _context("B")}

    async def fake_verified_auth(
        request: Request,
        x_test_tenant: str = Header("A", alias="X-Test-Tenant"),
    ) -> AuthPrincipal:
        context = contexts[x_test_tenant]
        set_current_tenant_context(context)
        principal = AuthPrincipal(
            kind="clerk",
            role="platform_admin",
            context=context,
        )
        request.state.auth_principal = principal
        request.state.tenant_context = context
        return principal

    app = FastAPI()
    app.dependency_overrides[verify_admin_or_integration] = fake_verified_auth
    app.include_router(create_history_router(tenant_repositories["scan"]))
    app.include_router(
        create_scan_router(
            tenant_repositories["scan"],
            job_repo=tenant_repositories["scan_job"],
        )
    )
    app.include_router(create_asset_router(tenant_repositories["asset"]))
    client = TestClient(app)

    tenant_b = {
        "X-Test-Tenant": "B",
        "X-Insight-User": f"clerk:{APP_USER_A}",
    }
    assert client.get("/api/scans/aaaaaaaaaaaa", headers=tenant_b).status_code == 404
    assert client.get("/api/scan/jobs/bbbbbbbbbbbb", headers=tenant_b).status_code == 404
    assert client.get("/api/assets/cccccccccccc", headers=tenant_b).status_code == 404
    assert (
        client.get(
            "/api/scans/aaaaaaaaaaaa",
            headers={"X-Test-Tenant": "A", "X-Insight-User": "auth:spoofed1"},
        ).status_code
        == 200
    )


def test_startup_stale_job_recovery_does_not_need_request_context(
    tenant_repositories,
):
    now = datetime.now(timezone.utc)
    set_current_tenant_context(_context("A"))
    tenant_repositories["scan_job"].save_job(
        ScanJobRecord(
            job_id="dddddddddddd",
            owner_id=_context("A").owner_id,
            urls=["https://example.com"],
            status=ScanJobStatus.running,
            stage=ScanJobStage.analyzing,
            created_at=now,
            updated_at=now,
        )
    )
    clear_current_tenant_context()
    assert tenant_repositories["scan_job"].mark_stale_running_as_failed() == 1
    set_current_tenant_context(_context("A"))
    recovered = tenant_repositories["scan_job"].load_job("dddddddddddd")
    assert recovered is not None
    assert recovered.status == ScanJobStatus.failed


def test_file_repository_is_rejected_in_production(monkeypatch, tmp_path):
    monkeypatch.setenv("RENDER", "true")
    with pytest.raises(
        TenantRepositoryConfigurationError,
        match="forbidden in production",
    ):
        create_tenant_repository_bundle("file", file_base_dir=tmp_path)


def test_database_failure_never_falls_back_to_file(monkeypatch, tmp_path):
    monkeypatch.setenv("RENDER", "true")
    missing_parent = tmp_path / "missing" / "platform.db"
    engine = sa.create_engine(f"sqlite:///{missing_parent.as_posix()}")
    factory = sessionmaker(bind=engine)
    with pytest.raises(
        TenantRepositoryConfigurationError,
        match="database repository is unavailable",
    ):
        create_tenant_repository_bundle("db", session_factory=factory)
    assert not (tmp_path / "data").exists()
