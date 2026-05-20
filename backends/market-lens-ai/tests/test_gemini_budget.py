from __future__ import annotations

import json
from pathlib import Path

import pytest

from web.app import gemini_budget as gb

TEST_USAGE_PATH = Path(__file__).resolve().parents[1] / "data" / "test_gemini_budget_usage.json"


def _usage_path(monkeypatch) -> Path:
    TEST_USAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if TEST_USAGE_PATH.exists():
        TEST_USAGE_PATH.unlink()
    monkeypatch.setenv("GEMINI_USAGE_PATH", str(TEST_USAGE_PATH))
    return TEST_USAGE_PATH


def test_calculates_gemini_35_flash_cost() -> None:
    assert gb.calculate_cost_usd(1_000_000, 1_000_000) == pytest.approx(10.5)
    assert gb.calculate_cost_usd(100_000, 10_000) == pytest.approx(0.24)


def test_blocks_when_projected_monthly_budget_exceeds(monkeypatch) -> None:
    usage_path = _usage_path(monkeypatch)
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "18")

    month = gb.current_month_key()
    usage_path.write_text(
        json.dumps({
            "version": 1,
            "events": [
                {"month": month, "cost_usd": 17.90, "created_at": "2026-05-20T00:00:00+09:00"}
            ],
        }),
        encoding="utf-8",
    )

    with pytest.raises(gb.GeminiBudgetExceeded):
        gb.assert_gemini_budget_available(
            model="gemini-3.5-flash",
            prompt="x" * 20_000,
            max_output_tokens=20_000,
            feature="test",
        )


def test_warning_status_thresholds(monkeypatch) -> None:
    usage_path = _usage_path(monkeypatch)
    monkeypatch.setenv("GEMINI_MONTHLY_BUDGET_USD", "18")
    month = gb.current_month_key()

    usage_path.write_text(
        json.dumps({
            "version": 1,
            "events": [
                {"month": month, "cost_usd": 12.60, "created_at": "2026-05-20T00:00:00+09:00"}
            ],
        }),
        encoding="utf-8",
    )
    assert gb.get_budget_summary()["status"] == "warning"

    usage_path.write_text(
        json.dumps({
            "version": 1,
            "events": [
                {"month": month, "cost_usd": 16.20, "created_at": "2026-05-20T00:00:00+09:00"}
            ],
        }),
        encoding="utf-8",
    )
    assert gb.get_budget_summary()["status"] == "danger"


def test_corrupt_usage_file_reports_unknown_and_blocks(monkeypatch) -> None:
    usage_path = _usage_path(monkeypatch)
    usage_path.write_text("{broken", encoding="utf-8")

    summary = gb.get_budget_summary()
    assert summary["status"] == "unknown"
    assert summary["storage_status"] == "corrupt"
    with pytest.raises(gb.GeminiBudgetExceeded):
        gb.assert_gemini_budget_available(
            model="gemini-3.5-flash",
            prompt="hello",
            max_output_tokens=100,
            feature="test",
        )
