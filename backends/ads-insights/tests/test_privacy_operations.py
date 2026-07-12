"""Operational tests for encrypted privacy exports and delayed deletion."""

from __future__ import annotations

import base64
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.legal.config import LegalConfig
from web.app.legal.identity import LegalIdentity
from web.app.legal.errors import LegalConfigurationError, LegalNotFound, PrivacyExportExpired
from web.app.legal.export_access import PrivacyExportAccessService
from web.app.legal.operations import (
    PrivacyOperationsRunner,
    PrivacyOpsConfig,
    PrivacyOpsConfigurationError,
    PrivacyWorkClaimSkipped,
    decrypt_export_blob,
)
from web.app.legal.service import LegalService
from web.app.platform.schema import (
    app_users,
    audit_events,
    deletion_requests,
    platform_metadata,
    privacy_export_artifacts,
    project_data_sources,
    projects,
    report_runs,
    report_snapshots,
    subscriptions,
    workspace_memberships,
    workspaces,
)


NOW = datetime(2026, 7, 12, 3, 0, tzinfo=timezone.utc)
LEGAL_CONFIG = LegalConfig(hash_secret="legal-test-secret-that-is-at-least-32-bytes")
RAW_KEY = b"p" * 32
OPS_CONFIG = PrivacyOpsConfig(
    retention_policy_version="retention-2026-07",
    export_retention_days=14,
    export_encryption_key_b64=base64.urlsafe_b64encode(RAW_KEY).decode("ascii"),
    export_encryption_key_id="privacy-key-v1",
    export_max_bytes=2 * 1024 * 1024,
)


@pytest.fixture()
def session_factory():
    engine = sa.create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    platform_metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory.begin() as session:
        session.execute(
            sa.insert(app_users),
            [
                {
                    "id": "u1",
                    "clerk_user_id": "clerk-u1",
                    "primary_email": "owner@example.test",
                    "display_name": "Owner",
                    "status": "active",
                },
                {
                    "id": "u2",
                    "clerk_user_id": "clerk-u2",
                    "primary_email": "second@example.test",
                    "display_name": "Second owner",
                    "status": "active",
                },
                {
                    "id": "u3",
                    "clerk_user_id": "clerk-u3",
                    "primary_email": "other@example.test",
                    "display_name": "Other tenant",
                    "status": "active",
                },
            ],
        )
        session.execute(
            sa.insert(workspaces),
            [
                {
                    "id": "w1",
                    "clerk_organization_id": "org-w1",
                    "slug": "workspace-one",
                    "name": "Workspace One",
                    "status": "active",
                },
                {
                    "id": "w2",
                    "clerk_organization_id": "org-w2",
                    "slug": "workspace-two",
                    "name": "Workspace Two",
                    "status": "active",
                },
            ],
        )
        session.execute(
            sa.insert(workspace_memberships),
            [
                {"workspace_id": "w1", "app_user_id": "u1", "role": "workspace_owner"},
                {"workspace_id": "w1", "app_user_id": "u2", "role": "workspace_owner"},
                {"workspace_id": "w2", "app_user_id": "u3", "role": "workspace_owner"},
            ],
        )
        session.execute(
            sa.insert(projects),
            [
                {
                    "id": "p1",
                    "workspace_id": "w1",
                    "slug": "site-one",
                    "name": "Site One",
                    "status": "active",
                },
                {
                    "id": "p2",
                    "workspace_id": "w2",
                    "slug": "site-two",
                    "name": "Site Two",
                    "status": "active",
                },
            ],
        )
        session.execute(
            sa.insert(project_data_sources),
            [
                {
                    "id": "source-1",
                    "workspace_id": "w1",
                    "project_id": "p1",
                    "source_type": "ga4_bigquery",
                    "gcp_project_id": "customer-gcp-project",
                    "dataset_id": "analytics_123456",
                    "status": "active",
                    "scope_kind": "customer",
                },
                {
                    "id": "source-2",
                    "workspace_id": "w2",
                    "project_id": "p2",
                    "source_type": "ga4_bigquery",
                    "gcp_project_id": "other-gcp-project",
                    "dataset_id": "analytics_999999",
                    "status": "active",
                    "scope_kind": "customer",
                },
            ],
        )
        session.execute(
            sa.insert(report_runs),
            [
                {
                    "id": "r1",
                    "workspace_id": "w1",
                    "project_id": "p1",
                    "created_by_user_id": "u1",
                    "schema_version": "report.v2",
                    "status": "succeeded",
                },
                {
                    "id": "r2",
                    "workspace_id": "w2",
                    "project_id": "p2",
                    "created_by_user_id": "u3",
                    "schema_version": "report.v2",
                    "status": "succeeded",
                },
            ],
        )
        session.execute(
            sa.insert(report_snapshots),
            [
                {
                    "id": "snapshot-1",
                    "workspace_id": "w1",
                    "project_id": "p1",
                    "report_run_id": "r1",
                    "snapshot_version": 1,
                    "report_json": {
                        "schema_version": "report.v2",
                        "summary": "analytics_123456 is ready",
                        "api_key": "AIza" + "A" * 30,
                        "note": "Bearer abcdefghijklmnopqrstuvwxyz123456",
                    },
                    "size_bytes": 100,
                },
                {
                    "id": "snapshot-2",
                    "workspace_id": "w2",
                    "project_id": "p2",
                    "report_run_id": "r2",
                    "snapshot_version": 1,
                    "report_json": {"summary": "other tenant private result"},
                    "size_bytes": 50,
                },
            ],
        )
    yield factory
    engine.dispose()


