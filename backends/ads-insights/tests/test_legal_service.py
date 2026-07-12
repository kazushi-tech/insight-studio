"""SQLite contract tests for legal consent and privacy requests."""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.legal.config import LegalConfig
from web.app.legal.errors import (
    LastOwnerConflict,
    LegalAcceptanceRequired,
    LegalConfigurationError,
    LegalConflict,
    LegalDocumentsUnavailable,
    LegalForbidden,
    LegalNotFound,
    LegalVersionConflict,
)
from web.app.legal.identity import LegalIdentity
from web.app.legal.service import LegalService
from web.app.platform.schema import (
    app_users,
    audit_events,
    deletion_requests,
    legal_acceptances,
    legal_document_versions,
    platform_metadata,
    workspace_memberships,
    workspaces,
)


NOW = datetime(2026, 7, 12, 3, 0, tzinfo=timezone.utc)
CONFIG = LegalConfig(hash_secret="legal-test-secret-that-is-at-least-32-bytes")


@pytest.fixture()
def session_factory():
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
                {"id": "u3", "clerk_user_id": "clerk-u3", "status": "active"},
                {"id": "u4", "clerk_user_id": "clerk-u4", "status": "active"},
            ],
        )
        session.execute(
            sa.insert(workspaces),
            [
                {"id": "w1", "slug": "workspace-one", "name": "Workspace One", "status": "active"},
                {"id": "w2", "slug": "workspace-two", "name": "Workspace Two", "status": "active"},
                {"id": "w3", "slug": "workspace-three", "name": "Workspace Three", "status": "active"},
            ],
        )
        session.execute(
            sa.insert(workspace_memberships),
            [
                {"workspace_id": "w1", "app_user_id": "u1", "role": "workspace_owner"},
                {"workspace_id": "w1", "app_user_id": "u2", "role": "workspace_owner"},
                {"workspace_id": "w2", "app_user_id": "u3", "role": "workspace_owner"},
                {"workspace_id": "w3", "app_user_id": "u2", "role": "workspace_owner"},
            ],
        )
        _seed_documents(session)
    yield factory
    engine.dispose()


def _seed_documents(session) -> None:
    common = {
        "content_sha256": "a" * 64,
        "requires_reacceptance": True,
        "required_at_signup": True,
        "created_at": NOW - timedelta(days=10),
    }
    session.execute(
        sa.insert(legal_document_versions),
        [
            {
                "id": "terms-v1",
                "document_key": "terms",
                "version": "1.0",
                "revision_number": 1,
                "title": "Terms v1",
                "public_url": "https://legal.example/terms/1.0",
                "effective_at": NOW - timedelta(days=5),
                "published_at": NOW - timedelta(days=6),
                **common,
            },
            {
                "id": "terms-v2-unpublished",
                "document_key": "terms",
                "version": "2.0-draft",
                "revision_number": 2,
                "title": "Draft Terms",
                "public_url": "https://legal.example/terms/draft",
                "effective_at": NOW - timedelta(days=1),
                "published_at": None,
                **common,
            },
            {
                "id": "privacy-v1",
                "document_key": "privacy",
                "version": "1.0",
                "revision_number": 1,
                "title": "Privacy v1",
                "public_url": "https://legal.example/privacy/1.0",
                "effective_at": NOW - timedelta(days=5),
                "published_at": NOW - timedelta(days=6),
                **common,
            },
            {
                "id": "cookie-v1",
                "document_key": "cookie",
                "version": "1.0",
                "revision_number": 1,
                "title": "Cookie v1",
                "public_url": "https://legal.example/cookie/1.0",
                "effective_at": NOW - timedelta(days=5),
                "published_at": NOW - timedelta(days=6),
                "required_at_signup": False,
                **{key: value for key, value in common.items() if key != "required_at_signup"},
            },
        ],
    )


def _owner(workspace_id: str = "w1", user_id: str = "u1") -> LegalIdentity:
    return LegalIdentity(workspace_id, user_id, workspace_role="workspace_owner")


def _viewer(workspace_id: str = "w1", user_id: str = "u4") -> LegalIdentity:
    return LegalIdentity(workspace_id, user_id)


def _service(session, *, now=NOW, config=CONFIG) -> LegalService:
    return LegalService(session, config=config, now_provider=lambda: now)


