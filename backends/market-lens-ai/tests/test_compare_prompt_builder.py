"""Tests for compare prompt builder (M5.3)."""

from __future__ import annotations

from web.app.schemas.competitor_compare import CompetitorData
from web.app.services.review.compare_prompt_builder import (
    COMPARE_RUBRIC_IDS,
    build_compare_review_prompt,
)


class TestBuildCompareReviewPrompt:
    def _competitors(self):
        return [
            CompetitorData(url="https://comp1.com", domain="comp1.com", title="Comp One"),
            CompetitorData(url="https://comp2.com", domain="comp2.com", title="Comp Two", description="Rival"),
        ]

    def test_contains_review_type(self):
        prompt = build_compare_review_prompt(
            asset_file_name="banner.png",
            competitors=self._competitors(),
        )
        assert '"review_type": "competitor_compare"' in prompt

    def test_contains_competitor_info(self):
        prompt = build_compare_review_prompt(
            asset_file_name="banner.png",
            competitors=self._competitors(),
        )
        assert "comp1.com" in prompt
        assert "comp2.com" in prompt
        assert "Comp One" in prompt
        assert "Rival" in prompt

    def test_contains_rubric_ids(self):
        prompt = build_compare_review_prompt(
            asset_file_name="banner.png",
            competitors=self._competitors(),
        )
        for rid in COMPARE_RUBRIC_IDS:
            assert rid in prompt

    def test_contains_positioning_insights(self):
        prompt = build_compare_review_prompt(
            asset_file_name="banner.png",
            competitors=self._competitors(),
        )
        assert "positioning_insights" in prompt

    def test_brand_info_included(self):
        prompt = build_compare_review_prompt(
            asset_file_name="banner.png",
            competitors=self._competitors(),
            brand_info="Acme Corp",
        )
        assert "Acme Corp" in prompt

    def test_size_included(self):
        prompt = build_compare_review_prompt(
            asset_file_name="banner.png",
            asset_width=728,
            asset_height=90,
            competitors=self._competitors(),
        )
        assert "728x90" in prompt
