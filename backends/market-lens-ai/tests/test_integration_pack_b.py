"""Integration tests for Pack B (Phase 5-A).

Tests end-to-end flows:
1. Discovery job → Compare review flow
2. Banner generation (disabled in Claude-only mode)
"""

from __future__ import annotations

import json
import time
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from web.app.models import TokenUsage
from web.app.repositories.file_discovery_job_repository import FileDiscoveryJobRepository
from web.app.routers.discovery_routes import create_discovery_router
from web.app.routers.generation_routes import create_generation_router
from web.app.routers.review_routes import create_review_router
from web.app.schemas.review_result import ReviewResult
from web.app.services.discovery.search_client import SearchClient, SearchResult
from web.app.services.generation.banner_gen_service import BannerGenService


# ── Fixtures ──────────────────────────────────────────────

class _MockSearchClient(SearchClient):
    async def search(
        self,
        query: str,
        *,
        num: int = 10,
        brand_context: str = "",
        deadline: float | None = None,
        request_id: str | None = None,
    ) -> list[SearchResult]:
        return [
            SearchResult(url="https://competitor1.com", title="Comp1", snippet="A great alternative"),
            SearchResult(url="https://competitor2.com", title="Comp2", snippet="Another vs option"),
        ]


def _valid_compare_output():
    return json.dumps({
        "review_type": "competitor_compare",
        "summary": "Integration test compare",
        "good_points": [
            {"point": "Strong visual", "reason": "Color scheme"},
            {"point": "Clear CTA", "reason": "Button design"},
        ],
        "keep_as_is": [{"point": "Logo", "reason": "Brand recognition"}],
        "improvements": [{"point": "Headline", "reason": "Weak vs competitor", "action": "Rewrite headline"}],
        "test_ideas": [{"hypothesis": "Bolder headline", "variable": "headline font", "expected_impact": "Higher CTR"}],
        "evidence": [{"evidence_type": "competitor_public", "evidence_source": "comp1.com", "evidence_text": "Their headline uses 32px bold"}],
        "target_hypothesis": "Marketing managers",
        "message_angle": "ROI focused",
        "rubric_scores": [{"rubric_id": "positioning_clarity", "score": 4, "comment": "Clear"}],
        "positioning_insights": [{
            "dimension": "Headline strength",
            "our_position": "Subtle",
            "competitor_position": "Bold",
            "gap_analysis": "Competitor has stronger first impression",
            "recommendation": "Increase headline font weight",
        }],
    })


def _mock_repo():
    repo = MagicMock()
    meta = MagicMock()
    meta.file_name = "banner.png"
    meta.width = 728
    meta.height = 90
    repo.load_metadata.return_value = meta
    return repo


def _make_integrated_app(job_repo=None):
    """Create a FastAPI app with all Pack B routers."""
    app = FastAPI()
    repo = _mock_repo()
    gen_svc = BannerGenService()

    app.include_router(create_discovery_router(
        search_client=_MockSearchClient(),
        job_repo=job_repo,
    ))
    app.include_router(create_review_router(repo))

    # Store review results for generation
    _review_results = {}

    def review_loader(run_id: str):
        return _review_results.get(run_id)

    app.include_router(create_generation_router(gen_service=gen_svc, review_result_loader=review_loader))

    # Expose for tests
    app.state.review_results = _review_results
    return app


def _patch_validate_candidates():
    return patch(
        "web.app.routers.discovery_routes.validate_candidates_with_llm",
        new_callable=AsyncMock,
        side_effect=lambda candidates, *args, **kwargs: candidates,
    )


def _patch_pipeline():
    return (
        patch("web.app.routers.discovery_routes.validate_operator_url", side_effect=lambda url: None),
        patch("web.app.routers.discovery_routes.fetch_html", new_callable=AsyncMock, return_value=("<html><body>Test</body></html>", None)),
        patch("web.app.routers.discovery_routes.classify_industry", new_callable=AsyncMock, return_value="テスト業種"),
        patch("web.app.routers.discovery_routes.analyze", new_callable=AsyncMock, return_value=("# Report", None)),
        _patch_validate_candidates(),
    )


def _poll_until_terminal(client, job_id, headers=None):
    for _ in range(30):
        resp = client.get(f"/api/discovery/jobs/{job_id}", headers=headers or {})
        assert resp.status_code == 200
        data = resp.json()
        if data["status"] in {"completed", "failed", "cancelled"}:
            return data
        time.sleep(0.05)
    raise AssertionError("Job did not reach terminal state")


# ── Test 1: Discovery Job → Compare Review Flow ──────────

class TestDiscoveryJobToCompareFlow:
    """End-to-end: start discovery job → poll to completion → compare review."""

    @patch(
        "web.app.routers.review_routes.review_competitor_compare",
        new_callable=AsyncMock,
    )
    def test_discovery_job_to_compare_review(self, mock_compare):
        """Full flow: start job → poll result → compare review."""
        mock_compare.return_value = ReviewResult(**json.loads(_valid_compare_output()))

        with TemporaryDirectory() as tmpdir:
            app = _make_integrated_app(job_repo=FileDiscoveryJobRepository(tmpdir))
            patches = _patch_pipeline()
            with patches[0], patches[1], patches[2], patches[3], patches[4]:
                client = TestClient(app)
                headers = {"X-Insight-User": "guest:integtest01"}

                # Start discovery job
                start_resp = client.post(
                    "/api/discovery/jobs",
                    headers=headers,
                    json={"brand_url": "https://example.com", "api_key": "test-key"},
                )
                assert start_resp.status_code == 202
                job_id = start_resp.json()["job_id"]

                # Poll to completion
                final = _poll_until_terminal(client, job_id, headers=headers)
                assert final["status"] == "completed"

                # Compare review using discovered competitors
                resp = client.post("/api/reviews/compare", json={
                    "asset_id": "aabbccddeeff",
                    "competitors": [
                        {"url": "https://competitor1.com", "domain": "competitor1.com", "title": "Comp1"},
                        {"url": "https://competitor2.com", "domain": "competitor2.com", "title": "Comp2"},
                    ],
                })
                assert resp.status_code == 200
                review = resp.json()["review"]
                assert review["review_type"] == "competitor_compare"


# ── Test 2: Generation Flow (disabled in Claude-only) ────

class TestGenerationFlow:
    """Banner generation is disabled in Claude-only mode."""

    def test_generate_returns_failed_in_claude_only_mode(self):
        """Generation should return failed status with explanatory message."""
        app = _make_integrated_app()
        client = TestClient(app)

        # Store a mock review result
        review_data = json.loads(_valid_compare_output())
        review_data["review_type"] = "banner_review"
        review_result = ReviewResult(**review_data)
        app.state.review_results["test_run_001"] = review_result

        # Generate — should return failed immediately
        resp = client.post("/api/generation/banner", json={
            "review_run_id": "test_run_001",
            "style_guidance": "ミニマルなデザイン",
            "api_key": "test-key",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "failed"
        assert "画像生成は現在利用できません" in data["error_message"]
