"""Tests for competitor compare schemas (M5.3)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from web.app.schemas.competitor_compare import CompareReviewRequest, CompetitorData
from web.app.schemas.review_result import PositioningInsight, ReviewResult


class TestCompetitorData:
    def test_basic(self):
        cd = CompetitorData(url="https://comp.com", domain="comp.com")
        assert cd.domain == "comp.com"

    def test_with_all_fields(self):
        cd = CompetitorData(
            url="https://comp.com",
            domain="comp.com",
            title="Competitor",
            description="A rival service",
        )
        assert cd.title == "Competitor"


class TestCompareReviewRequest:
    def test_valid(self):
        req = CompareReviewRequest(
            asset_id="aabbccddeeff",
            competitors=[CompetitorData(url="https://comp.com", domain="comp.com")],
        )
        assert len(req.competitors) == 1

    def test_empty_competitors_rejected(self):
        with pytest.raises(ValidationError):
            CompareReviewRequest(asset_id="aabbccddeeff", competitors=[])

    def test_max_five_competitors(self):
        comps = [
            CompetitorData(url=f"https://comp{i}.com", domain=f"comp{i}.com")
            for i in range(6)
        ]
        with pytest.raises(ValidationError):
            CompareReviewRequest(asset_id="aabbccddeeff", competitors=comps)


class TestPositioningInsight:
    def test_valid(self):
        pi = PositioningInsight(
            dimension="価格訴求",
            our_position="高価格帯",
            competitor_position="低価格帯",
            gap_analysis="価格差が大きい",
            recommendation="価値訴求を強化する",
        )
        assert pi.dimension == "価格訴求"

    def test_empty_field_rejected(self):
        with pytest.raises(ValidationError):
            PositioningInsight(
                dimension="",
                our_position="x",
                competitor_position="y",
                gap_analysis="z",
                recommendation="w",
            )


class TestReviewResultCompareType:
    """Test that ReviewResult accepts competitor_compare type."""

    def _base_data(self, **overrides):
        data = {
            "review_type": "competitor_compare",
            "summary": "Test summary",
            "good_points": [{"point": "Good", "reason": "Because"}],
            "keep_as_is": [{"point": "Keep", "reason": "Because"}],
            "improvements": [{"point": "Fix", "reason": "Why", "action": "Do this"}],
            "test_ideas": [{"hypothesis": "H", "variable": "V", "expected_impact": "E"}],
            "evidence": [{"evidence_type": "competitor_public", "evidence_source": "src", "evidence_text": "txt"}],
            "target_hypothesis": "Target",
            "message_angle": "Angle",
            "rubric_scores": [{"rubric_id": "positioning_clarity", "score": 4, "comment": "Good"}],
        }
        data.update(overrides)
        return data

    def test_competitor_compare_type_accepted(self):
        result = ReviewResult(**self._base_data())
        assert result.review_type == "competitor_compare"

    def test_with_positioning_insights(self):
        result = ReviewResult(**self._base_data(
            positioning_insights=[{
                "dimension": "CTA",
                "our_position": "Clear",
                "competitor_position": "Vague",
                "gap_analysis": "We are ahead",
                "recommendation": "Maintain",
            }]
        ))
        assert len(result.positioning_insights) == 1
        assert result.positioning_insights[0].dimension == "CTA"

    def test_without_positioning_insights(self):
        result = ReviewResult(**self._base_data())
        assert result.positioning_insights is None

    def test_banner_review_still_works(self):
        data = self._base_data(review_type="banner_review")
        result = ReviewResult(**data)
        assert result.review_type == "banner_review"
