"""Injectable tenant identity for legal/privacy routes."""

from __future__ import annotations

from dataclasses import dataclass

from .errors import LegalForbidden


@dataclass(frozen=True)
class LegalIdentity:
    workspace_id: str
    user_id: str
    workspace_role: str | None = None
    platform_role: str | None = None

    @property
    def can_manage_workspace(self) -> bool:
        return self.platform_role == "platform_admin" or self.workspace_role == "workspace_owner"

    @classmethod
    def from_access_context(cls, context: object) -> "LegalIdentity":
        return cls(
            workspace_id=str(getattr(context, "workspace_id")),
            user_id=str(getattr(context, "app_user_id")),
            workspace_role=getattr(context, "workspace_role", None),
            platform_role=getattr(context, "platform_role", None),
        )


def require_workspace_manager(identity: LegalIdentity) -> None:
    if not identity.can_manage_workspace:
        raise LegalForbidden("workspace privacy operations require workspace owner")
