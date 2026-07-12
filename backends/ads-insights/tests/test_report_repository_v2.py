"""SQLite contract tests for the migration-009 report repository."""

from __future__ import annotations

import hashlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

from web.app.platform.schema import (
    app_users,
    audit_events,
    platform_metadata,
    projects,
    report_runs,
    report_share_links,
    workspaces,
)
from web.app.report_contract_v2 import build_report_v2
from web.app.reporting.errors import ReportNotFound, ReportValidationError
from web.app.reporting.repository import ReportRepository


FIXED_NOW = datetime(2026, 7, 12, 3, 0, tzinfo=timezone.utc)


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
            }
        ],
        generated_at="2026-07-12T03:00:00+00:00",
    )


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
    yield factory
    engine.dispose()


def test_history_is_restored_in_a_new_session_and_duplicate_create_is_idempotent(session_factory):
    with session_factory() as session:
        repository = ReportRepository(session, now_provider=lambda: FIXED_NOW)
        created, was_created = repository.create_report(
            workspace_id="w1",
            project_id="p1",
            actor_user_id="u1",
            client_entry_id="device-entry-1",
            idempotency_key="create-key-0001",
            report=_report("p1"),
            title="Monthly report",
            messages=[{"role": "user", "content": "show July", "metadata": {"device": "A"}}],
        )
        session.commit()
        report_id = created["id"]
        assert was_created is True

    # A separate SQLAlchemy session represents another device/process.
    with session_factory() as session:
        repository = ReportRepository(session, now_provider=lambda: FIXED_NOW)
        listed = repository.list_reports("w1", "p1")
        restored = repository.get_report("w1", "p1", report_id)
        replay, was_created = repository.create_report(
            workspace_id="w1",
            project_id="p1",
            actor_user_id="u1",
            client_entry_id="device-entry-1",
            idempotency_key="a-different-retry-key",
            report=_report("p1"),
        )
        session.commit()

        assert [item["id"] for item in listed] == [report_id]
        assert restored["messages"][0]["content"] == "show July"
        assert replay["id"] == report_id
        assert was_created is False
        assert session.scalar(sa.select(sa.func.count()).select_from(report_runs)) == 1


def test_tenant_scope_and_legacy_import_never_masquerades_as_report_v2(session_factory):
    legacy = {"schema_version": "report.v1", "rows": [{"value": 7}]}
    with session_factory() as session:
        repository = ReportRepository(session, now_provider=lambda: FIXED_NOW)
        imported, _ = repository.import_report(
            workspace_id="w1",
            project_id="p1",
            actor_user_id="u1",
            client_entry_id="legacy-entry",
            idempotency_key="legacy-import-001",
            source_schema="report.v1",
            report=legacy,
        )
        session.commit()

        assert imported["source_schema"] == "report.v1"
        assert imported["report"]["schema_version"] == "report.v1"
        with pytest.raises(ReportNotFound):
            repository.get_report("w2", "p2", imported["id"])
        with pytest.raises(ReportNotFound):
            repository.resolve_project("w1", "project-two")
        with pytest.raises(ReportValidationError):
            repository.import_report(
                workspace_id="w1",
                project_id="p1",
                actor_user_id="u1",
                client_entry_id="fake-v2",
                idempotency_key="legacy-import-002",
                source_schema="legacy.v1",
                report={"schema_version": "report.v2"},
            )
        broken_evidence = _report("p1")
        broken_evidence["metrics"][0]["evidence_key"] = "missing-evidence"
        with pytest.raises(ReportValidationError, match="evidence"):
            repository.create_report(
                workspace_id="w1",
                project_id="p1",
                actor_user_id="u1",
                client_entry_id="broken-evidence",
                idempotency_key="broken-evidence-key",
                report=broken_evidence,
            )


def test_share_stores_only_hash_and_enforces_access_expiry_revoke_and_audit(session_factory):
    clock = {"now": FIXED_NOW}
    tokens = iter(["raw-share-token-000000000000000001", "raw-share-token-000000000000000002"])
    with session_factory() as session:
        repository = ReportRepository(
            session,
            now_provider=lambda: clock["now"],
            token_factory=lambda: next(tokens),
        )
        report, _ = repository.create_report(
            workspace_id="w1",
            project_id="p1",
            actor_user_id="u1",
            client_entry_id="share-report",
            idempotency_key="share-report-key",
            report=_report("p1"),
        )
        share = repository.create_share(
            "w1",
            "p1",
            report["id"],
            actor_user_id="u1",
            expires_in_days=7,
        )
        session.commit()

        stored = session.execute(sa.select(report_share_links)).mappings().one()
        assert share["token"] not in str(dict(stored))
        assert stored["token_hash"] == hashlib.sha256(share["token"].encode()).hexdigest()
        public = repository.access_share(
            share["token"],
            ip_hash="a" * 64,
            user_agent_hash="b" * 64,
        )
        session.commit()
        assert public["report_id"] == report["id"]
        assert session.scalar(
            sa.select(report_share_links.c.access_count).where(report_share_links.c.id == share["id"])
        ) == 1
        assert session.scalar(
            sa.select(sa.func.count()).select_from(audit_events).where(
                audit_events.c.event_type == "report_share.accessed"
            )
        ) == 1

        repository.revoke_share(
            "w1",
            "p1",
            report["id"],
            share["id"],
            actor_user_id="u1",
        )
        session.commit()
        with pytest.raises(ReportNotFound):
            repository.access_share(share["token"])

        expiring = repository.create_share(
            "w1",
            "p1",
            report["id"],
            actor_user_id="u1",
            expires_in_days=1,
        )
        session.commit()
        clock["now"] = FIXED_NOW + timedelta(days=2)
        with pytest.raises(ReportNotFound):
            repository.access_share(expiring["token"])
