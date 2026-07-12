"""Database-backed billing orchestration.

Checkout is deliberately not an entitlement write path.  Subscription access
changes only after a verified subscription webhook has been persisted.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Mapping

import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..platform.schema import (
    billing_customers,
    billing_webhook_events,
    legal_acceptances,
    legal_document_versions,
    subscriptions,
    workspaces,
)
from .config import BillingConfig
from .entitlements import decide_entitlement
from .errors import (
    BillingConflict,
    BillingNotFound,
    BillingPrerequisiteError,
    BillingValidationError,
)
from .identity import BillingIdentity, require_billing_manager
from .provider import BillingProvider


SUBSCRIPTION_EVENT_TYPES = frozenset(
    {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }
)
CHECKOUT_EVENT_TYPE = "checkout.session.completed"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _timestamp(value: Any, *, required: bool = False) -> datetime | None:
    if value in (None, ""):
        if required:
            raise BillingValidationError("billing event timestamp is missing")
        return None
    if isinstance(value, datetime):
        return _aware(value)
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    except (TypeError, ValueError, OverflowError) as exc:
        raise BillingValidationError("billing event timestamp is invalid") from exc


def _mapping(value: Any, *, field: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise BillingValidationError(f"billing event {field} is invalid")
    return value


def _identifier(value: Any, *, field: str, max_length: int = 255) -> str:
    normalized = str(value or "").strip()
    if not normalized or len(normalized) > max_length:
        raise BillingValidationError(f"billing event {field} is invalid")
    return normalized


def _row_mapping(row: Any) -> Mapping[str, Any] | None:
    return row._mapping if row is not None else None


class BillingService:
    """Coordinates provider calls with the migration-012 tables."""

    def __init__(
        self,
        session: Session,
        *,
        provider: BillingProvider,
        config: BillingConfig,
        now_provider: Callable[[], datetime] = _utcnow,
    ) -> None:
        self.session = session
        self.provider = provider
        self.config = config
        self.now_provider = now_provider

    def create_checkout(
        self,
        identity: BillingIdentity,
        *,
        plan_key: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        require_billing_manager(identity)
        self.config.assert_checkout_configured()
        if self.config.live_mode:
            self._assert_live_prerequisites(identity)
        price_id = self.config.price_for_plan(plan_key)
        customer = self._customer_for_workspace(identity.workspace_id)
        result = self.provider.create_subscription_checkout(
            workspace_id=identity.workspace_id,
            customer_id=(str(customer["provider_customer_id"]) if customer else None),
            billing_email=identity.email,
            price_id=price_id,
            plan_key=plan_key,
            success_url=self.config.checkout_success_url,
            cancel_url=self.config.checkout_cancel_url,
            # Stripe idempotency is account-wide, so tenant-scope the
            # untrusted client key before forwarding it to the provider.
            idempotency_key=(
                "checkout:"
                + hashlib.sha256(
                    f"{identity.workspace_id}\0{idempotency_key}".encode("utf-8")
                ).hexdigest()
            ),
        )
        self._upsert_customer(
            workspace_id=identity.workspace_id,
            provider_customer_id=result.customer_id,
            billing_email=identity.email,
        )
        self.session.flush()
        # A hosted Checkout success is not proof of a paid subscription.
        return {"url": result.url}

    def create_portal(
        self,
        identity: BillingIdentity,
        *,
        idempotency_key: str,
    ) -> dict[str, Any]:
        require_billing_manager(identity)
        self.config.assert_portal_configured()
        customer = self._customer_for_workspace(identity.workspace_id)
        if customer is None:
            raise BillingNotFound("billing customer is not provisioned")
        result = self.provider.create_portal(
            customer_id=str(customer["provider_customer_id"]),
            return_url=self.config.portal_return_url,
            idempotency_key=(
                "portal:"
                + hashlib.sha256(
                    f"{identity.workspace_id}\0{idempotency_key}".encode("utf-8")
                ).hexdigest()
            ),
        )
        return {"url": result.url}

    def entitlement(self, identity: BillingIdentity) -> dict[str, Any]:
        row = self.session.execute(
            sa.select(subscriptions)
            .where(subscriptions.c.workspace_id == identity.workspace_id)
            .order_by(subscriptions.c.updated_at.desc(), subscriptions.c.created_at.desc())
            .limit(1)
        ).first()
        return decide_entitlement(
            _row_mapping(row),
            now=self.now_provider(),
            config=self.config,
        )

    def process_webhook(self, raw_body: bytes, signature: str) -> dict[str, Any]:
        """Verify the exact bytes, deduplicate, then apply webhook DB truth."""
        event = self.provider.verify_webhook(raw_body, signature)
        event_id = _identifier(event.get("id"), field="id")
        event_type = _identifier(event.get("type"), field="type", max_length=150)
        event_created_at = _timestamp(event.get("created"), required=True)
        assert event_created_at is not None
        data = _mapping(event.get("data"), field="data")
        provider_object = _mapping(data.get("object"), field="object")

        existing_event = self.session.execute(
            sa.select(billing_webhook_events.c.status).where(
                billing_webhook_events.c.provider_event_id == event_id
            )
        ).first()
        if existing_event is not None:
            return {"received": True, "duplicate": True}

        workspace_id = self._resolve_workspace(provider_object)
        event_row_id = str(uuid.uuid4())
        now = _aware(self.now_provider()) or _utcnow()
        try:
            with self.session.begin_nested():
                self.session.execute(
                    sa.insert(billing_webhook_events).values(
                        id=event_row_id,
                        workspace_id=workspace_id,
                        provider="stripe",
                        provider_event_id=event_id,
                        event_type=event_type,
                        provider_event_created_at=event_created_at,
                        payload_sha256=hashlib.sha256(raw_body).hexdigest(),
                        status="pending",
                        attempts=1,
                        received_at=now,
                    )
                )
        except IntegrityError:
            # A concurrent delivery won the unique provider_event_id insert.
            return {"received": True, "duplicate": True}

        status = "ignored"
        if event_type in SUBSCRIPTION_EVENT_TYPES:
            status = self._apply_subscription_event(
                event_type=event_type,
                event_created_at=event_created_at,
                provider_object=provider_object,
                workspace_id=workspace_id,
            )
        elif event_type == CHECKOUT_EVENT_TYPE:
            # Customer linkage is useful, but Checkout never grants access.
            if workspace_id:
                customer_id = str(provider_object.get("customer") or "").strip()
                if customer_id:
                    self._upsert_customer(
                        workspace_id=workspace_id,
                        provider_customer_id=customer_id,
                        billing_email=None,
                    )
            status = "processed"

        self.session.execute(
            sa.update(billing_webhook_events)
            .where(billing_webhook_events.c.id == event_row_id)
            .values(status=status, processed_at=now)
        )
        self.session.flush()
        return {"received": True, "duplicate": False, "status": status}

    def _assert_live_prerequisites(self, identity: BillingIdentity) -> None:
        if not self.config.retention_policy_configured:
            raise BillingPrerequisiteError("retention policy is not configured")
        if not identity.user_id or not self.config.required_legal_document_keys:
            raise BillingPrerequisiteError("required legal acceptance is missing")

        now = _aware(self.now_provider()) or _utcnow()
        for document_key in self.config.required_legal_document_keys:
            document = self.session.execute(
                sa.select(legal_document_versions.c.id)
                .where(
                    legal_document_versions.c.document_key == document_key,
                    legal_document_versions.c.published_at.is_not(None),
                    legal_document_versions.c.effective_at <= now,
                )
                .order_by(
                    legal_document_versions.c.effective_at.desc(),
                    legal_document_versions.c.revision_number.desc(),
                )
                .limit(1)
            ).first()
            if document is None:
                raise BillingPrerequisiteError("required legal document is unavailable")
            accepted = self.session.execute(
                sa.select(legal_acceptances.c.id).where(
                    legal_acceptances.c.app_user_id == identity.user_id,
                    legal_acceptances.c.workspace_id == identity.workspace_id,
                    legal_acceptances.c.document_version_id == document.id,
                )
            ).first()
            if accepted is None:
                raise BillingPrerequisiteError("required legal acceptance is missing")

    def _customer_for_workspace(self, workspace_id: str) -> Mapping[str, Any] | None:
        row = self.session.execute(
            sa.select(billing_customers).where(
                billing_customers.c.workspace_id == workspace_id
            )
        ).first()
        return _row_mapping(row)

    def _upsert_customer(
        self,
        *,
        workspace_id: str,
        provider_customer_id: str,
        billing_email: str | None,
    ) -> None:
        customer_id = _identifier(provider_customer_id, field="customer id")
        now = _aware(self.now_provider()) or _utcnow()
        current = self._customer_for_workspace(workspace_id)
        if current is None:
            self.session.execute(
                sa.insert(billing_customers).values(
                    workspace_id=workspace_id,
                    provider="stripe",
                    provider_customer_id=customer_id,
                    billing_email=billing_email,
                    created_at=now,
                    updated_at=now,
                )
            )
            return
        if str(current["provider_customer_id"]) != customer_id:
            # A workspace has exactly one provider customer.  Never let a
            # delayed or cross-scoped event silently relink that tenant.
            raise BillingConflict("billing customer linkage is immutable")
        values: dict[str, Any] = {
            "updated_at": now,
        }
        if billing_email:
            values["billing_email"] = billing_email
        self.session.execute(
            sa.update(billing_customers)
            .where(billing_customers.c.workspace_id == workspace_id)
            .values(**values)
        )

    def _resolve_workspace(self, provider_object: Mapping[str, Any]) -> str | None:
        subscription_id = str(provider_object.get("id") or "").strip()
        customer_id = str(provider_object.get("customer") or "").strip()
        metadata = provider_object.get("metadata")
        metadata_workspace = (
            str(metadata.get("workspace_id") or "").strip()
            if isinstance(metadata, Mapping)
            else ""
        )
        reference_workspace = str(provider_object.get("client_reference_id") or "").strip()

        candidates: set[str] = set()
        if subscription_id:
            existing_workspace = self.session.scalar(
                sa.select(subscriptions.c.workspace_id).where(
                    subscriptions.c.provider_subscription_id == subscription_id
                )
            )
            if existing_workspace:
                candidates.add(str(existing_workspace))
        if customer_id:
            customer_workspace = self.session.scalar(
                sa.select(billing_customers.c.workspace_id).where(
                    billing_customers.c.provider_customer_id == customer_id
                )
            )
            if customer_workspace:
                candidates.add(str(customer_workspace))
        candidates.update(item for item in (metadata_workspace, reference_workspace) if item)
        if len(candidates) > 1:
            raise BillingValidationError("billing event workspace is inconsistent")
        if not candidates:
            return None
        workspace_id = next(iter(candidates))
        exists = self.session.scalar(
            sa.select(sa.func.count())
            .select_from(workspaces)
            .where(workspaces.c.id == workspace_id)
        )
        return workspace_id if exists else None

    def _apply_subscription_event(
        self,
        *,
        event_type: str,
        event_created_at: datetime,
        provider_object: Mapping[str, Any],
        workspace_id: str | None,
    ) -> str:
        provider_subscription_id = _identifier(
            provider_object.get("id"), field="subscription id"
        )
        current_row = self.session.execute(
            sa.select(subscriptions).where(
                subscriptions.c.provider_subscription_id == provider_subscription_id
            )
        ).first()
        current = _row_mapping(current_row)
        if current:
            previous = _aware(current.get("last_provider_event_created_at"))
            if previous is not None:
                if event_created_at < previous:
                    return "ignored_stale"
                if event_created_at == previous:
                    incoming_status = (
                        "canceled"
                        if event_type.endswith(".deleted")
                        else str(provider_object.get("status") or "unknown").strip().lower()
                    )
                    # Provider timestamps have one-second precision.  On a tie,
                    # accept only a more restrictive state so access can never
                    # be accidentally re-granted by an ambiguous event order.
                    access_rank = {
                        "active": 3,
                        "trialing": 3,
                        "past_due": 2,
                        "canceled": 1,
                        "unpaid": 1,
                    }
                    if access_rank.get(incoming_status, 0) >= access_rank.get(
                        str(current.get("status") or "unknown"), 0
                    ):
                        return "ignored_stale"
            resolved_workspace = str(current["workspace_id"])
            if workspace_id and workspace_id != resolved_workspace:
                raise BillingValidationError("billing event workspace is inconsistent")
            workspace_id = resolved_workspace
        if workspace_id is None:
            return "ignored_unscoped"

        price_id = self._subscription_price(provider_object)
        if not price_id and current:
            price_id = str(current["price_id"])
        if not price_id:
            return "ignored_invalid"
        plan_key = self.config.plan_for_price(price_id)
        provider_status = str(provider_object.get("status") or "").strip().lower()[:32]
        status = "canceled" if event_type.endswith(".deleted") else provider_status
        if not status:
            status = "unknown"
        if plan_key is None:
            plan_key = "unknown"
            status = "unknown_price"

        now = _aware(self.now_provider()) or _utcnow()
        canceled_at = _timestamp(provider_object.get("canceled_at"))
        if status == "canceled" and canceled_at is None:
            canceled_at = event_created_at
        values = {
            "workspace_id": workspace_id,
            "provider": "stripe",
            "provider_subscription_id": provider_subscription_id,
            "price_id": price_id,
            "plan_key": plan_key,
            "status": status,
            "current_period_start": _timestamp(provider_object.get("current_period_start")),
            "current_period_end": _timestamp(provider_object.get("current_period_end")),
            "cancel_at_period_end": bool(provider_object.get("cancel_at_period_end", False)),
            "canceled_at": canceled_at,
            "last_provider_event_created_at": event_created_at,
            "updated_at": now,
        }
        customer_id = str(provider_object.get("customer") or "").strip()
        if customer_id:
            # Validate the immutable customer linkage before changing the
            # access-bearing subscription row.
            self._upsert_customer(
                workspace_id=workspace_id,
                provider_customer_id=customer_id,
                billing_email=None,
            )
        if current is None:
            self.session.execute(
                sa.insert(subscriptions).values(
                    id=str(uuid.uuid4()),
                    created_at=now,
                    **values,
                )
            )
        else:
            self.session.execute(
                sa.update(subscriptions)
                .where(subscriptions.c.id == current["id"])
                .values(**values)
            )

        return "processed"

    @staticmethod
    def _subscription_price(provider_object: Mapping[str, Any]) -> str | None:
        items = provider_object.get("items")
        if not isinstance(items, Mapping):
            return None
        data = items.get("data")
        if not isinstance(data, list) or not data:
            return None
        first = data[0]
        if not isinstance(first, Mapping):
            return None
        price = first.get("price")
        if not isinstance(price, Mapping):
            return None
        value = str(price.get("id") or "").strip()
        return value[:255] or None