def test_latest_documents_return_only_published_current_metadata_and_fail_closed(session_factory):
    with session_factory() as session:
        service = _service(session)
        documents = service.latest_documents()
        keyed = {item["document_key"]: item for item in documents}
        assert keyed["terms"]["version"] == "1.0"
        assert keyed["privacy"]["version"] == "1.0"
        assert "cookie" in keyed
        assert "body" not in repr(documents).lower()
        assert "Draft Terms" not in repr(documents)

        session.execute(
            sa.delete(legal_document_versions).where(
                legal_document_versions.c.id == "privacy-v1"
            )
        )
        with pytest.raises(LegalDocumentsUnavailable):
            service.latest_documents()
        with pytest.raises(LegalDocumentsUnavailable):
            service.acceptance_status(_owner())


def test_versioned_acceptance_is_idempotent_hashed_and_rejects_stale_or_reused_key(
    session_factory,
):
    with session_factory() as session:
        service = _service(session)
        assert service.acceptance_status(_owner())["all_required_accepted"] is False
        with pytest.raises(LegalAcceptanceRequired):
            service.require_current_acceptance(_owner())
        with pytest.raises(LegalVersionConflict):
            service.accept_document(
                _owner(),
                document_key="terms",
                version="2.0-draft",
                idempotency_key="accept-terms-key-0001",
            )

        terms = service.accept_document(
            _owner(),
            document_key="terms",
            version="1.0",
            idempotency_key="accept-terms-key-0001",
            client_ip="203.0.113.10",
            user_agent="Unit Test Browser",
        )
        replay = service.accept_document(
            _owner(),
            document_key="terms",
            version="1.0",
            idempotency_key="accept-terms-key-0001",
        )
        assert terms["created"] is True
        assert replay["created"] is False
        assert replay["version"] == "1.0"

        with pytest.raises(LegalConflict):
            service.accept_document(
                _owner(),
                document_key="privacy",
                version="1.0",
                idempotency_key="accept-terms-key-0001",
            )
        service.accept_document(
            _owner(),
            document_key="privacy",
            version="1.0",
            idempotency_key="accept-privacy-key-0001",
        )
        assert service.acceptance_status(_owner())["all_required_accepted"] is True
        service.require_current_acceptance(_owner())

        stored = session.execute(
            sa.select(legal_acceptances).where(
                legal_acceptances.c.document_version_id == "terms-v1"
            )
        ).one()._mapping
        assert stored["subject_user_ref_hash"] != "u1"
        assert stored["ip_hash"] != "203.0.113.10"
        assert stored["user_agent_hash"] != "Unit Test Browser"
        assert len(stored["subject_user_ref_hash"]) == 64


def test_private_writes_fail_closed_without_a_hash_secret(session_factory):
    with session_factory() as session:
        service = _service(session, config=LegalConfig(hash_secret=""))
        assert service.latest_documents()
        with pytest.raises(LegalConfigurationError):
            service.accept_document(
                _owner(),
                document_key="terms",
                version="1.0",
                idempotency_key="accept-without-secret",
            )
        with pytest.raises(LegalConfigurationError):
            service.request_data_export(
                _owner(),
                scope="workspace",
                idempotency_key="export-without-secret",
            )
        with pytest.raises(LegalConfigurationError):
            service.request_deletion(
                _owner(),
                scope="workspace",
                idempotency_key="delete-without-secret",
            )


def test_non_reaccepting_published_revision_preserves_prior_consent(session_factory):
    with session_factory() as session:
        service = _service(session)
        service.accept_document(
            _owner(),
            document_key="terms",
            version="1.0",
            idempotency_key="accept-terms-before-revision",
        )
        session.execute(
            sa.insert(legal_document_versions).values(
                id="terms-v2",
                document_key="terms",
                version="2.0",
                revision_number=3,
                title="Terms v2",
                public_url="https://legal.example/terms/2.0",
                content_sha256="b" * 64,
                effective_at=NOW,
                requires_reacceptance=False,
                required_at_signup=True,
                published_at=NOW,
                created_at=NOW,
            )
        )
        status = service.acceptance_status(_owner())
        terms = next(item for item in status["documents"] if item["document_key"] == "terms")
        assert terms == {
            "document_key": "terms",
            "current_version": "2.0",
            "accepted": True,
            "accepted_version": "1.0",
            "requires_acceptance": False,
        }