def _legal(session, *, now=NOW) -> LegalService:
    return LegalService(session, config=LEGAL_CONFIG, now_provider=lambda: now)


def _owner() -> LegalIdentity:
    return LegalIdentity("w1", "u1", workspace_role="workspace_owner")


def _decrypt_json(artifact) -> dict:
    aad = f"privacy.export.v1\x1f{artifact['request_event_id']}".encode("utf-8")
    plaintext = decrypt_export_blob(
        artifact["json_nonce_ciphertext"],
        key=RAW_KEY,
        associated_data=aad + b"\x1fjson",
    )
    return json.loads(plaintext)


def _decrypt_csv(artifact) -> str:
    aad = f"privacy.export.v1\x1f{artifact['request_event_id']}".encode("utf-8")
    plaintext = decrypt_export_blob(
        artifact["csv_nonce_ciphertext"],
        key=RAW_KEY,
        associated_data=aad + b"\x1fcsv",
    )
    return plaintext.decode("utf-8-sig")


def test_dry_run_is_read_only_and_execution_fails_closed_without_policy(session_factory):
    with session_factory() as session:
        _legal(session).request_data_export(
            _owner(), scope="workspace", idempotency_key="workspace-export-dry-run"
        )
        request = _legal(session, now=NOW - timedelta(days=31)).request_deletion(
            _owner(), scope="workspace", idempotency_key="workspace-delete-dry-run"
        )
        runner = PrivacyOperationsRunner(
            session, config=PrivacyOpsConfig(), now_provider=lambda: NOW
        )
        result = runner.run_once()
        assert result.dry_run is True
        assert len(result.planned_exports) == 1
        assert result.planned_deletions == (request["id"],)
        assert session.scalar(
            sa.select(sa.func.count()).select_from(privacy_export_artifacts)
        ) == 0
        assert session.scalar(
            sa.select(deletion_requests.c.status).where(
                deletion_requests.c.id == request["id"]
            )
        ) == "requested"

        with pytest.raises(PrivacyOpsConfigurationError) as exc_info:
            runner.run_once(execute=True)
        assert exc_info.value.code == "retention_policy_not_configured"
        assert session.scalar(
            sa.select(sa.func.count()).select_from(privacy_export_artifacts)
        ) == 0


def test_locked_export_claim_is_skipped_without_false_failure(session_factory, monkeypatch):
    with session_factory() as session:
        runner = PrivacyOperationsRunner(
            session,
            config=OPS_CONFIG,
            now_provider=lambda: NOW,
        )
        monkeypatch.setattr(runner, "_pending_export_ids", lambda **_kwargs: ["job-locked"])
        monkeypatch.setattr(runner, "_due_deletion_ids", lambda **_kwargs: [])
        monkeypatch.setattr(runner, "_expired_artifact_ids", lambda **_kwargs: [])
        monkeypatch.setattr(
            runner,
            "_process_export",
            lambda **_kwargs: (_ for _ in ()).throw(
                PrivacyWorkClaimSkipped("export_claim_skipped")
            ),
        )
        result = runner.run_once(execute=True)
        assert result.exports_ready == 0
        assert result.exports_failed == 0


