"""Fail-closed privacy export and delayed deletion operations.

The HTTP layer only records requests.  This module is the operator-side
consumer: exports are built from the managed database, encrypted with AES-GCM,
and persisted back to PostgreSQL.  It never falls back to ``/tmp`` or another
local file.  Deletions are dry-run unless the caller explicitly opts in.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Mapping, Sequence

import sqlalchemy as sa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.orm import Session

from ..platform.schema import (
    ai_budget_accounts,
    ai_usage_ledger,
    analysis_jobs,
    app_users,
    audit_events,
    billing_customers,
    billing_webhook_events,
    deletion_requests,
    legal_acceptances,
    legal_document_versions,
    privacy_export_artifacts,
    project_data_sources,
    project_memberships,
    projects,
    rate_limit_buckets,
    report_messages,
    report_runs,
    report_snapshots,
    subscriptions,
    workspace_memberships,
    workspaces,
)


_AUDIT_NAMESPACE = uuid.UUID("1a9e83c2-c139-486a-a73a-079869eb895c")
_ARTIFACT_NAMESPACE = uuid.UUID("82679a4d-dc21-434f-8fb5-a038591b2817")
_ML_TENANT_TABLES = (
    "assets",
    "review_runs",
    "discovery_searches",
    "library_items",
    "watchlist_entries",
    "watchlists",
    "jobs",
    "delivery_configs",
    "generated_assets",
    "usage_events",
)
_SECRET_KEY_RE = re.compile(
    r"(^|_)(api_?key|secret|password|credential|access_?token|refresh_?token|"
    r"private_?key|jwt|dataset_?id|gcp_?project_?id|provider_?(customer|subscription)_?id|"
    r"price_?id|storage_?ref|ip_?hash|user_?agent_?hash)($|_)",
    re.IGNORECASE,
)
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_GOOGLE_KEY_RE = re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b")
_STRIPE_KEY_RE = re.compile(r"\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{12,}\b")
_COMMON_PROVIDER_KEY_RE = re.compile(
    r"\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[0-9A-Za-z]{20,}|"
    r"xox[baprs]-[0-9A-Za-z-]{12,}|sk-(?:ant-)?[0-9A-Za-z_-]{20,})\b"
)
_ASSIGNED_SECRET_RE = re.compile(
    r"(?i)\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password)"
    r"\s*[:=]\s*['\"]?[A-Za-z0-9._~+/-]{8,}['\"]?"
)
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b")
_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
    re.DOTALL,
)
_DELETION_SAFE_BILLING_STATUSES = frozenset(
    {"canceled", "unpaid", "incomplete_expired"}
)
_DELETION_BLOCK_RETRY_DELAY = timedelta(minutes=15)
_TERMINAL_EXPORT_ERRORS = frozenset(
    {
        "export_request_not_found",
        "export_scope_invalid",
        "export_subject_not_found",
        "workspace_not_found",
        "account_not_found",
        "export_too_large",
    }
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | date | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        aware = _aware(value)
        return aware.isoformat() if aware else None
    return value.isoformat()


def _row(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    mapping = value._mapping if hasattr(value, "_mapping") else value
    return dict(mapping)


def _stable_id(namespace: uuid.UUID, *parts: str) -> str:
    return str(uuid.uuid5(namespace, "\x1f".join(parts)))


class PrivacyOpsError(RuntimeError):
    """An operational failure with a safe, non-sensitive error code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class PrivacyOpsConfigurationError(PrivacyOpsError):
    pass


class PrivacyWorkClaimSkipped(PrivacyOpsError):
    """Another worker owns the row lock; this is not a failed attempt."""

    pass


@dataclass(frozen=True)
class PrivacyOpsConfig:
    """Configuration that must be explicit before any destructive execution."""

    retention_policy_version: str = ""
    export_retention_days: int = 0
    export_encryption_key_b64: str = ""
    export_encryption_key_id: str = ""
    export_max_bytes: int = 0

    @classmethod
    def from_env(cls) -> "PrivacyOpsConfig":
        return cls(
            retention_policy_version=(
                os.getenv("PRIVACY_RETENTION_POLICY_VERSION") or ""
            ).strip(),
            export_retention_days=_env_int("PRIVACY_EXPORT_RETENTION_DAYS"),
            export_encryption_key_b64=(
                os.getenv("PRIVACY_EXPORT_ENCRYPTION_KEY_B64") or ""
            ).strip(),
            export_encryption_key_id=(
                os.getenv("PRIVACY_EXPORT_ENCRYPTION_KEY_ID") or ""
            ).strip(),
            export_max_bytes=_env_int("PRIVACY_EXPORT_MAX_BYTES"),
        )

    def require_retention_policy(self) -> None:
        if not self.retention_policy_version:
            raise PrivacyOpsConfigurationError("retention_policy_not_configured")
        if not 1 <= self.export_retention_days <= 365:
            raise PrivacyOpsConfigurationError("export_retention_not_configured")

    def encryption_key(self) -> bytes:
        self.require_retention_policy()
        if not self.export_encryption_key_id:
            raise PrivacyOpsConfigurationError("export_encryption_key_not_configured")
        try:
            key = base64.urlsafe_b64decode(self.export_encryption_key_b64.encode("ascii"))
        except (ValueError, UnicodeError) as exc:
            raise PrivacyOpsConfigurationError("export_encryption_key_invalid") from exc
        if len(key) != 32:
            raise PrivacyOpsConfigurationError("export_encryption_key_invalid")
        return key

    def require_export_limit(self) -> int:
        if not 1024 <= self.export_max_bytes <= 250 * 1024 * 1024:
            raise PrivacyOpsConfigurationError("export_size_limit_not_configured")
        return self.export_max_bytes


def _env_int(name: str) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return 0
    try:
        return int(raw)
    except ValueError:
        return 0


def encrypt_export_blob(plaintext: bytes, *, key: bytes, associated_data: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, associated_data)


