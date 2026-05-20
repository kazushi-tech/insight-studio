from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from web.app import gemini_budget as gb

TEST_USAGE_PATH = ROOT / "data" / "test_gemini_budget_usage.json"


def _usage_path(monkeypatch) -> Path:
    TEST_USAGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if TEST_USAGE_PATH.exists():
        TEST_USAGE_PATH.unlink()
    monkeypatch.setenv("GEMINI_USAGE_PATH", str(TEST_USAGE_PATH))
    return TEST_USAGE_PATH


def test_calculates_gemini_35_flash_cost() -> None:
    assert gb.calculate_cost_usd(1_000_000, 1_000_000) == pytest.approx(10.5)
    assert gb.calculate_cost_usd(100_000, 10_000) == pytest.approx(0.24)


def test_normalizes_legacy_flash_preview_model() -> None:
    assert gb.normalize_gemini_model("gemini-3-flash-preview") == "gemini-3.5-flash"
    assert gb.normalize_gemini_model("") == "gemini-3.5-flash"


def test_records_real_usage_metadata(monkeypatch) -> None:
    _usage_path(monkeypatch)

    event = gb.record_gemini_usage_from_response(
        model="gemini-3.5-flash",
        prompt="hello",
        output_text="world",
        max_output_tokens=100,
        usage_metadata={
            "promptTokenCount": 1000,
            "candidatesTokenCount": 200,
            "totalTokenCount": 1200,
        },
        feature="test",
    )

    assert event is not None
    assert event["input_tokens"] == 1000
    assert event["output_tokens"] == 200
    assert event["estimated"] is False
    assert gb.get_budget_summary()["used_usd"] == pytest.approx(0.0033)


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
