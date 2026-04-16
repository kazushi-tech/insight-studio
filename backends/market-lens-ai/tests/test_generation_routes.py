"""Tests for generation routes (M5.7).

banner_gen_service.generate() now always returns status=failed with a fixed
error message — Gemini Vision has been removed. These tests verify that
behavior and the surrounding router/validation logic.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from web.app.routers.generation_routes import create_generation_router
from web.app.schemas.review_result import ReviewResult
from web.app.services.generation.banner_gen_service import BannerGenService

EXPECTED_ERROR = "画像生成は現在利用できません。Claude API はテキスト分析専用です。"


def _mock_review_result():
    return ReviewResult(**{
        "review_type": "banner_review",
        "summary": "Test",
        "good_points": [{"point": "G", "reason": "R"}],
        "keep_as_is": [{"point": "K", "reason": "R"}],
        "improvements": [{"point": "I", "reason": "R", "action": "A"}],
        "test_ideas": [{"hypothesis": "H", "variable": "V", "expected_impact": "E"}],
        "evidence": [{"evidence_type": "competitor_public", "evidence_source": "s", "evidence_text": "t"}],
        "target_hypothesis": "T",
        "message_angle": "M",
        "rubric_scores": [{"rubric_id": "hook_strength", "score": 4, "comment": "Good"}],
    })


def _make_app(review_result=None, tmp_path=None) -> tuple[FastAPI, BannerGenService]:
    app = FastAPI()
    kwargs = {}
    if tmp_path is not None:
        kwargs["generations_dir"] = tmp_path / "generations"
    svc = BannerGenService(**kwargs)

    def loader(run_id: str):
        return review_result

    router = create_generation_router(
        gen_service=svc,
        review_result_loader=loader if review_result else None,
    )
    app.include_router(router)
    return app, svc


class TestGenerateBanner:
    def test_returns_failed_status(self, tmp_path):
        """POST /api/generation/banner always returns status=failed."""
        app, _ = _make_app(_mock_review_result(), tmp_path)
        client = TestClient(app)
        resp = client.post("/api/generation/banner", json={
            "review_run_id": "aabbccddeeff",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "failed"

    def test_returns_correct_error_message(self, tmp_path):
        """The error_message must match the fixed unavailability notice."""
        app, _ = _make_app(_mock_review_result(), tmp_path)
        client = TestClient(app)
        resp = client.post("/api/generation/banner", json={
            "review_run_id": "aabbccddeeff",
        })
        assert resp.json()["error_message"] == EXPECTED_ERROR

    def test_missing_review_run_id_returns_error(self):
        """Omitting review_run_id should result in a 4xx validation error."""
        app, _ = _make_app(_mock_review_result())
        client = TestClient(app)
        resp = client.post("/api/generation/banner", json={})
        assert resp.status_code in (400, 422)

    def test_no_loader_configured(self):
        """If no review_result_loader is configured, expect 501."""
        app, _ = _make_app()
        client = TestClient(app)
        resp = client.post("/api/generation/banner", json={
            "review_run_id": "aabbccddeeff",
        })
        assert resp.status_code == 501

    def test_review_not_found(self):
        """If the loader returns None for the run_id, expect 422."""
        def null_loader(run_id):
            return None

        app = FastAPI()
        svc = BannerGenService()
        router = create_generation_router(gen_service=svc, review_result_loader=null_loader)
        app.include_router(router)
        client = TestClient(app)
        resp = client.post("/api/generation/banner", json={
            "review_run_id": "aabbccddeeff",
        })
        assert resp.status_code == 422


class TestGetGeneration:
    def test_get_after_generate(self, tmp_path):
        """GET /api/generation/{id} returns the failed generation record."""
        app, _ = _make_app(_mock_review_result(), tmp_path)
        client = TestClient(app)
        resp = client.post("/api/generation/banner", json={
            "review_run_id": "aabbccddeeff",
        })
        gen_id = resp.json()["id"]
        resp2 = client.get(f"/api/generation/{gen_id}")
        assert resp2.status_code == 200
        assert resp2.json()["id"] == gen_id

    def test_get_not_found(self):
        app, _ = _make_app()
        client = TestClient(app)
        resp = client.get("/api/generation/aabbccddeeff")
        assert resp.status_code == 404

    def test_get_invalid_id(self):
        app, _ = _make_app()
        client = TestClient(app)
        resp = client.get("/api/generation/BAD!")
        assert resp.status_code == 422


class TestGetGenerationImage:
    """Tests for GET /api/generation/{gen_id}/image endpoint."""

    def test_get_image_after_failed_generation_returns_422(self, tmp_path):
        """Image endpoint returns 422 when generation always fails."""
        app, _ = _make_app(_mock_review_result(), tmp_path)
        client = TestClient(app)
        resp = client.post("/api/generation/banner", json={
            "review_run_id": "aabbccddeeff",
        })
        gen_id = resp.json()["id"]

        img_resp = client.get(f"/api/generation/{gen_id}/image")
        assert img_resp.status_code == 422
        assert "failed" in img_resp.json()["detail"].lower()

    def test_get_image_not_found(self):
        """Verify 404 for missing gen_id."""
        app, _ = _make_app()
        client = TestClient(app)
        resp = client.get("/api/generation/aabbccddeeff/image")
        assert resp.status_code == 404

    def test_get_image_invalid_id(self):
        """Verify 422 for invalid gen_id format."""
        app, _ = _make_app()
        client = TestClient(app)
        resp = client.get("/api/generation/BAD!/image")
        assert resp.status_code == 422


class TestPathValidation:
    """Tests for FIX-9: service-layer path validation."""

    def test_image_path_rejects_invalid_gen_id(self):
        """Verify _image_path raises ValueError for invalid gen_id."""
        svc = BannerGenService()
        with pytest.raises(ValueError, match="Invalid gen_id format"):
            svc._image_path("../../../etc")

    def test_image_path_accepts_valid_gen_id(self, tmp_path):
        """Verify _image_path works with valid 12-char hex gen_id."""
        svc = BannerGenService(generations_dir=tmp_path / "gen")
        path = svc._image_path("aabbccddeeff")
        assert "aabbccddeeff" in str(path)
        assert str(path).endswith("banner.png")
