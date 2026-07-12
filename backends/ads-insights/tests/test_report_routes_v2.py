"""FastAPI route tests for DB-backed reports, permissions, sharing, and CSV."""

from __future__ import annotations

import hashlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

from web.app.platform.schema import (
    app_users,
    platform_metadata,
    projects,
    report_runs,
    report_share_links,
    workspaces,
)
from web.app.report_contract_v2 import build_report_v2
from web.app.reporting.identity import ReportIdentity
from web.app.reporting.repository import ReportRepository
from web.app.routers.report_v2_routes import create_report_v2_router


FIXED_NOW = datetime(2026, 7, 12, 3, 0, tzinfo=timezone.utc)
RAW_TOKEN = "route-raw-token-0000000000000000000001"


def _report(project_id: str, *, label: str = "Users") -> dict:
    return build_report_v2(
        report_id=f"client-{project_id}",
        project_id=project_id,
        current_period="2026-07",
        metrics=[
            {
                "key": "users",
                "label": label,
                "value": 3,
                "unit": "users",
                "aggregation": "distinct_period",
                "source": "pv.period_users",
                "evidence_key": "+source-cell",
            }
        ],
        generated_at="2026-07-12T03:00:00+00:00",
    )


def _harness():
    engine = sa.create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    platform_metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory.begin() as session:
        session.execute(
            sa.insert(app_users),
            [
                {"id": "u1", "clerk_user_id": "clerk-u1", "status": "active"},
                {"id": "u2", "clerk_user_id": "clerk-u2", "status": "active"},
            ],
        )
        session.execute(
            sa.insert(workspaces),
            [
                {"id": "w1", "slug": "workspace-1", "name": "Workspace 1", "status": "active"},
                {"id": "w2", "slug": "workspace-2", "name": "Workspace 2", "status": "active"},
            ],
        )
        session.execute(
            sa.insert(projects),
            [
                {"id": "p1", "workspace_id": "w1", "slug": "project-one", "name": "Project 1", "status": "active"},
                {"id": "p2", "workspace_id": "w2", "slug": "project-two", "name": "Project 2", "status": "active"},
            ],
        )

    identity = {
        "value": ReportIdentity(
            workspace_id="w1",
            user_id="u1",
            project_roles={"p1": "project_editor"},
        )
    }
    clock = {"now": FIXED_NOW}

    def get_session():
        session = factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_identity():
        return identity["value"]

    def repository_factory(session):
        return ReportRepository(
            session,
            now_provider=lambda: clock["now"],
            token_factory=lambda: RAW_TOKEN,
        )

    app = FastAPI()
    app.include_router(
        create_report_v2_router(
            session_dependency=get_session,
            identity_dependency=get_identity,
            repository_factory=repository_factory,
        )
    )
    return TestClient(app), factory, identity, clock, engine


def test_report_routes_restore_across_sessions_enforce_idempotency_tenant_and_soft_delete():
    client, factory, identity, _clock, engine = _harness()
    payload = {
        "client_entry_id": "route-entry-1",
        "title": "July",
        "report": _report("p1"),
        "messages": [{"role": "user", "content": "from device A"}],
    }
    assert client.post("/api/projects/p1/reports", json=payload).status_code == 400

    created = client.post(
        "/api/projects/project-one/reports",
        json=payload,
        headers={"Idempotency-Key": "route-create-key"},
    )
    assert created.status_code == 201
    report_id = created.json()["report"]["id"]
    replay = client.post(
        "/api/projects/p1/reports",
        json=payload,
        headers={"Idempotency-Key": "different-retry-key"},
    )
    assert replay.status_code == 201
    assert replay.json()["created"] is False
    assert replay.json()["report"]["id"] == report_id

    # A viewer on another request/session can restore, list, get and export.
    identity["value"] = ReportIdentity(
        workspace_id="w1",
        user_id="u2",
        project_roles={"p1": "project_viewer"},
    )
    listed = client.get("/api/projects/p1/reports")
    fetched = client.get(f"/api/projects/p1/reports/{report_id}")
    assert listed.status_code == fetched.status_code == 200
    assert fetched.json()["report"]["messages"][0]["content"] == "from device A"
    supported_answer = client.post(
        f"/api/projects/p1/reports/{report_id}/questions",
        json={"question": "Usersはどうなっていますか"},
    )
    assert supported_answer.status_code == 403
    identity["value"] = ReportIdentity(
        workspace_id="w1",
        user_id="u1",
        project_roles={"p1": "project_editor"},
    )
    supported_answer = client.post(
        f"/api/projects/p1/reports/{report_id}/questions",
        json={"question": "Usersはどうなっていますか"},
    )
    assert supported_answer.status_code == 200
    answer = supported_answer.json()["answer"]
    assert answer["answerable"] is True
    assert answer["citations"] == [
        {"evidence_key": "+source-cell", "title": "Users"}
    ]
    unsupported_answer = client.post(
        f"/api/projects/p1/reports/{report_id}/questions",
        json={"question": "ROASはどうですか"},
    )
    assert unsupported_answer.json()["answer"] == {
        "answerable": False,
        "text": "このデータだけでは判断できません",
        "confidence": "low",
        "citations": [],
        "reason": "unsupported_or_causal_question",
    }
    identity["value"] = ReportIdentity(
        workspace_id="w1",
        user_id="u2",
        project_roles={"p1": "project_viewer"},
    )
    assert client.post(
        "/api/projects/p1/reports",
        json={**payload, "client_entry_id": "viewer-cannot-create"},
        headers={"Idempotency-Key": "viewer-create-key"},
    ).status_code == 403

    identity["value"] = ReportIdentity(
        workspace_id="w2",
        user_id="u2",
        project_roles={"p2": "project_viewer"},
    )
    assert client.get(f"/api/projects/p1/reports/{report_id}").status_code == 404
    assert client.post(
        f"/api/projects/p1/reports/{report_id}/questions",
        json={"question": "Usersはどうなっていますか"},
    ).status_code == 404

    identity["value"] = ReportIdentity(
        workspace_id="w1",
        user_id="u1",
        project_roles={"p1": "project_editor"},
    )
    assert client.delete(f"/api/projects/p1/reports/{report_id}").status_code == 200
    assert client.get(f"/api/projects/p1/reports/{report_id}").status_code == 404
    with factory() as session:
        row = session.execute(sa.select(report_runs.c.status, report_runs.c.deleted_at)).one()
        assert row.status == "canceled"
        assert row.deleted_at is not None
    engine.dispose()


