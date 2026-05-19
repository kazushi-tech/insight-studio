"""Tests for A-6: label-mismatch detection."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from web.app.models import ExtractedData, ScanResult
from web.app.report_generator import (
    _check_label_mismatch,
    _normalize_deferred_evidence_labels,
    _quality_gate_check,
    generate_report_bundle,
)
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


def test_deferred_label_is_normalized_before_quality_gate():
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

    normalized = _normalize_deferred_evidence_labels(body, result)

    assert "評価保留" in normalized
    assert _check_label_mismatch(normalized, result) == []


def test_generate_report_bundle_injects_missing_exec_plan_requirement():
    brand_a = ExtractedData(url="https://aaa.example/", hero_copy="first", main_cta="購入")
    brand_b = ExtractedData(url="https://bbb.example/", hero_copy="second", main_cta="相談")
    result = _scan([brand_a, brand_b])
    body = (
        "## エグゼクティブサマリー\n要約。\n"
        "## 分析対象と比較前提\n2URL。\n"
        "## 競合比較サマリー\n比較。\n"
        "## ブランド別評価\n評価。\n"
        "## 実行プラン\n"
        "### 最優先3施策\n"
        "### 5-0 予算フレーム\n"
        "### 5-1 LP改善施策\n"
        "### 5-2 検索広告施策\n"
        "| 施策 | 期待KPI | 根拠 | 初回検証方法 |\n"
        "|---|---|---|---|\n"
        "| LP修正 | CPA | CTA | 7日で確認 |\n"
    )

    bundle = generate_report_bundle(result, body)

    assert "実行プラン補足（運用チェック）" in bundle.report_md
    assert "実装難易度" in bundle.report_md
    assert not any("実装難易度" in issue for issue in bundle.quality_issues)
