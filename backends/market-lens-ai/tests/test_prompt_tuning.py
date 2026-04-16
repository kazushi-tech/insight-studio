"""Tests for prompt tuning — structured good_points, evidence specificity, two-axis coverage."""

from __future__ import annotations

import pytest

from web.app.services.review.review_prompt_builder import (
    BANNER_RUBRIC_IDS,
    EVIDENCE_TYPES,
    LP_RUBRIC_IDS,
    build_ad_lp_review_prompt,
    build_banner_review_prompt,
)
from web.app.schemas.review_request import LandingPageInput


# ---------------------------------------------------------------------------
# Banner review prompt — minItems / two-axis / evidence specificity
# ---------------------------------------------------------------------------

class TestBannerPromptMinItems:
    """good_points must require minimum 2 items."""

    def test_contains_min_items_requirement(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        assert "minItems" in prompt or "最低2件" in prompt or "最低 2 件" in prompt

    def test_contains_min_items_value_2(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        assert "minItems: 2" in prompt or "最低2件" in prompt


class TestBannerPromptTwoAxis:
    """good_points must cover visual/design AND strategic/business axes."""

    def test_mentions_visual_axis(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        lower = prompt.lower()
        assert any(kw in lower for kw in ["視覚", "デザイン", "visual", "design"])

    def test_mentions_strategic_axis(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        lower = prompt.lower()
        assert any(kw in lower for kw in ["戦略", "ビジネス", "strategic", "business"])

    def test_two_axis_in_same_rule(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        # Both axes should appear in the prompt (confirming the two-axis rule)
        assert "視覚" in prompt or "デザイン" in prompt
        assert "戦略" in prompt or "ビジネス" in prompt


class TestBannerPromptEvidenceSpecificity:
    """evidence_text must require concrete data points, not vague statements."""

    def test_prohibits_vague_evidence(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        lower = prompt.lower()
        # Must mention prohibition of vague expressions
        assert "曖昧" in lower or "vague" in lower or "ベストプラクティス" in prompt

    def test_requires_concrete_data(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        # Must mention concrete data points or specific observations
        assert any(kw in prompt for kw in ["具体的なデータ", "数値", "色コード", "フォントサイズ", "concrete"])


# ---------------------------------------------------------------------------
# Prompt output — basic structure validation
# ---------------------------------------------------------------------------

class TestPromptBasicStructure:
    def test_banner_prompt_is_nonempty_string(self):
        prompt = build_banner_review_prompt(asset_file_name="banner.jpg")
        assert isinstance(prompt, str)
        assert len(prompt) > 100

    def test_ad_lp_prompt_is_nonempty_string(self):
        lp = LandingPageInput(url="https://example.com/lp", title="Test LP")
        prompt = build_ad_lp_review_prompt(
            asset_file_name="ad.png",
            landing_page=lp,
        )
        assert isinstance(prompt, str)
        assert len(prompt) > 100

    def test_ad_lp_prompt_valid_structure(self):
        lp = LandingPageInput(
            url="https://example.com/lp",
            title="Test LP",
            meta_description="desc",
            first_view_text="hero text",
            cta_text="Sign Up",
            extracted_benefits=["Fast", "Cheap"],
            trust_elements=["ISO certified"],
        )
        prompt = build_ad_lp_review_prompt(
            asset_file_name="ad.png",
            landing_page=lp,
        )
        assert "ad_lp_review" in prompt
        assert "example.com" in prompt


# ---------------------------------------------------------------------------
# Input combinations
# ---------------------------------------------------------------------------

class TestBannerPromptInputCombinations:
    def test_with_brand_info(self):
        prompt = build_banner_review_prompt(
            asset_file_name="test.png",
            brand_info="Brand X - luxury fashion",
        )
        assert "Brand X" in prompt

    def test_with_operator_memo(self):
        prompt = build_banner_review_prompt(
            asset_file_name="test.png",
            operator_memo="Focus on CTA visibility",
        )
        assert "CTA visibility" in prompt

    def test_with_dimensions(self):
        prompt = build_banner_review_prompt(
            asset_file_name="test.png",
            asset_width=728,
            asset_height=90,
        )
        assert "728x90" in prompt

    def test_without_optional_fields(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        assert "ブランド情報" not in prompt
        assert "運用者メモ" not in prompt


# ---------------------------------------------------------------------------
# Rubric IDs and evidence types present in prompt
# ---------------------------------------------------------------------------

class TestRubricAndEvidencePresence:
    def test_all_banner_rubric_ids_in_prompt(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        for rid in BANNER_RUBRIC_IDS:
            assert rid in prompt, f"Missing rubric ID: {rid}"

    def test_all_lp_rubric_ids_in_prompt(self):
        lp = LandingPageInput(url="https://example.com/lp")
        prompt = build_ad_lp_review_prompt(
            asset_file_name="ad.png",
            landing_page=lp,
        )
        for rid in LP_RUBRIC_IDS:
            assert rid in prompt, f"Missing rubric ID: {rid}"

    def test_evidence_types_mentioned_in_banner_prompt(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        for etype in EVIDENCE_TYPES:
            assert etype in prompt, f"Missing evidence type: {etype}"