def decrypt_export_blob(ciphertext: bytes, *, key: bytes, associated_data: bytes) -> bytes:
    """Operator tooling helper; no HTTP route exposes this primitive."""

    if len(ciphertext) < 29:
        raise PrivacyOpsError("export_ciphertext_invalid")
    nonce, encrypted = ciphertext[:12], ciphertext[12:]
    try:
        return AESGCM(key).decrypt(nonce, encrypted, associated_data)
    except Exception as exc:  # cryptography intentionally does not expose detail
        raise PrivacyOpsError("export_decryption_failed") from exc


@dataclass(frozen=True)
class PrivacyOpsRunResult:
    dry_run: bool
    planned_exports: tuple[str, ...]
    planned_deletions: tuple[str, ...]
    planned_expirations: tuple[str, ...] = ()
    exports_ready: int = 0
    exports_failed: int = 0
    artifacts_expired: int = 0
    deletions_completed: int = 0
    deletions_blocked: int = 0

    def as_safe_dict(self) -> dict[str, Any]:
        return {
            "dry_run": self.dry_run,
            "planned_export_count": len(self.planned_exports),
            "planned_deletion_count": len(self.planned_deletions),
            "planned_expiration_count": len(self.planned_expirations),
            "exports_ready": self.exports_ready,
            "exports_failed": self.exports_failed,
            "artifacts_expired": self.artifacts_expired,
            "deletions_completed": self.deletions_completed,
            "deletions_blocked": self.deletions_blocked,
        }


