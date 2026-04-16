"""Tests for compare review routes (M5.3)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from web.app.models import TokenUsage
from web.app.routers.review_routes import create_review_router


def _mock_repo():
    repo = MagicMock()
    meta = MagicMock()
    meta.file_name = "banner.png"
    meta.width = 728
    meta.height = 90
    repo.load_metadata.return_value = meta
    return repo


def _valid_llm_output():
    return json.dumps({
        "review_type": "competitor_compare",
        "summary": "Compare summary",
        "good_points": [
            {"point": "Good visual", "reason": "Design"},
            {"point": "Good strategy", "reason": "Targeting"},
        ],
        "keep_as_is": [{"point": "Logo", "reason": "Recognizable"}],
        "improvements": [{"point": "CTA", "reason": "Weak", "action": "Bold it"}],
        "test_ideas": [{"hypothesis": "H", "variable": "V", "expected_impact": "E"}],
        "evidence": [{"evidence_type": "competitor_public", "evidence_source": "src", "evidence_text": "txt"}],
        "target_hypothesis": "Target",
        "message_angle": "Angle",
        "rubric_scores": [{"rubric_id": "positioning_clarity", "score": 4, "comment": "Good"}],
        "positioning_insights": [{
            "dimension": "CTA",
            "our_position": "Text only",
            "competitor_position": "Icon button",
            "gap_analysis": "Gap",
            "recommendation": "Add icon",
        }],
    })


def _make_app(repo=None):
    app = FastAPI()
    router = create_review_router(repo or _mock_repo())
    app.include_router(router)
    return app


class TestCompareReviewEndpoint:
    def _req_body(self):
        return {
            "asset_id": "aabbccddeeff",
            "competitors": [
                {"url": "https://comp.com", "domain": "comp.com", "title": "Comp"},
            ],
        }

    @patch(
        "web.app.routers.review_routes.review_competitor_compare",
        new_callable=AsyncMock,
    )
    def test_successful_compare(self, mock_review):
        from web.app.schemas.review_result import ReviewResult

        mock_review.return_value = ReviewResult(**json.loads(_valid_llm_output()))
        client = TestClient(_make_app())
        resp = client.post("/api/reviews/compare", json=self._req_body())
        assert resp.status_code == 200
        data = resp.json()
        assert data["review"]["review_type"] == "competitor_compare"
        assert data["review"]["positioning_insights"] is not None

    @patch(
        "web.app.routers.review_routes.review_competitor_compare",
        new_callable=AsyncMock,
    )
    def test_asset_not_found(self, mock_review):
        from web.app.services.review.competitor_compare_service import CompareAssetNotFoundError

        mock_review.side_effect = CompareAssetNotFoundError("Asset not found: bad")
        client = TestClient(_make_app())
        resp = client.post("/api/reviews/compare", json=self._req_body())
        assert resp.status_code == 404

    @patch(
        "web.app.routers.review_routes.review_competitor_compare",
        new_callable=AsyncMock,
    )
    def test_compare_error(self, mock_review):
        from web.app.services.review.competitor_compare_service import CompareReviewError

        mock_review.side_effect = CompareReviewError("LLM failed")
        client = TestClient(_make_app())
        resp = client.post("/api/reviews/compare", json=self._req_body())
        assert resp.status_code == 422

    def test_empty_competitors_rejected(self):
        client = TestClient(_make_app())
        resp = client.post("/api/reviews/compare", json={
            "asset_id": "aabbccddeeff",
            "competitors": [],
        })
        assert resp.status_code == 422
