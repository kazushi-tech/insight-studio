"""HTTP boundary tests for injectable legal/privacy routes."""

from __future__ import annotations

import base64
import json
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.legal.config import LegalConfig
from web.app.legal.identity import LegalIdentity
from web.app.legal.operations import PrivacyOperationsRunner, PrivacyOpsConfig
from web.app.platform.schema import (
    app_users,
    audit_events,
    legal_document_versions,
    platform_metadata,
    workspace_memberships,
    workspaces,
)
from web.app.routers.legal_routes import create_legal_router


NOW = datetime.now(timezone.utc)
ROUTE_PRIVACY_CONFIG = PrivacyOpsConfig(
    retention_policy_version="retention-route-test",
    export_retention_days=14,
    export_encryption_key_b64=base64.urlsafe_b64encode(b"r" * 32).decode("ascii"),
    export_encryption_key_id="route-key-v1",
    export_max_bytes=2 * 1024 * 1024,
)


def _build_app():
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
            {"id": "w1", "slug": "workspace-one", "name": "Workspace One", "status": "active"},
        )
        session.execute(
            sa.insert(workspace_memberships),
            [
                {"workspace_id": "w1", "app_user_id": "u1", "role": "workspace_owner"},
                {"workspace_id": "w1", "app_user_id": "u2", "role": "workspace_owner"},
            ],
        )
        for index, key in enumerate(("terms", "privacy"), start=1):
            session.execute(
                sa.insert(legal_document_versions).values(
                    id=f"{key}-v1",
                    document_key=key,
                    version="1.0",
                    revision_number=1,
                    title=f"{key.title()} v1",
                    public_url=f"https://legal.example/{key}/1.0",
                    content_sha256=str(index) * 64,
                    effective_at=NOW - timedelta(days=2),
                    published_at=NOW - timedelta(days=3),
                )
            )

    @contextmanager
    def session_scope():
        session = factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def session_dependency():
        with session_scope() as session:
            yield session

    identity = {"value": LegalIdentity("w1", "u1", workspace_role="workspace_owner")}

    def identity_dependency():
        return identity["value"]

    app = FastAPI()
    app.include_router(
        create_legal_router(
            session_dependency=session_dependency,
            identity_dependency=identity_dependency,
            config=LegalConfig(
                hash_secret="route-test-secret-that-is-at-least-32-bytes"
            ),
            privacy_config=ROUTE_PRIVACY_CONFIG,
        )
    )
    return app, factory, identity, engine


def test_public_documents_acceptance_and_strict_idempotent_contract():
    app, _factory, _identity, engine = _build_app()
    try:
        with TestClient(app) as client:
            documents = client.get("/api/legal/documents")
            assert documents.status_code == 200
            assert {item["document_key"] for item in documents.json()["documents"]} == {
                "terms",
                "privacy",
            }
            assert "body" not in documents.text.lower()

            no_key = client.post(
                "/api/legal/acceptances",
                json={"document_key": "terms", "version": "1.0"},
            )
            assert no_key.status_code == 400
            assert no_key.json() == {"detail": "legal_invalid_idempotency_key"}

            extra = client.post(
                "/api/legal/acceptances",
                headers={"Idempotency-Key": "accept-route-extra"},
                json={"document_key": "terms", "version": "1.0", "body": "invented"},
            )
            assert extra.status_code == 422

            accepted = client.post(
                "/api/legal/acceptances",
                headers={"Idempotency-Key": "accept-route-terms"},
                json={"document_key": "terms", "version": "1.0"},
            )
            replay = client.post(
                "/api/legal/acceptances",
                headers={"Idempotency-Key": "accept-route-terms"},
                json={"document_key": "terms", "version": "1.0"},
            )
            assert accepted.status_code == 200
            assert accepted.json()["acceptance"]["created"] is True
            assert replay.json()["acceptance"]["created"] is False
            assert "hash" not in accepted.text

            status = client.get("/api/legal/acceptance-status")
            assert status.status_code == 200
            assert status.json()["all_required_accepted"] is False
    finally:
        engine.dispose()


