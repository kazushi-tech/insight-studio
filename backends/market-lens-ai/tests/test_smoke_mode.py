"""Tests for SMOKE_MODE deterministic backend paths.

Validates:
- smoke mode env detection
- scan returns deterministic result in smoke mode
- banner review returns golden fixture in smoke mode
- ad-LP review returns golden fixture in smoke mode
- smoke mode off = existing behavior unchanged
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from web.app.main import app
from web.app.smoke_mode import (
    is_smoke_mode,
    smoke_banner_review,
    smoke_ad_lp_review,
    smoke_scan_result,
)


@pytest.fixture
def client():
    return TestClient(app)


class TestSmokeDetection:
    def test_smoke_mode_off_by_default(self):
        with patch.dict("os.environ", {}, clear=True):
            assert not is_smoke_mode()

    def test_smoke_mode_on_with_1(self):
        with patch.dict("os.environ", {"SMOKE_MODE": "1"}):
            assert is_smoke_mode()

    def test_smoke_mode_on_with_true(self):
        with patch.dict("os.environ", {"SMOKE_MODE": "true"}):
            assert is_smoke_mode()

    def test_smoke_mode_off_with_0(self):
        with patch.dict("os.environ", {"SMOKE_MODE": "0"}):
            assert not is_smoke_mode()


class TestSmokeScanResult:
    def test_deterministic_scan_result(self):
        result = smoke_scan_result(["https://example.com"], "abcdef123456")
        assert result["run_id"] == "abcdef123456"
        assert result["status"] == "completed"
        assert "[SMOKE]" in result["report_md"]
        assert result["error"] is None

    def test_scan_result_with_multiple_urls(self):
        urls = ["https://a.com", "https://b.com", "https://c.com"]
        result = smoke_scan_result(urls, "111122223333")
        assert all(u in result["report_md"] for u in urls)


class TestSmokeBannerReview:
    def test_golden_banner_review_valid(self):
        review = smoke_banner_review()
        assert review.review_type == "banner_review"
        assert "[SMOKE]" in review.summary
        assert len(review.good_points) >= 1
        assert len(review.improvements) >= 1
        assert len(review.evidence) >= 1
        assert len(review.rubric_scores) >= 1

    def test_banner_review_rubric_ids_complete(self):
        from web.app.services.review.review_prompt_builder import BANNER_RUBRIC_IDS
        review = smoke_banner_review()
        actual_ids = {s.rubric_id for s in review.rubric_scores}
        assert actual_ids == set(BANNER_RUBRIC_IDS)


class TestSmokeAdLpReview:
    def test_golden_ad_lp_review_valid(self):
        review = smoke_ad_lp_review()
        assert review.review_type == "ad_lp_review"
        assert "[SMOKE]" in review.summary
        assert len(review.good_points) >= 1
        assert len(review.evidence) >= 2  # Has both ad + LP evidence

    def test_ad_lp_review_rubric_ids_complete(self):
        from web.app.services.review.review_prompt_builder import LP_RUBRIC_IDS
        review = smoke_ad_lp_review()
        actual_ids = {s.rubric_id for s in review.rubric_scores}
        assert actual_ids == set(LP_RUBRIC_IDS)


class TestSmokeScanRoute:
    def test_scan_in_smoke_mode_bypasses_allowlist(self, client):
        with patch.dict("os.environ", {"SMOKE_MODE": "1"}):
            res = client.post("/api/scan", json={"urls": ["https://not-in-allowlist.example.com"]})
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "completed"
            assert "[SMOKE]" in data["report_md"]

    def test_scan_without_smoke_mode_rejects_unlisted(self, client):
        with patch.dict("os.environ", {"SMOKE_MODE": "0"}):
            res = client.post("/api/scan", json={"urls": ["https://not-in-allowlist.example.com"]})
            assert res.status_code == 422


class TestSmokeReviewRoute:
    def test_banner_review_in_smoke_mode(self, client, tmp_path):
        """Smoke mode banner review returns deterministic golden fixture."""
        from web.app.repositories.file_asset_repository import FileAssetRepository
        from web.app.schemas.creative_asset import CreativeAssetMetadata

        # Create a test asset in the real repo path
        with patch.dict("os.environ", {"SMOKE_MODE": "1"}):
            # First upload an asset
            from tests.fixtures.creative_review.smoke_test_banner import create_minimal_png
            png_data = create_minimal_png(10, 10)

            res = client.post(
                "/api/assets",
                files={"file": ("test.png", png_data, "image/png")},
            )
            assert res.status_code == 201
            asset_id = res.json()["asset_id"]

            # Now do banner review
            res = client.post(
                "/api/reviews/banner",
                json={"asset_id": asset_id},
            )
            assert res.status_code == 200
            data = res.json()
            assert "review" in data
            assert data["review"]["review_type"] == "banner_review"
            assert "[SMOKE]" in data["review"]["summary"]
