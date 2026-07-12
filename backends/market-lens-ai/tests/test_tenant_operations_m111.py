"""M-111 durable operational persistence and tenant boundary tests."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
import sqlalchemy as sa
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from web.app.auth import (
    AuthPrincipal,
    verify_admin_or_integration,
    verify_auth_optional,
    verify_token,
)
from web.app.main import tenant_context_lifecycle_middleware
from web.app.repositories.tenant_ops_repository import (
    TenantDbDeliveryRepository,
    TenantDbJobScheduler,
    TenantDbWatchlistRepository,
)
from web.app.repositories.tenant_db_repository import (
    TenantRepositoryConfigurationError,
    create_tenant_repository_bundle,
)
from web.app.routers.delivery_routes import create_delivery_router
from web.app.routers.scheduler_routes import create_scheduler_router
from web.app.routers.watchlist_routes import create_watchlist_router
from web.app.schemas.delivery import (
    DeliveryChannel,
    DeliveryConfigCreate,
    DeliveryLog,
    DeliveryStatus,
)
from web.app.schemas.job import JobCreate, JobType
from web.app.schemas.watchlist_v2 import (
    DiffResult,
    WatchlistCreate,
    WatchlistEntryCreate,
)
from web.app.tenant_auth import (
    TenantAuthorizationError,
    TenantContext,
    clear_current_tenant_context,
    get_current_tenant_context,
    set_current_tenant_context,
)
from web.app.tenant_schema import (
    app_users,
    delivery_configs,
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
    suffix = "A" if label == "A" else "B"
    app_user_id = APP_USER_A if label == "A" else APP_USER_B
    workspace_id = WORKSPACE_A if label == "A" else WORKSPACE_B
    project_id = PROJECT_A if label == "A" else PROJECT_B
    return TenantContext(
        auth_kind="clerk",
        owner_id=f"clerk:{app_user_id}",
        workspace_id=workspace_id,
        project_id=project_id,
        app_user_id=app_user_id,
        clerk_user_id=f"user_{suffix}",
        clerk_organization_id=f"org_{suffix}",
        platform_role="platform_admin",
    )


@pytest.fixture()
def operations():
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
        "watchlist": TenantDbWatchlistRepository(factory),
        "scheduler": TenantDbJobScheduler(factory),
        "delivery": TenantDbDeliveryRepository(factory),
        "factory": factory,
    }


def _seed_a(operations):
    set_current_tenant_context(_context("A"))
    watchlist = operations["watchlist"].create_watchlist(
        WatchlistCreate(
            name="Tenant A Watchlist",
            project_id=PROJECT_B,  # caller spoof must be ignored
        )
    )
    entry = operations["watchlist"].add_entry(
        watchlist.id,
        WatchlistEntryCreate(url="https://example.com"),
    )
    assert entry is not None
    operations["watchlist"].store_diff(
        entry.id,
        DiffResult(
            entry_id=entry.id,
            url=entry.url,
            changes_detected=True,
            summary="changed",
            checked_at=datetime.now(timezone.utc),
        ),
    )
    config = operations["delivery"].create_config(
        DeliveryConfigCreate(
            channel=DeliveryChannel.email,
            target="owner@example.com",
        )
    )
    log = operations["delivery"].save_log(
        DeliveryLog(
            id="eeeeeeeeeeee",
            config_id=config.id,
            status=DeliveryStatus.pending_approval,
            digest_id="ffffffffffff",
        )
    )
    job = operations["scheduler"].create_job(
        JobCreate(job_type=JobType.watchlist_check, target_id=watchlist.id)
    )
    operations["scheduler"].record_result(
        job.id,
        result_status="success",
        summary="done",
    )
    return watchlist, entry, config, log, job


def test_records_survive_repository_recreation_and_ignore_project_spoof(operations):
    watchlist, entry, config, _, job = _seed_a(operations)
    recreated_watchlist = TenantDbWatchlistRepository(operations["factory"])
    recreated_scheduler = TenantDbJobScheduler(operations["factory"])
    recreated_delivery = TenantDbDeliveryRepository(operations["factory"])
    assert recreated_watchlist.get_watchlist(watchlist.id).project_id == PROJECT_A
    assert recreated_watchlist.get_entry(entry.id) is not None
    assert len(recreated_watchlist.get_diffs(entry.id)) == 1
    assert recreated_scheduler.get_job(job.id) is not None
    assert len(recreated_scheduler.get_results(job.id)) == 1
    assert recreated_delivery.get_config(config.id) is not None
    assert len(recreated_delivery.list_logs(config.id)) == 1


def test_tenant_a_direct_ids_are_invisible_to_tenant_b(operations):
    watchlist, entry, config, log, job = _seed_a(operations)
    set_current_tenant_context(_context("B"))
    assert operations["watchlist"].get_watchlist(watchlist.id) is None
    assert operations["watchlist"].get_entry(entry.id) is None
    assert operations["watchlist"].get_diffs(entry.id) == []
    assert operations["watchlist"].delete_watchlist(watchlist.id) is False
    assert operations["scheduler"].get_job(job.id) is None
    assert operations["scheduler"].get_results(job.id) == []
    assert operations["scheduler"].delete_job(job.id) is False
    assert operations["delivery"].get_config(config.id) is None
    assert operations["delivery"].list_logs(config.id) == []
    assert operations["delivery"].approve_log(log.id) is None


def test_routes_return_404_for_cross_tenant_direct_ids(operations):
    watchlist, entry, config, _, job = _seed_a(operations)
    contexts = {"A": _context("A"), "B": _context("B")}

    async def fake_auth(
        request: Request,
        x_test_tenant: str = Header("A", alias="X-Test-Tenant"),
    ):
        context = contexts[x_test_tenant]
        set_current_tenant_context(context)
        request.state.tenant_context = context
        return AuthPrincipal(kind="clerk", role="platform_admin", context=context)

    async def fake_token(
        request: Request,
        x_test_tenant: str = Header("A", alias="X-Test-Tenant"),
    ) -> str:
        await fake_auth(request, x_test_tenant)
        return "platform_admin"

    app = FastAPI()
    app.dependency_overrides[verify_admin_or_integration] = fake_auth
    app.dependency_overrides[verify_token] = fake_token
    app.dependency_overrides[verify_auth_optional] = fake_token
    app.include_router(create_watchlist_router(repo=operations["watchlist"]))
    app.include_router(create_scheduler_router(scheduler=operations["scheduler"]))
    app.include_router(create_delivery_router(repository=operations["delivery"]))
    client = TestClient(app)
    tenant_b = {"X-Test-Tenant": "B"}
    assert client.get(f"/api/watchlists/{watchlist.id}", headers=tenant_b).status_code == 404
    assert (
        client.get(
            f"/api/watchlists/{watchlist.id}/entries/{entry.id}/diffs",
            headers=tenant_b,
        ).status_code
        == 404
    )
    assert client.get(f"/api/jobs/{job.id}", headers=tenant_b).status_code == 404
    assert (
        client.get(f"/api/jobs/{job.id}/results", headers=tenant_b).status_code
        == 404
    )
    assert (
        client.get(f"/api/delivery/settings/{config.id}", headers=tenant_b).status_code
        == 404
    )
    assert (
        client.get(f"/api/delivery/logs/{config.id}", headers=tenant_b).status_code
        == 404
    )


def test_ops_database_failure_is_503_without_memory_fallback(tmp_path):
    missing_path = tmp_path / "missing" / "ops.db"
    engine = sa.create_engine(f"sqlite:///{missing_path.as_posix()}")
    repository = TenantDbWatchlistRepository(sessionmaker(bind=engine))
    set_current_tenant_context(_context("A"))
    with pytest.raises(HTTPException) as error:
        repository.list_watchlists()
    assert error.value.status_code == 503


def test_readiness_fails_when_an_operations_table_is_missing(operations):
    bind = operations["factory"].kw["bind"]
    delivery_configs.drop(bind)
    with pytest.raises(TenantRepositoryConfigurationError):
        create_tenant_repository_bundle(
            "db",
            session_factory=operations["factory"],
        )


@pytest.mark.asyncio
async def test_tenant_context_middleware_clears_same_task_after_response():
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})

    async def call_next(_request):
        set_current_tenant_context(_context("A"))
        assert get_current_tenant_context().workspace_id == WORKSPACE_A
        return JSONResponse({"ok": True})

    response = await tenant_context_lifecycle_middleware(request, call_next)
    assert response.status_code == 200
    with pytest.raises(TenantAuthorizationError):
        get_current_tenant_context()
    clear_current_tenant_context()
