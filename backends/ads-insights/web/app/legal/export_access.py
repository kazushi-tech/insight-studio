"""Tenant-scoped status and authenticated delivery for privacy exports."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

import sqlalchemy as sa
from sqlalchemy.orm import Session

from ..platform.schema import audit_events, privacy_export_artifacts
from .errors import (
    LegalConfigurationError,
    LegalNotFound,
    PrivacyExportExpired,
    PrivacyExportNotReady,
)
from .identity import LegalIdentity
from .operations import (
    PrivacyOpsConfig,
    PrivacyOpsError,
    decrypt_export_blob,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    aware = _aware(value)
    return aware.isoformat() if aware else None


@dataclass(frozen=True)
class PrivacyExportDownload:
    content: bytes
    media_type: str
    filename: str


class PrivacyExportAccessService:
    """Read export state and decrypt a ready artifact for its authorized owner."""

    def __init__(
        self,
        session: Session,
        *,
        config: PrivacyOpsConfig,
        now_provider: Callable[[], datetime] = _utcnow,
    ) -> None:
        self.session = session
        self.config = config
        self.now_provider = now_provider

    def list_exports(
        self,
        identity: LegalIdentity,
        *,
        limit: int = 25,
    ) -> list[dict[str, Any]]:
        if limit < 1 or limit > 100:
            limit = 25
        rows = self.session.execute(
            self._visible_query(identity)
            .order_by(audit_events.c.created_at.desc())
            .limit(limit)
        ).mappings().all()
        now = _aware(self.now_provider()) or _utcnow()
        return [self._view(row, now=now) for row in rows]

    def get_export(
        self,
        identity: LegalIdentity,
        *,
        job_id: str,
    ) -> dict[str, Any]:
        row = self._authorized_row(identity, job_id=job_id)
        return self._view(row, now=_aware(self.now_provider()) or _utcnow())

    def download(
        self,
        identity: LegalIdentity,
        *,
        job_id: str,
        export_format: str,
    ) -> PrivacyExportDownload:
        if export_format not in {"json", "csv"}:
            raise LegalNotFound("privacy export was not found")
        row = self._authorized_row(identity, job_id=job_id)
        now = _aware(self.now_provider()) or _utcnow()
        status = self._effective_status(row, now=now)
        if status == "expired":
            raise PrivacyExportExpired("privacy export has expired")
        if status != "ready":
            raise PrivacyExportNotReady("privacy export is not ready")

        key_id = str(row.get("encryption_key_id") or "")
        if not key_id or key_id != self.config.export_encryption_key_id:
            raise LegalConfigurationError("privacy export key is unavailable")
        try:
            key = self.config.encryption_key()
            ciphertext = row.get(f"{export_format}_nonce_ciphertext")
            if ciphertext is None:
                raise PrivacyOpsError("export_ciphertext_invalid")
            aad = (
                f"privacy.export.v1\x1f{job_id}\x1f{export_format}"
            ).encode("utf-8")
            content = decrypt_export_blob(
                bytes(ciphertext),
                key=key,
                associated_data=aad,
            )
        except PrivacyOpsError as exc:
            raise LegalConfigurationError("privacy export cannot be decrypted") from exc

        self.session.execute(
            sa.insert(audit_events).values(
                id=str(uuid.uuid4()),
                workspace_id=row.get("request_workspace_id"),
                actor_user_id=identity.user_id,
                event_type="privacy_export.downloaded",
                target_type="privacy_export",
                target_id=job_id,
                metadata_json={"format": export_format, "status": "delivered"},
                created_at=now,
            )
        )
        stamp = now.strftime("%Y%m%d")
        return PrivacyExportDownload(
            content=content,
            media_type=(
                "application/json; charset=utf-8"
                if export_format == "json"
                else "text/csv; charset=utf-8"
            ),
            filename=f"insight-studio-data-{stamp}.{export_format}",
        )

    @staticmethod
    def _select_columns() -> tuple:
        return (
            audit_events.c.id.label("job_id"),
            audit_events.c.workspace_id.label("request_workspace_id"),
            audit_events.c.actor_user_id.label("request_user_id"),
            audit_events.c.target_type.label("scope"),
            audit_events.c.created_at.label("requested_at"),
            privacy_export_artifacts.c.id.label("artifact_id"),
            privacy_export_artifacts.c.status.label("artifact_status"),
            privacy_export_artifacts.c.attempts,
            privacy_export_artifacts.c.encryption_key_id,
            privacy_export_artifacts.c.json_nonce_ciphertext,
            privacy_export_artifacts.c.csv_nonce_ciphertext,
            privacy_export_artifacts.c.size_bytes,
            privacy_export_artifacts.c.record_count,
            privacy_export_artifacts.c.ready_at,
            privacy_export_artifacts.c.expires_at,
        )

    def _visible_query(self, identity: LegalIdentity):
        account_scope = sa.and_(
            audit_events.c.target_type == "account",
            audit_events.c.actor_user_id == identity.user_id,
        )
        visible = account_scope
        if identity.can_manage_workspace:
            visible = sa.or_(
                account_scope,
                sa.and_(
                    audit_events.c.target_type == "workspace",
                    audit_events.c.workspace_id == identity.workspace_id,
                ),
            )
        return (
            sa.select(*self._select_columns())
            .select_from(
                audit_events.outerjoin(
                    privacy_export_artifacts,
                    privacy_export_artifacts.c.request_event_id == audit_events.c.id,
                )
            )
            .where(
                audit_events.c.event_type == "privacy_export.requested",
                visible,
            )
        )

    def _authorized_row(
        self,
        identity: LegalIdentity,
        *,
        job_id: str,
    ) -> Mapping[str, Any]:
        row = self.session.execute(
            self._visible_query(identity).where(audit_events.c.id == job_id)
        ).mappings().first()
        if row is None:
            raise LegalNotFound("privacy export was not found")
        return row

    @staticmethod
    def _effective_status(row: Mapping[str, Any], *, now: datetime) -> str:
        status = str(row.get("artifact_status") or "requested")
        expires_at = _aware(row.get("expires_at"))
        if status == "ready" and expires_at is not None and expires_at <= now:
            return "expired"
        return status

    @classmethod
    def _view(cls, row: Mapping[str, Any], *, now: datetime) -> dict[str, Any]:
        status = cls._effective_status(row, now=now)
        return {
            "job_id": str(row["job_id"]),
            "scope": str(row.get("scope") or ""),
            "status": status,
            "download_available": status == "ready",
            "record_count": int(row.get("record_count") or 0),
            "size_bytes": int(row.get("size_bytes") or 0),
            "requested_at": _iso(row.get("requested_at")),
            "ready_at": _iso(row.get("ready_at")),
            "expires_at": _iso(row.get("expires_at")),
        }
