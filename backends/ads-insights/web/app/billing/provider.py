"""Billing provider protocol and lazy Stripe SDK adapter."""

from __future__ import annotations

import importlib
import hashlib
import os
from dataclasses import dataclass
from typing import Any, Mapping, Protocol

from .errors import BillingConfigurationError, BillingProviderError, BillingSignatureError


@dataclass(frozen=True)
class CheckoutSessionResult:
    url: str
    customer_id: str


@dataclass(frozen=True)
class PortalSessionResult:
    url: str


class BillingProvider(Protocol):
    def create_subscription_checkout(
        self,
        *,
        workspace_id: str,
        customer_id: str | None,
        billing_email: str | None,
        price_id: str,
        plan_key: str,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
    ) -> CheckoutSessionResult: ...

    def create_portal(
        self,
        *,
        customer_id: str,
        return_url: str,
        idempotency_key: str,
    ) -> PortalSessionResult: ...

    def verify_webhook(self, raw_body: bytes, signature: str) -> Mapping[str, Any]: ...


def _mapping(value: Any) -> Mapping[str, Any]:
    if isinstance(value, Mapping):
        return value
    converter = getattr(value, "to_dict_recursive", None)
    if callable(converter):
        converted = converter()
        if isinstance(converted, Mapping):
            return converted
    raise BillingProviderError("provider returned an invalid response")


class StripeBillingProvider:
    """Stripe adapter that imports ``stripe`` only when a method is invoked."""

    def __init__(self, *, secret_key: str, webhook_secret: str) -> None:
        self.secret_key = secret_key
        self.webhook_secret = webhook_secret
        self._sdk = None

    @classmethod
    def from_env(cls) -> "StripeBillingProvider":
        return cls(
            secret_key=(os.getenv("STRIPE_SECRET_KEY") or "").strip(),
            webhook_secret=(os.getenv("STRIPE_WEBHOOK_SECRET") or "").strip(),
        )

    def _stripe(self):
        if not self.secret_key:
            raise BillingConfigurationError("billing provider is not configured")
        if self._sdk is None:
            try:
                self._sdk = importlib.import_module("stripe")
            except ImportError as exc:
                raise BillingConfigurationError("billing provider SDK is unavailable") from exc
            self._sdk.api_key = self.secret_key
        return self._sdk

    def create_subscription_checkout(
        self,
        *,
        workspace_id: str,
        customer_id: str | None,
        billing_email: str | None,
        price_id: str,
        plan_key: str,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
    ) -> CheckoutSessionResult:
        stripe = self._stripe()
        try:
            resolved_customer_id = customer_id
            if not resolved_customer_id:
                customer = stripe.Customer.create(
                    **({"email": billing_email} if billing_email else {}),
                    metadata={"workspace_id": workspace_id},
                    idempotency_key=(
                        "customer:"
                        + hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()
                    ),
                )
                resolved_customer_id = str(_mapping(customer)["id"])
            session = stripe.checkout.Session.create(
                mode="subscription",
                customer=resolved_customer_id,
                line_items=[{"price": price_id, "quantity": 1}],
                success_url=success_url,
                cancel_url=cancel_url,
                client_reference_id=workspace_id,
                metadata={"workspace_id": workspace_id, "plan_key": plan_key},
                subscription_data={
                    "metadata": {"workspace_id": workspace_id, "plan_key": plan_key}
                },
                idempotency_key=idempotency_key,
            )
            data = _mapping(session)
            url = str(data.get("url") or "")
            if not url:
                raise BillingProviderError("provider did not return a checkout URL")
            return CheckoutSessionResult(url=url, customer_id=resolved_customer_id)
        except BillingProviderError:
            raise
        except Exception as exc:
            raise BillingProviderError("provider checkout failed") from exc

    def create_portal(
        self,
        *,
        customer_id: str,
        return_url: str,
        idempotency_key: str,
    ) -> PortalSessionResult:
        stripe = self._stripe()
        try:
            session = stripe.billing_portal.Session.create(
                customer=customer_id,
                return_url=return_url,
                idempotency_key=idempotency_key,
            )
            url = str(_mapping(session).get("url") or "")
            if not url:
                raise BillingProviderError("provider did not return a portal URL")
            return PortalSessionResult(url=url)
        except BillingProviderError:
            raise
        except Exception as exc:
            raise BillingProviderError("provider portal failed") from exc

    def verify_webhook(self, raw_body: bytes, signature: str) -> Mapping[str, Any]:
        if not self.webhook_secret:
            raise BillingConfigurationError("billing webhook is not configured")
        stripe = self._stripe()
        try:
            event = stripe.Webhook.construct_event(
                payload=raw_body,
                sig_header=signature,
                secret=self.webhook_secret,
            )
            return _mapping(event)
        except Exception as exc:
            raise BillingSignatureError("webhook signature is invalid") from exc