def test_exports_are_encrypted_sanitized_tenant_scoped_and_idempotent(session_factory):
    with session_factory() as session:
        account = _legal(session).request_data_export(
            _owner(), scope="account", idempotency_key="account-export-ops"
        )
        workspace = _legal(session).request_data_export(
            _owner(), scope="workspace", idempotency_key="workspace-export-ops"
        )
        runner = PrivacyOperationsRunner(session, config=OPS_CONFIG, now_provider=lambda: NOW)
        result = runner.run_once(execute=True)
        assert result.exports_ready == 2
        assert result.exports_failed == 0

        artifacts = {
            row["request_event_id"]: dict(row)
            for row in session.execute(sa.select(privacy_export_artifacts)).mappings().all()
        }
        assert set(artifacts) == {account["job_id"], workspace["job_id"]}
        workspace_artifact = artifacts[workspace["job_id"]]
        assert workspace_artifact["status"] == "ready"
        assert workspace_artifact["encryption_key_id"] == "privacy-key-v1"
        assert workspace_artifact["expires_at"].replace(tzinfo=timezone.utc) == NOW + timedelta(days=14)
        assert b"analytics_123456" not in workspace_artifact["json_nonce_ciphertext"]

        exported = _decrypt_json(workspace_artifact)
        rendered = json.dumps(exported, ensure_ascii=False)
        csv_text = _decrypt_csv(workspace_artifact)
        assert exported["scope"] == "workspace"
        assert "Workspace One" in rendered
        assert "other tenant private result" not in rendered
        assert "analytics_123456" not in rendered
        assert "customer-gcp-project" not in rendered
        assert "AIza" not in rendered
        assert "abcdefghijklmnopqrstuvwxyz123456" not in rendered
        assert "analytics_123456" not in csv_text
        assert "[data source identifier redacted]" in rendered
        assert "api_key" not in rendered

        account_export = _decrypt_json(artifacts[account["job_id"]])
        account_rendered = json.dumps(account_export, ensure_ascii=False)
        assert "owner@example.test" in account_rendered
        assert "other@example.test" not in account_rendered
        assert "other tenant private result" not in account_rendered

        rerun = runner.run_once(execute=True)
        assert rerun.planned_exports == ()
        assert session.scalar(
            sa.select(sa.func.count()).select_from(privacy_export_artifacts)
        ) == 2
        ready_events = session.scalar(
            sa.select(sa.func.count())
            .select_from(audit_events)
            .where(audit_events.c.event_type == "privacy_export.ready")
        )
        assert ready_events == 2
        ready_metadata = session.scalars(
            sa.select(audit_events.c.metadata_json).where(
                audit_events.c.event_type == "privacy_export.ready"
            )
        ).all()
        assert all(
            item["delivery_status"] == "authenticated_download_available"
            for item in ready_metadata
        )

        expiry_runner = PrivacyOperationsRunner(
            session,
            config=OPS_CONFIG,
            now_provider=lambda: NOW + timedelta(days=15),
        )
        expiry_dry_run = expiry_runner.run_once(include_deletions=False)
        assert len(expiry_dry_run.planned_expirations) == 2
        expired = expiry_runner.run_once(execute=True, include_deletions=False)
        assert expired.artifacts_expired == 2
        expired_rows = session.execute(
            sa.select(privacy_export_artifacts)
        ).mappings().all()
        assert all(row["status"] == "expired" for row in expired_rows)
        assert all(row["json_nonce_ciphertext"] is None for row in expired_rows)
        assert all(row["csv_nonce_ciphertext"] is None for row in expired_rows)
        assert session.scalar(
            sa.select(sa.func.count())
            .select_from(audit_events)
            .where(audit_events.c.event_type == "privacy_export.expired")
        ) == 2