def test_report_routes_enforce_legal_and_subscription_access_modes():
    client, _factory, identity, _clock, engine = _harness()
    payload = {
        "client_entry_id": "entitlement-entry-1",
        "title": "July",
        "report": _report("p1"),
    }
    created = client.post(
        "/api/projects/p1/reports",
        json=payload,
        headers={"Idempotency-Key": "entitlement-create-key"},
    )
    assert created.status_code == 201
    report_id = created.json()["report"]["id"]

    for access in ("read_only", "export_only"):
        identity["value"] = ReportIdentity(
            workspace_id="w1",
            user_id="u1",
            project_roles={"p1": "project_editor"},
            entitlement_access=access,
        )
        assert client.get("/api/projects/p1/reports").status_code == 200
        assert client.get(f"/api/projects/p1/reports/{report_id}").status_code == 200
        assert client.get(
            f"/api/projects/p1/reports/{report_id}/export.csv"
        ).status_code == 200
        denied = client.post(
            "/api/projects/p1/reports",
            json={**payload, "client_entry_id": f"denied-{access}"},
            headers={"Idempotency-Key": f"denied-{access}-key"},
        )
        assert denied.status_code == 403
        assert denied.json()["detail"] == "subscription_access_forbidden"
        assert client.post(
            f"/api/projects/p1/reports/{report_id}/questions",
            json={"question": "Usersはどうなっていますか"},
        ).status_code == 403
        assert client.post(
            f"/api/projects/p1/reports/{report_id}/shares",
            json={"expires_in_days": 1},
        ).status_code == 403

    identity["value"] = ReportIdentity(
        workspace_id="w1",
        user_id="u1",
        project_roles={"p1": "project_editor"},
        entitlement_access="blocked",
    )
    assert client.get("/api/projects/p1/reports").status_code == 403

    identity["value"] = ReportIdentity(
        workspace_id="w1",
        user_id="u1",
        project_roles={"p1": "project_editor"},
        legal_accepted=False,
    )
    denied_legal = client.get("/api/projects/p1/reports")
    assert denied_legal.status_code == 403
    assert denied_legal.json()["detail"] == "legal_acceptance_required"
    engine.dispose()


