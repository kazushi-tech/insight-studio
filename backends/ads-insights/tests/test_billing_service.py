"""SQLite + fake-provider contract tests for billing DB truth."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.billing.config import BillingConfig
from web.app.billing.errors import (
    BillingConfigurationError,
    BillingForbidden,
    BillingPrerequisiteError,
    BillingSignatureError,
)
from web.app.billing.identity import BillingIdentity
from web.app.billing.provider import (
    CheckoutSessionResult,
    PortalSessionResult,
    StripeBillingProvider,
)
from web.app.billing import provider as provider_module
from web.app.billing.service import BillingService
from web.app.platform.schema import (
    app_users,
    billing_customers,
    billing_webhook_events,
    legal_acceptances,
    legal_document_versions,
    platform_metadata,
    subscriptions,
    workspaces,
)


FIXED_NOW = datetime(2026, 7, 12, 3, 0, tzinfo=timezone.utc)


class FakeProvider:
    def __init__(self) -> None:
        self.checkout_calls: list[dict] = []
        self.portal_calls: list[dict] = []
        self.raw_bodies: list[bytes] = []

    def create_subscription_checkout(self, **kwargs) -> CheckoutSessionResult:
        self.checkout_calls.append(dict(kwargs))
        return CheckoutSessionResult(
            url="https://checkout.example/session-safe",
            customer_id=kwargs.get("customer_id") or "cus_server_only",
        )

    def create_portal(self, **kwargs) -> PortalSessionResult:
        self.portal_calls.append(dict(kwargs))
        return PortalSessionResult(url="https://portal.example/session-safe")

    def verify_webhook(self, raw_body: bytes, signature: str) -> dict:
        self.raw_bodies.append(raw_body)
        if signature != "valid-signature":
            raise BillingSignatureError("fake provider signature mismatch")
        return json.loads(raw_body)


def test_live_stripe_secret_cannot_bypass_live_checkout_gate(monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_example")
    monkeypatch.delenv("BILLING_LIVE_MODE", raising=False)
    monkeypatch.setenv("BILLING_PLAN_PRICES_JSON", "{}")
    assert BillingConfig.from_env().live_mode is True


def test_stripe_sdk_is_imported_only_when_provider_is_invoked(monkeypatch):
    imports: list[str] = []

    def unavailable(name: str):
        imports.append(name)
        raise ImportError(name)

    monkeypatch.setattr(provider_module.importlib, "import_module", unavailable)
    adapter = StripeBillingProvider(
        secret_key="sk_test_example",
        webhook_secret="whsec_example",
    )
    assert imports == []
    with pytest.raises(BillingConfigurationError):
        adapter.create_portal(
            customer_id="cus_example",
            return_url="https://app.example/billing",
            idempotency_key="portal:test",
        )
    assert imports == ["stripe"]


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
                {
                    "id": "u-owner",
                    "clerk_user_id": "clerk-owner",
                    "primary_email": "owner@example.test",
                    "status": "active",
                },
                {
                    "id": "u-viewer",
                    "clerk_user_id": "clerk-viewer",
                    "primary_email": None,
                    "status": "active",
                },
            ],
        )
        session.execute(
            sa.insert(workspaces),
            {"id": "w1", "slug": "workspace-one", "name": "Workspace One", "status": "active"},
        )
    yield factory
    engine.dispose()


def _config(**overrides) -> BillingConfig:
    values = {
        "plan_prices": {"starter": "price_server_secret"},
        "checkout_success_url": "https://app.example/billing/success",
        "checkout_cancel_url": "https://app.example/billing/cancel",
        "portal_return_url": "https://app.example/settings/billing",
    }
    values.update(overrides)
    return BillingConfig(**values)


def _owner() -> BillingIdentity:
    return BillingIdentity(
        workspace_id="w1",
        user_id="u-owner",
        workspace_role="workspace_owner",
        email="owner@example.test",
    )


def _event(
    event_id: str,
    event_type: str,
    created: datetime,
    provider_object: dict,
) -> bytes:
    return json.dumps(
        {
            "id": event_id,
            "type": event_type,
            "created": int(created.timestamp()),
            "data": {"object": provider_object},
        },
        separators=(",", ":"),
    ).encode("utf-8")


def _subscription_object(status: str, *, metadata: bool = True) -> dict:
    result = {
        "id": "sub_server_only",
        "customer": "cus_server_only",
        "status": status,
        "items": {"data": [{"price": {"id": "price_server_secret"}}]},
        "current_period_start": int(FIXED_NOW.timestamp()),
        "current_period_end": int((FIXED_NOW + timedelta(days=30)).timestamp()),
        "cancel_at_period_end": False,
    }
    if metadata:
        result["metadata"] = {"workspace_id": "w1"}
    return result


def _seed_legal_acceptance(session) -> None:
    for index, key in enumerate(("terms", "privacy"), start=1):
        document_id = f"legal-{index}"
        session.execute(
            sa.insert(legal_document_versions).values(
                id=document_id,
                document_key=key,
                version="2026-07",
                revision_number=1,
                title=key.title(),
                public_url=f"https://legal.example/{key}",
                content_sha256="a" * 64,
                effective_at=FIXED_NOW - timedelta(days=1),
                published_at=FIXED_NOW - timedelta(days=2),
            )
        )
        session.execute(
            sa.insert(legal_acceptances).values(
                id=f"accept-{index}",
                app_user_id="u-owner",
                workspace_id="w1",
                document_version_id=document_id,
                subject_user_ref_hash="b" * 63 + str(index),
                workspace_scope_key="w1",
                accepted_at=FIXED_NOW,
            )
        )


def test_checkout_uses_server_price_is_owner_only_and_never_grants_access(session_factory):
    provider = FakeProvider()
    with session_factory() as session:
        service = BillingService(
            session,
            provider=provider,
            config=_config(),
            now_provider=lambda: FIXED_NOW,
        )
        viewer = BillingIdentity("w1", "u-viewer", workspace_role=None)
        with pytest.raises(BillingForbidden):
            service.create_checkout(
                viewer,
                plan_key="starter",
                idempotency_key="checkout-attempt-viewer",
            )

        response = service.create_checkout(
            _owner(),
            plan_key="starter",
            idempotency_key="checkout-attempt-owner",
        )
        portal = service.create_portal(
            _owner(), idempotency_key="portal-attempt-owner"
        )

        assert response == {"url": "https://checkout.example/session-safe"}
        assert portal == {"url": "https://portal.example/session-safe"}
        assert provider.checkout_calls[0]["price_id"] == "price_server_secret"
        assert provider.checkout_calls[0]["idempotency_key"].startswith("checkout:")
        assert provider.checkout_calls[0]["idempotency_key"] != "checkout-attempt-owner"
        assert provider.portal_calls[0]["idempotency_key"].startswith("portal:")
        assert "price_server_secret" not in repr(response)
        assert "cus_server_only" not in repr(response)
        assert session.scalar(sa.select(sa.func.count()).select_from(billing_customers)) == 1
        assert session.scalar(sa.select(sa.func.count()).select_from(subscriptions)) == 0
        assert service.entitlement(_owner())["access"] == "blocked"


def test_live_checkout_fails_closed_until_retention_and_current_legal_acceptance_exist(
    session_factory,
):
    provider = FakeProvider()
    with session_factory() as session:
        missing_retention = BillingService(
            session,
            provider=provider,
            config=_config(live_mode=True, retention_policy_configured=False),
            now_provider=lambda: FIXED_NOW,
        )
        with pytest.raises(BillingPrerequisiteError):
            missing_retention.create_checkout(
                _owner(), plan_key="starter", idempotency_key="live-checkout-0001"
            )

        missing_legal = BillingService(
            session,
            provider=provider,
            config=_config(live_mode=True, retention_policy_configured=True),
            now_provider=lambda: FIXED_NOW,
        )
        with pytest.raises(BillingPrerequisiteError):
            missing_legal.create_checkout(
                _owner(), plan_key="starter", idempotency_key="live-checkout-0002"
            )
        _seed_legal_acceptance(session)
        assert missing_legal.create_checkout(
            _owner(), plan_key="starter", idempotency_key="live-checkout-0003"
        )["url"].startswith("https://checkout.example/")
        assert len(provider.checkout_calls) == 1


def test_verified_webhooks_are_db_truth_deduplicated_and_ordered(session_factory):
    provider = FakeProvider()
    clock = {"now": FIXED_NOW}
    with session_factory() as session:
        service = BillingService(
            session,
            provider=provider,
            config=_config(),
            now_provider=lambda: clock["now"],
        )
        checkout_raw = _event(
            "evt_checkout",
            "checkout.session.completed",
            FIXED_NOW,
            {
                "id": "cs_server_only",
                "customer": "cus_server_only",
                "client_reference_id": "w1",
                "metadata": {"workspace_id": "w1"},
            },
        )
        service.process_webhook(checkout_raw, "valid-signature")
        assert session.scalar(sa.select(sa.func.count()).select_from(subscriptions)) == 0
        assert service.entitlement(_owner())["access"] == "blocked"

        active_at = FIXED_NOW + timedelta(minutes=1)
        active_raw = _event(
            "evt_active",
            "customer.subscription.created",
            active_at,
            _subscription_object("active"),
        )
        first = service.process_webhook(active_raw, "valid-signature")
        replay = service.process_webhook(active_raw, "valid-signature")
        assert first == {"received": True, "duplicate": False, "status": "processed"}
        assert replay == {"received": True, "duplicate": True}
        assert service.entitlement(_owner()) == {
            "access": "full",
            "status": "active",
            "plan_key": "starter",
            "transition_at": None,
        }

        same_second_restrictive = service.process_webhook(
            _event(
                "evt_same_second_past_due",
                "customer.subscription.updated",
                active_at,
                _subscription_object("past_due"),
            ),
            "valid-signature",
        )
        assert same_second_restrictive["status"] == "processed"
        assert service.entitlement(_owner())["status"] == "past_due"

        stale_raw = _event(
            "evt_stale",
            "customer.subscription.deleted",
            FIXED_NOW,
            _subscription_object("canceled"),
        )
        stale = service.process_webhook(stale_raw, "valid-signature")
        stored_status = session.scalar(
            sa.select(subscriptions.c.status).where(
                subscriptions.c.provider_subscription_id == "sub_server_only"
            )
        )
        assert stale["status"] == "ignored_stale"
        assert stored_status == "past_due"

        past_due_at = FIXED_NOW + timedelta(days=1)
        service.process_webhook(
            _event(
                "evt_past_due",
                "customer.subscription.updated",
                past_due_at,
                _subscription_object("past_due"),
            ),
            "valid-signature",
        )
        clock["now"] = past_due_at + timedelta(days=6)
        assert service.entitlement(_owner())["access"] == "full"
        clock["now"] = past_due_at + timedelta(days=8)
        assert service.entitlement(_owner())["access"] == "read_only"

        canceled_at = FIXED_NOW + timedelta(days=10)
        canceled_object = _subscription_object("canceled")
        canceled_object["canceled_at"] = int(canceled_at.timestamp())
        service.process_webhook(
            _event(
                "evt_canceled",
                "customer.subscription.deleted",
                canceled_at,
                canceled_object,
            ),
            "valid-signature",
        )
        clock["now"] = canceled_at + timedelta(days=29)
        assert service.entitlement(_owner())["access"] == "export_only"
        clock["now"] = canceled_at + timedelta(days=31)
        assert service.entitlement(_owner())["access"] == "blocked"

        assert session.scalar(sa.select(sa.func.count()).select_from(billing_webhook_events)) == 6
        stored_event = session.execute(
            sa.select(billing_webhook_events).where(
                billing_webhook_events.c.provider_event_id == "evt_active"
            )
        ).one()._mapping
        assert stored_event["payload_sha256"]
        assert "payload" not in stored_event


def test_invalid_signature_writes_nothing_and_unknown_price_fails_closed(session_factory):
    provider = FakeProvider()
    with session_factory() as session:
        service = BillingService(
            session,
            provider=provider,
            config=_config(),
            now_provider=lambda: FIXED_NOW,
        )
        raw = _event(
            "evt_invalid_signature",
            "customer.subscription.created",
            FIXED_NOW,
            _subscription_object("active"),
        )
        with pytest.raises(BillingSignatureError):
            service.process_webhook(raw, "invalid-signature")
        assert session.scalar(sa.select(sa.func.count()).select_from(billing_webhook_events)) == 0

        unknown = _subscription_object("active")
        unknown["items"]["data"][0]["price"]["id"] = "price_not_allowlisted"
        service.process_webhook(
            _event(
                "evt_unknown_price",
                "customer.subscription.created",
                FIXED_NOW,
                unknown,
            ),
            "valid-signature",
        )
        entitlement = service.entitlement(_owner())
        assert entitlement["access"] == "blocked"
        assert entitlement["status"] == "unknown_price"
        assert "price_not_allowlisted" not in repr(entitlement)


def test_managed_pilot_is_full_access_without_provider_checkout(session_factory):
    with session_factory() as session:
        session.execute(
            sa.insert(subscriptions).values(
                id="pilot-sub",
                workspace_id="w1",
                provider="managed_pilot",
                provider_subscription_id="pilot-w1",
                price_id="managed",
                plan_key="managed_pilot",
                status="managed_pilot",
                last_provider_event_created_at=FIXED_NOW,
                created_at=FIXED_NOW,
                updated_at=FIXED_NOW,
            )
        )
        service = BillingService(
            session,
            provider=FakeProvider(),
            config=_config(),
            now_provider=lambda: FIXED_NOW,
        )
        assert service.entitlement(_owner()) == {
            "access": "full",
            "status": "managed_pilot",
            "plan_key": "managed_pilot",
            "transition_at": None,
        }


def test_unpaid_is_export_only_for_thirty_days_then_blocked(session_factory):
    clock = {"now": FIXED_NOW + timedelta(days=29)}
    with session_factory() as session:
        session.execute(
            sa.insert(subscriptions).values(
                id="unpaid-sub",
                workspace_id="w1",
                provider="stripe",
                provider_subscription_id="sub-unpaid",
                price_id="price_server_secret",
                plan_key="starter",
                status="unpaid",
                last_provider_event_created_at=FIXED_NOW,
                created_at=FIXED_NOW,
                updated_at=FIXED_NOW,
            )
        )
        service = BillingService(
            session,
            provider=FakeProvider(),
            config=_config(),
            now_provider=lambda: clock["now"],
        )
        assert service.entitlement(_owner())["access"] == "export_only"
        clock["now"] = FIXED_NOW + timedelta(days=31)
        assert service.entitlement(_owner())["access"] == "blocked"
