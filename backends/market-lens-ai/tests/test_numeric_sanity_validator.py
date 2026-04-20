"""Unit tests for numeric_sanity_validator."""

from __future__ import annotations

import pytest

from web.app import numeric_sanity_validator
from web.app.numeric_sanity_validator import (
    NOTES_HEADING,
    extract_notes_from_markdown,
    validate_and_annotate,
)


@pytest.fixture(autouse=True)
def _reset_caches():
    numeric_sanity_validator.clear_cache()
    yield
    numeric_sanity_validator.clear_cache()


def test_market_size_hard_warn_trillion_range_flagged():
    """200,000〜250,000 億円 (20〜25兆円) is above hard threshold."""
    md = (
        "# レポート\n\n"
        "## 市場推定データ\n\n"
        "**信頼度**: low\n\n"
        "| 指標 | 範囲 | 単位 |\n"
        "|------|------|------|\n"
        "| 市場規模 | 200,000〜250,000 | 億円 |\n"
    )

    outcome = validate_and_annotate(report_markdown=md)

    assert outcome.is_clean is False
    assert any(i.rule_id == "market_size_hard_warn" for i in outcome.issues)
    assert "桁違い" in outcome.rewritten_markdown
    assert NOTES_HEADING in outcome.rewritten_markdown


def test_market_size_realistic_category_passes():
    """A realistic category-EC market size (500〜1,000 億円) should not be flagged."""
    md = (
        "# レポート\n\n"
        "## 市場推定データ\n\n"
        "| 指標 | 範囲 | 単位 |\n"
        "|------|------|------|\n"
        "| 市場規模 | 500〜1,000 | 億円 |\n"
    )

    outcome = validate_and_annotate(report_markdown=md)

    assert outcome.is_clean is True
    assert NOTES_HEADING not in outcome.rewritten_markdown


def test_market_size_soft_warn_at_trillion_scale():
    """市場規模 15,000〜20,000 億円 (1.5〜2兆円) triggers soft warn."""
    md = (
        "## 市場推定データ\n\n"
        "| 指標 | 範囲 | 単位 |\n"
        "|---|---|---|\n"
        "| 市場規模 | 15,000〜20,000 | 億円 |\n"
    )

    outcome = validate_and_annotate(report_markdown=md)

    assert outcome.is_clean is False
    assert any(i.rule_id == "market_size_soft_warn" for i in outcome.issues)


def test_ad_spend_range_wide_low_confidence_masked():
    """A 300〜5,000 万円 range (16.7×) under low confidence gets masked."""
    md = (
        "## 4. 競合広告投資推定\n\n"
        "信頼度: low\n\n"
        "- Hits Online / SANEI 広告投資: 300〜5,000万円\n"
    )

    outcome = validate_and_annotate(report_markdown=md)

    assert outcome.is_clean is False
    assert any(i.rule_id == "ad_spend_range_masked" for i in outcome.issues)
    body = outcome.rewritten_markdown.split(NOTES_HEADING, 1)[0]
    assert "推定根拠不足" in body
    assert "300〜5,000万円" not in body


def test_ad_spend_range_wide_medium_confidence_only_annotated():
    """A 10× range with medium confidence gets annotated but not masked."""
    md = (
        "## 4. 競合広告投資推定\n\n"
        "信頼度: 中\n\n"
        "- ブランドA 広告投資: 100〜1,000万円\n"
    )

    outcome = validate_and_annotate(report_markdown=md)

    assert outcome.is_clean is False
    assert any(i.rule_id == "ad_spend_range_wide" for i in outcome.issues)
    # Original range should still appear (annotated, not masked)
    assert "100〜1,000" in outcome.rewritten_markdown
    assert "⚠幅" in outcome.rewritten_markdown


def test_ad_spend_tight_range_passes():
    """A 500〜800 万円 range (1.6×) under low confidence is acceptable."""
    md = (
        "## 4. 競合広告投資推定\n\n"
        "信頼度: low\n\n"
        "- ブランドA 広告投資: 500〜800万円\n"
    )

    outcome = validate_and_annotate(report_markdown=md)

    assert outcome.is_clean is True


def test_notes_section_roundtrip():
    """extract_notes_from_markdown pulls back appended notes."""
    md = (
        "## 市場推定データ\n\n"
        "| 指標 | 範囲 | 単位 |\n"
        "|---|---|---|\n"
        "| 市場規模 | 200,000〜250,000 | 億円 |\n"
    )

    outcome = validate_and_annotate(report_markdown=md)
    notes = extract_notes_from_markdown(outcome.rewritten_markdown)

    assert notes
    assert any("桁違い" in n for n in notes)


def test_disabled_flag_returns_unchanged(monkeypatch):
    monkeypatch.setenv("ENABLE_NUMERIC_SANITY_VALIDATOR", "0")
    md = (
        "## 市場推定データ\n\n"
        "| 指標 | 範囲 | 単位 |\n"
        "|---|---|---|\n"
        "| 市場規模 | 200,000〜250,000 | 億円 |\n"
    )

    outcome = validate_and_annotate(report_markdown=md)

    assert outcome.is_clean is True
    assert outcome.rewritten_markdown == md