def test_privacy_routes_enforce_scope_return_safe_fields_and_cancel_in_grace_period():
    app, factory, identity, engine = _build_app()
    try:
        with TestClient(app) as client:
            identity["value"] = LegalIdentity("w1", "u1")
            denied = client.post(
                "/api/legal/data-exports",
                headers={"Idempotency-Key": "export-route-denied"},
                json={"scope": "workspace"},
            )
            assert denied.status_code == 403
            assert denied.json() == {"detail": "legal_forbidden"}

            account = client.post(
                "/api/legal/data-exports",
                headers={"Idempotency-Key": "export-route-account"},
                json={"scope": "account"},
            )
            assert account.status_code == 200
            assert account.json()["export"]["status"] == "requested"
            assert "target" not in account.text
            export_job_id = account.json()["export"]["job_id"]

            pending = client.get("/api/legal/data-exports")
            assert pending.status_code == 200
            assert pending.json()["exports"][0]["status"] == "requested"
            assert pending.json()["exports"][0]["download_available"] is False

            with factory.begin() as session:
                result = PrivacyOperationsRunner(
                    session,
                    config=ROUTE_PRIVACY_CONFIG,
                ).run_once(execute=True, include_deletions=False)
                assert result.exports_ready == 1

            ready = client.get(f"/api/legal/data-exports/{export_job_id}")
            assert ready.status_code == 200
            assert ready.json()["export"]["status"] == "ready"
            assert ready.json()["export"]["download_available"] is True

            downloaded = client.get(
                f"/api/legal/data-exports/{export_job_id}/download?format=json"
            )
            assert downloaded.status_code == 200
            assert downloaded.headers["cache-control"] == "private, no-store, max-age=0"
            assert downloaded.headers["x-content-type-options"] == "nosniff"
            assert "attachment" in downloaded.headers["content-disposition"]
            assert json.loads(downloaded.content)["scope"] == "account"
            with factory() as session:
                assert session.scalar(
                    sa.select(sa.func.count())
                    .select_from(audit_events)
                    .where(audit_events.c.event_type == "privacy_export.downloaded")
                ) == 1

            identity["value"] = LegalIdentity("w1", "u2")
            hidden = client.get(f"/api/legal/data-exports/{export_job_id}")
            assert hidden.status_code == 404

            identity["value"] = LegalIdentity(
                "w1", "u1", workspace_role="workspace_owner"
            )
            deletion = client.post(
                "/api/legal/deletion-requests",
                headers={"Idempotency-Key": "delete-route-workspace"},
                json={"scope": "workspace"},
            )
            assert deletion.status_code == 200
            payload = deletion.json()["deletion_request"]
            assert payload["status"] == "requested"
            assert "target_ref_hash" not in deletion.text
            request_id = payload["id"]

            canceled = client.post(
                f"/api/legal/deletion-requests/{request_id}/cancel",
                headers={"Idempotency-Key": "cancel-route-workspace"},
            )
            assert canceled.status_code == 200
            assert canceled.json()["deletion_request"]["status"] == "canceled"

            listed = client.get("/api/legal/deletion-requests")
            assert listed.status_code == 200
            assert listed.json()["deletion_requests"][0]["id"] == request_id
            assert "requested_by_user_id" not in listed.text
    finally:
        engine.dispose()


def test_database_failure_is_503_with_canonical_safe_code():
    class BrokenSession:
        def execute(self, *_args, **_kwargs):
            raise SQLAlchemyError("sensitive database detail")

    def broken_session():
        yield BrokenSession()

    app = FastAPI()
    app.include_router(create_legal_router(session_dependency=broken_session))
    with TestClient(app) as client:
        response = client.get("/api/legal/documents")
    assert response.status_code == 503
    assert response.json() == {"detail": "legal_database_unavailable"}
    assert "sensitive" not in response.text