class PrivacyOperationsRunner:
    """Consume pending privacy work from the managed database."""

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

    def run_once(
        self,
        *,
        execute: bool = False,
        limit: int = 25,
        include_exports: bool = True,
        include_deletions: bool = True,
    ) -> PrivacyOpsRunResult:
        if limit < 1 or limit > 250:
            raise PrivacyOpsError("invalid_limit")
        now = _aware(self.now_provider()) or _utcnow()
        export_ids = (
            tuple(self._pending_export_ids(limit=limit)) if include_exports else ()
        )
        deletion_ids = (
            tuple(self._due_deletion_ids(now=now, limit=limit))
            if include_deletions
            else ()
        )
        expiration_ids = (
            tuple(self._expired_artifact_ids(now=now, limit=limit))
            if include_exports
            else ()
        )
        if not execute:
            return PrivacyOpsRunResult(
                dry_run=True,
                planned_exports=export_ids,
                planned_deletions=deletion_ids,
                planned_expirations=expiration_ids,
            )

        self.config.require_retention_policy()
        if export_ids:
            self.config.encryption_key()
            self.config.require_export_limit()

        ready = failed = expired = completed = blocked = 0
        for request_event_id in export_ids:
            try:
                self._process_export(request_event_id=request_event_id, now=now)
                ready += 1
            except PrivacyWorkClaimSkipped:
                continue
            except PrivacyOpsError as exc:
                self._fail_export(request_event_id=request_event_id, error_code=exc.code, now=now)
                failed += 1
            except sa.exc.SQLAlchemyError:
                raise
            except Exception:
                self._fail_export(
                    request_event_id=request_event_id,
                    error_code="internal_error",
                    now=now,
                )
                failed += 1

        for artifact_id in expiration_ids:
            if self._expire_artifact(artifact_id=artifact_id, now=now):
                expired += 1

        for request_id in deletion_ids:
            outcome = self._process_deletion(request_id=request_id, now=now)
            if outcome == "completed":
                completed += 1
            elif outcome == "blocked":
                blocked += 1

        self.session.flush()
        return PrivacyOpsRunResult(
            dry_run=False,
            planned_exports=export_ids,
            planned_deletions=deletion_ids,
            planned_expirations=expiration_ids,
            exports_ready=ready,
            exports_failed=failed,
            artifacts_expired=expired,
            deletions_completed=completed,
            deletions_blocked=blocked,
        )

    def _pending_export_ids(self, *, limit: int) -> list[str]:
        query = (
            sa.select(audit_events.c.id)
            .select_from(
                audit_events.outerjoin(
                    privacy_export_artifacts,
                    privacy_export_artifacts.c.request_event_id == audit_events.c.id,
                )
            )
            .where(
                audit_events.c.event_type == "privacy_export.requested",
                sa.or_(
                    privacy_export_artifacts.c.id.is_(None),
                    sa.and_(
                        privacy_export_artifacts.c.status == "failed",
                        privacy_export_artifacts.c.attempts < 3,
                        privacy_export_artifacts.c.error_code.not_in(
                            _TERMINAL_EXPORT_ERRORS
                        ),
                    ),
                ),
            )
            .order_by(audit_events.c.created_at.asc(), audit_events.c.id.asc())
            .limit(limit)
        )
        return [str(value) for value in self.session.scalars(query).all()]

    def _due_deletion_ids(self, *, now: datetime, limit: int) -> list[str]:
        query = (
            sa.select(deletion_requests.c.id)
            .where(
                deletion_requests.c.status == "requested",
                deletion_requests.c.canceled_at.is_(None),
                deletion_requests.c.execute_after <= now,
                sa.or_(
                    deletion_requests.c.error_message.is_(None),
                    deletion_requests.c.updated_at <= now - _DELETION_BLOCK_RETRY_DELAY,
                ),
            )
            .order_by(deletion_requests.c.execute_after.asc(), deletion_requests.c.id.asc())
            .limit(limit)
        )
        return [str(value) for value in self.session.scalars(query).all()]

    def _expired_artifact_ids(self, *, now: datetime, limit: int) -> list[str]:
        query = (
            sa.select(privacy_export_artifacts.c.id)
            .where(
                privacy_export_artifacts.c.status == "ready",
                privacy_export_artifacts.c.expires_at.is_not(None),
                privacy_export_artifacts.c.expires_at <= now,
            )
            .order_by(
                privacy_export_artifacts.c.expires_at.asc(),
                privacy_export_artifacts.c.id.asc(),
            )
            .limit(limit)
        )
        return [str(value) for value in self.session.scalars(query).all()]

    def _expire_artifact(self, *, artifact_id: str, now: datetime) -> bool:
        artifact = _row(
            self.session.execute(
                sa.select(privacy_export_artifacts)
                .where(privacy_export_artifacts.c.id == artifact_id)
                .with_for_update(skip_locked=True)
            ).first()
        )
        if artifact is None or artifact.get("status") != "ready":
            return False
        expires_at = _aware(artifact.get("expires_at"))
        if expires_at is None or expires_at > now:
            return False
        self.session.execute(
            sa.update(privacy_export_artifacts)
            .where(
                privacy_export_artifacts.c.id == artifact_id,
                privacy_export_artifacts.c.status == "ready",
            )
            .values(
                status="expired",
                encryption_key_id=None,
                json_nonce_ciphertext=None,
                csv_nonce_ciphertext=None,
                content_sha256=None,
                size_bytes=0,
                record_count=0,
                updated_at=now,
            )
        )
        self._audit_transition(
            event_type="privacy_export.expired",
            workspace_id=str(artifact.get("workspace_id") or "") or None,
            target_type="privacy_export",
            target_id=str(artifact["request_event_id"]),
            attempt=int(artifact.get("attempts") or 1),
            metadata={"status": "expired"},
            now=now,
        )
        return True

    def _process_export(self, *, request_event_id: str, now: datetime) -> None:
        request = _row(
            self.session.execute(
                sa.select(audit_events)
                .where(
                    audit_events.c.id == request_event_id,
                    audit_events.c.event_type == "privacy_export.requested",
                )
                .with_for_update(skip_locked=True)
            ).first()
        )
        if request is None:
            # The ID came from the pending query. With SKIP LOCKED, a missing
            # row here normally means another worker is already processing it;
            # never overwrite that worker's artifact with a false failure.
            raise PrivacyWorkClaimSkipped("export_claim_skipped")
        scope = str(request.get("target_type") or "")
        if scope not in {"account", "workspace"}:
            raise PrivacyOpsError("export_scope_invalid")
        workspace_id = str(request.get("workspace_id") or "")
        user_id = str(request.get("actor_user_id") or "")
        if not workspace_id or not user_id:
            raise PrivacyOpsError("export_subject_not_found")

        artifact_id = _stable_id(_ARTIFACT_NAMESPACE, request_event_id)
        existing = _row(
            self.session.execute(
                sa.select(privacy_export_artifacts)
                .where(privacy_export_artifacts.c.request_event_id == request_event_id)
                .with_for_update(skip_locked=True)
            ).first()
        )
        if existing is not None and existing.get("status") == "ready":
            return
        attempt = int((existing or {}).get("attempts") or 0) + 1
        values = {
            "id": artifact_id,
            "request_event_id": request_event_id,
            "workspace_id": workspace_id,
            "requested_by_user_id": user_id,
            "scope": scope,
            "status": "processing",
            "attempts": attempt,
            "encryption_key_id": None,
            "json_nonce_ciphertext": None,
            "csv_nonce_ciphertext": None,
            "content_sha256": None,
            "size_bytes": 0,
            "record_count": 0,
            "error_code": None,
            "ready_at": None,
            "expires_at": None,
            "updated_at": now,
        }
        if existing is None:
            values["created_at"] = now
            self.session.execute(sa.insert(privacy_export_artifacts).values(**values))
        else:
            self.session.execute(
                sa.update(privacy_export_artifacts)
                .where(privacy_export_artifacts.c.id == artifact_id)
                .values(**{key: value for key, value in values.items() if key != "id"})
            )
        self._audit_transition(
            event_type="privacy_export.processing",
            workspace_id=workspace_id,
            target_type="privacy_export",
            target_id=request_event_id,
            attempt=attempt,
            metadata={"scope": scope, "status": "processing"},
            now=now,
        )

        export = self._build_export(
            request_event_id=request_event_id,
            scope=scope,
            workspace_id=workspace_id,
            user_id=user_id,
            now=now,
        )
        json_bytes = json.dumps(
            export,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        csv_bytes = self._build_csv(export["records"])
        total_size = len(json_bytes) + len(csv_bytes)
        if total_size > self.config.require_export_limit():
            raise PrivacyOpsError("export_too_large")
        content_hash = hashlib.sha256(json_bytes + b"\0" + csv_bytes).hexdigest()
        aad_root = f"privacy.export.v1\x1f{request_event_id}".encode("utf-8")
        key = self.config.encryption_key()
        encrypted_json = encrypt_export_blob(
            json_bytes, key=key, associated_data=aad_root + b"\x1fjson"
        )
        encrypted_csv = encrypt_export_blob(
            csv_bytes, key=key, associated_data=aad_root + b"\x1fcsv"
        )
        expires_at = now + timedelta(days=self.config.export_retention_days)
        self.session.execute(
            sa.update(privacy_export_artifacts)
            .where(
                privacy_export_artifacts.c.id == artifact_id,
                privacy_export_artifacts.c.status == "processing",
                privacy_export_artifacts.c.attempts == attempt,
            )
            .values(
                status="ready",
                encryption_key_id=self.config.export_encryption_key_id,
                json_nonce_ciphertext=encrypted_json,
                csv_nonce_ciphertext=encrypted_csv,
                content_sha256=content_hash,
                size_bytes=total_size,
                record_count=len(export["records"]),
                error_code=None,
                ready_at=now,
                expires_at=expires_at,
                updated_at=now,
            )
        )
        self._audit_transition(
            event_type="privacy_export.ready",
            workspace_id=workspace_id,
            target_type="privacy_export",
            target_id=request_event_id,
            attempt=attempt,
            metadata={
                "scope": scope,
                "status": "ready",
                "artifact_id": artifact_id,
                "content_sha256": content_hash,
                "record_count": len(export["records"]),
                "expires_at": _iso(expires_at),
                "delivery_status": "authenticated_download_available",
            },
            now=now,
        )

    def _fail_export(self, *, request_event_id: str, error_code: str, now: datetime) -> None:
        artifact = _row(
            self.session.execute(
                sa.select(privacy_export_artifacts).where(
                    privacy_export_artifacts.c.request_event_id == request_event_id
                )
            ).first()
        )
        if artifact is None:
            request = _row(
                self.session.execute(
                    sa.select(audit_events).where(
                        audit_events.c.id == request_event_id,
                        audit_events.c.event_type == "privacy_export.requested",
                    )
                ).first()
            )
            if request is None:
                return
            artifact_id = _stable_id(_ARTIFACT_NAMESPACE, request_event_id)
            artifact = {
                "id": artifact_id,
                "request_event_id": request_event_id,
                "workspace_id": request.get("workspace_id"),
                "requested_by_user_id": request.get("actor_user_id"),
                "scope": str(request.get("target_type") or "account"),
                "attempts": 1,
            }
            self.session.execute(
                sa.insert(privacy_export_artifacts).values(
                    **artifact,
                    status="failed",
                    size_bytes=0,
                    record_count=0,
                    error_code=error_code[:100],
                    created_at=now,
                    updated_at=now,
                )
            )
        attempt = int(artifact.get("attempts") or 0)
        self.session.execute(
            sa.update(privacy_export_artifacts)
            .where(privacy_export_artifacts.c.id == artifact["id"])
            .values(
                status="failed",
                json_nonce_ciphertext=None,
                csv_nonce_ciphertext=None,
                error_code=error_code[:100],
                updated_at=now,
            )
        )
        self._audit_transition(
            event_type="privacy_export.failed",
            workspace_id=str(artifact.get("workspace_id") or "") or None,
            target_type="privacy_export",
            target_id=request_event_id,
            attempt=attempt,
            metadata={"status": "failed", "error_code": error_code[:100]},
            now=now,
        )

    def _build_export(
        self,
        *,
        request_event_id: str,
        scope: str,
        workspace_id: str,
        user_id: str,
        now: datetime,
    ) -> dict[str, Any]:
        sensitive_values = self._dataset_identifiers(scope=scope, workspace_id=workspace_id, user_id=user_id)
        raw_records = (
            self._workspace_export_records(workspace_id=workspace_id)
            if scope == "workspace"
            else self._account_export_records(user_id=user_id)
        )
        records = [
            {
                "record_type": record_type,
                "record_id": str(record.get("id") or record.get("record_id") or ""),
                "data": _sanitize(record, sensitive_values=sensitive_values),
            }
            for record_type, record in raw_records
        ]
        return {
            "schema_version": "privacy.export.v1",
            "scope": scope,
            "request_event_id": request_event_id,
            "generated_at": _iso(now),
            "retention_policy_version": self.config.retention_policy_version,
            "records": records,
        }

    def _workspace_export_records(self, *, workspace_id: str) -> list[tuple[str, dict[str, Any]]]:
        workspace = _row(
            self.session.execute(
                sa.select(
                    workspaces.c.id,
                    workspaces.c.slug,
                    workspaces.c.name,
                    workspaces.c.status,
                    workspaces.c.created_at,
                    workspaces.c.updated_at,
                ).where(workspaces.c.id == workspace_id)
            ).first()
        )
        if workspace is None:
            raise PrivacyOpsError("workspace_not_found")
        records: list[tuple[str, dict[str, Any]]] = [("workspace", workspace)]
        records.extend(
            self._mapped_rows(
                "workspace_member",
                sa.select(
                    app_users.c.id,
                    app_users.c.primary_email,
                    app_users.c.display_name,
                    app_users.c.status,
                    workspace_memberships.c.role,
                    workspace_memberships.c.created_at,
                )
                .select_from(
                    workspace_memberships.join(
                        app_users, app_users.c.id == workspace_memberships.c.app_user_id
                    )
                )
                .where(workspace_memberships.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "project_member",
                sa.select(
                    app_users.c.id,
                    app_users.c.primary_email,
                    app_users.c.display_name,
                    app_users.c.status,
                    project_memberships.c.project_id,
                    project_memberships.c.role,
                    project_memberships.c.created_at,
                )
                .select_from(
                    project_memberships.join(
                        app_users, app_users.c.id == project_memberships.c.app_user_id
                    )
                )
                .where(project_memberships.c.workspace_id == workspace_id),
            )
        )
        records.extend(self._workspace_platform_records(workspace_id=workspace_id))
        records.extend(self._dynamic_ml_records(scope="workspace", subject_id=workspace_id))
        return records

    def _account_export_records(self, *, user_id: str) -> list[tuple[str, dict[str, Any]]]:
        user = _row(
            self.session.execute(
                sa.select(
                    app_users.c.id,
                    app_users.c.primary_email,
                    app_users.c.display_name,
                    app_users.c.platform_role,
                    app_users.c.status,
                    app_users.c.created_at,
                    app_users.c.updated_at,
                ).where(app_users.c.id == user_id)
            ).first()
        )
        if user is None:
            raise PrivacyOpsError("account_not_found")
        records: list[tuple[str, dict[str, Any]]] = [("account", user)]
        records.extend(
            self._mapped_rows(
                "workspace_membership",
                sa.select(
                    workspaces.c.id,
                    workspaces.c.slug,
                    workspaces.c.name,
                    workspaces.c.status,
                    workspace_memberships.c.role,
                    workspace_memberships.c.created_at,
                )
                .select_from(
                    workspace_memberships.join(
                        workspaces, workspaces.c.id == workspace_memberships.c.workspace_id
                    )
                )
                .where(workspace_memberships.c.app_user_id == user_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "project_membership",
                sa.select(
                    projects.c.id,
                    projects.c.workspace_id,
                    projects.c.slug,
                    projects.c.name,
                    projects.c.status,
                    project_memberships.c.role,
                    project_memberships.c.created_at,
                )
                .select_from(
                    project_memberships.join(
                        projects, projects.c.id == project_memberships.c.project_id
                    )
                )
                .where(project_memberships.c.app_user_id == user_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "report_run",
                sa.select(
                    report_runs.c.id,
                    report_runs.c.workspace_id,
                    report_runs.c.project_id,
                    report_runs.c.schema_version,
                    report_runs.c.status,
                    report_runs.c.generated_at,
                    report_runs.c.created_at,
                ).where(report_runs.c.created_by_user_id == user_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "report_message",
                sa.select(
                    report_messages.c.id,
                    report_messages.c.workspace_id,
                    report_messages.c.project_id,
                    report_messages.c.report_run_id,
                    report_messages.c.role,
                    report_messages.c.content,
                    report_messages.c.metadata_json,
                    report_messages.c.created_at,
                ).where(report_messages.c.app_user_id == user_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "analysis_job",
                sa.select(
                    analysis_jobs.c.id,
                    analysis_jobs.c.workspace_id,
                    analysis_jobs.c.project_id,
                    analysis_jobs.c.job_type,
                    analysis_jobs.c.status,
                    analysis_jobs.c.stage,
                    analysis_jobs.c.progress_pct,
                    analysis_jobs.c.created_at,
                    analysis_jobs.c.completed_at,
                ).where(analysis_jobs.c.created_by_user_id == user_id),
            )
        )
        records.extend(self._legal_acceptance_records(user_id=user_id))
        records.extend(
            self._mapped_rows(
                "deletion_request",
                sa.select(
                    deletion_requests.c.id,
                    deletion_requests.c.workspace_id,
                    deletion_requests.c.request_type,
                    deletion_requests.c.status,
                    deletion_requests.c.execute_after,
                    deletion_requests.c.canceled_at,
                    deletion_requests.c.completed_at,
                    deletion_requests.c.created_at,
                ).where(deletion_requests.c.requested_by_user_id == user_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "audit_event",
                sa.select(
                    audit_events.c.id,
                    audit_events.c.workspace_id,
                    audit_events.c.project_id,
                    audit_events.c.event_type,
                    audit_events.c.target_type,
                    audit_events.c.created_at,
                ).where(audit_events.c.actor_user_id == user_id),
            )
        )
        records.extend(self._dynamic_ml_records(scope="account", subject_id=user_id))
        return records

    def _workspace_platform_records(self, *, workspace_id: str) -> list[tuple[str, dict[str, Any]]]:
        records: list[tuple[str, dict[str, Any]]] = []
        records.extend(
            self._mapped_rows(
                "project",
                sa.select(
                    projects.c.id,
                    projects.c.workspace_id,
                    projects.c.slug,
                    projects.c.name,
                    projects.c.description,
                    projects.c.status,
                    projects.c.is_demo,
                    projects.c.created_at,
                    projects.c.updated_at,
                ).where(projects.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "data_source_status",
                sa.select(
                    project_data_sources.c.id,
                    project_data_sources.c.project_id,
                    project_data_sources.c.source_type,
                    project_data_sources.c.status,
                    project_data_sources.c.scope_kind,
                    project_data_sources.c.last_verified_at,
                    project_data_sources.c.created_at,
                ).where(project_data_sources.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "report_run",
                sa.select(
                    report_runs.c.id,
                    report_runs.c.project_id,
                    report_runs.c.schema_version,
                    report_runs.c.status,
                    report_runs.c.generated_at,
                    report_runs.c.created_at,
                ).where(report_runs.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "report_snapshot",
                sa.select(
                    report_snapshots.c.id,
                    report_snapshots.c.project_id,
                    report_snapshots.c.report_run_id,
                    report_snapshots.c.snapshot_version,
                    report_snapshots.c.title,
                    report_snapshots.c.summary,
                    report_snapshots.c.report_json,
                    report_snapshots.c.created_at,
                ).where(report_snapshots.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "report_message",
                sa.select(
                    report_messages.c.id,
                    report_messages.c.project_id,
                    report_messages.c.report_run_id,
                    report_messages.c.role,
                    report_messages.c.content,
                    report_messages.c.metadata_json,
                    report_messages.c.created_at,
                ).where(report_messages.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "analysis_job",
                sa.select(
                    analysis_jobs.c.id,
                    analysis_jobs.c.project_id,
                    analysis_jobs.c.job_type,
                    analysis_jobs.c.status,
                    analysis_jobs.c.stage,
                    analysis_jobs.c.progress_pct,
                    analysis_jobs.c.result_summary_json,
                    analysis_jobs.c.created_at,
                    analysis_jobs.c.completed_at,
                ).where(analysis_jobs.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "subscription",
                sa.select(
                    subscriptions.c.id,
                    subscriptions.c.plan_key,
                    subscriptions.c.status,
                    subscriptions.c.current_period_start,
                    subscriptions.c.current_period_end,
                    subscriptions.c.cancel_at_period_end,
                    subscriptions.c.canceled_at,
                    subscriptions.c.created_at,
                ).where(subscriptions.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "billing_contact",
                sa.select(
                    billing_customers.c.workspace_id.label("id"),
                    billing_customers.c.provider,
                    billing_customers.c.billing_email,
                    billing_customers.c.created_at,
                    billing_customers.c.updated_at,
                ).where(billing_customers.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "ai_budget",
                sa.select(
                    ai_budget_accounts.c.id,
                    ai_budget_accounts.c.project_id,
                    ai_budget_accounts.c.scope_key,
                    ai_budget_accounts.c.provider,
                    ai_budget_accounts.c.currency,
                    ai_budget_accounts.c.monthly_limit_microunits,
                    ai_budget_accounts.c.warning_percent,
                    ai_budget_accounts.c.hard_limit,
                    ai_budget_accounts.c.enabled,
                    ai_budget_accounts.c.created_at,
                ).where(ai_budget_accounts.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "ai_usage",
                sa.select(
                    ai_usage_ledger.c.id,
                    ai_usage_ledger.c.project_id,
                    ai_usage_ledger.c.provider,
                    ai_usage_ledger.c.model,
                    ai_usage_ledger.c.operation,
                    ai_usage_ledger.c.input_tokens,
                    ai_usage_ledger.c.output_tokens,
                    ai_usage_ledger.c.estimated_cost_microunits,
                    ai_usage_ledger.c.currency,
                    ai_usage_ledger.c.occurred_at,
                ).where(ai_usage_ledger.c.workspace_id == workspace_id),
            )
        )
        records.extend(self._legal_acceptance_records(workspace_id=workspace_id))
        records.extend(
            self._mapped_rows(
                "deletion_request",
                sa.select(
                    deletion_requests.c.id,
                    deletion_requests.c.request_type,
                    deletion_requests.c.status,
                    deletion_requests.c.execute_after,
                    deletion_requests.c.canceled_at,
                    deletion_requests.c.completed_at,
                    deletion_requests.c.created_at,
                ).where(deletion_requests.c.workspace_id == workspace_id),
            )
        )
        records.extend(
            self._mapped_rows(
                "audit_event",
                sa.select(
                    audit_events.c.id,
                    audit_events.c.project_id,
                    audit_events.c.event_type,
                    audit_events.c.target_type,
                    audit_events.c.created_at,
                ).where(audit_events.c.workspace_id == workspace_id),
            )
        )
        return records

    def _legal_acceptance_records(
        self,
        *,
        user_id: str | None = None,
        workspace_id: str | None = None,
    ) -> list[tuple[str, dict[str, Any]]]:
        query = (
            sa.select(
                legal_acceptances.c.id,
                legal_acceptances.c.workspace_id,
                legal_document_versions.c.document_key,
                legal_document_versions.c.version,
                legal_acceptances.c.accepted_at,
            )
            .select_from(
                legal_acceptances.join(
                    legal_document_versions,
                    legal_document_versions.c.id == legal_acceptances.c.document_version_id,
                )
            )
        )
        if user_id is not None:
            query = query.where(legal_acceptances.c.app_user_id == user_id)
        if workspace_id is not None:
            query = query.where(legal_acceptances.c.workspace_id == workspace_id)
        return self._mapped_rows("legal_acceptance", query)

    def _mapped_rows(self, record_type: str, query: sa.Select) -> list[tuple[str, dict[str, Any]]]:
        return [(record_type, dict(row)) for row in self.session.execute(query).mappings().all()]

    def _dynamic_ml_records(self, *, scope: str, subject_id: str) -> list[tuple[str, dict[str, Any]]]:
        # Reflect through the session connection.  Besides seeing the current
        # transaction consistently, this avoids a second SQLite connection
        # rolling back the StaticPool transaction used by contract tests.
        bind = self.session.connection()
        inspector = sa.inspect(bind)
        records: list[tuple[str, dict[str, Any]]] = []
        reflection = sa.MetaData()
        for table_name in _ML_TENANT_TABLES:
            if not inspector.has_table(table_name):
                continue
            table = sa.Table(table_name, reflection, autoload_with=bind)
            scope_column = "workspace_id" if scope == "workspace" else "created_by_user_id"
            if scope_column not in table.c:
                continue
            query = sa.select(table).where(table.c[scope_column] == subject_id)
            for row in self.session.execute(query).mappings().all():
                records.append((f"market_lens.{table_name}", dict(row)))
        return records

    def _dataset_identifiers(self, *, scope: str, workspace_id: str, user_id: str) -> tuple[str, ...]:
        query = sa.select(
            project_data_sources.c.gcp_project_id,
            project_data_sources.c.dataset_id,
        )
        if scope == "workspace":
            query = query.where(project_data_sources.c.workspace_id == workspace_id)
        else:
            workspace_ids = sa.union(
                sa.select(workspace_memberships.c.workspace_id).where(
                    workspace_memberships.c.app_user_id == user_id
                ),
                sa.select(project_memberships.c.workspace_id).where(
                    project_memberships.c.app_user_id == user_id
                ),
            )
            query = query.where(project_data_sources.c.workspace_id.in_(workspace_ids))
        values: set[str] = set()
        for row in self.session.execute(query).mappings().all():
            for key in ("gcp_project_id", "dataset_id"):
                value = str(row.get(key) or "").strip()
                if len(value) >= 3:
                    values.add(value)
        return tuple(sorted(values, key=len, reverse=True))

    @staticmethod
    def _build_csv(records: Sequence[Mapping[str, Any]]) -> bytes:
        output = io.StringIO(newline="")
        writer = csv.DictWriter(
            output,
            fieldnames=("record_type", "record_id", "data_json"),
            extrasaction="ignore",
            lineterminator="\n",
        )
        writer.writeheader()
        for record in records:
            writer.writerow(
                {
                    "record_type": _csv_safe(str(record.get("record_type") or "")),
                    "record_id": _csv_safe(str(record.get("record_id") or "")),
                    "data_json": json.dumps(
                        record.get("data") or {},
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                }
            )
        return output.getvalue().encode("utf-8-sig")

    def _process_deletion(self, *, request_id: str, now: datetime) -> str:
        request = _row(
            self.session.execute(
                sa.select(deletion_requests)
                .where(deletion_requests.c.id == request_id)
                .with_for_update(skip_locked=True)
            ).first()
        )
        if request is None:
            return "skipped"
        if (
            request.get("status") != "requested"
            or request.get("canceled_at") is not None
            or (_aware(request.get("execute_after")) or now + timedelta(days=1)) > now
        ):
            return "skipped"
        scope = str(request.get("request_type") or "")
        if scope not in {"account", "workspace"}:
            return self._block_deletion(request=request, error_code="deletion_scope_invalid", now=now)
        user_id = str(request.get("requested_by_user_id") or "")
        workspace_id = str(request.get("workspace_id") or "")
        if not user_id or not workspace_id:
            return self._block_deletion(request=request, error_code="deletion_subject_not_found", now=now)

        try:
            if scope == "account":
                account_status = self.session.scalar(
                    sa.select(app_users.c.status).where(app_users.c.id == user_id)
                )
                if account_status != "active":
                    raise PrivacyOpsError("account_not_found")
                self._ensure_not_last_owner(user_id=user_id)
            else:
                workspace_status = self.session.scalar(
                    sa.select(workspaces.c.status).where(workspaces.c.id == workspace_id)
                )
                if workspace_status not in {"active", "suspended"}:
                    raise PrivacyOpsError("workspace_not_found")
                self._ensure_workspace_billing_inactive(workspace_id=workspace_id)
        except PrivacyOpsError as exc:
            return self._block_deletion(request=request, error_code=exc.code, now=now)

        updated = self.session.execute(
            sa.update(deletion_requests)
            .where(
                deletion_requests.c.id == request_id,
                deletion_requests.c.status == "requested",
                deletion_requests.c.canceled_at.is_(None),
            )
            .values(status="processing", error_message=None, updated_at=now)
        )
        if updated.rowcount != 1:
            return "skipped"
        self._audit_transition(
            event_type="privacy_deletion.processing",
            workspace_id=workspace_id,
            target_type="deletion_request",
            target_id=request_id,
            attempt=1,
            metadata={"scope": scope, "status": "processing"},
            now=now,
        )

        if scope == "account":
            self._delete_account(user_id=user_id, now=now)
        else:
            self._delete_workspace(workspace_id=workspace_id, now=now)

        self.session.execute(
            sa.update(deletion_requests)
            .where(deletion_requests.c.id == request_id)
            .values(
                status="completed",
                requested_by_user_id=None if scope == "account" else user_id,
                completed_at=now,
                error_message=None,
                updated_at=now,
            )
        )
        self._audit_transition(
            event_type="privacy_deletion.completed",
            workspace_id=workspace_id,
            target_type="deletion_request",
            target_id=request_id,
            attempt=1,
            metadata={
                "scope": scope,
                "status": "completed",
                "retention_policy_version": self.config.retention_policy_version,
            },
            now=now,
        )
        return "completed"

    def _block_deletion(
        self,
        *,
        request: Mapping[str, Any],
        error_code: str,
        now: datetime,
    ) -> str:
        self.session.execute(
            sa.update(deletion_requests)
            .where(
                deletion_requests.c.id == request["id"],
                deletion_requests.c.status == "requested",
            )
            .values(error_message=error_code[:100], updated_at=now)
        )
        self._audit_transition(
            event_type="privacy_deletion.blocked",
            workspace_id=str(request.get("workspace_id") or "") or None,
            target_type="deletion_request",
            target_id=str(request["id"]),
            attempt=1,
            metadata={
                "scope": str(request.get("request_type") or ""),
                "status": "blocked",
                "error_code": error_code[:100],
            },
            now=now,
        )
        return "blocked"

    def _ensure_not_last_owner(self, *, user_id: str) -> None:
        workspace_ids = self.session.scalars(
            sa.select(workspace_memberships.c.workspace_id)
            .join(workspaces, workspaces.c.id == workspace_memberships.c.workspace_id)
            .where(
                workspace_memberships.c.app_user_id == user_id,
                workspace_memberships.c.role == "workspace_owner",
                workspaces.c.status == "active",
            )
        ).all()
        for workspace_id in workspace_ids:
            owners = self.session.scalar(
                sa.select(sa.func.count())
                .select_from(workspace_memberships)
                .join(app_users, app_users.c.id == workspace_memberships.c.app_user_id)
                .where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.role == "workspace_owner",
                    app_users.c.status == "active",
                )
            )
            if int(owners or 0) <= 1:
                raise PrivacyOpsError("last_owner")

    def _ensure_workspace_billing_inactive(self, *, workspace_id: str) -> None:
        active = self.session.scalar(
            sa.select(sa.func.count())
            .select_from(subscriptions)
            .where(
                subscriptions.c.workspace_id == workspace_id,
                subscriptions.c.status.not_in(_DELETION_SAFE_BILLING_STATUSES),
            )
        )
        if int(active or 0) > 0:
            raise PrivacyOpsError("active_billing_subscription")

    def _delete_account(self, *, user_id: str, now: datetime) -> None:
        user = _row(
            self.session.execute(
                sa.select(app_users).where(app_users.c.id == user_id).with_for_update()
            ).first()
        )
        if user is None:
            raise PrivacyOpsError("account_not_found")
        self.session.execute(
            sa.update(report_messages)
            .where(report_messages.c.app_user_id == user_id)
            .values(
                app_user_id=None,
                content="[account data deleted]",
                metadata_json=None,
            )
        )
        self.session.execute(
            sa.update(report_runs)
            .where(report_runs.c.created_by_user_id == user_id)
            .values(created_by_user_id=None)
        )
        self.session.execute(
            sa.update(analysis_jobs)
            .where(analysis_jobs.c.created_by_user_id == user_id)
            .values(created_by_user_id=None)
        )
        self.session.execute(
            sa.update(ai_usage_ledger)
            .where(ai_usage_ledger.c.app_user_id == user_id)
            .values(app_user_id=None)
        )
        self._clear_dynamic_ml_creator(user_id=user_id)
        self.session.execute(
            sa.delete(project_memberships).where(project_memberships.c.app_user_id == user_id)
        )
        self.session.execute(
            sa.delete(workspace_memberships).where(workspace_memberships.c.app_user_id == user_id)
        )
        self.session.execute(
            sa.update(legal_acceptances)
            .where(legal_acceptances.c.app_user_id == user_id)
            .values(app_user_id=None)
        )
        self.session.execute(
            sa.update(privacy_export_artifacts)
            .where(privacy_export_artifacts.c.requested_by_user_id == user_id)
            .values(
                requested_by_user_id=None,
                status="expired",
                encryption_key_id=None,
                json_nonce_ciphertext=None,
                csv_nonce_ciphertext=None,
                content_sha256=None,
                size_bytes=0,
                record_count=0,
                updated_at=now,
            )
        )
        self.session.execute(
            sa.update(audit_events)
            .where(audit_events.c.actor_user_id == user_id)
            .values(
                actor_user_id=None,
                target_id=None,
                request_id=None,
                metadata_json={"retained_for": "security_audit"},
                ip_hash=None,
                user_agent_hash=None,
            )
        )
        self.session.execute(
            sa.update(app_users)
            .where(app_users.c.id == user_id)
            .values(
                primary_email=None,
                display_name=None,
                platform_role=None,
                status="deleted",
                deleted_at=now,
                updated_at=now,
            )
        )

    def _delete_workspace(self, *, workspace_id: str, now: datetime) -> None:
        workspace = _row(
            self.session.execute(
                sa.select(workspaces).where(workspaces.c.id == workspace_id).with_for_update()
            ).first()
        )
        if workspace is None:
            raise PrivacyOpsError("workspace_not_found")
        self.session.execute(sa.delete(projects).where(projects.c.workspace_id == workspace_id))
        self.session.execute(
            sa.delete(workspace_memberships).where(workspace_memberships.c.workspace_id == workspace_id)
        )
        self.session.execute(
            sa.delete(rate_limit_buckets).where(rate_limit_buckets.c.workspace_id == workspace_id)
        )
        self.session.execute(
            sa.delete(ai_budget_accounts).where(ai_budget_accounts.c.workspace_id == workspace_id)
        )
        self.session.execute(
            sa.delete(ai_usage_ledger).where(ai_usage_ledger.c.workspace_id == workspace_id)
        )
        self.session.execute(
            sa.delete(legal_acceptances).where(legal_acceptances.c.workspace_id == workspace_id)
        )
        self.session.execute(
            sa.delete(billing_webhook_events).where(
                billing_webhook_events.c.workspace_id == workspace_id
            )
        )
        self.session.execute(sa.delete(subscriptions).where(subscriptions.c.workspace_id == workspace_id))
        self.session.execute(
            sa.delete(billing_customers).where(billing_customers.c.workspace_id == workspace_id)
        )
        self.session.execute(
            sa.update(privacy_export_artifacts)
            .where(privacy_export_artifacts.c.workspace_id == workspace_id)
            .values(
                status="expired",
                json_nonce_ciphertext=None,
                csv_nonce_ciphertext=None,
                workspace_id=None,
                updated_at=now,
            )
        )
        self.session.execute(
            sa.update(audit_events)
            .where(audit_events.c.workspace_id == workspace_id)
            .values(
                project_id=None,
                target_id=None,
                request_id=None,
                metadata_json={"retained_for": "security_audit"},
                ip_hash=None,
                user_agent_hash=None,
            )
        )
        tombstone = hashlib.sha256(workspace_id.encode("utf-8")).hexdigest()[:16]
        self.session.execute(
            sa.update(workspaces)
            .where(workspaces.c.id == workspace_id)
            .values(
                slug=f"deleted-{tombstone}",
                name="Deleted workspace",
                status="deleted",
                is_internal=False,
                deleted_at=now,
                updated_at=now,
            )
        )

    def _clear_dynamic_ml_creator(self, *, user_id: str) -> None:
        bind = self.session.connection()
        inspector = sa.inspect(bind)
        reflection = sa.MetaData()
        for table_name in _ML_TENANT_TABLES:
            if not inspector.has_table(table_name):
                continue
            table = sa.Table(table_name, reflection, autoload_with=bind)
            if "created_by_user_id" in table.c:
                self.session.execute(
                    sa.update(table)
                    .where(table.c.created_by_user_id == user_id)
                    .values(created_by_user_id=None)
                )

    def _audit_transition(
        self,
        *,
        event_type: str,
        workspace_id: str | None,
        target_type: str,
        target_id: str,
        attempt: int,
        metadata: Mapping[str, Any],
        now: datetime,
    ) -> None:
        event_id = _stable_id(_AUDIT_NAMESPACE, event_type, target_id, str(attempt))
        exists = self.session.scalar(
            sa.select(audit_events.c.id).where(audit_events.c.id == event_id)
        )
        if exists is not None:
            return
        self.session.execute(
            sa.insert(audit_events).values(
                id=event_id,
                workspace_id=workspace_id,
                actor_user_id=None,
                event_type=event_type,
                target_type=target_type,
                target_id=target_id,
                request_id=None,
                metadata_json=dict(metadata),
                created_at=now,
            )
        )


def _sanitize(value: Any, *, sensitive_values: Sequence[str]) -> Any:
    if isinstance(value, Mapping):
        result: dict[str, Any] = {}
        for key, child in value.items():
            key_text = str(key)
            if _SECRET_KEY_RE.search(key_text):
                continue
            result[key_text] = _sanitize(child, sensitive_values=sensitive_values)
        return result
    if isinstance(value, (list, tuple, set)):
        return [_sanitize(item, sensitive_values=sensitive_values) for item in value]
    if isinstance(value, datetime):
        return _iso(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return "[binary omitted]"
    if isinstance(value, str):
        result = value
        for sensitive in sensitive_values:
            result = result.replace(sensitive, "[data source identifier redacted]")
        result = _PRIVATE_KEY_RE.sub("[private key redacted]", result)
        result = _JWT_RE.sub("[jwt redacted]", result)
        result = _GOOGLE_KEY_RE.sub("[api key redacted]", result)
        result = _STRIPE_KEY_RE.sub("[provider key redacted]", result)
        result = _COMMON_PROVIDER_KEY_RE.sub("[provider key redacted]", result)
        result = _ASSIGNED_SECRET_RE.sub("[assigned secret redacted]", result)
        result = _BEARER_RE.sub("Bearer [token redacted]", result)
        return result
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)


def _csv_safe(value: str) -> str:
    return f"'{value}" if value.startswith(("=", "+", "-", "@")) else value
