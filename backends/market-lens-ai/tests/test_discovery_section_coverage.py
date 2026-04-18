"""Tests for Discovery Section 5 subsection coverage (Phase P1-C/D).

Confirms that:
 - When required subsections exist, the quality gate passes.
 - When any MUST subsection is missing, the gate raises a critical issue.
 - When DETERMINISTIC_STUB_ENABLED=true, stubs are injected and the gate
   re-evaluates to non-critical.
"""

from __future__ import annotations

import os

import pytest

from web.app.models import ExtractedData, ScanResult, TokenUsage
from web.app.report_generator import (
    _detect_section5_subsections,
    _quality_gate_check,
    generate_report_bundle,
)


def _full_section5_markdown() -> str:
    return (
        "## エグゼクティブサマリー\n要約\n\n"
        "## 分析対象と比較前提\n前提\n\n"
        "## 競合比較サマリー\n比較\n\n"
        "## ブランド別評価\n評価\n\n"
        "## 実行プラン\n"
        "### 最優先3施策\n- 施策A\n\n"
        "### 5-0 予算フレーム\n"
        "| 項目 | 初期 | 拡張 | 備考 |\n|---|---|---|---|\n| 月額予算帯 | 10万円 | 30万円 | 推定 |\n\n"
        "### 5-1 LP改善施策\n| 項目 |\n|---|\n| FV改善 |\n\n"
        "### 5-2 検索広告施策\n| 項目 |\n|---|\n| 指名防衛 |\n"
    )


def _missing_section5_markdown() -> str:
    # Has 実行プラン heading but none of the 4 MUST subsections
    return (
        "## エグゼクティブサマリー\n要約\n\n"
        "## 分析対象と比較前提\n前提\n\n"
        "## 競合比較サマリー\n比較\n\n"
        "## ブランド別評価\n評価\n\n"
        "## 実行プラン\n雑多な改善提案を平文で記載\n"
    )


def _synthesizable_gap_markdown() -> str:
    # Only the two synthesizable MUST subsections (最優先3施策 / 5-0) are
    # missing. 5-1 / 5-2 are present so the stub injection alone can clear
    # the critical gate.
    return (
        "## エグゼクティブサマリー\n要約\n\n"
        "## 分析対象と比較前提\n前提\n\n"
        "## 競合比較サマリー\n比較\n\n"
        "## ブランド別評価\n評価\n\n"
        "## 実行プラン\n"
        "### 5-1 LP改善施策\n| 項目 |\n|---|\n| FV改善 |\n\n"
        "### 5-2 検索広告施策\n| 項目 |\n|---|\n| 指名防衛 |\n"
    )


def _strong_extracted(url: str) -> ExtractedData:
    return ExtractedData(
        url=url,
        title="公式ストア",
        h1="主要ブランド",
        hero_copy="価値提案" * 8,
        main_cta="購入する",
        body_text_snippet="本文が充実しています。" * 20,
        contact_paths=["購入", "FAQ"],
        corporate_elements=["実績", "信頼"],
    )


def _multi_url_result(urls: list[str]) -> ScanResult:
    return ScanResult(
        urls=urls,
        extracted=[_strong_extracted(u) for u in urls],
        token_usage=TokenUsage(model="test"),
    )


def test_detect_section5_subsections_all_present():
    flags = _detect_section5_subsections(_full_section5_markdown())
    assert flags["最優先3施策"] is True
    assert flags["5-0 予算フレーム"] is True
    assert flags["5-1 LP改善施策"] is True
    assert flags["5-2 検索広告施策"] is True


def test_detect_section5_subsections_all_missing():
    flags = _detect_section5_subsections(_missing_section5_markdown())
    assert flags["最優先3施策"] is False
    assert flags["5-0 予算フレーム"] is False
    assert flags["5-1 LP改善施策"] is False
    assert flags["5-2 検索広告施策"] is False


def test_quality_gate_passes_when_all_subsections_present():
    result = _multi_url_result(
        ["https://a.example", "https://b.example", "https://c.example"]
    )
    issues, is_critical = _quality_gate_check(_full_section5_markdown(), result)
    # MUST subsections should have no critical issue; info-level gaps for
    # 5-3/5-4 are tolerated.
    critical_subsection_issues = [
        i for i in issues
        if i.startswith("セクション欠損:")
        and any(
            tag in i
            for tag in ("最優先3施策", "5-0 予算フレーム", "5-1 LP改善施策", "5-2 検索広告施策")
        )
    ]
    assert critical_subsection_issues == []
    assert is_critical is False


def test_quality_gate_flags_missing_must_subsections_as_critical():
    result = _multi_url_result(
        ["https://a.example", "https://b.example", "https://c.example"]
    )
    issues, is_critical = _quality_gate_check(_missing_section5_markdown(), result)
    assert is_critical is True
    joined = "\n".join(issues)
    assert "最優先3施策" in joined
    assert "5-0 予算フレーム" in joined
    assert "5-1 LP改善施策" in joined
    assert "5-2 検索広告施策" in joined


def test_single_url_result_does_not_trigger_subsection_gate():
    result = ScanResult(
        urls=["https://solo.example"],
        extracted=[_strong_extracted("https://solo.example")],
    )
    issues, _is_critical = _quality_gate_check(_missing_section5_markdown(), result)
    # Single URL LP path should not raise 最優先3施策-style critical issues
    assert not any("最優先3施策" in i for i in issues)


def test_deterministic_stub_injection_recovers_missing_subsections(monkeypatch):
    monkeypatch.setenv("DETERMINISTIC_STUB_ENABLED", "true")
    result = _multi_url_result(
        ["https://a.example", "https://b.example", "https://c.example"]
    )
    bundle = generate_report_bundle(result, _synthesizable_gap_markdown())

    # Auto-generated Appendix A marker should appear
    assert "自動生成" in bundle.report_md
    # After stub injection, the two synthesizable gaps are closed →
    # critical gate clears.
    assert bundle.quality_is_critical is False


def test_feature_flag_off_skips_stub_injection(monkeypatch):
    monkeypatch.delenv("DETERMINISTIC_STUB_ENABLED", raising=False)
    result = _multi_url_result(
        ["https://a.example", "https://b.example", "https://c.example"]
    )
    bundle = generate_report_bundle(result, _missing_section5_markdown())
    # Without the flag the critical gate should remain raised
    assert bundle.quality_is_critical is True