def test_export_requests_are_durable_idempotent_and_workspace_manager_only(session_factory):
    with session_factory() as session:
        service = _service(session)
        account = service.request_data_export(
            _viewer(), scope="account", idempotency_key="export-account-key-0001"
        )
        assert account["scope"] == "account"
        assert account["status"] == "requested"
        with pytest.raises(LegalForbidden):
            service.request_data_export(
                _viewer(), scope="workspace", idempotency_key="export-workspace-denied"
            )

        workspace = service.request_data_export(
            _owner(), scope="workspace", idempotency_key="export-workspace-key-0001"
        )
        replay = service.request_data_export(
            _owner(), scope="workspace", idempotency_key="export-workspace-key-0001"
        )
        assert workspace["created"] is True
        assert replay["created"] is False
        assert replay["job_id"] == workspace["job_id"]
        with pytest.raises(LegalConflict):
            service.request_data_export(
                _owner(), scope="account", idempotency_key="export-workspace-key-0001"
            )

        events = session.execute(
            sa.select(audit_events).where(
                audit_events.c.event_type == "privacy_export.requested"
            )
        ).all()
        assert len(events) == 2
        assert all("u1" not in str(row._mapping["target_id"]) for row in events)
        assert all("w1" not in str(row._mapping["target_id"]) for row in events)


def test_workspace_deletion_has_30_day_grace_dedupes_and_can_be_canceled(session_factory):
    with session_factory() as session:
        service = _service(session)
        with pytest.raises(LegalForbidden):
            service.request_deletion(
                _viewer(), scope="workspace", idempotency_key="delete-workspace-denied"
            )
        requested = service.request_deletion(
            _owner(), scope="workspace", idempotency_key="delete-workspace-key-0001"
        )
        duplicate = service.request_deletion(
            _owner(), scope="workspace", idempotency_key="delete-workspace-key-0002"
        )
        assert requested["created"] is True
        assert duplicate["created"] is False
        assert duplicate["id"] == requested["id"]
        assert datetime.fromisoformat(requested["execute_after"]) == NOW + timedelta(days=30)
        requested_events = session.scalar(
            sa.select(sa.func.count())
            .select_from(audit_events)
            .where(audit_events.c.event_type == "privacy_deletion.requested")
        )
        assert requested_events == 1

        with pytest.raises(LegalNotFound):
            service.cancel_deletion(
                _owner("w2", "u3"),
                request_id=requested["id"],
                idempotency_key="cancel-cross-tenant",
            )
        canceled = service.cancel_deletion(
            _owner(),
            request_id=requested["id"],
            idempotency_key="cancel-workspace-key-0001",
        )
        canceled_replay = service.cancel_deletion(
            _owner(),
            request_id=requested["id"],
            idempotency_key="cancel-workspace-key-0001",
        )
        assert canceled["status"] == "canceled"
        assert canceled_replay["status"] == "canceled"

        requested_again = service.request_deletion(
            _owner(), scope="workspace", idempotency_key="delete-workspace-key-0003"
        )
        assert requested_again["created"] is True
        assert requested_again["id"] != requested["id"]
        with pytest.raises(LegalConflict):
            service.cancel_deletion(
                _owner(),
                request_id=requested_again["id"],
                idempotency_key="cancel-workspace-key-0001",
            )


def test_account_deletion_protects_last_owner_and_list_is_tenant_scoped(session_factory):
    with session_factory() as session:
        service = _service(session)
        with pytest.raises(LastOwnerConflict):
            service.request_deletion(
                _owner("w2", "u3"),
                scope="account",
                idempotency_key="delete-last-owner-key",
            )

        account = service.request_deletion(
            _owner(), scope="account", idempotency_key="delete-account-u1-key"
        )
        workspace = service.request_deletion(
            _owner(), scope="workspace", idempotency_key="delete-workspace-w1-list"
        )
        owner_visible = service.list_deletion_requests(_owner())
        viewer_visible = service.list_deletion_requests(_viewer("w1", "u1"))
        cross_visible = service.list_deletion_requests(_owner("w2", "u3"))
        assert {item["id"] for item in owner_visible} == {account["id"], workspace["id"]}
        assert [item["id"] for item in viewer_visible] == [account["id"]]
        assert cross_visible == []
        assert "target_ref_hash" not in repr(owner_visible)
        assert "requested_by_user_id" not in repr(owner_visible)


def test_platform_admin_can_manage_workspace_privacy_operations(session_factory):
    admin = LegalIdentity("w1", "u4", platform_role="platform_admin")
    with session_factory() as session:
        service = _service(session)
        export = service.request_data_export(
            admin, scope="workspace", idempotency_key="admin-export-workspace"
        )
        deletion = service.request_deletion(
            admin, scope="workspace", idempotency_key="admin-delete-workspace"
        )
        assert export["status"] == "requested"
        assert deletion["status"] == "requested"
        assert session.scalar(sa.select(sa.func.count()).select_from(deletion_requests)) == 1
