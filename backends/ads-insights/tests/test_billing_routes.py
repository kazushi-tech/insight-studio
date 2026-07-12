"""HTTP boundary tests for injectable billing routes."""

from __future__ import annotations

import json
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app.billing.config import BillingConfig
from web.app.billing.errors import BillingSignatureError
from web.app.billing.identity import BillingIdentity
from web.app.billing.provider import CheckoutSessionResult, PortalSessionResult
from web.app.platform.schema import (
    app_users,
    billing_webhook_events,
    platform_metadata,
    subscriptions,
    workspaces,
)
from web.app.routers.billing_routes import create_billing_router


NOW = datetime(2026, 7, 12, 3, 0, tzinfo=timezone.utc)


class FakeProvider:
    def __init__(self) -> None:
        self.checkout_call: dict | None = None
        self.raw_body: bytes | None = None

    def create_subscription_checkout(self, **kwargs):
        self.checkout_call = dict(kwargs)
        return CheckoutSessionResult("https://checkout.example/safe", "cus_private")

    def create_portal(self, **kwargs):
        return PortalSessionResult("https://portal.example/safe")

    def verify_webhook(self, raw_body: bytes, signature: str):
        self.raw_body = raw_body
        if signature != "valid-signature":
            raise BillingSignatureError("provider detail must not escape")
        return json.loads(raw_body)


def _build_app():
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
            {"id": "u1", "clerk_user_id": "clerk-u1", "status": "active"},
        )
        session.execute(
            sa.insert(workspaces),
            {"id": "w1", "slug": "w-one", "name": "Workspace One", "status": "active"},
        )

    @contextmanager
    def session_scope():
        session = factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def session_dependency():
        with session_scope() as session:
            yield session

    identity = {
        "value": BillingIdentity("w1", "u1", workspace_role="workspace_owner")
    }

    def identity_dependency():
        return identity["value"]

    provider = FakeProvider()
    config = BillingConfig(
        plan_prices={"starter": "price_private"},
        checkout_success_url="https://app.example/success",
        checkout_cancel_url="https://app.example/cancel",
        portal_return_url="https://app.example/billing",
    )
    app = FastAPI()
    app.include_router(
        create_billing_router(
            session_dependency=session_dependency,
            identity_dependency=identity_dependency,
            provider=provider,
            config=config,
        )
    )
    return app, factory, provider, identity, engine


def test_router_permissions_server_allowlist_strict_body_and_safe_response():
    app, factory, provider, identity, engine = _build_app()
    try:
        with TestClient(app) as client:
            identity["value"] = BillingIdentity("w1", "u1", workspace_role=None)
            denied = client.post(
                "/api/billing/checkout",
                headers={"Idempotency-Key": "checkout-router-0001"},
                json={"plan_key": "starter"},
            )
            assert denied.status_code == 403
            assert denied.json() == {"detail": "billing_forbidden"}

            identity["value"] = BillingIdentity(
                "w1", "u1", workspace_role="workspace_owner"
            )
            injected_price = client.post(
                "/api/billing/checkout",
                headers={"Idempotency-Key": "checkout-router-0002"},
                json={"plan_key": "starter", "price_id": "attacker-price"},
            )
            assert injected_price.status_code == 422

            missing_key = client.post(
                "/api/billing/checkout", json={"plan_key": "starter"}
            )
            assert missing_key.status_code == 400
            assert missing_key.json() == {"detail": "billing_invalid_idempotency_key"}

            created = client.post(
                "/api/billing/checkout",
                headers={"Idempotency-Key": "checkout-router-0003"},
                json={"plan_key": "starter"},
            )
            assert created.status_code == 200
            assert created.json() == {
                "ok": True,
                "url": "https://checkout.example/safe",
            }
            assert provider.checkout_call["price_id"] == "price_private"
            assert provider.checkout_call["idempotency_key"].startswith("checkout:")
            assert provider.checkout_call["idempotency_key"] != "checkout-router-0003"
            assert "price_private" not in created.text
            assert "cus_private" not in created.text

            portal = client.post(
                "/api/billing/portal",
                headers={"Idempotency-Key": "portal-router-0001"},
                json={},
            )
            assert portal.status_code == 200
            assert portal.json() == {
                "ok": True,
                "url": "https://portal.example/safe",
            }

        with factory() as session:
            assert session.scalar(sa.select(sa.func.count()).select_from(subscriptions)) == 0
    finally:
        engine.dispose()


def test_webhook_receives_exact_raw_bytes_and_invalid_signature_has_no_db_trace():
    app, factory, provider, _identity, engine = _build_app()
    valid_raw = (
        b'{"id":"evt_route_valid","type":"checkout.session.completed","created":'
        + str(int(NOW.timestamp())).encode("ascii")
        + b',"data":{"object":{"id":"cs_1","customer":"cus_private",'
        b'"client_reference_id":"w1","metadata":{"workspace_id":"w1"}}}}'
    )
    invalid_raw = valid_raw.replace(b"evt_route_valid", b"evt_route_bad__")
    try:
        with TestClient(app) as client:
            accepted = client.post(
                "/api/billing/webhooks/stripe",
                content=valid_raw,
                headers={
                    "Content-Type": "application/json",
                    "Stripe-Signature": "valid-signature",
                },
            )
            assert accepted.status_code == 200
            assert accepted.json() == {
                "ok": True,
                "received": True,
                "duplicate": False,
                "status": "processed",
            }
            assert provider.raw_body == valid_raw

            rejected = client.post(
                "/api/billing/webhooks/stripe",
                content=invalid_raw,
                headers={
                    "Content-Type": "application/json",
                    "Stripe-Signature": "wrong-signature",
                },
            )
            assert rejected.status_code == 400
            assert rejected.json() == {"detail": "invalid_webhook_signature"}
            assert "provider detail" not in rejected.text

        with factory() as session:
            ids = session.scalars(
                sa.select(billing_webhook_events.c.provider_event_id)
            ).all()
            assert ids == ["evt_route_valid"]
            assert session.scalar(sa.select(sa.func.count()).select_from(subscriptions)) == 0
    finally:
        engine.dispose()


def test_webhook_rejects_oversized_body_before_signature_verification():
    app, _factory, provider, _identity, engine = _build_app()
    try:
        with TestClient(app) as client:
            rejected = client.post(
                "/api/billing/webhooks/stripe",
                content=b"x" * 1_048_577,
                headers={"Stripe-Signature": "valid-signature"},
            )
        assert rejected.status_code == 413
        assert rejected.json() == {"detail": "request_body_too_large"}
        assert provider.raw_body is None
    finally:
        engine.dispose()
