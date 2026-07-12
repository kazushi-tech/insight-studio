"""Server-only billing configuration and plan allowlist."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Mapping

from .errors import BillingConfigurationError, BillingValidationError


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class BillingConfig:
    """All provider identifiers remain server-only behind ``plan_prices``."""

    plan_prices: Mapping[str, str] = field(default_factory=dict, repr=False)
    checkout_success_url: str = ""
    checkout_cancel_url: str = ""
    portal_return_url: str = ""
    live_mode: bool = False
    retention_policy_configured: bool = False
    required_legal_document_keys: tuple[str, ...] = ("terms", "privacy")
    past_due_grace_days: int = 7
    cancellation_export_days: int = 30

    @classmethod
    def from_env(cls) -> "BillingConfig":
        raw_plans = (os.getenv("BILLING_PLAN_PRICES_JSON") or "{}").strip()
        try:
            parsed = json.loads(raw_plans)
        except json.JSONDecodeError as exc:
            raise BillingConfigurationError("billing plan allowlist is invalid") from exc
        if not isinstance(parsed, dict):
            raise BillingConfigurationError("billing plan allowlist is invalid")
        normalized_plans: dict[str, str] = {}
        for key, value in parsed.items():
            if not isinstance(key, str) or not isinstance(value, str):
                raise BillingConfigurationError("billing plan allowlist is invalid")
            plan_key = key.strip()
            price_id = value.strip()
            if not plan_key or len(plan_key) > 100 or not price_id or len(price_id) > 255:
                raise BillingConfigurationError("billing plan allowlist is invalid")
            normalized_plans[plan_key] = price_id
        if len(set(normalized_plans.values())) != len(normalized_plans):
            raise BillingConfigurationError("billing plan allowlist is ambiguous")
        legal_keys = tuple(
            item.strip()
            for item in (os.getenv("BILLING_REQUIRED_LEGAL_DOCUMENT_KEYS") or "terms,privacy").split(",")
            if item.strip()
        )
        stripe_secret = (os.getenv("STRIPE_SECRET_KEY") or "").strip()
        return cls(
            plan_prices=normalized_plans,
            checkout_success_url=(os.getenv("BILLING_CHECKOUT_SUCCESS_URL") or "").strip(),
            checkout_cancel_url=(os.getenv("BILLING_CHECKOUT_CANCEL_URL") or "").strip(),
            portal_return_url=(os.getenv("BILLING_PORTAL_RETURN_URL") or "").strip(),
            # A live Stripe key always activates the stricter launch gate;
            # an omitted BILLING_LIVE_MODE must never bypass legal checks.
            live_mode=(
                _bool_env("BILLING_LIVE_MODE") or stripe_secret.startswith("sk_live_")
            ),
            retention_policy_configured=_bool_env("BILLING_RETENTION_POLICY_CONFIGURED"),
            required_legal_document_keys=legal_keys,
        )

    def price_for_plan(self, plan_key: str) -> str:
        normalized = str(plan_key or "").strip()
        price_id = self.plan_prices.get(normalized)
        if not normalized or not isinstance(price_id, str) or not price_id:
            raise BillingValidationError("unknown billing plan")
        return price_id

    def plan_for_price(self, price_id: str) -> str | None:
        matches = [
            str(plan_key)
            for plan_key, configured_price in self.plan_prices.items()
            if configured_price == price_id
        ]
        return matches[0] if len(matches) == 1 else None

    def assert_checkout_configured(self) -> None:
        if not self.checkout_success_url or not self.checkout_cancel_url:
            raise BillingConfigurationError("checkout URLs are not configured")
        if self.live_mode and (
            not self.checkout_success_url.startswith("https://")
            or not self.checkout_cancel_url.startswith("https://")
        ):
            raise BillingConfigurationError("live checkout requires HTTPS URLs")

    def assert_portal_configured(self) -> None:
        if not self.portal_return_url:
            raise BillingConfigurationError("portal return URL is not configured")
        if self.live_mode and not self.portal_return_url.startswith("https://"):
            raise BillingConfigurationError("live portal requires an HTTPS URL")
