"""PostgreSQL-backed Gemini monthly budget reservations.

``ai_budget_accounts`` and ``ai_usage_ledger`` (Alembic 010) are the only
source of truth.  A request reserves its worst-case cost before the provider
call, then the same idempotency key is finalized with the returned token
counts.  Failed calls may release the reservation; abandoned reservations are
reclaimed after a short lease.  There is deliberately no file or ``/tmp``
fallback.
"""

from __future__ import annotations

import math
import os
import secrets
import uuid
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Any, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from .tenant_auth import (
    TenantAuthConfigurationError,
    TenantDatabaseUnavailableError,
    get_managed_session_factory,
)
from .tenant_schema import ai_budget_accounts, ai_usage_ledger

GEMINI_FLASH_LITE_INPUT_USD_PER_1M = 0.25
GEMINI_FLASH_LITE_OUTPUT_USD_PER_1M = 1.50
GEMINI_FLASH_LITE_MODEL = "gemini-3.1-flash-lite"
LEGACY_GEMINI_FLASH_MODELS = {
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.5-flash",
}
DEFAULT_MONTHLY_BUDGET_USD = 18.0
DEFAULT_USD_JPY = 159.0

INTERNAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001"
INTERNAL_PROJECT_ID = "00000000-0000-0000-0000-000000000002"
_PROVIDER = "gemini"
_SCOPE_KEY = "platform.gemini"
_RESERVATION_PREFIX = "reservation:"
_ESTIMATED_PREFIX = "estimated:"
_RESERVATION_LEASE = timedelta(minutes=30)
_JST = timezone(timedelta(hours=9))
_SQLITE_TEST_LOCK = RLock()


class GeminiBudgetExceeded(RuntimeError):
    """Raised before a paid call when the durable monthly cap is exceeded."""


class GeminiBudgetUnavailable(RuntimeError):
    """Raised when PostgreSQL cannot make a durable budget decision."""


def is_gemini_model(model: str | None) -> bool:
    return str(model or "").strip().lower().startswith("gemini")


def normalize_gemini_model(model: str | None) -> str:
    normalized = str(model or "").strip()
    lowered = normalized.lower()
    if not normalized:
        return GEMINI_FLASH_LITE_MODEL
    if lowered == GEMINI_FLASH_LITE_MODEL:
        return GEMINI_FLASH_LITE_MODEL
    if lowered in LEGACY_GEMINI_FLASH_MODELS or lowered.startswith("gemini"):
        return GEMINI_FLASH_LITE_MODEL
    return normalized


def current_month_key(now: datetime | None = None) -> str:
    dt = now or datetime.now(_JST)
    return dt.astimezone(_JST).strftime("%Y-%m")


def monthly_budget_usd() -> float:
    return _float_env("GEMINI_MONTHLY_BUDGET_USD", DEFAULT_MONTHLY_BUDGET_USD)


def usd_jpy_rate() -> float:
    return _float_env("GEMINI_BUDGET_USD_JPY", DEFAULT_USD_JPY)


def estimate_text_tokens(text: str | None) -> int:
    if not text:
        return 0
    # UTF-8 bytes are a deliberately conservative tokenizer-independent upper
    # bound for the Japanese-heavy prompts used here.  Reservations must
    # overestimate rather than allow a later finalization to cross the cap.
    return max(1, len(str(text).encode("utf-8")))


def calculate_cost_usd(input_tokens: int, output_tokens: int) -> float:
    return (
        max(0, int(input_tokens)) * GEMINI_FLASH_LITE_INPUT_USD_PER_1M
        + max(0, int(output_tokens)) * GEMINI_FLASH_LITE_OUTPUT_USD_PER_1M
    ) / 1_000_000


def _cost_microunits(input_tokens: int, output_tokens: int) -> int:
    # The schema stores millionths of USD.  Round up so reservations never
    # underestimate a fractional microunit.
    return max(0, math.ceil(calculate_cost_usd(input_tokens, output_tokens) * 1_000_000))


