"""SQLAlchemy repository for persistent report history and sharing.

Only migration 009 tables are used for report data.  The managed database is
the sole source of truth; this module has no filesystem or browser fallback.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping, Sequence

import sqlalchemy as sa
from sqlalchemy.orm import Session

from ..platform.schema import (
    audit_events,
    projects,
    report_messages,
    report_runs,
    report_share_links,
    report_snapshots,
)
from .errors import ReportConflict, ReportNotFound, ReportValidationError
from .validation import validate_import_payload, validate_report_v2


_ID_NAMESPACE = uuid.UUID("689551a2-d57e-4a34-8e6c-31cd55a2e3d3")


def _new_id() -> str:
    return str(uuid.uuid4())


def _stable_id(*parts: str) -> str:
    return str(uuid.uuid5(_ID_NAMESPACE, "\x1f".join(parts)))


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    aware = _aware(value)
    return aware.isoformat() if aware is not None else None


def _row(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    mapping = row._mapping if hasattr(row, "_mapping") else row
    return dict(mapping)


def _generated_at(report: Mapping[str, Any], fallback: datetime) -> datetime:
    value = report.get("generated_at")
    if not isinstance(value, str):
        return fallback
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return fallback
    return _aware(parsed) or fallback


class ReportRepository:
    def __init__(
        self,
        session: Session,
        *,
        now_provider: Callable[[], datetime] = _utcnow,
        token_factory: Callable[[], str] | None = None,
    ) -> None:
        self.session = session
        self.now_provider = now_provider
        self.token_factory = token_factory or (lambda: secrets.token_urlsafe(32))

    def _now(self) -> datetime:
        value = self.now_provider()
        return _aware(value) or _utcnow()

    # -- project scoping -------------------------------------------------

    def resolve_project(self, workspace_id: str, project_ref: str) -> dict[str, Any]:
        row = self.session.execute(
            sa.select(projects.c.id, projects.c.workspace_id, projects.c.slug)
            .where(
                projects.c.workspace_id == workspace_id,
                sa.or_(projects.c.id == project_ref, projects.c.slug == project_ref),
                projects.c.deleted_at.is_(None),
                projects.c.status.notin_(["archived", "deleted"]),
            )
            .limit(1)
        ).first()
        project = _row(row)
        if project is None:
            raise ReportNotFound("project not found")
        return project

    # -- reports ---------------------------------------------------------

    def list_reports(self, workspace_id: str, project_id: str) -> list[dict[str, Any]]:
        ids = self.session.scalars(
            sa.select(report_runs.c.id)
            .where(
                report_runs.c.workspace_id == workspace_id,
                report_runs.c.project_id == project_id,
                report_runs.c.deleted_at.is_(None),
            )
            .order_by(report_runs.c.created_at.desc(), report_runs.c.id.desc())
        ).all()
        return [self.get_report(workspace_id, project_id, str(report_id), include_messages=False) for report_id in ids]

    def get_report(
        self,
        workspace_id: str,
        project_id: str,
        report_id: str,
        *,
        include_messages: bool = True,
    ) -> dict[str, Any]:
        run = self._run_row(workspace_id, project_id, report_id)
        snapshot_row = self.session.execute(
            sa.select(report_snapshots)
            .where(
                report_snapshots.c.workspace_id == workspace_id,
                report_snapshots.c.project_id == project_id,
                report_snapshots.c.report_run_id == report_id,
            )
            .order_by(report_snapshots.c.snapshot_version.desc())
            .limit(1)
        ).first()
        snapshot = _row(snapshot_row)
        if snapshot is None:
            raise ReportNotFound("report snapshot not found")

        messages: list[dict[str, Any]] = []
        if include_messages:
            rows = self.session.execute(
                sa.select(report_messages)
                .where(
                    report_messages.c.workspace_id == workspace_id,
                    report_messages.c.project_id == project_id,
                    report_messages.c.report_run_id == report_id,
                )
                .order_by(report_messages.c.ordinal.asc())
            ).all()
            messages = [
                {
                    "id": str(item["id"]),
                    "role": str(item["role"]),
                    "content": str(item["content"]),
                    "metadata": deepcopy(item.get("metadata_json")),
                    "ordinal": int(item["ordinal"]),
                    "created_at": _iso(item.get("created_at")),
                }
                for item in (_row(row) for row in rows)
                if item is not None
            ]
        return {
            "id": str(run["id"]),
            "client_entry_id": run.get("client_run_id"),
            "source_schema": str(run["schema_version"]),
            "status": str(run["status"]),
            "title": snapshot.get("title"),
            "summary": snapshot.get("summary"),
            "report": deepcopy(snapshot["report_json"]),
            "size_bytes": int(snapshot.get("size_bytes") or 0),
            "messages": messages,
            "generated_at": _iso(run.get("generated_at")),
            "created_at": _iso(run.get("created_at")),
            "updated_at": _iso(run.get("updated_at")),
        }

    def create_report(
        self,
        *,
        workspace_id: str,
        project_id: str,
        actor_user_id: str | None,
        client_entry_id: str,
        idempotency_key: str,
        report: Mapping[str, Any],
        title: str | None = None,
        summary: str | None = None,
        messages: Sequence[Mapping[str, Any]] = (),
        request_id: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        size = validate_report_v2(report, expected_project_id=project_id)
        return self._insert_report(
            workspace_id=workspace_id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            client_entry_id=client_entry_id,
            idempotency_key=idempotency_key,
            source_schema="report.v2",
            report=report,
            size_bytes=size,
            title=title,
            summary=summary,
            messages=messages,
            audit_event="report.created",
            request_id=request_id,
        )

    def import_report(
        self,
        *,
        workspace_id: str,
        project_id: str,
        actor_user_id: str | None,
        client_entry_id: str,
        idempotency_key: str,
        source_schema: str,
        report: Mapping[str, Any],
        title: str | None = None,
        summary: str | None = None,
        messages: Sequence[Mapping[str, Any]] = (),
        request_id: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        size = validate_import_payload(
            report,
            source_schema=source_schema,
            expected_project_id=project_id,
        )
        return self._insert_report(
            workspace_id=workspace_id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            client_entry_id=client_entry_id,
            idempotency_key=idempotency_key,
            source_schema=source_schema,
            report=report,
            size_bytes=size,
            title=title,
            summary=summary,
            messages=messages,
            audit_event="report.imported",
            request_id=request_id,
        )

    def soft_delete_report(
        self,
        workspace_id: str,
        project_id: str,
        report_id: str,
        *,
        actor_user_id: str | None,
        request_id: str | None = None,
    ) -> None:
        self._run_row(workspace_id, project_id, report_id)
        now = self._now()
        self.session.execute(
            sa.update(report_runs)
            .where(
                report_runs.c.workspace_id == workspace_id,
                report_runs.c.project_id == project_id,
                report_runs.c.id == report_id,
                report_runs.c.deleted_at.is_(None),
            )
            .values(status="canceled", deleted_at=now, updated_at=now)
        )
        self._audit(
            workspace_id=workspace_id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            event_type="report.deleted",
            target_type="report_run",
            target_id=report_id,
            request_id=request_id,
        )
        self.session.flush()

    # -- shares ----------------------------------------------------------

    def create_share(
        self,
        workspace_id: str,
        project_id: str,
        report_id: str,
        *,
        actor_user_id: str | None,
        expires_in_days: int,
        request_id: str | None = None,
    ) -> dict[str, Any]:
        self._run_row(workspace_id, project_id, report_id)
        if not 1 <= int(expires_in_days) <= 7:
            raise ReportValidationError("share expiry must be between 1 and 7 days")
        raw_token = self.token_factory()
        if not raw_token or len(raw_token) < 24:
            raise ReportValidationError("share token generator returned an unsafe token")
        token_hash = _sha256(raw_token)
        if self.session.execute(
            sa.select(report_share_links.c.id).where(report_share_links.c.token_hash == token_hash)
        ).first():
            raise ReportConflict("share token collision")
        now = self._now()
        share_id = _new_id()
        expires_at = now + timedelta(days=int(expires_in_days))
        self.session.execute(
            sa.insert(report_share_links).values(
                id=share_id,
                workspace_id=workspace_id,
                project_id=project_id,
                report_run_id=report_id,
                created_by_user_id=actor_user_id,
                token_hash=token_hash,
                expires_at=expires_at,
                revoked_at=None,
                last_accessed_at=None,
                access_count=0,
                created_at=now,
            )
        )
        self._audit(
            workspace_id=workspace_id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            event_type="report_share.created",
            target_type="report_share_link",
            target_id=share_id,
            request_id=request_id,
            metadata={"report_id": report_id, "expires_at": expires_at.isoformat()},
        )
        self.session.flush()
        return {
            "id": share_id,
            "report_id": report_id,
            "token": raw_token,
            "expires_at": expires_at.isoformat(),
        }

    def revoke_share(
        self,
        workspace_id: str,
        project_id: str,
        report_id: str,
        share_id: str,
        *,
        actor_user_id: str | None,
        request_id: str | None = None,
    ) -> None:
        self._run_row(workspace_id, project_id, report_id)
        share = self.session.execute(
            sa.select(report_share_links.c.id, report_share_links.c.revoked_at).where(
                report_share_links.c.workspace_id == workspace_id,
                report_share_links.c.project_id == project_id,
                report_share_links.c.report_run_id == report_id,
                report_share_links.c.id == share_id,
            )
        ).first()
        if share is None:
            raise ReportNotFound("share not found")
        now = self._now()
        self.session.execute(
            sa.update(report_share_links)
            .where(report_share_links.c.id == share_id)
            .values(revoked_at=now)
        )
        self._audit(
            workspace_id=workspace_id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            event_type="report_share.revoked",
            target_type="report_share_link",
            target_id=share_id,
            request_id=request_id,
            metadata={"report_id": report_id},
        )
        self.session.flush()

    def access_share(
        self,
        raw_token: str,
        *,
        request_id: str | None = None,
        ip_hash: str | None = None,
        user_agent_hash: str | None = None,
    ) -> dict[str, Any]:
        token_hash = _sha256(raw_token)
        row = self.session.execute(
            sa.select(report_share_links).where(report_share_links.c.token_hash == token_hash)
        ).first()
        share = _row(row)
        now = self._now()
        if (
            share is None
            or share.get("revoked_at") is not None
            or share.get("expires_at") is None
            or (_aware(share.get("expires_at")) or now) <= now
        ):
            raise ReportNotFound("share not found")
        report = self.get_report(
            str(share["workspace_id"]),
            str(share["project_id"]),
            str(share["report_run_id"]),
            include_messages=False,
        )
        self.session.execute(
            sa.update(report_share_links)
            .where(report_share_links.c.id == share["id"])
            .values(
                last_accessed_at=now,
                access_count=report_share_links.c.access_count + 1,
            )
        )
        self._audit(
            workspace_id=str(share["workspace_id"]),
            project_id=str(share["project_id"]),
            actor_user_id=None,
            event_type="report_share.accessed",
            target_type="report_share_link",
            target_id=str(share["id"]),
            request_id=request_id,
            ip_hash=ip_hash,
            user_agent_hash=user_agent_hash,
        )
        self.session.flush()
        return {
            "share_id": str(share["id"]),
            "report_id": report["id"],
            "title": report["title"],
            "summary": report["summary"],
            "report": report["report"],
            "expires_at": _iso(share.get("expires_at")),
        }

    # -- internals -------------------------------------------------------

    def _insert_report(
        self,
        *,
        workspace_id: str,
        project_id: str,
        actor_user_id: str | None,
        client_entry_id: str,
        idempotency_key: str,
        source_schema: str,
        report: Mapping[str, Any],
        size_bytes: int,
        title: str | None,
        summary: str | None,
        messages: Sequence[Mapping[str, Any]],
        audit_event: str,
        request_id: str | None,
    ) -> tuple[dict[str, Any], bool]:
        normalized_client_id = str(client_entry_id or "").strip()
        if not normalized_client_id or len(normalized_client_id) > 100:
            raise ReportValidationError("client_entry_id is invalid")
        normalized_idempotency = str(idempotency_key or "").strip()
        if not 8 <= len(normalized_idempotency) <= 255:
            raise ReportValidationError("Idempotency-Key is invalid")

        existing = self.session.execute(
            sa.select(report_runs.c.id).where(
                report_runs.c.workspace_id == workspace_id,
                report_runs.c.project_id == project_id,
                report_runs.c.client_run_id == normalized_client_id,
            )
        ).first()
        if existing is not None:
            existing_id = str(existing[0])
            if self.session.execute(
                sa.select(report_runs.c.deleted_at).where(report_runs.c.id == existing_id)
            ).scalar_one_or_none() is not None:
                raise ReportConflict("client_entry_id belongs to a deleted report")
            return self.get_report(workspace_id, project_id, existing_id), False

        report_id = _stable_id(workspace_id, project_id, "report", normalized_idempotency)
        replay = self.session.execute(
            sa.select(report_runs.c.id).where(
                report_runs.c.workspace_id == workspace_id,
                report_runs.c.project_id == project_id,
                report_runs.c.id == report_id,
                report_runs.c.deleted_at.is_(None),
            )
        ).first()
        if replay is not None:
            return self.get_report(workspace_id, project_id, report_id), False

        now = self._now()
        input_json = {
            "idempotency_key_hash": _sha256(normalized_idempotency),
            "source_schema": source_schema,
            "client_entry_id": normalized_client_id,
        }
        self.session.execute(
            sa.insert(report_runs).values(
                id=report_id,
                workspace_id=workspace_id,
                project_id=project_id,
                created_by_user_id=actor_user_id,
                client_run_id=normalized_client_id,
                schema_version=source_schema,
                status="succeeded",
                input_json=input_json,
                error_code=None,
                generated_at=_generated_at(report, now),
                started_at=now,
                completed_at=now,
                created_at=now,
                updated_at=now,
                deleted_at=None,
            )
        )
        self.session.execute(
            sa.insert(report_snapshots).values(
                id=_stable_id(report_id, "snapshot", "1"),
                workspace_id=workspace_id,
                project_id=project_id,
                report_run_id=report_id,
                snapshot_version=1,
                title=title,
                summary=summary,
                report_json=deepcopy(dict(report)),
                size_bytes=size_bytes,
                created_at=now,
            )
        )
        for ordinal, raw_message in enumerate(messages):
            message = dict(raw_message)
            role = str(message.get("role") or "")
            content = str(message.get("content") or "")
            if role not in {"user", "assistant", "system", "tool"} or not content:
                raise ReportValidationError("report message is invalid")
            self.session.execute(
                sa.insert(report_messages).values(
                    id=_stable_id(report_id, "message", str(ordinal)),
                    workspace_id=workspace_id,
                    project_id=project_id,
                    report_run_id=report_id,
                    app_user_id=actor_user_id,
                    role=role,
                    content=content,
                    metadata_json=deepcopy(message.get("metadata")),
                    ordinal=ordinal,
                    created_at=now,
                )
            )
        self._audit(
            workspace_id=workspace_id,
            project_id=project_id,
            actor_user_id=actor_user_id,
            event_type=audit_event,
            target_type="report_run",
            target_id=report_id,
            request_id=request_id,
            metadata={
                "client_entry_id": normalized_client_id,
                "source_schema": source_schema,
                "size_bytes": size_bytes,
            },
        )
        self.session.flush()
        return self.get_report(workspace_id, project_id, report_id), True

    def _run_row(self, workspace_id: str, project_id: str, report_id: str) -> dict[str, Any]:
        row = self.session.execute(
            sa.select(report_runs).where(
                report_runs.c.workspace_id == workspace_id,
                report_runs.c.project_id == project_id,
                report_runs.c.id == report_id,
                report_runs.c.deleted_at.is_(None),
            )
        ).first()
        run = _row(row)
        if run is None:
            raise ReportNotFound("report not found")
        return run

    def _audit(
        self,
        *,
        workspace_id: str | None,
        project_id: str | None,
        actor_user_id: str | None,
        event_type: str,
        target_type: str | None,
        target_id: str | None,
        request_id: str | None,
        metadata: Mapping[str, Any] | None = None,
        ip_hash: str | None = None,
        user_agent_hash: str | None = None,
    ) -> None:
        self.session.execute(
            sa.insert(audit_events).values(
                id=_new_id(),
                workspace_id=workspace_id,
                project_id=project_id,
                actor_user_id=actor_user_id,
                event_type=event_type,
                target_type=target_type,
                target_id=target_id,
                request_id=request_id,
                metadata_json=deepcopy(dict(metadata or {})),
                ip_hash=ip_hash,
                user_agent_hash=user_agent_hash,
                created_at=self._now(),
            )
        )
