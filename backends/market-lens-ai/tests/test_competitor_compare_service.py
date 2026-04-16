"""Tests for competitor compare service (M5.3)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from web.app.models import TokenUsage
from web.app.schemas.competitor_compare import CompetitorData
from web.app.schemas.review_result import ReviewResult
from web.app.services.review.competitor_compare_service import (
    CompareAssetNotFoundError,
    CompareReviewError,
    review_competitor_compare,
)


def _mock_asset_meta():
    meta = MagicMock()
    meta.file_name = "banner.png"
    meta.width = 728
    meta.height = 90
    return meta


def _valid_llm_output():
    return json.dumps({
        "review_type": "competitor_compare",
        "summary": "Test compare summary",
        "good_points": [
            {"point": "Good visual", "reason": "Strong color scheme"},
            {"point": "Good strategy", "reason": "Clear targeting"},
        ],
        "keep_as_is": [{"point": "Brand logo", "reason": "Recognizable"}],
        "improvements": [{"point": "CTA", "reason": "Weak vs competitor", "action": "Make CTA bolder"}],
        "test_ideas": [{"hypothesis": "Bolder CTA", "variable": "CTA size", "expected_impact": "Higher CTR"}],
        "evidence": [{"evidence_type": "competitor_public", "evidence_source": "comp1.com", "evidence_text": "Their CTA uses orange #FF6600"}],
        "target_hypothesis": "Young professionals",
        "message_angle": "Value proposition",
        "rubric_scores": [{"rubric_id": "positioning_clarity", "score": 4, "comment": "Clear positioning"}],
        "positioning_insights": [
            {
                "dimension": "CTA明確性",
                "our_position": "テキストのみ",
                "competitor_position": "アイコン付きボタン",
                "gap_analysis": "競合のCTAがより目立つ",
                "recommendation": "CTAボタンにアイコンを追加",
            }
        ],
    })


def _make_repo(meta=None):
    repo = MagicMock()
    repo.load_metadata.return_value = meta
    return repo


def _competitors():
    return [CompetitorData(url="https://comp.com", domain="comp.com", title="Comp")]


class TestReviewCompetitorCompare:
    @pytest.mark.asyncio
    async def test_successful_review(self):
        repo = _make_repo(_mock_asset_meta())
        usage = TokenUsage(prompt_tokens=100, completion_tokens=200, total_tokens=300, model="test")
        with patch(
            "web.app.services.review.competitor_compare_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(_valid_llm_output(), usage),
        ):
            result = await review_competitor_compare(
                asset_id="aabbccddeeff",
                competitors=_competitors(),
                repo=repo,
            )
        assert isinstance(result, ReviewResult)
        assert result.review_type == "competitor_compare"
        assert result.positioning_insights is not None
        assert len(result.positioning_insights) == 1

    @pytest.mark.asyncio
    async def test_asset_not_found(self):
        repo = _make_repo(None)
        with pytest.raises(CompareAssetNotFoundError, match="Asset not found"):
            await review_competitor_compare(
                asset_id="aabbccddeeff",
                competitors=_competitors(),
                repo=repo,
            )

    @pytest.mark.asyncio
    async def test_invalid_asset_id(self):
        repo = MagicMock()
        repo.load_metadata.side_effect = ValueError("bad id")
        with pytest.raises(CompareReviewError, match="Invalid asset_id"):
            await review_competitor_compare(
                asset_id="BAD",
                competitors=_competitors(),
                repo=repo,
            )

    @pytest.mark.asyncio
    async def test_llm_parse_error(self):
        repo = _make_repo(_mock_asset_meta())
        usage = TokenUsage(prompt_tokens=10, completion_tokens=10, total_tokens=20, model="test")
        with patch(
            "web.app.services.review.competitor_compare_service._call_text_model",
            new_callable=AsyncMock,
            return_value=("NOT JSON", usage),
        ):
            with pytest.raises(CompareReviewError, match="parse failed"):
                await review_competitor_compare(
                    asset_id="aabbccddeeff",
                    competitors=_competitors(),
                    repo=repo,
                )
