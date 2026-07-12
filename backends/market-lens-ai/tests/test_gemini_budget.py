from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import OperationalError

from web.app import gemini_budget as gb
from web.app.tenant_auth import get_managed_session_factory
from web.app.tenant_schema import ai_budget_accounts, ai_usage_ledger


def _engine():
    return get_managed_session_factory().kw["bind"]


def test_calculates_gemini_flash_lite_cost() -> None:
    assert gb.calculate_cost_usd(1_000_000, 1_000_000) == pytest.approx(1.75)
    assert gb.calculate_cost_usd(100_000, 10_000) == pytest.approx(0.04)


def test_normalizes_legacy_flash_preview_model() -> None:
    assert gb.normalize_gemini_model("gemini-3-flash-preview") == "gemini-3.1-flash-lite"
    assert gb.normalize_gemini_model("gemini-3.5-flash") == "gemini-3.1-flash-lite"
    assert gb.normalize_gemini_model("gemini-3.1-flash-lite-preview") == "gemini-3.1-flash-lite"
    assert gb.normalize_gemini_model("gemini-2.5-flash") == "gemini-3.1-flash-lite"
    assert gb.normalize_gemini_model("") == "gemini-3.1-flash-lite"


def test_real_usage_is_finalized_once() -> None:
    reservation = gb.assert_gemini_budget_available(
        model=gb.GEMINI_FLASH_LITE_MODEL,
        prompt="hello",
        max_output_tokens=100,
        feature="test",
        idempotency_key="budget:test:ml-real",
    )
    event = gb.record_gemini_usage(
        model=gb.GEMINI_FLASH_LITE_MODEL,
        prompt_tokens=1000,
        completion_tokens=200,
        feature="test",
        request_estimate=reservation,
    )
    assert event is not None and event["estimated"] is False
    assert gb.get_budget_summary()["used_usd"] == pytest.approx(0.00055)


def test_blocks_when_projected_monthly_budget_exceeds(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "0.01")
    with pytest.raises(gb.GeminiBudgetExceeded):
        gb.assert_gemini_budget_available(
            model=gb.GEMINI_FLASH_LITE_MODEL,
            prompt="x" * 20_000,
            max_output_tokens=20_000,
            feature="test",
            idempotency_key="budget:test:ml-over",
        )


def test_warning_status_thresholds(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "0.9")
    gb.record_gemini_usage(
        model=gb.GEMINI_FLASH_LITE_MODEL,
        prompt_tokens=0,
        completion_tokens=420_000,
        feature="warning",
        idempotency_key="budget:test:warning",
    )
    assert gb.get_budget_summary()["status"] == "warning"
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "1")
    gb.reset_budget_for_dev()
    gb.record_gemini_usage(
        model=gb.GEMINI_FLASH_LITE_MODEL,
        prompt_tokens=0,
        completion_tokens=600_000,
        feature="danger",
        idempotency_key="budget:test:danger",
    )
    assert gb.get_budget_summary()["status"] == "danger"


def test_cross_instance_idempotency_and_concurrent_cap(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "0.00001")
    engine = _engine()
    first = gb.PostgresGeminiBudgetStore(engine_provider=lambda: engine)
    cold = gb.PostgresGeminiBudgetStore(engine_provider=lambda: engine)
    first.reserve(
        idempotency_key="budget:test:ml-retry",
        model=gb.GEMINI_FLASH_LITE_MODEL,
        feature="retry",
        input_tokens=0,
        output_tokens=1,
    )
    assert cold.reserve(
        idempotency_key="budget:test:ml-retry",
        model=gb.GEMINI_FLASH_LITE_MODEL,
        feature="retry",
        input_tokens=0,
        output_tokens=1,
    )["already_reserved"] is True

    def reserve(index: int) -> str:
        try:
            gb.PostgresGeminiBudgetStore(engine_provider=lambda: engine).reserve(
                idempotency_key=f"budget:test:ml-parallel:{index}",
                model=gb.GEMINI_FLASH_LITE_MODEL,
                feature="parallel",
                input_tokens=0,
                output_tokens=1,
            )
            return "allowed"
        except gb.GeminiBudgetExceeded:
            return "blocked"

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(reserve, range(9)))
    # One slot was already consumed by the retry key; four more can fit.
    assert results.count("allowed") == 4
    assert results.count("blocked") == 5
    with engine.connect() as connection:
        assert connection.scalar(sa.select(sa.func.count()).select_from(ai_usage_ledger)) == 5


def test_finalize_and_release_do_not_double_charge() -> None:
    estimate = gb.assert_gemini_budget_available(
        model=gb.GEMINI_FLASH_LITE_MODEL,
        prompt="hello",
        max_output_tokens=100,
        feature="finalize",
        idempotency_key="budget:test:ml-finalize",
    )
    first = gb.record_gemini_usage(
        model=gb.GEMINI_FLASH_LITE_MODEL,
        prompt_tokens=20,
        completion_tokens=30,
        feature="finalize",
        request_estimate=estimate,
    )
    replay = gb.record_gemini_usage(
        model=gb.GEMINI_FLASH_LITE_MODEL,
        prompt_tokens=999,
        completion_tokens=999,
        feature="finalize",
        request_estimate=estimate,
    )
    assert replay == first
    assert gb.release_gemini_reservation(estimate) is False

    pending = gb.assert_gemini_budget_available(
        model=gb.GEMINI_FLASH_LITE_MODEL,
        prompt="pending",
        max_output_tokens=20,
        feature="release",
        idempotency_key="budget:test:ml-release",
    )
    assert gb.release_gemini_reservation(pending) is True
    assert gb.release_gemini_reservation(pending) is False


def test_database_failure_fails_closed(monkeypatch) -> None:
    def unavailable():
        raise OperationalError("SELECT", {}, RuntimeError("secret db detail"))

    monkeypatch.setattr(
        gb,
        "_budget_store",
        gb.PostgresGeminiBudgetStore(engine_provider=unavailable),
    )
    with pytest.raises(gb.GeminiBudgetUnavailable, match="database is unavailable"):
        gb.get_budget_summary()
    with pytest.raises(gb.GeminiBudgetUnavailable):
        gb.assert_gemini_budget_available(
            model=gb.GEMINI_FLASH_LITE_MODEL,
            prompt="paid call must not start",
            max_output_tokens=100,
            feature="failure",
        )


def test_account_and_ledger_are_migration_owned() -> None:
    engine = _engine()
    gb.get_budget_summary()
    with engine.connect() as connection:
        assert connection.scalar(sa.select(sa.func.count()).select_from(ai_budget_accounts)) == 1
        assert connection.scalar(sa.select(sa.func.count()).select_from(ai_usage_ledger)) == 0