def estimate_request_cost(
    *, prompt: str, max_output_tokens: int, model: str | None = None
) -> dict[str, Any]:
    input_tokens = estimate_text_tokens(prompt)
    output_tokens = max(0, int(max_output_tokens or 0))
    cost_usd = calculate_cost_usd(input_tokens, output_tokens)
    return {
        "model": model or "",
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cost_usd": round(cost_usd, 8),
        "estimated": True,
    }


def _is_managed_runtime() -> bool:
    return bool(
        os.getenv("VERCEL")
        or os.getenv("RENDER")
        or str(os.getenv("ENVIRONMENT", "")).strip().lower() in {"prod", "production", "staging"}
    )


def _period_bounds(now: datetime, timezone_name: str) -> tuple[datetime, datetime, str]:
    try:
        zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise GeminiBudgetUnavailable("AI budget timezone is invalid") from exc
    local = now.astimezone(zone)
    start_local = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start_local.month == 12:
        end_local = start_local.replace(year=start_local.year + 1, month=1)
    else:
        end_local = start_local.replace(month=start_local.month + 1)
    return (
        start_local.astimezone(timezone.utc),
        end_local.astimezone(timezone.utc),
        start_local.strftime("%Y-%m"),
    )


def _get_budget_engine() -> Engine:
    try:
        factory = get_managed_session_factory()
        engine = factory.kw.get("bind")
    except (TenantAuthConfigurationError, TenantDatabaseUnavailableError, SQLAlchemyError, ValueError) as exc:
        raise GeminiBudgetUnavailable("AI budget database is unavailable") from exc
    if not isinstance(engine, Engine):
        raise GeminiBudgetUnavailable("AI budget database is unavailable")
    return engine