def test_import_schema_oversize_share_security_headers_expiry_revoke_and_csv_injection():
    client, factory, identity, clock, engine = _harness()
    report_payload = {
        "client_entry_id": "share-entry",
        "title": "Shareable",
        "summary": "narrative must never enter csv",
        "report": _report("p1", label="=SUM(A1:A2)"),
    }
    created = client.post(
        "/api/projects/p1/reports",
        json=report_payload,
        headers={"Idempotency-Key": "share-create-key"},
    ).json()["report"]
    report_id = created["id"]

    csv_response = client.get(f"/api/projects/p1/reports/{report_id}/export.csv")
    assert csv_response.status_code == 200
    assert "'=SUM(A1:A2)" in csv_response.text
    assert "'+source-cell" in csv_response.text
    assert "narrative must never enter csv" not in csv_response.text
    assert csv_response.headers["cache-control"] == "no-store"

    legacy_payload = {
        "client_entry_id": "legacy-entry",
        "source_schema": "report.v1",
        "report": {"schema_version": "report.v1", "value": 8},
    }
    imported = client.post(
        "/api/projects/p1/reports/import",
        json=legacy_payload,
        headers={"Idempotency-Key": "legacy-route-key"},
    )
    assert imported.status_code == 201
    assert imported.json()["report"]["source_schema"] == "report.v1"
    assert imported.json()["report"]["report"]["schema_version"] == "report.v1"
    duplicate = client.post(
        "/api/projects/p1/reports/import",
        json=legacy_payload,
        headers={"Idempotency-Key": "legacy-route-key-2"},
    )
    assert duplicate.json()["created"] is False

    invalid = client.post(
        "/api/projects/p1/reports",
        json={"client_entry_id": "invalid", "report": {"schema_version": "report.v2"}},
        headers={"Idempotency-Key": "invalid-schema-key"},
    )
    assert invalid.status_code == 422
    oversized_report = _report("p1")
    oversized_report["caveats"] = ["x" * 2_000_100]
    oversized = client.post(
        "/api/projects/p1/reports",
        json={"client_entry_id": "oversized", "report": oversized_report},
        headers={"Idempotency-Key": "oversized-report-key"},
    )
    assert oversized.status_code == 413

    # Editors cannot share; only owner/admin identities can.
    assert client.post(
        f"/api/projects/p1/reports/{report_id}/shares",
        json={"expires_in_days": 7},
    ).status_code == 403
    identity["value"] = ReportIdentity(
        workspace_id="w1",
        user_id="u1",
        workspace_role="workspace_owner",
    )
    shared = client.post(
        f"/api/projects/p1/reports/{report_id}/shares",
        json={"expires_in_days": 7},
    )
    assert shared.status_code == 201
    assert shared.headers["cache-control"] == "no-store"
    share = shared.json()["share"]
    assert share["token"] == RAW_TOKEN
    with factory() as session:
        stored = session.execute(sa.select(report_share_links)).mappings().one()
        assert RAW_TOKEN not in str(dict(stored))
        assert stored["token_hash"] == hashlib.sha256(RAW_TOKEN.encode()).hexdigest()

    public = client.get(f"/api/report-shares/{RAW_TOKEN}")
    assert public.status_code == 200
    assert public.headers["cache-control"].startswith("no-store")
    assert "noindex" in public.headers["x-robots-tag"]
    assert "token" not in public.json()["share"]
    revoked = client.delete(
        f"/api/projects/p1/reports/{report_id}/shares/{share['id']}"
    )
    assert revoked.status_code == 200
    revoked_public = client.get(f"/api/report-shares/{RAW_TOKEN}")
    assert revoked_public.status_code == 404
    assert revoked_public.headers["cache-control"].startswith("no-store")
    assert "noindex" in revoked_public.headers["x-robots-tag"]

    # A separately created share expires after its <=7 day TTL.
    expiring_token = "route-expiring-token-000000000000000001"
    app = FastAPI()

    def get_session():
        session = factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    app.include_router(
        create_report_v2_router(
            session_dependency=get_session,
            identity_dependency=lambda: identity["value"],
            repository_factory=lambda session: ReportRepository(
                session,
                now_provider=lambda: clock["now"],
                token_factory=lambda: expiring_token,
            ),
        )
    )
    expiring_client = TestClient(app)
    expiring = expiring_client.post(
        f"/api/projects/p1/reports/{report_id}/shares",
        json={"expires_in_days": 1},
    ).json()["share"]
    clock["now"] = FIXED_NOW + timedelta(days=2)
    assert expiring_client.get(f"/api/report-shares/{expiring['token']}").status_code == 404
    engine.dispose()


def test_database_exceptions_are_503_without_local_fallback():
    client, _factory, identity, _clock, engine = _harness()

    class BrokenRepository:
        def __init__(self, _session):
            pass

        def resolve_project(self, _workspace_id, _project_ref):
            raise OperationalError("SELECT 1", {}, RuntimeError("db down"))

    app = FastAPI()
    app.include_router(
        create_report_v2_router(
            session_dependency=lambda: iter([object()]),
            identity_dependency=lambda: identity["value"],
            repository_factory=BrokenRepository,
        )
    )
    response = TestClient(app, raise_server_exceptions=False).get("/api/projects/p1/reports")
    assert response.status_code == 503
    assert response.json()["detail"] == "report_database_unavailable"
    engine.dispose()
