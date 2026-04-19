"""Unit tests for confidence_tier_validator."""

from __future__ import annotations

import pytest

from web.app import confidence_tier_validator
from web.app.confidence_tier_validator import (
    NOTES_HEADING,
    extract_notes_from_markdown,
    validate_and_annotate,
)
from web.app.deterministic_evaluator import evaluate_all
from web.app.models import ExtractedData
from web.app.shared_specs import clear_cache as _clear_shared_specs_cache


@pytest.fixture(autouse=True)
def _reset_caches():
    _clear_shared_specs_cache()
    confidence_tier_validator.clear_cache()
    yield
    _clear_shared_specs_cache()
    confidence_tier_validator.clear_cache()


def _l5_only_nav_brand() -> ExtractedData:
    """Mimic the SAURUS 'ANTI DOPING' nav-label-only case.

    Populates only L5-tier signal fields (banner_texts / promo_claims /
    feature_bullets) so evaluate_all classifies the brand as trust_tier=L5.
    """
    return ExtractedData(
        url="https://saurus-example.example.jp/",
        title="SAURUS",
        hero_copy="ANTI DOPING",
        banner_texts=["ANTI DOPING"],
        feature_bullets=["プロアスリート向け"],
        promo_claims=["選ばれる理由"],
    )


def _l1_certified_brand() -> ExtractedData:
    """Brand with real L1 evidence (trust_badges + review_signals)."""
    return ExtractedData(
        url="https://certified-brand.example.jp/",
        title="認証ブランド",
        hero_copy="第三者機関による品質認証済みの製品です",
        main_cta="詳細を見る",
        trust_badges=["JIS認証", "ISO9001取得"],
        review_signals=["Google口コミ 星4.8"],
        corporate_elements=["運営会社: 株式会社認証"],
    )


def test_l5_only_nav_label_blocks_certification_claim():
    """L5-only brand: 'アンチドーピング対応' must be rewritten to neutral phrasing."""
    evaluations = evaluate_all([_l5_only_nav_brand()])
    assert evaluations[0].trust_tier == "L5"

    report_md = (
        "# レポート\n\n"
        "## ブランド別評価\n\n"
        "### saurus-example.example.jp\n\n"
        "**強み:** アンチドーピング対応が明確に訴求されている\n\n"
        "**弱み:** 価格訴求が弱い\n"
    )

    outcome = validate_and_annotate(
        report_markdown=report_md,
        brand_evaluations=evaluations,
        context="discovery",
    )

    assert outcome.is_clean is False
    # Notes section echoes the original claim; check the body only.
    body = outcome.rewritten_markdown.split(NOTES_HEADING, 1)[0]
    assert "アンチドーピング対応" not in body
    assert "関連情報の記載あり（内容未確認）" in body
    assert any(v.rule_id == "l5_only_certification" for v in outcome.violations)
    assert any(v.original_claim == "アンチドーピング対応" for v in outcome.violations)


def test_l1_certified_evidence_passes_through():
    """L1 brand with real trust_badges — 'アンチドーピング対応' rule is L5-only and must not rewrite."""
    evaluations = evaluate_all([_l1_certified_brand()])
    assert evaluations[0].trust_tier == "L1"

    report_md = (
        "# レポート\n\n"
        "## ブランド別評価\n\n"
        "### certified-brand.example.jp\n\n"
        "**強み:** アンチドーピング対応の第三者認証を保有している\n"
    )

    outcome = validate_and_annotate(
        report_markdown=report_md,
        brand_evaluations=evaluations,
        context="discovery",
    )

    # L5-only rules don't fire on L1 brands.
    assert outcome.rewritten_markdown == report_md
    # defer_comparative_claims also should not fire (no 評価保留 axis).
    assert outcome.is_clean is True


def test_verdict_defer_blocks_comparative_claims():
    """Brand with any 評価保留 axis: '他社を圧倒している' must be rewritten."""
    # Empty brand → all axes 評価保留 and trust_tier=L5.
    empty = ExtractedData(url="https://empty-brand.example.jp/")
    evaluations = evaluate_all([empty])
    assert any(v.verdict == "評価保留" for v in evaluations[0].axis_verdicts)

    report_md = (
        "# レポート\n\n"
        "## ブランド別評価\n\n"
        "### empty-brand.example.jp\n\n"
        "このブランドは他社を圧倒している価格訴求を持つ。\n"
    )

    outcome = validate_and_annotate(
        report_markdown=report_md,
        brand_evaluations=evaluations,
        context="discovery",
    )

    assert outcome.is_clean is False
    body = outcome.rewritten_markdown.split(NOTES_HEADING, 1)[0]
    assert "他社を圧倒している" not in body
    assert "判定保留（データ不足）" in body
    assert any(v.rule_id == "defer_comparative_claims" for v in outcome.violations)


def test_clean_report_returns_no_notes():
    """Clean markdown with no forbidden patterns returns is_clean=True, notes=()."""
    evaluations = evaluate_all([_l5_only_nav_brand()])
    report_md = (
        "# レポート\n\n"
        "## ブランド別評価\n\n"
        "### saurus-example.example.jp\n\n"
        "**強み:** ブランド訴求が明確\n"
        "**弱み:** 価格情報が不足\n"
    )

    outcome = validate_and_annotate(
        report_markdown=report_md,
        brand_evaluations=evaluations,
        context="discovery",
    )

    assert outcome.is_clean is True
    assert outcome.violations == ()
    assert outcome.notes == ()
    assert outcome.rewritten_markdown == report_md
    # And extract_notes_from_markdown mirrors this on the output.
    assert extract_notes_from_markdown(outcome.rewritten_markdown) == []


def test_report_notes_section_is_appended_correctly():
    """Violations detected → notes section with canonical heading appears at EOF."""
    evaluations = evaluate_all([_l5_only_nav_brand()])
    report_md = (
        "# レポート\n\n"
        "## ブランド別評価\n\n"
        "### saurus-example.example.jp\n\n"
        "**強み:** アンチドーピング対応\n"
    )

    outcome = validate_and_annotate(
        report_markdown=report_md,
        brand_evaluations=evaluations,
        context="discovery",
    )

    assert outcome.is_clean is False
    assert NOTES_HEADING in outcome.rewritten_markdown
    # Notes section sits at the end of the doc (no following H2).
    tail = outcome.rewritten_markdown[outcome.rewritten_markdown.index(NOTES_HEADING):]
    assert "関連情報の記載あり" in tail
    # extract_notes_from_markdown round-trips.
    parsed_notes = extract_notes_from_markdown(outcome.rewritten_markdown)
    assert len(parsed_notes) >= 1
    assert any("アンチドーピング対応" in n for n in parsed_notes)


def test_feature_flag_disables_validator(monkeypatch):
    """ENABLE_CONFIDENCE_TIER_VALIDATOR=0 bypasses all rewriting."""
    monkeypatch.setenv("ENABLE_CONFIDENCE_TIER_VALIDATOR", "0")
    evaluations = evaluate_all([_l5_only_nav_brand()])
    report_md = (
        "## ブランド別評価\n\n"
        "### saurus-example.example.jp\n\n"
        "**強み:** アンチドーピング対応\n"
    )

    outcome = validate_and_annotate(
        report_markdown=report_md,
        brand_evaluations=evaluations,
        context="discovery",
    )

    assert outcome.is_clean is True
    assert outcome.rewritten_markdown == report_md