def test_export_access_is_tenant_scoped_audited_and_expires_without_worker_lag(session_factory):
    with session_factory() as session:
        requested = _legal(session).request_data_export(
            _owner(), scope="account", idempotency_key="account-export-access"
        )
        access = PrivacyExportAccessService(
            session,
            config=OPS_CONFIG,
            now_provider=lambda: NOW,
        )
        assert access.get_export(_owner(), job_id=requested["job_id"])["status"] == "requested"
        PrivacyOperationsRunner(
            session,
            config=OPS_CONFIG,
            now_provider=lambda: NOW,
        ).run_once(execute=True, include_deletions=False)

        ready = access.get_export(_owner(), job_id=requested["job_id"])
        assert ready["status"] == "ready"
        assert ready["download_available"] is True
        downloaded = access.download(
            _owner(),
            job_id=requested["job_id"],
            export_format="json",
        )
        assert json.loads(downloaded.content)["scope"] == "account"
        assert session.scalar(
            sa.select(sa.func.count())
            .select_from(audit_events)
            .where(audit_events.c.event_type == "privacy_export.downloaded")
        ) == 1

        with pytest.raises(LegalNotFound):
            access.get_export(
                LegalIdentity("w2", "u3"),
                job_id=requested["job_id"],
            )

        expired_access = PrivacyExportAccessService(
            session,
            config=OPS_CONFIG,
            now_provider=lambda: NOW + timedelta(days=15),
        )
        assert expired_access.get_export(_owner(), job_id=requested["job_id"])["status"] == "expired"
        with pytest.raises(PrivacyExportExpired):
            expired_access.download(
                _owner(),
                job_id=requested["job_id"],
                export_format="json",
            )

        wrong_key = PrivacyOpsConfig(
            retention_policy_version=OPS_CONFIG.retention_policy_version,
            export_retention_days=OPS_CONFIG.export_retention_days,
            export_encryption_key_b64=OPS_CONFIG.export_encryption_key_b64,
            export_encryption_key_id="wrong-key-version",
            export_max_bytes=OPS_CONFIG.export_max_bytes,
        )
        with pytest.raises(LegalConfigurationError):
            PrivacyExportAccessService(
                session,
                config=wrong_key,
                now_provider=lambda: NOW,
            ).download(
                _owner(),
                job_id=requested["job_id"],
                export_format="csv",
            )


def test_canceled_or_not_due_deletions_are_never_executed(session_factory):
    with session_factory() as session:
        request = _legal(session).request_deletion(
            _owner(), scope="workspace", idempotency_key="workspace-delete-cancel"
        )
        before_due = PrivacyOperationsRunner(
            session,
            config=OPS_CONFIG,
            now_provider=lambda: NOW + timedelta(days=29),
        ).run_once(execute=True, include_exports=False)
        assert before_due.planned_deletions == ()
        _legal(session, now=NOW + timedelta(days=29)).cancel_deletion(
            _owner(), request_id=request["id"], idempotency_key="cancel-delete-ops"
        )
        after_due = PrivacyOperationsRunner(
            session,
            config=OPS_CONFIG,
            now_provider=lambda: NOW + timedelta(days=31),
        ).run_once(execute=True, include_exports=False)
        assert after_due.planned_deletions == ()
        assert session.scalar(
            sa.select(deletion_requests.c.status).where(
                deletion_requests.c.id == request["id"]
            )
        ) == "canceled"
        assert session.scalar(
            sa.select(workspaces.c.status).where(workspaces.c.id == "w1")
        ) == "active"


