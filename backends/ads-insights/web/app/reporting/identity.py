"""Injectable identity and permission contract for report routes."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

from .errors import (
    ReportForbidden,
    ReportLegalAcceptanceRequired,
    ReportNotFound,
    ReportSubscriptionForbidden,
)


READ_ROLES = frozenset(
    {
        "project_viewer",
        "project_editor",
        "project_owner",
        "project_admin",
        "viewer",
        "editor",
        "owner",
        "admin",
        "workspace_owner",
        "workspace_admin",
        "platform_admin",
    }
)
EDIT_ROLES = frozenset(
    {
        "project_editor",
        "project_owner",
        "project_admin",
        "editor",
        "owner",
        "admin",
        "workspace_owner",
        "workspace_admin",
        "platform_admin",
    }
)
SHARE_ROLES = frozenset(
    {
        "project_owner",
        "project_admin",
        "owner",
        "admin",
        "workspace_owner",
        "workspace_admin",
        "platform_admin",
    }
)


@dataclass(frozen=True)
class ReportIdentity:
    """Authenticated tenant identity supplied by the host application."""

    workspace_id: str
    user_id: str | None
    platform_role: str | None = None
    workspace_role: str | None = None
    project_roles: Mapping[str, str] = field(default_factory=dict)
    legal_accepted: bool = True
    entitlement_access: str = "full"

    def role_for_project(self, project_id: str) -> str | None:
        if self.platform_role == "platform_admin":
            return "platform_admin"
        if self.workspace_role in {"workspace_owner", "workspace_admin"}:
            return self.workspace_role
        return self.project_roles.get(project_id)

    @classmethod
    def from_access_context(cls, context: object) -> "ReportIdentity":
        """Adapt ``platform.repository.AccessContext`` without auth coupling."""
        return cls(
            workspace_id=str(getattr(context, "workspace_id")),
            user_id=str(getattr(context, "app_user_id")),
            platform_role=getattr(context, "platform_role", None),
            workspace_role=getattr(context, "workspace_role", None),
            project_roles=dict(getattr(context, "project_roles", {}) or {}),
        )


def default_permission_check(identity: ReportIdentity, project_id: str, action: str) -> None:
    """Enforce report permissions without exposing cross-tenant existence."""
    role = identity.role_for_project(project_id)
    if role is None:
        raise ReportNotFound("project not found")
    if not identity.legal_accepted:
        raise ReportLegalAcceptanceRequired("current legal acceptance is required")
    access_actions = {
        "full": {
            "read",
            "export",
            "question",
            "create",
            "import",
            "delete",
            "share",
            "revoke_share",
        },
        "read_only": {"read", "export"},
        "export_only": {"read", "export"},
        "blocked": set(),
    }
    entitlement_actions = access_actions.get(identity.entitlement_access, set())
    if action not in entitlement_actions:
        raise ReportSubscriptionForbidden("subscription does not allow this operation")
    allowed = {
        "read": READ_ROLES,
        "export": READ_ROLES,
        "question": EDIT_ROLES,
        "create": EDIT_ROLES,
        "import": EDIT_ROLES,
        "delete": EDIT_ROLES,
        "share": SHARE_ROLES,
        "revoke_share": SHARE_ROLES,
    }.get(action)
    if allowed is None or role not in allowed:
        raise ReportForbidden("insufficient project permission")
