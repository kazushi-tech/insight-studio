"""Pure subscription-to-access policy."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from .config import BillingConfig


def _aware(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def decide_entitlement(
    subscription: Mapping[str, Any] | None,
    *,
    now: datetime,
    config: BillingConfig,
) -> dict[str, Any]:
    """Return only customer-safe access state; no provider identifiers."""
    current = _aware(now) or datetime.now(timezone.utc)
    if not subscription:
        return {
            "access": "blocked",
            "status": "none",
            "plan_key": None,
            "transition_at": None,
        }
    status = str(subscription.get("status") or "unknown")
    plan_key = str(subscription.get("plan_key") or "") or None
    provider = str(subscription.get("provider") or "")

    if provider == "managed_pilot" or plan_key == "managed_pilot" or status == "managed_pilot":
        return {
            "access": "full",
            "status": "managed_pilot",
            "plan_key": plan_key or "managed_pilot",
            "transition_at": None,
        }
    if status in {"active", "trialing"}:
        return {
            "access": "full",
            "status": status,
            "plan_key": plan_key,
            "transition_at": None,
        }

    event_at = (
        _aware(subscription.get("last_provider_event_created_at"))
        or _aware(subscription.get("updated_at"))
        or current
    )
    if status == "past_due":
        transition = event_at + timedelta(days=config.past_due_grace_days)
        return {
            "access": "full" if current < transition else "read_only",
            "status": status,
            "plan_key": plan_key,
            "transition_at": _iso(transition),
        }
    if status in {"canceled", "unpaid"}:
        start = _aware(subscription.get("canceled_at")) or event_at
        transition = start + timedelta(days=config.cancellation_export_days)
        return {
            "access": "export_only" if current < transition else "blocked",
            "status": status,
            "plan_key": plan_key,
            "transition_at": _iso(transition),
        }
    return {
        "access": "blocked",
        "status": status,
        "plan_key": plan_key,
        "transition_at": None,
    }
