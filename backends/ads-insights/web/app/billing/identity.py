"""Injectable workspace billing identity and owner/admin authorization."""

from __future__ import annotations

from dataclasses import dataclass

from .errors import BillingForbidden


@dataclass(frozen=True)
class BillingIdentity:
    workspace_id: str
    user_id: str | None
    workspace_role: str | None = None
    platform_role: str | None = None
    email: str | None = None

    @property
    def can_manage_billing(self) -> bool:
        return self.platform_role == "platform_admin" or self.workspace_role == "workspace_owner"

    @classmethod
    def from_access_context(cls, context: object) -> "BillingIdentity":
        app_user = getattr(context, "app_user", {}) or {}
        return cls(
            workspace_id=str(getattr(context, "workspace_id")),
            user_id=str(getattr(context, "app_user_id")),
            workspace_role=getattr(context, "workspace_role", None),
            platform_role=getattr(context, "platform_role", None),
            email=app_user.get("primary_email"),
        )


def require_billing_manager(identity: BillingIdentity) -> None:
    if not identity.can_manage_billing:
        raise BillingForbidden("billing management requires workspace owner")