def test_account_deletion_rechecks_last_owner_then_scrubs_account(session_factory):
    with session_factory() as session:
        request = _legal(session, now=NOW - timedelta(days=31)).request_deletion(
            _owner(), scope="account", idempotency_key="account-delete-ops"
        )
        session.execute(
            sa.delete(workspace_memberships).where(
                workspace_memberships.c.workspace_id == "w1",
                workspace_memberships.c.app_user_id == "u2",
            )
        )
        runner = PrivacyOperationsRunner(session, config=OPS_CONFIG, now_provider=lambda: NOW)
        blocked = runner.run_once(execute=True, include_exports=False)
        assert blocked.deletions_blocked == 1
        assert session.scalar(
            sa.select(deletion_requests.c.status).where(
                deletion_requests.c.id == request["id"]
            )
        ) == "requested"
        assert session.scalar(
            sa.select(deletion_requests.c.error_message).where(
                deletion_requests.c.id == request["id"]
            )
        ) == "last_owner"
        assert session.scalar(
            sa.select(app_users.c.status).where(app_users.c.id == "u1")
        ) == "active"
        immediate_retry = runner.run_once(execute=True, include_exports=False)
        assert immediate_retry.planned_deletions == ()
        assert session.scalar(
            sa.select(sa.func.count())
            .select_from(audit_events)
            .where(audit_events.c.event_type == "privacy_deletion.blocked")
        ) == 1

        session.execute(
            sa.insert(workspace_memberships).values(
                workspace_id="w1", app_user_id="u2", role="workspace_owner"
            )
        )
        completed = PrivacyOperationsRunner(
            session,
            config=OPS_CONFIG,
            now_provider=lambda: NOW + timedelta(minutes=16),
        ).run_once(execute=True, include_exports=False)
        assert completed.deletions_completed == 1
        user = session.execute(
            sa.select(app_users).where(app_users.c.id == "u1")
        ).one()._mapping
        assert user["status"] == "deleted"
        assert user["primary_email"] is None
        assert user["display_name"] is None
        assert user["clerk_user_id"] == "clerk-u1"  # access-blocking tombstone
        assert session.scalar(
            sa.select(sa.func.count())
            .select_from(workspace_memberships)
            .where(workspace_memberships.c.app_user_id == "u1")
        ) == 0
        deleted_request = session.execute(
            sa.select(deletion_requests).where(deletion_requests.c.id == request["id"])
        ).one()._mapping
        assert deleted_request["status"] == "completed"
        assert deleted_request["requested_by_user_id"] is None


def test_workspace_deletion_blocks_active_billing_then_keeps_minimal_tombstone(session_factory):
    with session_factory() as session:
        request = _legal(session, now=NOW - timedelta(days=31)).request_deletion(
            _owner(), scope="workspace", idempotency_key="workspace-delete-ops"
        )
        session.execute(
            sa.insert(subscriptions).values(
                id="subscription-1",
                workspace_id="w1",
                provider="stripe",
                provider_subscription_id="sub_secret_provider_identifier",
                price_id="price_secret_provider_identifier",
                plan_key="pilot",
                status="active",
            )
        )
        runner = PrivacyOperationsRunner(session, config=OPS_CONFIG, now_provider=lambda: NOW)
        blocked = runner.run_once(execute=True, include_exports=False)
        assert blocked.deletions_blocked == 1
        assert session.scalar(
            sa.select(deletion_requests.c.error_message).where(
                deletion_requests.c.id == request["id"]
            )
        ) == "active_billing_subscription"

        session.execute(
            sa.update(subscriptions)
            .where(subscriptions.c.id == "subscription-1")
            .values(status="canceled")
        )
        completed = PrivacyOperationsRunner(
            session,
            config=OPS_CONFIG,
            now_provider=lambda: NOW + timedelta(minutes=16),
        ).run_once(execute=True, include_exports=False)
        assert completed.deletions_completed == 1
        workspace = session.execute(
            sa.select(workspaces).where(workspaces.c.id == "w1")
        ).one()._mapping
        assert workspace["status"] == "deleted"
        assert workspace["name"] == "Deleted workspace"
        assert workspace["clerk_organization_id"] == "org-w1"
        assert session.scalar(
            sa.select(sa.func.count()).select_from(projects).where(projects.c.workspace_id == "w1")
        ) == 0
        assert session.scalar(
            sa.select(sa.func.count())
            .select_from(project_data_sources)
            .where(project_data_sources.c.workspace_id == "w1")
        ) == 0
        assert session.scalar(
            sa.select(sa.func.count()).select_from(subscriptions).where(
                subscriptions.c.workspace_id == "w1"
            )
        ) == 0
        assert session.scalar(
            sa.select(deletion_requests.c.status).where(
                deletion_requests.c.id == request["id"]
            )
        ) == "completed"