class PostgresGeminiBudgetStore:
    """Atomic reservation/finalization over the migration-owned tables."""

    def __init__(
        self,
        *,
        engine_provider: Callable[[], Engine] = _get_budget_engine,
        now_provider: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ) -> None:
        self._engine_provider = engine_provider
        self._now_provider = now_provider

    def _engine(self) -> Engine:
        try:
            engine = self._engine_provider()
        except (TenantDatabaseUnavailableError, SQLAlchemyError, ValueError) as exc:
            raise GeminiBudgetUnavailable("AI budget database is unavailable") from exc
        if engine.dialect.name not in {"postgresql", "sqlite"}:
            raise GeminiBudgetUnavailable("AI budget requires PostgreSQL")
        if _is_managed_runtime() and engine.dialect.name != "postgresql":
            raise GeminiBudgetUnavailable("Managed AI budget requires PostgreSQL")
        return engine

    @staticmethod
    def _insert_for(engine: Engine, table: sa.Table):
        if engine.dialect.name == "postgresql":
            return postgresql_insert(table)
        # SQLite is accepted only by non-managed tests/local verification.
        return sqlite_insert(table)

    def _ensure_account(self, connection: sa.Connection, engine: Engine) -> Any:
        now = self._now_provider().astimezone(timezone.utc)
        values = {
            "id": str(uuid.uuid4()),
            "workspace_id": INTERNAL_WORKSPACE_ID,
            "project_id": INTERNAL_PROJECT_ID,
            "scope_key": _SCOPE_KEY,
            "provider": _PROVIDER,
            "currency": "USD",
            "monthly_limit_microunits": max(0, round(monthly_budget_usd() * 1_000_000)),
            "warning_percent": 70,
            "hard_limit": True,
            "period_timezone": "Asia/Tokyo",
            "enabled": True,
            "created_at": now,
            "updated_at": now,
        }
        statement = self._insert_for(engine, ai_budget_accounts).values(**values)
        statement = statement.on_conflict_do_nothing(
            index_elements=[
                ai_budget_accounts.c.workspace_id,
                ai_budget_accounts.c.scope_key,
                ai_budget_accounts.c.provider,
            ]
        )
        connection.execute(statement)
        account = connection.execute(
            sa.select(ai_budget_accounts)
            .where(
                ai_budget_accounts.c.workspace_id == INTERNAL_WORKSPACE_ID,
                ai_budget_accounts.c.scope_key == _SCOPE_KEY,
                ai_budget_accounts.c.provider == _PROVIDER,
            )
            .with_for_update()
        ).mappings().one_or_none()
        if account is None or not bool(account["enabled"]):
            raise GeminiBudgetUnavailable("AI budget account is unavailable")
        return account

    def _purge_expired_reservations(
        self, connection: sa.Connection, *, now: datetime
    ) -> None:
        connection.execute(
            sa.delete(ai_usage_ledger).where(
                ai_usage_ledger.c.workspace_id == INTERNAL_WORKSPACE_ID,
                ai_usage_ledger.c.project_id == INTERNAL_PROJECT_ID,
                ai_usage_ledger.c.provider == _PROVIDER,
                ai_usage_ledger.c.operation.like(f"{_RESERVATION_PREFIX}%"),
                ai_usage_ledger.c.occurred_at < now - _RESERVATION_LEASE,
            )
        )

    @staticmethod
    def _row_to_event(row: Any) -> dict[str, Any]:
        operation = str(row["operation"] or "")
        estimated = operation.startswith((_RESERVATION_PREFIX, _ESTIMATED_PREFIX))
        feature = operation.split(":", 1)[1] if estimated and ":" in operation else operation
        occurred_at = row["occurred_at"]
        return {
            "id": str(row["id"])[:12],
            "month": occurred_at.astimezone(_JST).strftime("%Y-%m"),
            "created_at": occurred_at.astimezone(_JST).isoformat(),
            "feature": feature,
            "model": str(row["model"] or ""),
            "input_tokens": int(row["input_tokens"] or 0),
            "output_tokens": int(row["output_tokens"] or 0),
            "total_tokens": int(row["input_tokens"] or 0) + int(row["output_tokens"] or 0),
            "cost_usd": round(int(row["estimated_cost_microunits"] or 0) / 1_000_000, 8),
            "estimated": estimated,
        }

    def reserve(
        self,
        *,
        idempotency_key: str,
        model: str,
        feature: str,
        input_tokens: int,
        output_tokens: int,
    ) -> dict[str, Any]:
        key = str(idempotency_key or "").strip()[:255]
        if not key:
            raise GeminiBudgetUnavailable("AI budget idempotency key is required")
        now = self._now_provider().astimezone(timezone.utc)
        cost = _cost_microunits(input_tokens, output_tokens)
        engine = self._engine()
        lock = _SQLITE_TEST_LOCK if engine.dialect.name == "sqlite" else nullcontext()
        try:
            with lock, engine.begin() as connection:
                account = self._ensure_account(connection, engine)
                self._purge_expired_reservations(connection, now=now)
                start, end, month = _period_bounds(now, str(account["period_timezone"]))
                existing = connection.execute(
                    sa.select(ai_usage_ledger).where(
                        ai_usage_ledger.c.idempotency_key == key
                    )
                ).mappings().one_or_none()
                if existing is not None:
                    if (
                        str(existing["workspace_id"]) != INTERNAL_WORKSPACE_ID
                        or str(existing["project_id"]) != INTERNAL_PROJECT_ID
                        or str(existing["provider"]) != _PROVIDER
                    ):
                        raise GeminiBudgetUnavailable("AI budget idempotency scope conflicts")
                    return {
                        "reservation_key": key,
                        "month": month,
                        "cost_microunits": int(existing["estimated_cost_microunits"] or 0),
                        "already_reserved": True,
                    }
                used = int(
                    connection.execute(
                        sa.select(sa.func.coalesce(sa.func.sum(ai_usage_ledger.c.estimated_cost_microunits), 0))
                        .where(
                            ai_usage_ledger.c.workspace_id == INTERNAL_WORKSPACE_ID,
                            ai_usage_ledger.c.project_id == INTERNAL_PROJECT_ID,
                            ai_usage_ledger.c.provider == _PROVIDER,
                            ai_usage_ledger.c.occurred_at >= start,
                            ai_usage_ledger.c.occurred_at < end,
                        )
                    ).scalar_one()
                    or 0
                )
                limit = int(account["monthly_limit_microunits"] or 0)
                if bool(account["hard_limit"]) and used + cost > limit:
                    raise GeminiBudgetExceeded(
                        "gemini_budget_exceeded: monthly Gemini budget would be exceeded"
                    )
                connection.execute(
                    sa.insert(ai_usage_ledger).values(
                        id=str(uuid.uuid4()),
                        workspace_id=INTERNAL_WORKSPACE_ID,
                        project_id=INTERNAL_PROJECT_ID,
                        provider=_PROVIDER,
                        model=model[:128],
                        operation=f"{_RESERVATION_PREFIX}{feature}"[:100],
                        input_tokens=max(0, int(input_tokens)),
                        output_tokens=max(0, int(output_tokens)),
                        estimated_cost_microunits=cost,
                        currency="USD",
                        idempotency_key=key,
                        occurred_at=now,
                    )
                )
                return {
                    "reservation_key": key,
                    "month": month,
                    "cost_microunits": cost,
                    "already_reserved": False,
                }
        except GeminiBudgetExceeded:
            raise
        except GeminiBudgetUnavailable:
            raise
        except (TenantDatabaseUnavailableError, SQLAlchemyError, ValueError) as exc:
            raise GeminiBudgetUnavailable("AI budget database is unavailable") from exc

    def finalize(
        self,
        *,
        idempotency_key: str,
        model: str,
        feature: str,
        input_tokens: int,
        output_tokens: int,
        estimated: bool,
    ) -> dict[str, Any] | None:
        engine = self._engine()
        lock = _SQLITE_TEST_LOCK if engine.dialect.name == "sqlite" else nullcontext()
        try:
            with lock, engine.begin() as connection:
                row = connection.execute(
                    sa.select(ai_usage_ledger)
                    .where(
                        ai_usage_ledger.c.idempotency_key == idempotency_key,
                        ai_usage_ledger.c.workspace_id == INTERNAL_WORKSPACE_ID,
                        ai_usage_ledger.c.project_id == INTERNAL_PROJECT_ID,
                        ai_usage_ledger.c.provider == _PROVIDER,
                    )
                    .with_for_update()
                ).mappings().one_or_none()
                if row is None:
                    return None
                operation = str(row["operation"] or "")
                if not operation.startswith(_RESERVATION_PREFIX):
                    # Idempotent replay: the first finalized usage is the
                    # source of truth and is never charged a second time.
                    return self._row_to_event(row)
                input_count = max(0, int(input_tokens))
                output_count = max(0, int(output_tokens))
                connection.execute(
                    sa.update(ai_usage_ledger)
                    .where(ai_usage_ledger.c.id == row["id"])
                    .values(
                        model=model[:128],
                        operation=(f"{_ESTIMATED_PREFIX}{feature}" if estimated else feature)[:100],
                        input_tokens=input_count,
                        output_tokens=output_count,
                        estimated_cost_microunits=_cost_microunits(input_count, output_count),
                    )
                )
                updated = dict(row)
                updated.update(
                    model=model[:128],
                    operation=(f"{_ESTIMATED_PREFIX}{feature}" if estimated else feature)[:100],
                    input_tokens=input_count,
                    output_tokens=output_count,
                    estimated_cost_microunits=_cost_microunits(input_count, output_count),
                )
                return self._row_to_event(updated)
        except GeminiBudgetUnavailable:
            raise
        except (TenantDatabaseUnavailableError, SQLAlchemyError, ValueError) as exc:
            raise GeminiBudgetUnavailable("AI budget database is unavailable") from exc

    def release(self, *, idempotency_key: str) -> bool:
        if not idempotency_key:
            return False
        engine = self._engine()
        lock = _SQLITE_TEST_LOCK if engine.dialect.name == "sqlite" else nullcontext()
        try:
            with lock, engine.begin() as connection:
                result = connection.execute(
                    sa.delete(ai_usage_ledger).where(
                        ai_usage_ledger.c.idempotency_key == idempotency_key,
                        ai_usage_ledger.c.workspace_id == INTERNAL_WORKSPACE_ID,
                        ai_usage_ledger.c.project_id == INTERNAL_PROJECT_ID,
                        ai_usage_ledger.c.provider == _PROVIDER,
                        ai_usage_ledger.c.operation.like(f"{_RESERVATION_PREFIX}%"),
                    )
                )
                return bool(result.rowcount)
        except (TenantDatabaseUnavailableError, SQLAlchemyError, ValueError) as exc:
            raise GeminiBudgetUnavailable("AI budget database is unavailable") from exc

    def summary(self) -> dict[str, Any]:
        now = self._now_provider().astimezone(timezone.utc)
        engine = self._engine()
        lock = _SQLITE_TEST_LOCK if engine.dialect.name == "sqlite" else nullcontext()
        try:
            with lock, engine.begin() as connection:
                account = self._ensure_account(connection, engine)
                self._purge_expired_reservations(connection, now=now)
                start, end, month = _period_bounds(now, str(account["period_timezone"]))
                rows = connection.execute(
                    sa.select(ai_usage_ledger)
                    .where(
                        ai_usage_ledger.c.workspace_id == INTERNAL_WORKSPACE_ID,
                        ai_usage_ledger.c.project_id == INTERNAL_PROJECT_ID,
                        ai_usage_ledger.c.provider == _PROVIDER,
                        ai_usage_ledger.c.occurred_at >= start,
                        ai_usage_ledger.c.occurred_at < end,
                    )
                    .order_by(ai_usage_ledger.c.occurred_at.desc())
                ).mappings().all()
                events = [self._row_to_event(row) for row in rows]
                return _summary_payload(
                    month=month,
                    budget_usd=int(account["monthly_limit_microunits"] or 0) / 1_000_000,
                    usd_jpy=usd_jpy_rate(),
                    used_usd=sum(int(row["estimated_cost_microunits"] or 0) for row in rows) / 1_000_000,
                    events=events,
                    storage_status="ok",
                    error=None,
                )
        except GeminiBudgetUnavailable:
            raise
        except (TenantDatabaseUnavailableError, SQLAlchemyError, ValueError) as exc:
            raise GeminiBudgetUnavailable("AI budget database is unavailable") from exc

    def reset(self) -> None:
        engine = self._engine()
        lock = _SQLITE_TEST_LOCK if engine.dialect.name == "sqlite" else nullcontext()
        try:
            with lock, engine.begin() as connection:
                connection.execute(
                    sa.delete(ai_usage_ledger).where(
                        ai_usage_ledger.c.workspace_id == INTERNAL_WORKSPACE_ID,
                        ai_usage_ledger.c.project_id == INTERNAL_PROJECT_ID,
                        ai_usage_ledger.c.provider == _PROVIDER,
                    )
                )
                connection.execute(
                    sa.delete(ai_budget_accounts).where(
                        ai_budget_accounts.c.workspace_id == INTERNAL_WORKSPACE_ID,
                        ai_budget_accounts.c.scope_key == _SCOPE_KEY,
                        ai_budget_accounts.c.provider == _PROVIDER,
                    )
                )
        except (TenantDatabaseUnavailableError, SQLAlchemyError, ValueError) as exc:
            raise GeminiBudgetUnavailable("AI budget database is unavailable") from exc


