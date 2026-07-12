"""DB-backed legal consent, privacy export requests, and deletion grace periods.

No legal prose is generated here.  Only already-published document metadata is
returned, and unpublished/missing required versions fail closed.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping
from urllib.parse import urlparse

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..platform.schema import (
    app_users,
    audit_events,
    deletion_requests,
    legal_acceptances,
    legal_document_versions,
    workspace_memberships,
    workspaces,
)
from .config import LegalConfig
from .errors import (
    LastOwnerConflict,
    LegalAcceptanceRequired,
    LegalConflict,
    LegalDocumentsUnavailable,
    LegalNotFound,
    LegalVersionConflict,
)
from .identity import LegalIdentity, require_workspace_manager


_IDEMPOTENCY_NAMESPACE = uuid.UUID("9b04fcd3-0f91-4d6e-88ba-e3a8bb28f158")
_DELETION_GRACE_DAYS = 30
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    aware = _aware(value)
    return aware.isoformat() if aware else None


def _row(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    mapping = row._mapping if hasattr(row, "_mapping") else row
    return dict(mapping)


def _stable_id(*parts: str) -> str:
    return str(uuid.uuid5(_IDEMPOTENCY_NAMESPACE, "\x1f".join(parts)))


def _request_hash(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        dict(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class LegalService:
    def __init__(
        self,
        session: Session,
        *,
        config: LegalConfig,
        now_provider: Callable[[], datetime] = _utcnow,
    ) -> None:
        self.session = session
        self.config = config
        self.now_provider = now_provider

    def latest_documents(self) -> list[dict[str, Any]]:
        documents = self._current_documents()
        missing = set(self.config.required_document_keys) - set(documents)
        if not documents or missing:
            raise LegalDocumentsUnavailable("required legal documents are not published")
        return [self._document_view(documents[key]) for key in sorted(documents)]

    def acceptance_status(self, identity: LegalIdentity) -> dict[str, Any]:
        documents = self._required_current_documents()
        statuses: list[dict[str, Any]] = []
        for key in self.config.required_document_keys:
            document = documents[key]
            accepted = self._accepted_document(identity, key, document)
            statuses.append(
                {
                    "document_key": key,
                    "current_version": str(document["version"]),
                    "accepted": accepted is not None,
                    "accepted_version": (
                        str(accepted["version"]) if accepted is not None else None
                    ),
                    "requires_acceptance": accepted is None,
                }
            )
        return {
            "all_required_accepted": all(item["accepted"] for item in statuses),
            "documents": statuses,
        }

    def require_current_acceptance(self, identity: LegalIdentity) -> None:
        if not self.acceptance_status(identity)["all_required_accepted"]:
            raise LegalAcceptanceRequired("current legal acceptance is required")

    def accept_document(
        self,
        identity: LegalIdentity,
        *,
        document_key: str,
        version: str,
        idempotency_key: str,
        client_ip: str | None = None,
        user_agent: str | None = None,
    ) -> dict[str, Any]:
        documents = self._current_documents()
        document = documents.get(document_key)
        if document is None:
            raise LegalDocumentsUnavailable("legal document is not published")
        self._document_view(document)
        if str(document["version"]) != version:
            raise LegalVersionConflict("only the current published version may be accepted")

        acceptance_id = _stable_id(
            "accept",
            identity.user_id,
            identity.workspace_id,
            idempotency_key,
        )
        idempotent = _row(
            self.session.execute(
                sa.select(legal_acceptances).where(legal_acceptances.c.id == acceptance_id)
            ).first()
        )
        if idempotent is not None:
            if str(idempotent["document_version_id"]) != str(document["id"]):
                raise LegalConflict("idempotency key was used with another document")
            return self._acceptance_view(idempotent, document, created=False)

        existing = _row(
            self.session.execute(
                sa.select(legal_acceptances).where(
                    legal_acceptances.c.app_user_id == identity.user_id,
                    legal_acceptances.c.workspace_id == identity.workspace_id,
                    legal_acceptances.c.document_version_id == document["id"],
                )
            ).first()
        )
        if existing is not None:
            return self._acceptance_view(existing, document, created=False)

        now = _aware(self.now_provider()) or _utcnow()
        subject_hash = self._private_hash("subject", identity.user_id)
        values = {
            "id": acceptance_id,
            "app_user_id": identity.user_id,
            "workspace_id": identity.workspace_id,
            "document_version_id": document["id"],
            "subject_user_ref_hash": subject_hash,
            "workspace_scope_key": identity.workspace_id,
            "accepted_at": now,
            "ip_hash": self._private_hash("ip", client_ip) if client_ip else None,
            "user_agent_hash": (
                self._private_hash("user-agent", user_agent) if user_agent else None
            ),
            "created_at": now,
        }
        try:
            with self.session.begin_nested():
                self.session.execute(sa.insert(legal_acceptances).values(**values))
        except IntegrityError:
            existing = _row(
                self.session.execute(
                    sa.select(legal_acceptances).where(
                        legal_acceptances.c.app_user_id == identity.user_id,
                        legal_acceptances.c.workspace_id == identity.workspace_id,
                        legal_acceptances.c.document_version_id == document["id"],
                    )
                ).first()
            )
            if existing is None:
                raise
            return self._acceptance_view(existing, document, created=False)
        self.session.flush()
        return self._acceptance_view(values, document, created=True)

    def request_data_export(
        self,
        identity: LegalIdentity,
        *,
        scope: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        if scope == "workspace":
            require_workspace_manager(identity)
            target = identity.workspace_id
        elif scope == "account":
            target = identity.user_id
        else:
            raise LegalConflict("unsupported export scope")

        target_hash = self._private_hash(f"export-{scope}", target)
        request_data = {"scope": scope, "target_hash": target_hash}
        job_id = _stable_id("export", identity.user_id, idempotency_key)
        existing = _row(
            self.session.execute(
                sa.select(audit_events).where(
                    audit_events.c.id == job_id,
                    audit_events.c.actor_user_id == identity.user_id,
                    audit_events.c.event_type == "privacy_export.requested",
                )
            ).first()
        )
        if existing is not None:
            metadata = existing.get("metadata_json") or {}
            if metadata.get("request_hash") != _request_hash(request_data):
                raise LegalConflict("idempotency key was used with another export scope")
            return self._export_view(existing, created=False)

        now = _aware(self.now_provider()) or _utcnow()
        values = {
            "id": job_id,
            "workspace_id": identity.workspace_id,
            "actor_user_id": identity.user_id,
            "event_type": "privacy_export.requested",
            "target_type": scope,
            "target_id": target_hash,
            "request_id": hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest(),
            "metadata_json": {
                "request_hash": _request_hash(request_data),
                "scope": scope,
                "status": "requested",
            },
            "created_at": now,
        }
        try:
            with self.session.begin_nested():
                self.session.execute(sa.insert(audit_events).values(**values))
        except IntegrityError:
            existing = _row(
                self.session.execute(
                    sa.select(audit_events).where(
                        audit_events.c.id == job_id,
                        audit_events.c.actor_user_id == identity.user_id,
                        audit_events.c.event_type == "privacy_export.requested",
                    )
                ).first()
            )
            if existing is None:
                raise
            metadata = existing.get("metadata_json") or {}
            if metadata.get("request_hash") != _request_hash(request_data):
                raise LegalConflict("idempotency key was used with another export scope")
            return self._export_view(existing, created=False)
        self.session.flush()
        return self._export_view(values, created=True)

    def request_deletion(
        self,
        identity: LegalIdentity,
        *,
        scope: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        if scope == "workspace":
            require_workspace_manager(identity)
            target = identity.workspace_id
        elif scope == "account":
            self._protect_last_owner(identity.user_id)
            target = identity.user_id
        else:
            raise LegalConflict("unsupported deletion scope")

        target_hash = self._private_hash(f"deletion-{scope}", target)
        request_id = _stable_id(
            "deletion",
            identity.user_id,
            identity.workspace_id,
            idempotency_key,
        )
        replay = _row(
            self.session.execute(
                sa.select(deletion_requests).where(deletion_requests.c.id == request_id)
            ).first()
        )
        if replay is not None:
            if (
                replay["request_type"] != scope
                or replay["target_ref_hash"] != target_hash
            ):
                raise LegalConflict("idempotency key was used with another deletion target")
            self._authorize_deletion(identity, replay)
            return self._deletion_view(replay, created=False)

        active = _row(
            self.session.execute(
                sa.select(deletion_requests).where(
                    deletion_requests.c.request_type == scope,
                    deletion_requests.c.target_ref_hash == target_hash,
                    deletion_requests.c.status.in_(("requested", "processing")),
                )
            ).first()
        )
        if active is not None:
            self._authorize_deletion(identity, active)
            return self._deletion_view(active, created=False)

        now = _aware(self.now_provider()) or _utcnow()
        values = {
            "id": request_id,
            "requested_by_user_id": identity.user_id,
            "workspace_id": identity.workspace_id,
            "request_type": scope,
            "target_ref_hash": target_hash,
            "status": "requested",
            "execute_after": now + timedelta(days=_DELETION_GRACE_DAYS),
            "created_at": now,
            "updated_at": now,
        }
        try:
            with self.session.begin_nested():
                self.session.execute(sa.insert(deletion_requests).values(**values))
        except IntegrityError:
            active = _row(
                self.session.execute(
                    sa.select(deletion_requests).where(
                        deletion_requests.c.request_type == scope,
                        deletion_requests.c.target_ref_hash == target_hash,
                        deletion_requests.c.status.in_(("requested", "processing")),
                    )
                ).first()
            )
            if active is None:
                raise
            self._authorize_deletion(identity, active)
            return self._deletion_view(active, created=False)
        self.session.flush()
        self._record_deletion_requested(
            identity=identity,
            request=values,
            idempotency_key=idempotency_key,
        )
        return self._deletion_view(values, created=True)

    def list_deletion_requests(self, identity: LegalIdentity) -> list[dict[str, Any]]:
        account_scope = sa.and_(
            deletion_requests.c.request_type == "account",
            deletion_requests.c.requested_by_user_id == identity.user_id,
        )
        visible = account_scope
        if identity.can_manage_workspace:
            visible = sa.or_(
                account_scope,
                sa.and_(
                    deletion_requests.c.request_type == "workspace",
                    deletion_requests.c.workspace_id == identity.workspace_id,
                ),
            )
        rows = self.session.execute(
            sa.select(deletion_requests)
            .where(visible)
            .order_by(deletion_requests.c.created_at.desc())
        ).all()
        return [self._deletion_view(_row(row) or {}, created=False) for row in rows]

    def cancel_deletion(
        self,
        identity: LegalIdentity,
        *,
        request_id: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        audit_id = _stable_id(
            "cancel-deletion",
            identity.user_id,
            identity.workspace_id,
            idempotency_key,
        )
        cancel_request_hash = _request_hash({"request_id": request_id})
        replay = _row(
            self.session.execute(
                sa.select(audit_events).where(
                    audit_events.c.id == audit_id,
                    audit_events.c.actor_user_id == identity.user_id,
                    audit_events.c.event_type == "privacy_deletion.canceled",
                )
            ).first()
        )
        if replay is not None:
            metadata = replay.get("metadata_json") or {}
            if metadata.get("request_hash") != cancel_request_hash:
                raise LegalConflict("idempotency key was used for another cancellation")
        request = _row(
            self.session.execute(
                sa.select(deletion_requests).where(deletion_requests.c.id == request_id)
            ).first()
        )
        if request is None:
            raise LegalNotFound("deletion request was not found")
        self._authorize_deletion(identity, request)
        if replay is not None:
            if request.get("status") != "canceled":
                raise LegalConflict("cancellation state is inconsistent")
            return self._deletion_view(request, created=False)
        if request["status"] == "canceled":
            self._record_cancellation(
                audit_id=audit_id,
                identity=identity,
                request_id=request_id,
                idempotency_key=idempotency_key,
                request_hash=cancel_request_hash,
            )
            return self._deletion_view(request, created=False)
        if request["status"] != "requested":
            raise LegalConflict("deletion request can no longer be canceled")

        now = _aware(self.now_provider()) or _utcnow()
        updated = self.session.execute(
            sa.update(deletion_requests)
            .where(
                deletion_requests.c.id == request_id,
                deletion_requests.c.status == "requested",
            )
            .values(status="canceled", canceled_at=now, updated_at=now)
        )
        if updated.rowcount != 1:
            current = _row(
                self.session.execute(
                    sa.select(deletion_requests).where(
                        deletion_requests.c.id == request_id
                    )
                ).first()
            )
            if current is None or current.get("status") != "canceled":
                raise LegalConflict("deletion request can no longer be canceled")
            request = current
        else:
            request.update(status="canceled", canceled_at=now, updated_at=now)
        self._record_cancellation(
            audit_id=audit_id,
            identity=identity,
            request_id=request_id,
            idempotency_key=idempotency_key,
            request_hash=cancel_request_hash,
        )
        self.session.flush()
        return self._deletion_view(request, created=False)

    def _record_cancellation(
        self,
        *,
        audit_id: str,
        identity: LegalIdentity,
        request_id: str,
        idempotency_key: str,
        request_hash: str,
    ) -> None:
        now = _aware(self.now_provider()) or _utcnow()
        try:
            with self.session.begin_nested():
                self.session.execute(
                    sa.insert(audit_events).values(
                        id=audit_id,
                        workspace_id=identity.workspace_id,
                        actor_user_id=identity.user_id,
                        event_type="privacy_deletion.canceled",
                        target_type="deletion_request",
                        target_id=request_id,
                        request_id=hashlib.sha256(
                            idempotency_key.encode("utf-8")
                        ).hexdigest(),
                        metadata_json={"request_hash": request_hash},
                        created_at=now,
                    )
                )
        except IntegrityError:
            existing = _row(
                self.session.execute(
                    sa.select(audit_events).where(audit_events.c.id == audit_id)
                ).first()
            )
            metadata = existing.get("metadata_json") if existing else None
            if not isinstance(metadata, Mapping) or metadata.get("request_hash") != request_hash:
                raise LegalConflict("idempotency key was used for another cancellation")

    def _record_deletion_requested(
        self,
        *,
        identity: LegalIdentity,
        request: Mapping[str, Any],
        idempotency_key: str,
    ) -> None:
        request_id = str(request["id"])
        audit_id = _stable_id("request-deletion-audit", request_id)
        now = _aware(self.now_provider()) or _utcnow()
        try:
            with self.session.begin_nested():
                self.session.execute(
                    sa.insert(audit_events).values(
                        id=audit_id,
                        workspace_id=identity.workspace_id,
                        actor_user_id=identity.user_id,
                        event_type="privacy_deletion.requested",
                        target_type="deletion_request",
                        target_id=request_id,
                        request_id=hashlib.sha256(
                            idempotency_key.encode("utf-8")
                        ).hexdigest(),
                        metadata_json={
                            "scope": str(request["request_type"]),
                            "status": "requested",
                            "execute_after": _iso(request.get("execute_after")),
                        },
                        created_at=now,
                    )
                )
        except IntegrityError:
            existing = self.session.scalar(
                sa.select(audit_events.c.id).where(audit_events.c.id == audit_id)
            )
            if existing is None:
                raise

    def _required_current_documents(self) -> dict[str, dict[str, Any]]:
        if not self.config.required_document_keys:
            raise LegalDocumentsUnavailable("required legal document keys are not configured")
        documents = self._current_documents()
        missing = set(self.config.required_document_keys) - set(documents)
        if missing:
            raise LegalDocumentsUnavailable("required legal documents are not published")
        for key in self.config.required_document_keys:
            self._document_view(documents[key])
        return documents

    def _current_documents(self) -> dict[str, dict[str, Any]]:
        now = _aware(self.now_provider()) or _utcnow()
        rows = self.session.execute(
            sa.select(legal_document_versions)
            .where(
                legal_document_versions.c.published_at.is_not(None),
                legal_document_versions.c.published_at <= now,
                legal_document_versions.c.effective_at <= now,
            )
            .order_by(
                legal_document_versions.c.document_key.asc(),
                legal_document_versions.c.effective_at.desc(),
                legal_document_versions.c.revision_number.desc(),
            )
        ).all()
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            document = _row(row) or {}
            key = str(document.get("document_key") or "")
            if key and key not in result:
                result[key] = document
        return result

    def _accepted_document(
        self,
        identity: LegalIdentity,
        document_key: str,
        current: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        now = _aware(self.now_provider()) or _utcnow()
        rows = self.session.execute(
            sa.select(
                legal_acceptances.c.document_version_id,
                legal_acceptances.c.accepted_at,
                legal_document_versions.c.id,
                legal_document_versions.c.version,
            )
            .join(
                legal_document_versions,
                legal_document_versions.c.id == legal_acceptances.c.document_version_id,
            )
            .where(
                legal_acceptances.c.app_user_id == identity.user_id,
                legal_acceptances.c.workspace_id == identity.workspace_id,
                legal_document_versions.c.document_key == document_key,
                legal_document_versions.c.published_at.is_not(None),
                legal_document_versions.c.published_at <= now,
                legal_document_versions.c.effective_at <= now,
            )
            .order_by(legal_acceptances.c.accepted_at.desc())
        ).mappings().all()
        for row in rows:
            if str(row["document_version_id"]) == str(current["id"]):
                return dict(row)
        if not bool(current.get("requires_reacceptance")) and rows:
            return dict(rows[0])
        return None

    def _protect_last_owner(self, user_id: str) -> None:
        owned_workspace_ids = self.session.scalars(
            sa.select(workspace_memberships.c.workspace_id)
            .join(workspaces, workspaces.c.id == workspace_memberships.c.workspace_id)
            .where(
                workspace_memberships.c.app_user_id == user_id,
                workspace_memberships.c.role == "workspace_owner",
                workspaces.c.status == "active",
            )
        ).all()
        for workspace_id in owned_workspace_ids:
            active_owner_count = self.session.scalar(
                sa.select(sa.func.count())
                .select_from(workspace_memberships)
                .join(app_users, app_users.c.id == workspace_memberships.c.app_user_id)
                .where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.role == "workspace_owner",
                    app_users.c.status == "active",
                )
            )
            if int(active_owner_count or 0) <= 1:
                raise LastOwnerConflict("account is the last owner of an active workspace")

    @staticmethod
    def _authorize_deletion(
        identity: LegalIdentity,
        request: Mapping[str, Any],
    ) -> None:
        if request.get("request_type") == "account":
            if str(request.get("requested_by_user_id") or "") != identity.user_id:
                raise LegalNotFound("deletion request was not found")
            return
        if (
            request.get("request_type") == "workspace"
            and str(request.get("workspace_id") or "") == identity.workspace_id
            and identity.can_manage_workspace
        ):
            return
        raise LegalNotFound("deletion request was not found")

    def _private_hash(self, namespace: str, value: str | None) -> str:
        secret = self.config.require_hash_secret().encode("utf-8")
        message = f"{namespace}\x1f{value or ''}".encode("utf-8")
        return hmac.new(secret, message, hashlib.sha256).hexdigest()

    @staticmethod
    def _document_view(document: Mapping[str, Any]) -> dict[str, Any]:
        public_url = str(document.get("public_url") or "")
        parsed_url = urlparse(public_url)
        content_sha256 = str(document.get("content_sha256") or "")
        if (
            parsed_url.scheme != "https"
            or not parsed_url.netloc
            or not _SHA256_RE.fullmatch(content_sha256)
        ):
            raise LegalDocumentsUnavailable("published legal document metadata is invalid")
        return {
            "document_key": str(document["document_key"]),
            "version": str(document["version"]),
            "title": str(document["title"]),
            "public_url": public_url,
            "content_sha256": content_sha256,
            "effective_at": _iso(document.get("effective_at")),
            "requires_reacceptance": bool(document.get("requires_reacceptance")),
            "required_at_signup": bool(document.get("required_at_signup")),
        }

    @staticmethod
    def _acceptance_view(
        acceptance: Mapping[str, Any],
        document: Mapping[str, Any],
        *,
        created: bool,
    ) -> dict[str, Any]:
        return {
            "created": created,
            "document_key": str(document["document_key"]),
            "version": str(document["version"]),
            "accepted_at": _iso(acceptance.get("accepted_at")),
        }

    @staticmethod
    def _export_view(event: Mapping[str, Any], *, created: bool) -> dict[str, Any]:
        metadata = event.get("metadata_json") or {}
        return {
            "job_id": str(event["id"]),
            "scope": str(metadata.get("scope") or ""),
            "status": "requested",
            "created": created,
            "requested_at": _iso(event.get("created_at")),
        }

    @staticmethod
    def _deletion_view(
        request: Mapping[str, Any],
        *,
        created: bool,
    ) -> dict[str, Any]:
        return {
            "id": str(request["id"]),
            "scope": str(request["request_type"]),
            "status": str(request["status"]),
            "created": created,
            "execute_after": _iso(request.get("execute_after")),
            "canceled_at": _iso(request.get("canceled_at")),
            "completed_at": _iso(request.get("completed_at")),
            "created_at": _iso(request.get("created_at")),
        }
