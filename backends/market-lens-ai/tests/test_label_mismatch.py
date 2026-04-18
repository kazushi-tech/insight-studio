"""Tests for A-6: label-mismatch detection."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from web.app.models import ExtractedData, ScanResult
from web.app.report_generator import _check_label_mismatch, _quality_gate_check
from web.app.shared_specs import clear_cache


@pytest.fixture(autouse=True)
def _reset_cache():
    clear_cache()
    yield
    clear_cache()


def _scan(extracted: list[ExtractedData]) -> ScanResult:
    return ScanResult(
        run_id="test-run",
        created_at=datetime(2026, 4, 18, tzinfo=timezone.utc),
        status="pass",
        urls=[d.url for d in extracted],
        extracted=extracted,
    )


def test_no_mismatch_when_data_supports_claim():
    # Brand with populated trust fields → 確認済み in 信頼構築 row is OK
    brand = ExtractedData(
        url="https://camera-obayashi.example/",
        hero_copy="中古カメラを高く売るなら",
        main_cta="無料査定",
        trust_badges=["JCAA認定店"],
        testimonials=["顧客の声A", "顧客の声B"],
        review_signals=["Google口コミ星4.7"],
    )
    result = _scan([brand])
    body = (
        "## 4. ブランド別評価\n\n"
        "### camera-obayashi.example\n"
        "| 評価軸 | 判定 | 根拠 | 証拠強度 |\n"
        "| --- | --- | --- | --- |\n"
        "| 信頼構築 | 強 | JCAA認定店 + 口コミ豊富 | 確認済み |\n"
    )
    assert _check_label_mismatch(body, result) == []


def test_mismatch_flagged_when_trust_fields_all_empty():
    # Brand has no trust fields → 確認済み on 信頼構築 is a mismatch.
    brand = ExtractedData(
        url="https://emptybrand.example/",
        hero_copy="welcome",
    )
    result = _scan([brand])
    body = (
        "## 4. ブランド別評価\n\n"
        "### emptybrand.example\n"
        "| 評価軸 | 判定 | 根拠 | 証拠強度 |\n"
        "| --- | --- | --- | --- |\n"
        "| 信頼構築 | 強 | — | 確認済み |\n"
    )
    issues = _check_label_mismatch(body, result)
    assert len(issues) == 1
    assert "Label mismatch" in issues[0]
    assert "信頼構築" in issues[0]


def test_mismatch_surfaces_in_quality_gate():
    brand = ExtractedData(url="https://zzzbrand.example/")
    result = _scan([brand])
    body = (
        "# Market Lens AI\n"
        "## エグゼクティブサマリー\n本件の要約です。\n"
        "## 分析対象と比較前提\n対象1件。\n"
        "## 4. ブランド別評価\n"
        "### zzzbrand.example\n"
        "| 評価軸 | 判定 | 根拠 | 証拠強度 |\n"
        "| --- | --- | --- | --- |\n"
        "| 信頼構築 | 強 | なし | 確認済み |\n"
        "## 実行プラン\n実行する。\n"
    )
    issues, _is_critical = _quality_gate_check(body, result)
    assert any("Label mismatch" in i for i in issues)


def test_mismatch_scoped_to_correct_brand_when_multiple():
    ok_brand = ExtractedData(
        url="https://okbrand.example/",
        testimonials=["顧客A"],
        review_signals=["口コミ"],
        trust_badges=["認定"],
        hero_copy="hello",
    )
    bad_brand = ExtractedData(
        url="https://badbrand.example/",
        hero_copy="world",
    )
    result = _scan([ok_brand, bad_brand])
    body = (
        "### okbrand.example\n"
        "| 評価軸 | 判定 | 根拠 | 証拠強度 |\n"
        "| --- | --- | --- | --- |\n"
        "| 信頼構築 | 強 | 口コミ + 認定 | 確認済み |\n"
        "\n### badbrand.example\n"
        "| 評価軸 | 判定 | 根拠 | 証拠強度 |\n"
        "| --- | --- | --- | --- |\n"
        "| 信頼構築 | 強 | — | 確認済み |\n"
    )
    issues = _check_label_mismatch(body, result)
    assert len(issues) == 1
    assert "badbrand" in issues[0]
    assert "okbrand" not in issues[0]


def test_no_mismatch_when_extracted_is_empty():
    result = ScanResult(
        run_id="empty",
        created_at=datetime(2026, 4, 18, tzinfo=timezone.utc),
        urls=[],
        extracted=[],
    )
    assert _check_label_mismatch("| 信頼構築 | 強 | — | 確認済み |", result) == []
