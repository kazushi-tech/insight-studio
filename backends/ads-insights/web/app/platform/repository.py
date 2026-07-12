"""Database-backed platform repository and RBAC enforcement."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

import sqlalchemy as sa
from sqlalchemy.orm import Session

from .auth import ClerkPrincipal
from .contracts import (
    BootstrapRequest,
    DataSourceUpsert,
    ProjectCreate,
    ProjectMemberCreate,
    ProjectPatch,
)
from .errors import (
    AuthorizationError,
    ConflictError,
    InvitationProviderError,
    PlatformError,
    PlatformConfigurationError,
    ResourceNotFoundError,
    ValidationError,
    VersionConflictError,
)
from .invitations import (
    ClerkInvitationProvider,
    ClerkInvitationResult,
    normalize_invitation_email,
)
from .schema import (
    app_users,
    audit_events,
    project_data_sources,
    project_memberships,
    projects,
    workspace_memberships,
    workspaces,
)


PLATFORM_ADMIN = "platform_admin"
WORKSPACE_OWNER = "workspace_owner"
WORKSPACE_ADMIN = "workspace_admin"
PROJECT_EDITOR = "project_editor"
PROJECT_VIEWER = "project_viewer"

_WORKSPACE_MANAGERS = {PLATFORM_ADMIN, WORKSPACE_OWNER, WORKSPACE_ADMIN}
_PROJECT_READERS = _WORKSPACE_MANAGERS | {PROJECT_EDITOR, PROJECT_VIEWER}
_PROJECT_EDITORS = _WORKSPACE_MANAGERS | {PROJECT_EDITOR}
_IDEMPOTENCY_NAMESPACE = uuid.UUID("f7fd8a14-0bfd-4ea5-baa9-3471849c687a")
_SECRET_KEY_RE = re.compile(
    r"(^|_)(api_?key|secret|password|credential|access_?token|refresh_?token|private_?key)($|_)",
    re.IGNORECASE,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


def _stable_id(*parts: str) -> str:
    return str(uuid.uuid5(_IDEMPOTENCY_NAMESPACE, "\x1f".join(parts)))


def _canonical_hash(value: Mapping[str, Any]) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9_-]+", "-", (value or "").strip().lower()).strip("-_")
    return normalized[:100] or f"workspace-{uuid.uuid4().hex[:8]}"


def _row_dict(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    mapping = row._mapping if hasattr(row, "_mapping") else row
    return dict(mapping)


def _contains_secret_key(value: Any) -> bool:
    if isinstance(value, Mapping):
        for key, child in value.items():
            if _SECRET_KEY_RE.search(str(key)) or _contains_secret_key(child):
                return True
    elif isinstance(value, list):
        return any(_contains_secret_key(item) for item in value)
    return False


@dataclass(frozen=True)
class AccessContext:
    principal: ClerkPrincipal
    app_user: Mapping[str, Any]
    workspace: Mapping[str, Any]
    workspace_role: str | None
    project_roles: Mapping[str, str]

    @property
    def workspace_id(self) -> str:
        return str(self.workspace["id"])

    @property
    def app_user_id(self) -> str:
        return str(self.app_user["id"])

    @property
    def platform_role(self) -> str | None:
        value = self.app_user.get("platform_role")
        return str(value) if value else None

    @property
    def can_manage_workspace(self) -> bool:
        return self.platform_role == PLATFORM_ADMIN or self.workspace_role in {
            WORKSPACE_OWNER,
            WORKSPACE_ADMIN,
        }

    def role_for_project(self, project_id: str) -> str | None:
        if self.platform_role == PLATFORM_ADMIN:
            return PLATFORM_ADMIN
        if self.workspace_role in {WORKSPACE_OWNER, WORKSPACE_ADMIN}:
            return self.workspace_role
        return self.project_roles.get(project_id)


class PlatformRepository:
    def __init__(
        self,
        session: Session,
        *,
        platform_admin_clerk_user_ids: set[str] | None = None,
        project_invite_hash_secret: str | None = None,
    ) -> None:
        self.session = session
        if platform_admin_clerk_user_ids is None:
            platform_admin_clerk_user_ids = {
                item.strip()
                for item in (os.getenv("PLATFORM_ADMIN_CLERK_USER_IDS") or "").split(",")
                if item.strip()
            }
        self.platform_admin_clerk_user_ids = frozenset(platform_admin_clerk_user_ids)
        if project_invite_hash_secret is None:
            # Keep the invitation lookup key independent from Clerk credentials.
            # Rotating CLERK_SECRET_KEY must never orphan pending projections.
            project_invite_hash_secret = os.getenv("PROJECT_INVITE_HASH_SECRET") or ""
        self._project_invite_hash_secret = str(project_invite_hash_secret).strip()

    # ── identity and active Clerk organization ─────────────────────

    def bootstrap(self, principal: ClerkPrincipal, payload: BootstrapRequest) -> dict[str, Any]:
        user = self._user_by_clerk_id(principal.clerk_user_id)
        if user is None:
            user_id = _new_id()
            self.session.execute(
                sa.insert(app_users).values(
                    id=user_id,
                    clerk_user_id=principal.clerk_user_id,
                    primary_email=None,
                    display_name=payload.display_name,
                    platform_role=(
                        PLATFORM_ADMIN
                        if principal.clerk_user_id in self.platform_admin_clerk_user_ids
                        else None
                    ),
                    status="active",
                )
            )
        else:
            if user["status"] != "active":
                raise AuthorizationError("App user is not active")
            updates: dict[str, Any] = {
                "primary_email": None,
                "updated_at": _now(),
            }
            # The bootstrap request keeps accepting the hybrid field, but Clerk
            # email addresses are not copied into the application database.
            if payload.display_name is not None:
                updates["display_name"] = payload.display_name
            if principal.clerk_user_id in self.platform_admin_clerk_user_ids:
                updates["platform_role"] = PLATFORM_ADMIN
            self.session.execute(
                sa.update(app_users).where(app_users.c.id == user["id"]).values(**updates)
            )
            user_id = str(user["id"])

        workspace = self._workspace_by_clerk_id(principal.clerk_organization_id)
        if workspace is None:
            workspace_id = _new_id()
            requested_slug = _slugify(payload.workspace_slug or payload.workspace_name)
            slug = self._available_workspace_slug(requested_slug, principal.clerk_organization_id)
            self.session.execute(
                sa.insert(workspaces).values(
                    id=workspace_id,
                    clerk_organization_id=principal.clerk_organization_id,
                    slug=slug,
                    name=payload.workspace_name,
                    status="active",
                    is_internal=False,
                )
            )
        else:
            if workspace["status"] != "active":
                raise AuthorizationError("Workspace is not active")
            workspace_id = str(workspace["id"])

        membership_count = self.session.execute(
            sa.select(sa.func.count())
            .select_from(workspace_memberships)
            .where(workspace_memberships.c.workspace_id == workspace_id)
        ).scalar_one()
        membership = self.session.execute(
            sa.select(workspace_memberships).where(
                workspace_memberships.c.workspace_id == workspace_id,
                workspace_memberships.c.app_user_id == user_id,
            )
        ).first()
        bootstrap_workspace_role = {
            "org:owner": WORKSPACE_OWNER,
            "owner": WORKSPACE_OWNER,
            # Clerk's default organization creator role is commonly org:admin;
            # only the first persisted membership is promoted to owner.
            "org:admin": WORKSPACE_OWNER,
            "admin": WORKSPACE_OWNER,
        }.get(str(principal.claims.get("org_role") or ""))
        if membership_count == 0 and membership is None and bootstrap_workspace_role:
            self.session.execute(
                sa.insert(workspace_memberships).values(
                    workspace_id=workspace_id,
                    app_user_id=user_id,
                    role=bootstrap_workspace_role,
                )
            )
        elif (
            membership_count == 0
            and membership is None
            and principal.clerk_user_id not in self.platform_admin_clerk_user_ids
        ):
            raise AuthorizationError(
                "Initial workspace bootstrap requires a signed Clerk organization admin role"
            )
        self.session.flush()
        return self.get_me(principal)

    def get_context(self, principal: ClerkPrincipal) -> AccessContext:
        user = self._user_by_clerk_id(principal.clerk_user_id)
        workspace = self._workspace_by_clerk_id(principal.clerk_organization_id)
        if user is None or workspace is None:
            raise ResourceNotFoundError("Platform identity has not been bootstrapped")
        if user["status"] != "active" or workspace["status"] != "active":
            raise AuthorizationError("Platform identity is inactive")

        workspace_role = self.session.execute(
            sa.select(workspace_memberships.c.role).where(
                workspace_memberships.c.workspace_id == workspace["id"],
                workspace_memberships.c.app_user_id == user["id"],
            )
        ).scalar_one_or_none()
        project_role_rows = self.session.execute(
            sa.select(project_memberships.c.project_id, project_memberships.c.role).where(
                project_memberships.c.workspace_id == workspace["id"],
                project_memberships.c.app_user_id == user["id"],
            )
        ).all()
        project_roles = {
            str(row.project_id): str(row.role) for row in project_role_rows
        }
        if (
            user.get("platform_role") != PLATFORM_ADMIN
            and workspace_role is None
            and not project_roles
        ):
            raise AuthorizationError("User has no role in the active Clerk organization")
        return AccessContext(
            principal=principal,
            app_user=user,
            workspace=workspace,
            workspace_role=workspace_role,
            project_roles=project_roles,
        )

    def get_me(self, principal: ClerkPrincipal) -> dict[str, Any]:
        context = self.get_context(principal)
        return {
            "user": {
                "id": context.app_user_id,
                "display_name": context.app_user.get("display_name"),
                "platform_role": context.platform_role,
            },
            "workspace": {
                "id": context.workspace_id,
                "slug": context.workspace["slug"],
                "name": context.workspace["name"],
            },
            "workspace_role": context.workspace_role,
            "project_roles": dict(context.project_roles),
        }

    # ── projects ───────────────────────────────────────────────────

    def list_projects(self, context: AccessContext) -> list[dict[str, Any]]:
        query = sa.select(projects).where(
            projects.c.workspace_id == context.workspace_id,
            projects.c.status != "deleted",
        )
        if not context.can_manage_workspace:
            allowed_ids = list(context.project_roles)
            if not allowed_ids:
                return []
            query = query.where(projects.c.id.in_(allowed_ids))
        rows = self.session.execute(query.order_by(projects.c.created_at.desc())).all()
        return [self._project_view(_row_dict(row)) for row in rows]

    def get_project(self, context: AccessContext, project_id: str) -> dict[str, Any]:
        project, _ = self._require_project_role(context, project_id, _PROJECT_READERS)
        return self._project_view(project)

    def create_project(
        self,
        context: AccessContext,
        payload: ProjectCreate,
        idempotency_key: str,
    ) -> dict[str, Any]:
        self._require_workspace_manager(context)
        request_data = payload.model_dump()
        replay = self._idempotency_replay(
            context,
            operation="project.create",
            idempotency_key=idempotency_key,
            request_data=request_data,
        )
        if replay is not None:
            project = self._project_in_workspace(context.workspace_id, str(replay["target_id"]))
            if project is None:
                raise ConflictError("Idempotency record points to a missing project")
            return self._project_view(project)

        project_id = _stable_id(context.workspace_id, "project.create", idempotency_key)
        self.session.execute(
            sa.insert(projects).values(
                id=project_id,
                workspace_id=context.workspace_id,
                slug=payload.slug,
                name=payload.name,
                description=payload.description,
                status="active",
                is_internal=False,
                is_demo=payload.is_demo,
                version=1,
            )
        )
        self._record_idempotency(
            context,
            operation="project.create",
            idempotency_key=idempotency_key,
            request_data=request_data,
            target_type="project",
            target_id=project_id,
            project_id=project_id,
        )
        self.session.flush()
        project = self._project_in_workspace(context.workspace_id, project_id)
        assert project is not None
        return self._project_view(project)

    def update_project(
        self,
        context: AccessContext,
        project_id: str,
        payload: ProjectPatch,
    ) -> dict[str, Any]:
        project, role = self._require_project_role(context, project_id, _PROJECT_EDITORS)
        changes = payload.model_dump(exclude={"version"}, exclude_unset=True)
        if "status" in changes and role not in _WORKSPACE_MANAGERS:
            raise AuthorizationError("Project editors cannot change project status")
        if not changes:
            return self._project_view(project)
        changes["version"] = projects.c.version + 1
        changes["updated_at"] = _now()
        result = self.session.execute(
            sa.update(projects)
            .where(
                projects.c.id == project_id,
                projects.c.workspace_id == context.workspace_id,
                projects.c.version == payload.version,
                projects.c.status != "deleted",
            )
            .values(**changes)
        )
        if result.rowcount != 1:
            if self._project_in_workspace(context.workspace_id, project_id) is None:
                raise ResourceNotFoundError("Project not found")
            raise VersionConflictError("Project version does not match")
        self.session.flush()
        updated = self._project_in_workspace(context.workspace_id, project_id)
        assert updated is not None
        return self._project_view(updated)

    def archive_project(
        self,
        context: AccessContext,
        project_id: str,
        expected_version: int,
    ) -> dict[str, Any]:
        self._require_workspace_manager(context)
        project = self._project_in_workspace(context.workspace_id, project_id)
        if project is None or project["status"] == "deleted":
            raise ResourceNotFoundError("Project not found")
        result = self.session.execute(
            sa.update(projects)
            .where(
                projects.c.id == project_id,
                projects.c.workspace_id == context.workspace_id,
                projects.c.version == expected_version,
                projects.c.status != "deleted",
            )
            .values(status="archived", version=projects.c.version + 1, updated_at=_now())
        )
        if result.rowcount != 1:
            raise VersionConflictError("Project version does not match")
        self.session.flush()
        archived = self._project_in_workspace(context.workspace_id, project_id)
        assert archived is not None
        return self._project_view(archived)

    # ── project members ────────────────────────────────────────────

    def list_project_members(
        self, context: AccessContext, project_id: str
    ) -> list[dict[str, Any]]:
        self._require_workspace_manager(context)
        if self._project_in_workspace(context.workspace_id, project_id) is None:
            raise ResourceNotFoundError("Project not found")
        rows = self.session.execute(
            sa.select(
                project_memberships.c.app_user_id,
                project_memberships.c.role,
                app_users.c.display_name,
                app_users.c.status,
            )
            .join(app_users, app_users.c.id == project_memberships.c.app_user_id)
            .where(
                project_memberships.c.workspace_id == context.workspace_id,
                project_memberships.c.project_id == project_id,
            )
            .order_by(app_users.c.created_at)
        ).mappings().all()
        return [dict(row) for row in rows]

    def create_project_member(
        self,
        context: AccessContext,
        project_id: str,
        payload: ProjectMemberCreate,
        idempotency_key: str,
        invitation_provider: ClerkInvitationProvider | None = None,
    ) -> dict[str, Any]:
        if payload.email is not None:
            if invitation_provider is None:
                raise PlatformConfigurationError("Clerk invitation provider is unavailable")
            return self._create_project_email_invite(
                context,
                project_id,
                payload,
                idempotency_key,
                invitation_provider,
            )
        return self._create_legacy_project_member(
            context,
            project_id,
            payload,
            idempotency_key,
        )

    def _create_legacy_project_member(
        self,
        context: AccessContext,
        project_id: str,
        payload: ProjectMemberCreate,
        idempotency_key: str,
    ) -> dict[str, Any]:
        self._require_workspace_manager(context)
        if self._project_in_workspace(context.workspace_id, project_id) is None:
            raise ResourceNotFoundError("Project not found")
        request_data = payload.model_dump()
        replay = self._idempotency_replay(
            context,
            operation="project_member.create",
            idempotency_key=idempotency_key,
            request_data={"project_id": project_id, **request_data},
        )
        if replay is not None:
            return self._project_member_view(
                context.workspace_id,
                project_id,
                str(replay["target_id"]),
            )

        clerk_user_id = str(payload.clerk_user_id or "")
        if not clerk_user_id:
            raise ValidationError("legacy Clerk user identity is missing")
        target = self._user_by_clerk_id(clerk_user_id)
        if target is None:
            target_user_id = _new_id()
            self.session.execute(
                sa.insert(app_users).values(
                    id=target_user_id,
                    clerk_user_id=clerk_user_id,
                    primary_email=None,
                    display_name=None,
                    platform_role=None,
                    status="active",
                )
            )
        else:
            target_user_id = str(target["id"])
            if target["status"] != "active":
                raise ConflictError("Target user is not active")
            self.session.execute(
                sa.update(app_users)
                .where(app_users.c.id == target_user_id)
                .values(primary_email=None, updated_at=_now())
            )

        existing = self.session.execute(
            sa.select(project_memberships).where(
                project_memberships.c.workspace_id == context.workspace_id,
                project_memberships.c.project_id == project_id,
                project_memberships.c.app_user_id == target_user_id,
            )
        ).first()
        if existing is None:
            self.session.execute(
                sa.insert(project_memberships).values(
                    workspace_id=context.workspace_id,
                    project_id=project_id,
                    app_user_id=target_user_id,
                    role=payload.role,
                )
            )
        else:
            self.session.execute(
                sa.update(project_memberships)
                .where(
                    project_memberships.c.project_id == project_id,
                    project_memberships.c.app_user_id == target_user_id,
                )
                .values(role=payload.role, updated_at=_now())
            )
        self._record_idempotency(
            context,
            operation="project_member.create",
            idempotency_key=idempotency_key,
            request_data={"project_id": project_id, **request_data},
            target_type="project_member",
            target_id=target_user_id,
            project_id=project_id,
        )
        self.session.flush()
        return self._project_member_view(context.workspace_id, project_id, target_user_id)

    def _create_project_email_invite(
        self,
        context: AccessContext,
        project_id: str,
        payload: ProjectMemberCreate,
        idempotency_key: str,
        invitation_provider: ClerkInvitationProvider,
    ) -> dict[str, Any]:
        self._require_workspace_manager(context)
        project = self._project_in_workspace(context.workspace_id, project_id)
        if project is None or project["status"] in {"archived", "deleted"}:
            raise ResourceNotFoundError("Project not found")
        organization_id = str(context.workspace.get("clerk_organization_id") or "")
        inviter_user_id = str(context.principal.clerk_user_id or "")
        if not organization_id or not inviter_user_id:
            raise PlatformConfigurationError("Clerk Organization context is unavailable")

        email = normalize_invitation_email(str(payload.email or ""))
        email_hmac = self._project_invite_hash("email", email)
        request_data = {
            "project_id": project_id,
            "email_hmac": email_hmac,
            "role": payload.role,
        }
        pending_id = _stable_id(
            context.workspace_id,
            project_id,
            "project_invite.pending",
            email_hmac,
        )
        replay = self._idempotency_replay(
            context,
            operation="project_invite.create",
            idempotency_key=idempotency_key,
            request_data=request_data,
        )
        if replay is not None:
            if replay.get("target_type") == "project_member":
                target_user_id = str(replay.get("target_id") or "")
                target_user = self._user_by_id(target_user_id)
                if target_user is None or not self._project_membership_exists(
                    context.workspace_id,
                    project_id,
                    target_user_id,
                ):
                    raise ConflictError("project invitation state is unavailable")
                return self._canonical_project_member_view(
                    target_user,
                    payload.role,
                    created=False,
                )
            pending = self._pending_invite_by_id(
                context.workspace_id,
                project_id,
                str(replay.get("target_id") or ""),
            )
            if pending is None:
                raise ConflictError("project invitation state is unavailable")
            return self._pending_invite_view(pending, created=False)

        known_user = self._user_by_invitation_email_hmac(email_hmac)
        known_project_member = bool(
            known_user is not None
            and self._project_membership_exists(
                context.workspace_id,
                project_id,
                str(known_user["id"]),
            )
        )
        if known_user is not None and (
            known_project_member
            or self._clerk_organization_membership_is_active(
                context.workspace,
                known_user,
            )
        ):
            pending_to_close = self._pending_invite_by_id(
                context.workspace_id,
                project_id,
                pending_id,
                for_update=True,
            )
            self._upsert_project_membership(
                context.workspace_id,
                project_id,
                str(known_user["id"]),
                payload.role,
            )
            if pending_to_close is not None:
                pending_metadata = dict(
                    pending_to_close.get("metadata_json") or {}
                )
                pending_metadata.update(
                    project_role=payload.role,
                    status="applied",
                    applied_at=_now().isoformat(),
                    applied_user_ref_hash=self._project_invite_hash(
                        "app-user-id",
                        str(known_user["id"]),
                    ),
                )
                self.session.execute(
                    sa.update(audit_events)
                    .where(
                        audit_events.c.id == pending_id,
                        audit_events.c.workspace_id == context.workspace_id,
                        audit_events.c.project_id == project_id,
                    )
                    .values(metadata_json=pending_metadata)
                )
            self._record_idempotency(
                context,
                operation="project_invite.create",
                idempotency_key=idempotency_key,
                request_data=request_data,
                target_type="project_member",
                target_id=str(known_user["id"]),
                project_id=project_id,
            )
            self.session.flush()
            return self._canonical_project_member_view(
                known_user,
                payload.role,
                created=not known_project_member,
            )

        pending = self._pending_invite_by_id(
            context.workspace_id,
            project_id,
            pending_id,
            for_update=True,
        )
        now = _now()
        previous_metadata: dict[str, Any] | None = None
        previous_target_id: str | None = None
        if pending is not None:
            metadata = dict(pending.get("metadata_json") or {})
            status = str(metadata.get("status") or "")
            expires_at = self._metadata_datetime(metadata.get("expires_at"))
            if status == "pending" and expires_at is not None and now < expires_at:
                if metadata.get("project_role") != payload.role:
                    raise ConflictError("a pending invitation already has another role")
                self._record_idempotency(
                    context,
                    operation="project_invite.create",
                    idempotency_key=idempotency_key,
                    request_data=request_data,
                    target_type="project_invite",
                    target_id=pending_id,
                    project_id=project_id,
                )
                self.session.flush()
                return self._pending_invite_view(pending, created=False)
            if (
                status == "applied"
                and known_user is not None
                and self._clerk_organization_membership_is_active(
                    context.workspace,
                    known_user,
                )
            ):
                self._upsert_project_membership(
                    context.workspace_id,
                    project_id,
                    str(known_user["id"]),
                    payload.role,
                )
                self._record_idempotency(
                    context,
                    operation="project_invite.create",
                    idempotency_key=idempotency_key,
                    request_data=request_data,
                    target_type="project_member",
                    target_id=str(known_user["id"]),
                    project_id=project_id,
                )
                self.session.flush()
                return self._canonical_project_member_view(
                    known_user,
                    payload.role,
                    created=True,
                )
            if status == "creating":
                raise ConflictError("project invitation is already being created")
            previous_metadata = metadata
            previous_target_id = (
                str(pending.get("target_id")) if pending.get("target_id") else None
            )
            self.session.execute(
                sa.update(audit_events)
                .where(audit_events.c.id == pending_id)
                .values(
                    actor_user_id=context.app_user_id,
                    target_id=None,
                    metadata_json={
                        "email_hmac": email_hmac,
                        "project_role": payload.role,
                        "status": "creating",
                        "created_at": now.isoformat(),
                    },
                )
            )
        else:
            reservation = {
                "id": pending_id,
                "workspace_id": context.workspace_id,
                "project_id": project_id,
                "actor_user_id": context.app_user_id,
                "event_type": "project_invite.pending",
                "target_type": "project_invite",
                "target_id": None,
                "metadata_json": {
                    "email_hmac": email_hmac,
                    "project_role": payload.role,
                    "status": "creating",
                    "created_at": now.isoformat(),
                },
                "created_at": now,
            }
            # Reserve the deterministic email+project key before the external
            # call. A concurrent insert fails before sending a second email.
            self.session.execute(sa.insert(audit_events).values(**reservation))

        # Reserve the client key in the same transaction *before* the external
        # email side effect.  This also blocks the same key racing with a
        # different email payload from sending two invitations.
        self._record_idempotency(
            context,
            operation="project_invite.create",
            idempotency_key=idempotency_key,
            request_data=request_data,
            target_type="project_invite",
            target_id=pending_id,
            project_id=project_id,
        )
        provider_key = "project-invite:" + hashlib.sha256(
            f"{context.workspace_id}\x1f{project_id}\x1f{idempotency_key}".encode("utf-8")
        ).hexdigest()
        try:
            result = invitation_provider.invite_to_organization(
                organization_id=organization_id,
                inviter_user_id=inviter_user_id,
                email=email,
                idempotency_key=provider_key,
            )
            self._validate_invitation_result(result, organization_id, email, now)
        except PlatformError:
            self._restore_invite_reservation(
                pending_id,
                previous_metadata,
                previous_target_id,
            )
            raise
        except Exception:
            self._restore_invite_reservation(
                pending_id,
                previous_metadata,
                previous_target_id,
            )
            raise InvitationProviderError("invitation provider failed") from None

        provider_id_hash = self._project_invite_hash(
            "provider-invitation-id",
            result.invitation_id,
        )
        pending_metadata = {
            "email_hmac": email_hmac,
            "project_role": payload.role,
            "provider_invitation_id_hash": provider_id_hash,
            "status": "pending",
            "provider_created_at": result.created_at.isoformat(),
            "expires_at": result.expires_at.isoformat(),
        }
        self.session.execute(
            sa.update(audit_events)
            .where(
                audit_events.c.id == pending_id,
                audit_events.c.workspace_id == context.workspace_id,
                audit_events.c.project_id == project_id,
            )
            .values(
                target_id=provider_id_hash,
                metadata_json=pending_metadata,
            )
        )
        self.session.flush()
        stored = self._pending_invite_by_id(
            context.workspace_id,
            project_id,
            pending_id,
        )
        assert stored is not None
        return self._pending_invite_view(stored, created=True)

    def _pending_invite_by_id(
        self,
        workspace_id: str,
        project_id: str,
        invite_id: str,
        *,
        for_update: bool = False,
    ) -> dict[str, Any] | None:
        if not invite_id:
            return None
        query = sa.select(audit_events).where(
            audit_events.c.id == invite_id,
            audit_events.c.workspace_id == workspace_id,
            audit_events.c.project_id == project_id,
            audit_events.c.event_type == "project_invite.pending",
        )
        if for_update:
            query = query.with_for_update()
        row = self.session.execute(query).first()
        return _row_dict(row)

    @staticmethod
    def _metadata_datetime(value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        if not isinstance(value, str) or not value:
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    @staticmethod
    def _pending_invite_view(
        event: Mapping[str, Any],
        *,
        created: bool,
    ) -> dict[str, Any]:
        metadata = event.get("metadata_json") or {}
        return {
            "status": str(metadata.get("status") or "pending"),
            "project_id": str(event.get("project_id") or ""),
            "role": str(metadata.get("project_role") or ""),
            "expires_at": metadata.get("expires_at"),
            "created": created,
        }

    @staticmethod
    def _canonical_project_member_view(
        user: Mapping[str, Any],
        role: str,
        *,
        created: bool,
    ) -> dict[str, Any]:
        return {
            "status": "active",
            "app_user_id": str(user["id"]),
            "role": role,
            "created": created,
        }

    def _project_invite_hash(self, namespace: str, value: str) -> str:
        secret = self._project_invite_hash_secret.encode("utf-8")
        if len(secret) < 32:
            raise PlatformConfigurationError("project invitation hashing is not configured")
        return hmac.new(
            secret,
            f"{namespace}\x1f{value}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    @staticmethod
    def _validate_invitation_result(
        result: ClerkInvitationResult,
        expected_organization_id: str,
        expected_email: str,
        now: datetime,
    ) -> None:
        invitation_id = str(result.invitation_id or "")
        created_at = result.created_at
        expires_at = result.expires_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        try:
            result_email = normalize_invitation_email(result.email_address)
        except ValidationError:
            raise InvitationProviderError(
                "invitation provider response is invalid"
            ) from None
        if (
            not invitation_id
            or len(invitation_id) > 255
            or result.organization_id != expected_organization_id
            or not hmac.compare_digest(result_email, expected_email)
            or result.role != "org:member"
            or result.status != "pending"
            or created_at > now + timedelta(minutes=5)
            or expires_at <= now
            or expires_at - created_at > timedelta(days=31)
        ):
            raise InvitationProviderError("invitation provider response is invalid")

    def _restore_invite_reservation(
        self,
        pending_id: str,
        previous_metadata: Mapping[str, Any] | None,
        previous_target_id: str | None,
    ) -> None:
        if previous_metadata is None:
            self.session.execute(
                sa.delete(audit_events).where(audit_events.c.id == pending_id)
            )
            return
        self.session.execute(
            sa.update(audit_events)
            .where(audit_events.c.id == pending_id)
            .values(
                target_id=previous_target_id,
                metadata_json=dict(previous_metadata),
            )
        )

    def _user_by_invitation_email_hmac(
        self,
        email_hmac: str,
    ) -> dict[str, Any] | None:
        rows = self.session.execute(
            sa.select(audit_events.c.target_id, audit_events.c.metadata_json).where(
                audit_events.c.event_type == "clerk_webhook.processed",
                audit_events.c.target_type.in_(("user.created", "user.updated")),
            )
        ).all()
        for row in rows:
            metadata = row.metadata_json or {}
            candidate = str(metadata.get("primary_email_hmac") or "")
            if len(candidate) != 64 or not hmac.compare_digest(candidate, email_hmac):
                continue
            clerk_user_id = str(row.target_id or "")
            if self._latest_clerk_user_email_hmac(clerk_user_id) != email_hmac:
                continue
            user = self._user_by_clerk_id(clerk_user_id)
            if user is not None and user.get("status") == "active":
                return user
        return None

    def _user_by_id(self, user_id: str) -> dict[str, Any] | None:
        row = self.session.execute(
            sa.select(app_users).where(
                app_users.c.id == user_id,
                app_users.c.status == "active",
            )
        ).first()
        return _row_dict(row)

    def _project_membership_exists(
        self,
        workspace_id: str,
        project_id: str,
        user_id: str,
    ) -> bool:
        return bool(
            self.session.execute(
                sa.select(project_memberships.c.app_user_id).where(
                    project_memberships.c.workspace_id == workspace_id,
                    project_memberships.c.project_id == project_id,
                    project_memberships.c.app_user_id == user_id,
                )
            ).first()
        )

    def _upsert_project_membership(
        self,
        workspace_id: str,
        project_id: str,
        user_id: str,
        role: str,
    ) -> None:
        if role not in {PROJECT_EDITOR, PROJECT_VIEWER}:
            raise ValidationError("project invitation role is invalid")
        if self._project_membership_exists(workspace_id, project_id, user_id):
            self.session.execute(
                sa.update(project_memberships)
                .where(
                    project_memberships.c.workspace_id == workspace_id,
                    project_memberships.c.project_id == project_id,
                    project_memberships.c.app_user_id == user_id,
                )
                .values(role=role, updated_at=_now())
            )
            return
        self.session.execute(
            sa.insert(project_memberships).values(
                workspace_id=workspace_id,
                project_id=project_id,
                app_user_id=user_id,
                role=role,
            )
        )

    def update_project_member(
        self,
        context: AccessContext,
        project_id: str,
        app_user_id: str,
        role: str,
    ) -> dict[str, Any]:
        self._require_workspace_manager(context)
        result = self.session.execute(
            sa.update(project_memberships)
            .where(
                project_memberships.c.workspace_id == context.workspace_id,
                project_memberships.c.project_id == project_id,
                project_memberships.c.app_user_id == app_user_id,
            )
            .values(role=role, updated_at=_now())
        )
        if result.rowcount != 1:
            raise ResourceNotFoundError("Project member not found")
        self.session.flush()
        return self._project_member_view(context.workspace_id, project_id, app_user_id)

    def delete_project_member(
        self, context: AccessContext, project_id: str, app_user_id: str
    ) -> None:
        self._require_workspace_manager(context)
        result = self.session.execute(
            sa.delete(project_memberships).where(
                project_memberships.c.workspace_id == context.workspace_id,
                project_memberships.c.project_id == project_id,
                project_memberships.c.app_user_id == app_user_id,
            )
        )
        if result.rowcount != 1:
            raise ResourceNotFoundError("Project member not found")

    # ── project data source ────────────────────────────────────────

    def get_data_source(
        self,
        context: AccessContext,
        project_id: str,
        source_type: str = "ga4_bigquery",
    ) -> dict[str, Any]:
        self._require_project_role(context, project_id, _PROJECT_READERS)
        row = self.session.execute(
            sa.select(project_data_sources).where(
                project_data_sources.c.workspace_id == context.workspace_id,
                project_data_sources.c.project_id == project_id,
                project_data_sources.c.source_type == source_type,
            )
        ).first()
        if row is None:
            raise ResourceNotFoundError("Project data source not found")
        return self._data_source_view(_row_dict(row), context.platform_role == PLATFORM_ADMIN)

    def put_data_source(
        self,
        context: AccessContext,
        project_id: str,
        payload: DataSourceUpsert,
    ) -> dict[str, Any]:
        self._require_workspace_manager(context)
        if self._project_in_workspace(context.workspace_id, project_id) is None:
            raise ResourceNotFoundError("Project not found")
        if payload.safe_config is not None and _contains_secret_key(payload.safe_config):
            raise ValidationError("safe_config cannot contain credentials or secrets")
        existing = self.session.execute(
            sa.select(project_data_sources).where(
                project_data_sources.c.workspace_id == context.workspace_id,
                project_data_sources.c.project_id == project_id,
                project_data_sources.c.source_type == payload.source_type,
            )
        ).first()
        values = {
            "gcp_project_id": payload.gcp_project_id,
            "dataset_id": payload.dataset_id,
            "scope_kind": payload.scope_kind,
            "safe_config": payload.safe_config,
            "status": "pending",
            "last_verified_at": None,
            "updated_at": _now(),
        }
        if existing is None:
            data_source_id = _new_id()
            self.session.execute(
                sa.insert(project_data_sources).values(
                    id=data_source_id,
                    workspace_id=context.workspace_id,
                    project_id=project_id,
                    source_type=payload.source_type,
                    **values,
                )
            )
        else:
            data_source_id = str(existing._mapping["id"])
            self.session.execute(
                sa.update(project_data_sources)
                .where(project_data_sources.c.id == data_source_id)
                .values(**values)
            )
        self.session.flush()
        row = self.session.execute(
            sa.select(project_data_sources).where(
                project_data_sources.c.id == data_source_id,
                project_data_sources.c.workspace_id == context.workspace_id,
            )
        ).first()
        assert row is not None
        return self._data_source_view(_row_dict(row), context.platform_role == PLATFORM_ADMIN)

    def disable_data_source(
        self,
        context: AccessContext,
        project_id: str,
        source_type: str = "ga4_bigquery",
    ) -> None:
        self._require_workspace_manager(context)
        result = self.session.execute(
            sa.update(project_data_sources)
            .where(
                project_data_sources.c.workspace_id == context.workspace_id,
                project_data_sources.c.project_id == project_id,
                project_data_sources.c.source_type == source_type,
            )
            .values(status="disabled", updated_at=_now())
        )
        if result.rowcount != 1:
            raise ResourceNotFoundError("Project data source not found")

    def get_data_source_for_test(
        self,
        context: AccessContext,
        project_id: str,
        source_type: str = "ga4_bigquery",
    ) -> dict[str, Any]:
        self._require_workspace_manager(context)
        row = self.session.execute(
            sa.select(project_data_sources).where(
                project_data_sources.c.workspace_id == context.workspace_id,
                project_data_sources.c.project_id == project_id,
                project_data_sources.c.source_type == source_type,
                project_data_sources.c.status != "disabled",
            )
        ).first()
        if row is None:
            raise ResourceNotFoundError("Project data source not found")
        return _row_dict(row) or {}

    def record_data_source_test(
        self,
        context: AccessContext,
        data_source_id: str,
        *,
        connected: bool,
    ) -> None:
        self.session.execute(
            sa.update(project_data_sources)
            .where(
                project_data_sources.c.id == data_source_id,
                project_data_sources.c.workspace_id == context.workspace_id,
            )
            .values(
                status="active" if connected else "error",
                last_verified_at=_now(),
                updated_at=_now(),
            )
        )

    # ── Clerk webhook projection ──────────────────────────────────

    def process_clerk_webhook(
        self,
        event: Mapping[str, Any],
        *,
        message_id: str,
    ) -> dict[str, Any]:
        event_type = str(event.get("type") or "")
        data = event.get("data")
        if not event_type or not message_id or not isinstance(data, Mapping):
            raise ValidationError("Invalid Clerk webhook event")
        supported_membership_events = {
            "organizationMembership.created",
            "organizationMembership.updated",
            "organizationMembership.deleted",
        }
        supported_events = {
            "user.created",
            "user.updated",
            "user.deleted",
            "organization.created",
            "organization.updated",
            "organization.deleted",
            *supported_membership_events,
        }
        if event_type not in supported_events:
            return {"ok": True, "ignored": True}
        target_id = str(data.get("id") or "").strip()
        if not target_id:
            raise ValidationError("Invalid Clerk webhook event")

        audit_id = _stable_id("clerk.webhook", message_id)
        if self.session.execute(
            sa.select(audit_events.c.id).where(audit_events.c.id == audit_id)
        ).scalar_one_or_none():
            return {"ok": True, "duplicate": True}

        # Reserve the provider message before applying any projection.  The
        # deterministic primary key makes concurrent Svix deliveries safe too.
        try:
            with self.session.begin_nested():
                self.session.execute(
                    sa.insert(audit_events).values(
                        id=audit_id,
                        event_type="clerk_webhook.processed",
                        target_type=event_type,
                        target_id=target_id,
                        request_id=hashlib.sha256(message_id.encode("utf-8")).hexdigest(),
                        metadata_json={
                            "event_type": event_type,
                            "projection_status": "processing",
                        },
                    )
                )
                self.session.flush()
        except sa.exc.IntegrityError:
            return {"ok": True, "duplicate": True}

        workspace_id: str | None = None
        audit_metadata: dict[str, Any] = {"event_type": event_type}
        occurred_at = self._clerk_event_datetime(event)
        stale_entity_event = False
        if event_type.startswith("user.") or event_type.startswith("organization."):
            if occurred_at is None:
                raise ValidationError("Clerk entity event timestamp is invalid")
            entity_prefix = "user" if event_type.startswith("user.") else "organization"
            stale_entity_event = self._newer_clerk_entity_event_exists(
                entity_prefix,
                target_id,
                event_type,
                occurred_at,
                exclude_audit_id=audit_id,
            )
            audit_metadata.update(
                occurred_at=occurred_at.isoformat(),
                entity_event_type=event_type,
                projection_status="ignored_stale" if stale_entity_event else "processing",
            )

        if stale_entity_event:
            pass
        elif event_type in {"user.created", "user.updated"}:
            email_hmac = self._clerk_user_primary_email_hmac(data)
            self._upsert_clerk_user(data)
            audit_metadata.update(
                primary_email_hmac=email_hmac,
                projection_status="applied",
            )
            self._reconcile_deferred_clerk_memberships(
                clerk_user_id=target_id,
                user_email_hmac=email_hmac,
            )
        elif event_type == "user.deleted":
            self.session.execute(
                sa.update(app_users)
                .where(app_users.c.clerk_user_id == target_id)
                .values(
                    primary_email=None,
                    status="deleted",
                    deleted_at=_now(),
                    updated_at=_now(),
                )
            )
            audit_metadata.update(
                projection_status="applied",
            )
        elif event_type in {"organization.created", "organization.updated"}:
            workspace_id = self._upsert_clerk_organization(data)
            self._reconcile_deferred_clerk_memberships(
                clerk_organization_id=target_id
            )
            audit_metadata["projection_status"] = "applied"
        elif event_type == "organization.deleted":
            workspace = self._workspace_by_clerk_id(target_id)
            if workspace is not None:
                workspace_id = str(workspace["id"])
                self.session.execute(
                    sa.update(workspaces)
                    .where(workspaces.c.id == workspace_id)
                    .values(status="deleted", deleted_at=_now(), updated_at=_now())
                )
            audit_metadata["projection_status"] = "applied"
        elif event_type in supported_membership_events:
            if occurred_at is None:
                raise ValidationError("Clerk membership event timestamp is invalid")
            membership_metadata = self._membership_projection_metadata(
                event_type,
                data,
                occurred_at,
            )
            workspace_id, projection_status = self._project_clerk_membership(
                event_type,
                data,
                occurred_at=occurred_at,
                exclude_audit_id=audit_id,
            )
            membership_metadata["projection_status"] = projection_status
            audit_metadata.update(membership_metadata)

        self.session.execute(
            sa.update(audit_events)
            .where(audit_events.c.id == audit_id)
            .values(
                workspace_id=workspace_id,
                metadata_json=audit_metadata,
            )
        )
        self.session.flush()
        return {"ok": True, "duplicate": False}

    # ── internal helpers ──────────────────────────────────────────

    def _user_by_clerk_id(self, clerk_user_id: str) -> dict[str, Any] | None:
        row = self.session.execute(
            sa.select(app_users).where(app_users.c.clerk_user_id == clerk_user_id)
        ).first()
        return _row_dict(row)

    def _workspace_by_clerk_id(self, clerk_org_id: str) -> dict[str, Any] | None:
        row = self.session.execute(
            sa.select(workspaces).where(
                workspaces.c.clerk_organization_id == clerk_org_id
            )
        ).first()
        return _row_dict(row)

    def _project_in_workspace(
        self, workspace_id: str, project_id: str
    ) -> dict[str, Any] | None:
        row = self.session.execute(
            sa.select(projects).where(
                projects.c.workspace_id == workspace_id,
                projects.c.id == project_id,
            )
        ).first()
        return _row_dict(row)

    def _available_workspace_slug(self, requested: str, clerk_org_id: str) -> str:
        exists = self.session.execute(
            sa.select(workspaces.c.id).where(workspaces.c.slug == requested)
        ).scalar_one_or_none()
        if exists is None:
            return requested
        suffix = hashlib.sha256(clerk_org_id.encode("utf-8")).hexdigest()[:8]
        return f"{requested[:91]}-{suffix}"

    def _require_workspace_manager(self, context: AccessContext) -> None:
        if not context.can_manage_workspace:
            raise AuthorizationError("Workspace management role is required")

    def _require_project_role(
        self,
        context: AccessContext,
        project_id: str,
        allowed_roles: set[str],
    ) -> tuple[dict[str, Any], str]:
        project = self._project_in_workspace(context.workspace_id, project_id)
        if project is None or project["status"] == "deleted":
            raise ResourceNotFoundError("Project not found")
        role = context.role_for_project(project_id)
        if role not in allowed_roles:
            raise AuthorizationError("Project access is denied")
        return project, str(role)

    @staticmethod
    def _project_view(project: Mapping[str, Any] | None) -> dict[str, Any]:
        if project is None:
            raise ResourceNotFoundError("Project not found")
        return {
            key: project.get(key)
            for key in (
                "id",
                "workspace_id",
                "slug",
                "name",
                "description",
                "status",
                "is_internal",
                "is_demo",
                "version",
                "created_at",
                "updated_at",
            )
        }

    def _project_member_view(
        self, workspace_id: str, project_id: str, app_user_id: str
    ) -> dict[str, Any]:
        row = self.session.execute(
            sa.select(
                project_memberships.c.app_user_id,
                project_memberships.c.role,
                app_users.c.display_name,
                app_users.c.status,
            )
            .join(app_users, app_users.c.id == project_memberships.c.app_user_id)
            .where(
                project_memberships.c.workspace_id == workspace_id,
                project_memberships.c.project_id == project_id,
                project_memberships.c.app_user_id == app_user_id,
            )
        ).mappings().first()
        if row is None:
            raise ResourceNotFoundError("Project member not found")
        return dict(row)

    @staticmethod
    def _data_source_view(
        data_source: Mapping[str, Any] | None,
        include_sensitive_scope: bool,
    ) -> dict[str, Any]:
        if data_source is None:
            raise ResourceNotFoundError("Project data source not found")
        view = {
            "id": data_source.get("id"),
            "project_id": data_source.get("project_id"),
            "status": data_source.get("status"),
            "configured": True,
            "last_verified_at": data_source.get("last_verified_at"),
            "updated_at": data_source.get("updated_at"),
        }
        if include_sensitive_scope:
            view.update(
                source_type=data_source.get("source_type"),
                gcp_project_id=data_source.get("gcp_project_id"),
                dataset_id=data_source.get("dataset_id"),
                scope_kind=data_source.get("scope_kind"),
                safe_config=data_source.get("safe_config"),
            )
        return view

    def _idempotency_replay(
        self,
        context: AccessContext,
        *,
        operation: str,
        idempotency_key: str,
        request_data: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        audit_id = _stable_id(context.workspace_id, operation, idempotency_key)
        row = self.session.execute(
            sa.select(audit_events).where(
                audit_events.c.id == audit_id,
                audit_events.c.workspace_id == context.workspace_id,
            )
        ).first()
        if row is None:
            return None
        event = _row_dict(row) or {}
        metadata = event.get("metadata_json") or {}
        if metadata.get("request_hash") != _canonical_hash(request_data):
            raise ConflictError("Idempotency-Key was already used with another payload")
        return event

    def _record_idempotency(
        self,
        context: AccessContext,
        *,
        operation: str,
        idempotency_key: str,
        request_data: Mapping[str, Any],
        target_type: str,
        target_id: str,
        project_id: str | None,
    ) -> None:
        self.session.execute(
            sa.insert(audit_events).values(
                id=_stable_id(context.workspace_id, operation, idempotency_key),
                workspace_id=context.workspace_id,
                project_id=project_id,
                actor_user_id=context.app_user_id,
                event_type=f"idempotency.{operation}",
                target_type=target_type,
                target_id=target_id,
                request_id=hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest(),
                metadata_json={"request_hash": _canonical_hash(request_data)},
            )
        )

    @staticmethod
    def _clerk_primary_email(data: Mapping[str, Any]) -> str | None:
        primary_email: Any = None
        primary_email_id = data.get("primary_email_address_id")
        addresses = data.get("email_addresses") or []
        if isinstance(addresses, list):
            for address in addresses:
                if not isinstance(address, Mapping):
                    continue
                if address.get("id") == primary_email_id or primary_email is None:
                    primary_email = address.get("email_address")
                if address.get("id") == primary_email_id:
                    break
        if not primary_email:
            return None
        try:
            return normalize_invitation_email(str(primary_email))
        except ValidationError:
            return None

    def _clerk_user_primary_email_hmac(
        self,
        data: Mapping[str, Any],
    ) -> str | None:
        email = self._clerk_primary_email(data)
        if email is None or len(self._project_invite_hash_secret.encode("utf-8")) < 32:
            return None
        return self._project_invite_hash("email", email)

    def _upsert_clerk_user(self, data: Mapping[str, Any]) -> str:
        clerk_user_id = str(data.get("id") or "")
        if not clerk_user_id:
            raise ValidationError("Clerk user event has no id")
        display_name = " ".join(
            part for part in [str(data.get("first_name") or "").strip(), str(data.get("last_name") or "").strip()] if part
        ) or data.get("username")
        existing = self._user_by_clerk_id(clerk_user_id)
        if existing is None:
            user_id = _new_id()
            self.session.execute(
                sa.insert(app_users).values(
                    id=user_id,
                    clerk_user_id=clerk_user_id,
                    primary_email=None,
                    display_name=display_name,
                    platform_role=(
                        PLATFORM_ADMIN
                        if clerk_user_id in self.platform_admin_clerk_user_ids
                        else None
                    ),
                    status="active",
                )
            )
            return user_id
        if existing.get("status") in {"suspended", "deleted"}:
            # A provider profile update is not an administrative restore.
            # Tombstones and local suspensions require an explicit recovery
            # workflow and must remain fail-closed.
            return str(existing["id"])
        updates = {
            "primary_email": None,
            "display_name": display_name,
            "status": "active",
            "deleted_at": None,
            "updated_at": _now(),
        }
        if clerk_user_id in self.platform_admin_clerk_user_ids:
            updates["platform_role"] = PLATFORM_ADMIN
        self.session.execute(
            sa.update(app_users).where(app_users.c.id == existing["id"]).values(**updates)
        )
        return str(existing["id"])

    def _upsert_clerk_organization(self, data: Mapping[str, Any]) -> str:
        clerk_org_id = str(data.get("id") or "")
        if not clerk_org_id:
            raise ValidationError("Clerk organization event has no id")
        existing = self._workspace_by_clerk_id(clerk_org_id)
        name = str(data.get("name") or "Workspace")[:200]
        slug = _slugify(str(data.get("slug") or name))
        if existing is None:
            workspace_id = _new_id()
            self.session.execute(
                sa.insert(workspaces).values(
                    id=workspace_id,
                    clerk_organization_id=clerk_org_id,
                    slug=self._available_workspace_slug(slug, clerk_org_id),
                    name=name,
                    status="active",
                    is_internal=False,
                )
            )
            return workspace_id
        if existing.get("status") in {"suspended", "deleted"}:
            return str(existing["id"])
        self.session.execute(
            sa.update(workspaces)
            .where(workspaces.c.id == existing["id"])
            .values(name=name, status="active", deleted_at=None, updated_at=_now())
        )
        return str(existing["id"])

    def _latest_clerk_user_email_hmac(self, clerk_user_id: str) -> str | None:
        rows = self.session.execute(
            sa.select(
                audit_events.c.target_type,
                audit_events.c.metadata_json,
                audit_events.c.created_at,
            ).where(
                audit_events.c.event_type == "clerk_webhook.processed",
                audit_events.c.target_id == clerk_user_id,
                audit_events.c.target_type.in_(
                    ("user.created", "user.updated", "user.deleted")
                ),
            )
        ).all()
        latest: tuple[tuple[float, int], str | None] | None = None
        for row in rows:
            metadata = row.metadata_json or {}
            occurred_at = self._metadata_datetime(metadata.get("occurred_at"))
            if occurred_at is None:
                occurred_at = row.created_at
                if occurred_at is not None and occurred_at.tzinfo is None:
                    occurred_at = occurred_at.replace(tzinfo=timezone.utc)
            order_key = (
                occurred_at.timestamp() if occurred_at is not None else 0.0,
                2 if row.target_type == "user.deleted" else 1,
            )
            value = str(metadata.get("primary_email_hmac") or "")
            candidate = value if len(value) == 64 else None
            if latest is None or order_key > latest[0]:
                latest = (order_key, candidate)
        return latest[1] if latest else None

    def _newer_clerk_entity_event_exists(
        self,
        entity_prefix: str,
        target_id: str,
        event_type: str,
        occurred_at: datetime,
        *,
        exclude_audit_id: str | None,
    ) -> bool:
        terminal_type = f"{entity_prefix}.deleted"
        incoming_key = (occurred_at.timestamp(), 2 if event_type == terminal_type else 1)
        rows = self.session.execute(
            sa.select(
                audit_events.c.id,
                audit_events.c.target_type,
                audit_events.c.metadata_json,
                audit_events.c.created_at,
            ).where(
                audit_events.c.event_type == "clerk_webhook.processed",
                audit_events.c.target_id == target_id,
                audit_events.c.target_type.in_(
                    (
                        f"{entity_prefix}.created",
                        f"{entity_prefix}.updated",
                        terminal_type,
                    )
                ),
            )
        ).all()
        for row in rows:
            if exclude_audit_id and str(row.id) == exclude_audit_id:
                continue
            metadata = row.metadata_json or {}
            if metadata.get("projection_status") in {"processing", "ignored_stale"}:
                continue
            existing_type = str(row.target_type or "")
            # Clerk user and organization IDs are immutable.  A delete event is
            # terminal even if a delayed update carries a later ingestion time.
            if existing_type == terminal_type and event_type != terminal_type:
                return True
            existing_at = self._metadata_datetime(metadata.get("occurred_at"))
            if existing_at is None:
                existing_at = row.created_at
                if existing_at is not None and existing_at.tzinfo is None:
                    existing_at = existing_at.replace(tzinfo=timezone.utc)
            existing_key = (
                existing_at.timestamp() if existing_at is not None else 0.0,
                2 if existing_type == terminal_type else 1,
            )
            if existing_key >= incoming_key:
                return True
        return False

    def _clerk_organization_membership_is_active(
        self,
        workspace: Mapping[str, Any],
        user: Mapping[str, Any],
    ) -> bool:
        clerk_org_id = str(workspace.get("clerk_organization_id") or "")
        clerk_user_id = str(user.get("clerk_user_id") or "")
        if not clerk_org_id or not clerk_user_id:
            return False
        membership_key = self._membership_key(clerk_org_id, clerk_user_id)
        rows = self.session.execute(
            sa.select(audit_events.c.metadata_json, audit_events.c.created_at).where(
                audit_events.c.event_type == "clerk_webhook.processed",
                audit_events.c.target_type.in_(
                    (
                        "organizationMembership.created",
                        "organizationMembership.updated",
                        "organizationMembership.deleted",
                    )
                ),
            )
        ).all()
        latest: tuple[tuple[float, int], str] | None = None
        for row in rows:
            metadata = row.metadata_json or {}
            if metadata.get("membership_key") != membership_key:
                continue
            occurred_at = self._metadata_datetime(metadata.get("occurred_at"))
            if occurred_at is None:
                occurred_at = row.created_at
                if occurred_at is not None and occurred_at.tzinfo is None:
                    occurred_at = occurred_at.replace(tzinfo=timezone.utc)
            event_type = str(metadata.get("membership_event_type") or "")
            order_key = self._membership_order_key(
                event_type,
                str(metadata.get("clerk_role") or ""),
                occurred_at,
            )
            if latest is None or order_key > latest[0]:
                latest = (order_key, event_type)
        return bool(latest and latest[1] != "organizationMembership.deleted")

    def _project_clerk_membership(
        self,
        event_type: str,
        data: Mapping[str, Any],
        *,
        occurred_at: datetime | None,
        exclude_audit_id: str | None = None,
        user_email_hmac: str | None = None,
    ) -> tuple[str | None, str]:
        organization = data.get("organization") or {}
        public_user_data = data.get("public_user_data") or {}
        clerk_org_id = str(
            organization.get("id") if isinstance(organization, Mapping) else ""
        )
        clerk_user_id = str(
            public_user_data.get("user_id")
            if isinstance(public_user_data, Mapping)
            else ""
        )
        if not clerk_org_id or not clerk_user_id:
            raise ValidationError("Clerk membership event is missing organization or user")
        workspace = self._workspace_by_clerk_id(clerk_org_id)
        user = self._user_by_clerk_id(clerk_user_id)
        workspace_id = str(workspace["id"]) if workspace is not None else None
        membership_key = self._membership_key(clerk_org_id, clerk_user_id)
        if self._newer_membership_event_exists(
            membership_key,
            event_type,
            str(data.get("role") or ""),
            occurred_at,
            exclude_audit_id=exclude_audit_id,
        ):
            return workspace_id, "ignored_stale"
        if (
            workspace is None
            or workspace.get("status") != "active"
            or user is None
            or user.get("status") != "active"
        ):
            return workspace_id, "deferred"
        workspace_id = str(workspace["id"])
        if event_type == "organizationMembership.deleted":
            self.session.execute(
                sa.delete(workspace_memberships).where(
                    workspace_memberships.c.workspace_id == workspace_id,
                    workspace_memberships.c.app_user_id == user["id"],
                )
            )
            self.session.execute(
                sa.delete(project_memberships).where(
                    project_memberships.c.workspace_id == workspace_id,
                    project_memberships.c.app_user_id == user["id"],
                )
            )
            return workspace_id, "applied"

        clerk_role = str(data.get("role") or "")
        mapped_role = {
            "org:owner": WORKSPACE_OWNER,
            "owner": WORKSPACE_OWNER,
            "org:admin": WORKSPACE_ADMIN,
            "admin": WORKSPACE_ADMIN,
        }.get(clerk_role)
        existing = self.session.execute(
            sa.select(workspace_memberships).where(
                workspace_memberships.c.workspace_id == workspace_id,
                workspace_memberships.c.app_user_id == user["id"],
            )
        ).first()
        if mapped_role is None:
            if existing is not None:
                self.session.execute(
                    sa.delete(workspace_memberships).where(
                        workspace_memberships.c.workspace_id == workspace_id,
                        workspace_memberships.c.app_user_id == user["id"],
                    )
                )
        else:
            if existing is None:
                self.session.execute(
                    sa.insert(workspace_memberships).values(
                        workspace_id=workspace_id,
                        app_user_id=user["id"],
                        role=mapped_role,
                    )
                )
            else:
                self.session.execute(
                    sa.update(workspace_memberships)
                    .where(
                        workspace_memberships.c.workspace_id == workspace_id,
                        workspace_memberships.c.app_user_id == user["id"],
                    )
                    .values(role=mapped_role, updated_at=_now())
                )
        if occurred_at is not None:
            self._apply_pending_project_invites(
                workspace_id,
                user,
                occurred_at,
                email_hmac=(
                    user_email_hmac
                    or self._latest_clerk_user_email_hmac(clerk_user_id)
                ),
            )
        return workspace_id, "applied"

    @staticmethod
    def _clerk_event_datetime(event: Mapping[str, Any]) -> datetime | None:
        value = event.get("timestamp")
        if value in (None, ""):
            return None
        try:
            numeric = float(value)
            if numeric > 100_000_000_000:
                numeric /= 1000
            return datetime.fromtimestamp(numeric, tz=timezone.utc)
        except (TypeError, ValueError, OverflowError):
            return None

    @staticmethod
    def _membership_key(clerk_org_id: str, clerk_user_id: str) -> str:
        return hashlib.sha256(
            f"{clerk_org_id}\x1f{clerk_user_id}".encode("utf-8")
        ).hexdigest()

    def _membership_projection_metadata(
        self,
        event_type: str,
        data: Mapping[str, Any],
        occurred_at: datetime | None,
    ) -> dict[str, Any]:
        organization = data.get("organization") or {}
        public_user_data = data.get("public_user_data") or {}
        clerk_org_id = str(
            organization.get("id") if isinstance(organization, Mapping) else ""
        )
        clerk_user_id = str(
            public_user_data.get("user_id")
            if isinstance(public_user_data, Mapping)
            else ""
        )
        if not clerk_org_id or not clerk_user_id:
            raise ValidationError("Clerk membership event is missing organization or user")
        return {
            "membership_key": self._membership_key(clerk_org_id, clerk_user_id),
            "clerk_organization_id": clerk_org_id,
            "clerk_user_id": clerk_user_id,
            "clerk_role": str(data.get("role") or ""),
            "occurred_at": occurred_at.isoformat() if occurred_at else None,
            "membership_event_type": event_type,
        }

    @staticmethod
    def _membership_order_key(
        event_type: str,
        role: str,
        occurred_at: datetime | None,
    ) -> tuple[float, int]:
        timestamp = occurred_at.timestamp() if occurred_at else 0.0
        restrictive_rank = 0
        if event_type == "organizationMembership.deleted":
            restrictive_rank = 3
        elif role in {"org:member", "member", ""}:
            restrictive_rank = 2
        elif role in {"org:admin", "admin"}:
            restrictive_rank = 1
        return timestamp, restrictive_rank

    def _newer_membership_event_exists(
        self,
        membership_key: str,
        event_type: str,
        role: str,
        occurred_at: datetime | None,
        *,
        exclude_audit_id: str | None,
    ) -> bool:
        incoming_key = self._membership_order_key(event_type, role, occurred_at)
        rows = self.session.execute(
            sa.select(audit_events.c.id, audit_events.c.metadata_json).where(
                audit_events.c.event_type == "clerk_webhook.processed",
                audit_events.c.target_type.like("organizationMembership.%"),
            )
        ).all()
        for row in rows:
            if exclude_audit_id and str(row.id) == exclude_audit_id:
                continue
            metadata = row.metadata_json or {}
            if metadata.get("membership_key") != membership_key:
                continue
            existing_at = self._metadata_datetime(metadata.get("occurred_at"))
            existing_key = self._membership_order_key(
                str(metadata.get("membership_event_type") or ""),
                str(metadata.get("clerk_role") or ""),
                existing_at,
            )
            if existing_key >= incoming_key:
                return True
        return False

    def _reconcile_deferred_clerk_memberships(
        self,
        *,
        clerk_user_id: str | None = None,
        clerk_organization_id: str | None = None,
        user_email_hmac: str | None = None,
    ) -> None:
        rows = self.session.execute(
            sa.select(audit_events).where(
                audit_events.c.event_type == "clerk_webhook.processed",
                audit_events.c.target_type.like("organizationMembership.%"),
            )
        ).all()
        deferred: list[dict[str, Any]] = []
        for row in rows:
            event = _row_dict(row) or {}
            metadata = event.get("metadata_json") or {}
            if metadata.get("projection_status") != "deferred":
                continue
            if clerk_user_id and metadata.get("clerk_user_id") != clerk_user_id:
                continue
            if (
                clerk_organization_id
                and metadata.get("clerk_organization_id") != clerk_organization_id
            ):
                continue
            deferred.append(event)
        deferred.sort(
            key=lambda event: self._membership_order_key(
                str((event.get("metadata_json") or {}).get("membership_event_type") or ""),
                str((event.get("metadata_json") or {}).get("clerk_role") or ""),
                self._metadata_datetime(
                    (event.get("metadata_json") or {}).get("occurred_at")
                ),
            )
        )
        for event in deferred:
            metadata = dict(event.get("metadata_json") or {})
            membership_data = {
                "id": event.get("target_id"),
                "role": metadata.get("clerk_role"),
                "organization": {"id": metadata.get("clerk_organization_id")},
                "public_user_data": {"user_id": metadata.get("clerk_user_id")},
            }
            workspace_id, status = self._project_clerk_membership(
                str(metadata.get("membership_event_type") or ""),
                membership_data,
                occurred_at=self._metadata_datetime(metadata.get("occurred_at")),
                exclude_audit_id=str(event["id"]),
                user_email_hmac=(
                    user_email_hmac
                    if clerk_user_id
                    and metadata.get("clerk_user_id") == clerk_user_id
                    else None
                ),
            )
            metadata["projection_status"] = status
            self.session.execute(
                sa.update(audit_events)
                .where(audit_events.c.id == event["id"])
                .values(
                    workspace_id=workspace_id,
                    metadata_json=metadata,
                )
            )

    def _apply_pending_project_invites(
        self,
        workspace_id: str,
        user: Mapping[str, Any],
        membership_occurred_at: datetime,
        *,
        email_hmac: str | None,
    ) -> int:
        rows = self.session.execute(
            sa.select(audit_events).where(
                audit_events.c.workspace_id == workspace_id,
                audit_events.c.event_type == "project_invite.pending",
            )
        ).all()
        pending_events = [
            _row_dict(row) or {}
            for row in rows
            if (_row_dict(row) or {}).get("metadata_json", {}).get("status") == "pending"
        ]
        if not pending_events:
            return 0
        if not email_hmac:
            return 0
        applied = 0
        for event in pending_events:
            metadata = dict(event.get("metadata_json") or {})
            stored_email_hmac = str(metadata.get("email_hmac") or "")
            if len(stored_email_hmac) != 64 or not hmac.compare_digest(
                stored_email_hmac,
                email_hmac,
            ):
                continue
            provider_hash = str(metadata.get("provider_invitation_id_hash") or "")
            role = str(metadata.get("project_role") or "")
            provider_created_at = self._metadata_datetime(
                metadata.get("provider_created_at")
            )
            expires_at = self._metadata_datetime(metadata.get("expires_at"))
            if (
                len(provider_hash) != 64
                or event.get("target_id") != provider_hash
                or role not in {PROJECT_EDITOR, PROJECT_VIEWER}
                or provider_created_at is None
                or expires_at is None
            ):
                continue
            if membership_occurred_at > expires_at:
                metadata["status"] = "expired"
                self.session.execute(
                    sa.update(audit_events)
                    .where(audit_events.c.id == event["id"])
                    .values(metadata_json=metadata)
                )
                continue
            if membership_occurred_at < provider_created_at:
                continue
            project = self._project_in_workspace(
                workspace_id,
                str(event.get("project_id") or ""),
            )
            if project is None or project.get("status") != "active":
                continue
            self._upsert_project_membership(
                workspace_id,
                str(project["id"]),
                str(user["id"]),
                role,
            )
            metadata.update(
                status="applied",
                applied_at=membership_occurred_at.isoformat(),
                applied_user_ref_hash=self._project_invite_hash(
                    "app-user-id",
                    str(user["id"]),
                ),
            )
            self.session.execute(
                sa.update(audit_events)
                .where(audit_events.c.id == event["id"])
                .values(metadata_json=metadata)
            )
            applied += 1
        return applied