_budget_store = PostgresGeminiBudgetStore()


def _new_idempotency_key() -> str:
    return f"gemini-budget:{secrets.token_urlsafe(24)}"


def get_budget_summary() -> dict[str, Any]:
    return _budget_store.summary()


def assert_gemini_budget_available(
    *,
    model: str | None,
    prompt: str,
    max_output_tokens: int,
    feature: str,
    idempotency_key: str | None = None,
) -> dict[str, Any] | None:
    if not is_gemini_model(model):
        return None
    estimate = estimate_request_cost(
        prompt=prompt,
        max_output_tokens=max_output_tokens,
        model=model,
    )
    reservation = _budget_store.reserve(
        idempotency_key=idempotency_key or _new_idempotency_key(),
        model=str(model or ""),
        feature=feature,
        input_tokens=int(estimate["input_tokens"]),
        output_tokens=int(estimate["output_tokens"]),
    )
    estimate.update(reservation)
    return estimate


def record_gemini_usage(
    *,
    model: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int | None = None,
    feature: str,
    estimated: bool = False,
    request_estimate: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any] | None:
    del total_tokens  # derived from the two authoritative component counts
    if not is_gemini_model(model):
        return None
    key = str(
        idempotency_key
        or (request_estimate or {}).get("reservation_key")
        or _new_idempotency_key()
    )
    input_tokens = max(0, int(prompt_tokens or 0))
    output_tokens = max(0, int(completion_tokens or 0))
    event = _budget_store.finalize(
        idempotency_key=key,
        model=str(model or ""),
        feature=feature,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        estimated=bool(estimated),
    )
    if event is not None:
        return event
    # Backward-compatible direct recording still makes an atomic budget
    # decision; normal provider paths always finalize a prior reservation.
    _budget_store.reserve(
        idempotency_key=key,
        model=str(model or ""),
        feature=feature,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    return _budget_store.finalize(
        idempotency_key=key,
        model=str(model or ""),
        feature=feature,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        estimated=bool(estimated),
    )


def record_gemini_usage_from_response(
    *,
    model: str | None,
    prompt: str,
    output_text: str,
    max_output_tokens: int,
    usage_metadata: dict[str, Any] | None,
    feature: str,
    request_estimate: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any] | None:
    usage = usage_metadata or {}
    prompt_tokens = _first_int(
        usage.get("promptTokenCount"),
        usage.get("prompt_token_count"),
        estimate_text_tokens(prompt),
    )
    output_tokens = _first_int(
        usage.get("candidatesTokenCount"),
        usage.get("candidates_token_count"),
        estimate_text_tokens(output_text) or max_output_tokens,
    )
    total_tokens = _first_int(
        usage.get("totalTokenCount"),
        usage.get("total_token_count"),
        prompt_tokens + output_tokens,
    )
    has_real_usage = bool(usage_metadata) and (
        usage.get("promptTokenCount") is not None
        or usage.get("candidatesTokenCount") is not None
        or usage.get("totalTokenCount") is not None
    )
    return record_gemini_usage(
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=output_tokens,
        total_tokens=total_tokens,
        feature=feature,
        estimated=not has_real_usage,
        request_estimate=request_estimate,
        idempotency_key=idempotency_key,
    )


def release_gemini_reservation(
    request_estimate: dict[str, Any] | None = None,
    *,
    idempotency_key: str | None = None,
) -> bool:
    key = str(idempotency_key or (request_estimate or {}).get("reservation_key") or "")
    return _budget_store.release(idempotency_key=key)


def reset_budget_for_dev() -> dict[str, Any]:
    if _is_managed_runtime() and os.getenv("ALLOW_GEMINI_BUDGET_RESET") != "1":
        raise PermissionError("Gemini budget reset is disabled in production.")
    _budget_store.reset()
    return get_budget_summary()


def _summary_payload(
    *,
    month: str,
    budget_usd: float,
    usd_jpy: float,
    used_usd: float,
    events: list[dict[str, Any]],
    storage_status: str,
    error: str | None,
) -> dict[str, Any]:
    remaining_usd = max(0.0, budget_usd - used_usd)
    usage_ratio = (used_usd / budget_usd) if budget_usd > 0 else 1.0
    threshold_ratio = usage_ratio + 1e-9
    if storage_status != "ok":
        status = "unknown"
    elif threshold_ratio >= 1:
        status = "exceeded"
    elif threshold_ratio >= 0.9:
        status = "danger"
    elif threshold_ratio >= 0.7:
        status = "warning"
    else:
        status = "ok"
    return {
        "ok": storage_status == "ok",
        "month": month,
        "budget_usd": round(budget_usd, 4),
        "used_usd": round(used_usd, 8),
        "remaining_usd": round(remaining_usd, 8),
        "usage_ratio": round(usage_ratio, 6),
        "used_jpy_estimate": round(used_usd * usd_jpy),
        "budget_jpy_estimate": round(budget_usd * usd_jpy),
        "usd_jpy": usd_jpy,
        "status": status,
        "storage_status": storage_status,
        "error": error,
        "events": events[:10],
        "pricing": {
            "model": GEMINI_FLASH_LITE_MODEL,
            "input_usd_per_1m": GEMINI_FLASH_LITE_INPUT_USD_PER_1M,
            "output_usd_per_1m": GEMINI_FLASH_LITE_OUTPUT_USD_PER_1M,
        },
    }


def _float_env(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
        return value if value > 0 else default
    except Exception:
        return default


def _first_int(*values: Any) -> int:
    for value in values:
        try:
            if value is None:
                continue
            return int(value)
        except Exception:
            continue
    return 0
