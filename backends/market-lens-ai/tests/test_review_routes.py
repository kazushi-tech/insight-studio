"""Tests for review routes — banner and ad-LP review endpoints.

Covers:
- Route-level 200 success path with mocked Gemini
- Malformed asset_id → 422
- Valid-format missing asset → 404
- Missing required fields → 422
- GET review → 501 (not yet implemented)
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from web.app.repositories.file_asset_repository import FileAssetRepository
from web.app.repositories.file_creative_review_repository import FileCreativeReviewRepository
from web.app.routers.review_routes import create_review_router
from web.app.schemas.creative_asset import CreativeAssetMetadata
from web.app.schemas.review_result import ReviewResult
from web.app.services.review.review_prompt_builder import BANNER_RUBRIC_IDS, LP_RUBRIC_IDS


def _golden_banner_review() -> dict:
    """A valid banner review output with all required rubric IDs."""
    return {
        "review_type": "banner_review",
        "summary": "ECセールバナーとして基本的な訴求力を備えている",
        "good_points": [
            {"point": "50%OFFの数字訴求が目立つ", "reason": "赤背景に白文字で視認しやすい"}
        ],
        "keep_as_is": [
            {"point": "ブランドカラーの統一感", "reason": "ガイドラインに沿っている"}
        ],
        "improvements": [
            {"point": "CTAボタンが小さい", "reason": "CTAが目立たない", "action": "CTAを20%拡大"}
        ],
        "test_ideas": [
            {"hypothesis": "CTA文言変更でCTR向上の可能性がある", "variable": "CTAテキスト", "expected_impact": "CTR 5-10%向上が期待できる（仮説）"}
        ],
        "evidence": [
            {"evidence_type": "client_material", "evidence_source": "ブランドガイドライン v2.1", "evidence_text": "メインカラーは赤"}
        ],
        "target_hypothesis": "20-40代女性",
        "message_angle": "期間限定値引き訴求",
        "rubric_scores": [
            {"rubric_id": rid, "score": 4, "comment": f"{rid}の評価"}
            for rid in BANNER_RUBRIC_IDS
        ],
    }


def _golden_ad_lp_review() -> dict:
    """A valid ad-LP review output with all required rubric IDs."""
    return {
        "review_type": "ad_lp_review",
        "summary": "広告とLPのメッセージは概ね一致している",
        "good_points": [
            {"point": "50%OFFの訴求が一致", "reason": "広告のメッセージがLPで確認できる"}
        ],
        "keep_as_is": [
            {"point": "セール訴求の一貫性", "reason": "期待通りの内容が展開される"}
        ],
        "improvements": [
            {"point": "CTAの文言差異", "reason": "広告とLPでCTA文言が違う", "action": "文言を統一する"}
        ],
        "test_ideas": [
            {"hypothesis": "CTA統一で遷移率向上の可能性がある", "variable": "CTA文言", "expected_impact": "直帰率低減が期待できる（仮説）"}
        ],
        "evidence": [
            {"evidence_type": "client_material", "evidence_source": "広告バナー banner.png", "evidence_text": "50%OFF訴求"},
            {"evidence_type": "competitor_public", "evidence_source": "LP https://example.com/sale", "evidence_text": "ファーストビューに50%OFF"}
        ],
        "target_hypothesis": "セール情報に敏感な20-40代女性",
        "message_angle": "セール訴求一貫性",
        "rubric_scores": [
            {"rubric_id": rid, "score": 4, "comment": f"{rid}の評価"}
            for rid in LP_RUBRIC_IDS
        ],
    }


def _make_test_app(tmp_path, *, with_review_repo: bool = False):
    """Create a test app with a real file-backed repo.

    Returns (client, asset_id) or (client, asset_id, review_repo) when with_review_repo=True.
    """
    repo = FileAssetRepository(base_dir=tmp_path / "assets")
    meta = CreativeAssetMetadata(
        file_name="banner.png", mime_type="image/png", size_bytes=1024,
        width=300, height=250,
    )
    repo.save(meta, b"\x89PNG\r\n\x1a\n")

    review_repo = FileCreativeReviewRepository(base_dir=tmp_path / "reviews") if with_review_repo else None

    test_app = FastAPI()
    test_app.include_router(create_review_router(repo, review_repo=review_repo))
    client = TestClient(test_app)
    if with_review_repo:
        return client, meta.asset_id, review_repo
    return client, meta.asset_id


# =============================================================================
# Route-level success path tests
# =============================================================================

class TestBannerReviewRouteSuccess:
    """POST /api/reviews/banner returns 200 with valid asset + mocked Gemini."""

    @patch(
        "web.app.services.review.banner_review_service._call_multimodal_model",
        new_callable=AsyncMock,
    )
    def test_banner_review_200(self, mock_gemini, tmp_path):
        golden = _golden_banner_review()
        mock_gemini.return_value = (json.dumps(golden), MagicMock())

        client, asset_id = _make_test_app(tmp_path)
        res = client.post(
            "/api/reviews/banner",
            json={"asset_id": asset_id},
        )
        assert res.status_code == 200
        data = res.json()
        # Envelope: {run_id, review}
        assert "review" in data
        review = data["review"]
        assert review["review_type"] == "banner_review"
        assert len(review["rubric_scores"]) == len(BANNER_RUBRIC_IDS)


class TestAdLpReviewRouteSuccess:
    """POST /api/reviews/ad-lp returns 200 with valid asset + mocked Gemini."""

    @patch(
        "web.app.services.review.ad_lp_fit_service._call_text_model",
        new_callable=AsyncMock,
    )
    def test_ad_lp_review_200(self, mock_gemini, tmp_path):
        golden = _golden_ad_lp_review()
        mock_gemini.return_value = (json.dumps(golden), MagicMock())

        client, asset_id = _make_test_app(tmp_path)
        res = client.post(
            "/api/reviews/ad-lp",
            json={
                "asset_id": asset_id,
                "landing_page": {
                    "url": "https://example.com/lp",
                    "title": "テストLP",
                    "first_view_text": "ファーストビュー",
                    "cta_text": "申し込む",
                },
            },
        )
        assert res.status_code == 200
        data = res.json()
        # Envelope: {run_id, review}
        assert "review" in data
        review = data["review"]
        assert review["review_type"] == "ad_lp_review"
        assert len(review["rubric_scores"]) == len(LP_RUBRIC_IDS)


# =============================================================================
# Malformed asset_id and not-found tests
# =============================================================================

class TestBannerReviewEndpoint:
    def test_banner_review_malformed_id_422(self, tmp_path):
        """POST /api/reviews/banner with malformed asset_id returns 422."""
        client, _ = _make_test_app(tmp_path)
        res = client.post(
            "/api/reviews/banner",
            json={"asset_id": "INVALID-ID!"},
        )
        assert res.status_code == 422

    def test_banner_review_valid_format_missing_404(self, tmp_path):
        """POST /api/reviews/banner with valid-format but missing asset returns 404."""
        client, _ = _make_test_app(tmp_path)
        res = client.post(
            "/api/reviews/banner",
            json={"asset_id": "aaaaaaaaaaaa"},
        )
        assert res.status_code == 404

    def test_banner_review_invalid_request(self):
        """POST /api/reviews/banner rejects invalid request."""
        from web.app.main import app
        client = TestClient(app)
        res = client.post("/api/reviews/banner", json={})
        assert res.status_code == 422


class TestAdLpReviewEndpoint:
    def test_ad_lp_review_malformed_id_422(self, tmp_path):
        """POST /api/reviews/ad-lp with malformed asset_id returns 422."""
        client, _ = _make_test_app(tmp_path)
        res = client.post(
            "/api/reviews/ad-lp",
            json={
                "asset_id": "INVALID-ID!",
                "landing_page": {"url": "https://example.com/lp"},
            },
        )
        assert res.status_code == 422

    def test_ad_lp_review_valid_format_missing_404(self, tmp_path):
        """POST /api/reviews/ad-lp with valid-format but missing asset returns 404."""
        client, _ = _make_test_app(tmp_path)
        res = client.post(
            "/api/reviews/ad-lp",
            json={
                "asset_id": "aaaaaaaaaaaa",
                "landing_page": {"url": "https://example.com/lp"},
            },
        )
        assert res.status_code == 404

    def test_ad_lp_review_invalid_request(self):
        """POST /api/reviews/ad-lp rejects missing required fields."""
        from web.app.main import app
        client = TestClient(app)
        res = client.post("/api/reviews/ad-lp", json={})
        assert res.status_code == 422


class TestGetReview:
    def test_get_review_malformed_id_422(self):
        """GET /api/reviews/{bad-id} returns 422."""
        from web.app.main import app
        client = TestClient(app)
        res = client.get("/api/reviews/INVALID-ID!")
        assert res.status_code == 422

    def test_get_review_valid_format_not_found_404(self):
        """GET /api/reviews/{valid-but-missing} returns 404."""
        from web.app.main import app
        client = TestClient(app)
        res = client.get("/api/reviews/aaaaaaaaaaaa")
        assert res.status_code == 404


# =============================================================================
# P1: Review persistence and retrieval
# =============================================================================

class TestReviewPersistence:
    """POST review persists output; GET retrieves it."""

    @patch(
        "web.app.services.review.banner_review_service._call_multimodal_model",
        new_callable=AsyncMock,
    )
    def test_banner_post_persists_and_get_retrieves(self, mock_gemini, tmp_path):
        golden = _golden_banner_review()
        mock_gemini.return_value = (json.dumps(golden), MagicMock())

        client, asset_id, review_repo = _make_test_app(tmp_path, with_review_repo=True)

        # POST — creates review; response is envelope with run_id
        res = client.post(
            "/api/reviews/banner",
            json={"asset_id": asset_id},
        )
        assert res.status_code == 200
        envelope = res.json()
        assert "run_id" in envelope
        assert envelope["run_id"] is not None
        run_id = envelope["run_id"]
        assert envelope["review"]["review_type"] == "banner_review"

        # GET — retrieves persisted review using API-returned run_id (no repo introspection)
        res2 = client.get(f"/api/reviews/{run_id}")
        assert res2.status_code == 200
        data = res2.json()
        assert data["run_id"] == run_id
        assert data["review_type"] == "banner_review"
        assert data["output"]["review_type"] == "banner_review"

    @patch(
        "web.app.services.review.banner_review_service._call_multimodal_model",
        new_callable=AsyncMock,
    )
    def test_post_without_review_repo_returns_null_run_id(self, mock_gemini, tmp_path):
        """When review_repo is not configured, POST returns run_id=null."""
        golden = _golden_banner_review()
        mock_gemini.return_value = (json.dumps(golden), MagicMock())

        client, asset_id = _make_test_app(tmp_path, with_review_repo=False)
        res = client.post(
            "/api/reviews/banner",
            json={"asset_id": asset_id},
        )
        assert res.status_code == 200
        envelope = res.json()
        assert envelope["run_id"] is None
        assert envelope["review"]["review_type"] == "banner_review"

    def test_get_without_review_repo_returns_501(self, tmp_path):
        """When review_repo is not configured, GET returns 501."""
        client, _ = _make_test_app(tmp_path, with_review_repo=False)
        res = client.get("/api/reviews/aaaaaaaaaaaa")
        assert res.status_code == 501


# =============================================================================
# Gate-H1: OpenAPI contract regression — response schemas are not empty
# =============================================================================

class TestOpenApiContractRegression:
    """OpenAPI schema must publicly expose response shapes for review routes."""

    def _get_openapi(self, tmp_path):
        client, _ = _make_test_app(tmp_path)
        res = client.get("/openapi.json")
        assert res.status_code == 200
        return res.json()

    def test_post_banner_200_schema_not_empty(self, tmp_path):
        """POST /api/reviews/banner 200 schema must not be {}."""
        spec = self._get_openapi(tmp_path)
        schema_200 = spec["paths"]["/api/reviews/banner"]["post"]["responses"]["200"]
        content = schema_200["content"]["application/json"]["schema"]
        # Must reference ReviewSubmissionResponse (has properties or $ref)
        assert content != {}, "POST /banner 200 schema is empty"
        assert "$ref" in content or "properties" in content

    def test_post_ad_lp_200_schema_not_empty(self, tmp_path):
        """POST /api/reviews/ad-lp 200 schema must not be {}."""
        spec = self._get_openapi(tmp_path)
        schema_200 = spec["paths"]["/api/reviews/ad-lp"]["post"]["responses"]["200"]
        content = schema_200["content"]["application/json"]["schema"]
        assert content != {}, "POST /ad-lp 200 schema is empty"
        assert "$ref" in content or "properties" in content

    def test_get_review_200_schema_not_empty(self, tmp_path):
        """GET /api/reviews/{review_id} 200 schema must not be {}."""
        spec = self._get_openapi(tmp_path)
        schema_200 = spec["paths"]["/api/reviews/{review_id}"]["get"]["responses"]["200"]
        content = schema_200["content"]["application/json"]["schema"]
        assert content != {}, "GET /review 200 schema is empty"
        assert "$ref" in content or "properties" in content

    def test_post_schema_exposes_run_id_and_review(self, tmp_path):
        """POST response schema must contain run_id and review fields."""
        spec = self._get_openapi(tmp_path)
        schema_ref = spec["paths"]["/api/reviews/banner"]["post"]["responses"]["200"]["content"]["application/json"]["schema"]
        # Resolve $ref if present
        if "$ref" in schema_ref:
            ref_name = schema_ref["$ref"].split("/")[-1]
            schema = spec["components"]["schemas"][ref_name]
        else:
            schema = schema_ref
        props = schema.get("properties", {})
        assert "run_id" in props, "run_id missing from POST response schema"
        assert "review" in props, "review missing from POST response schema"

    def test_get_schema_exposes_output(self, tmp_path):
        """GET response schema must contain output field."""
        spec = self._get_openapi(tmp_path)
        schema_ref = spec["paths"]["/api/reviews/{review_id}"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        if "$ref" in schema_ref:
            ref_name = schema_ref["$ref"].split("/")[-1]
            schema = spec["components"]["schemas"][ref_name]
        else:
            schema = schema_ref
        props = schema.get("properties", {})
        assert "output" in props, "output missing from GET response schema"


# =============================================================================
# Gate-L2: Nested OpenAPI contract — review/output are typed, not free-form
# =============================================================================

class TestNestedOpenApiContract:
    """OpenAPI must expose ReviewResult shape inside review/output, not bare object."""

    def _get_openapi(self, tmp_path):
        client, _ = _make_test_app(tmp_path)
        res = client.get("/openapi.json")
        assert res.status_code == 200
        return res.json()

    def _resolve_ref(self, spec, ref_or_schema):
        """Resolve $ref to actual schema dict."""
        if "$ref" in ref_or_schema:
            ref_name = ref_or_schema["$ref"].split("/")[-1]
            return spec["components"]["schemas"][ref_name]
        return ref_or_schema

    def test_review_result_in_components(self, tmp_path):
        """ReviewResult must appear in OpenAPI components/schemas (Pydantic v2 may suffix -Input/-Output)."""
        spec = self._get_openapi(tmp_path)
        schemas = spec.get("components", {}).get("schemas", {})
        rr_keys = [k for k in schemas if k.startswith("ReviewResult")]
        assert len(rr_keys) >= 1, (
            f"ReviewResult not in OpenAPI components. Found: {list(schemas.keys())}"
        )

    def test_post_review_field_is_typed(self, tmp_path):
        """POST response 'review' field must reference ReviewResult, not be free-form."""
        spec = self._get_openapi(tmp_path)
        post_ref = spec["paths"]["/api/reviews/banner"]["post"]["responses"]["200"]["content"]["application/json"]["schema"]
        envelope = self._resolve_ref(spec, post_ref)
        review_prop = envelope["properties"]["review"]
        # Must be a $ref or have properties — not a bare {"type": "object"}
        assert "$ref" in review_prop or "properties" in review_prop, (
            f"POST review field is free-form: {review_prop}"
        )

    def test_get_output_field_is_typed(self, tmp_path):
        """GET response 'output' field must reference ReviewResult, not be free-form."""
        spec = self._get_openapi(tmp_path)
        get_ref = spec["paths"]["/api/reviews/{review_id}"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        stored = self._resolve_ref(spec, get_ref)
        output_prop = stored["properties"]["output"]
        assert "$ref" in output_prop or "properties" in output_prop, (
            f"GET output field is free-form: {output_prop}"
        )

    def _get_review_result_schema(self, spec):
        """Get ReviewResult schema (handles Pydantic v2 -Output suffix)."""
        schemas = spec["components"]["schemas"]
        for name in ("ReviewResult-Output", "ReviewResult"):
            if name in schemas:
                return schemas[name]
        raise AssertionError(f"ReviewResult not found in: {list(schemas.keys())}")

    def test_review_result_has_rubric_scores(self, tmp_path):
        """ReviewResult schema must expose rubric_scores field."""
        spec = self._get_openapi(tmp_path)
        rr = self._get_review_result_schema(spec)
        props = rr.get("properties", {})
        assert "rubric_scores" in props, "ReviewResult missing rubric_scores"

    def test_review_result_has_summary(self, tmp_path):
        """ReviewResult schema must expose summary field."""
        spec = self._get_openapi(tmp_path)
        rr = self._get_review_result_schema(spec)
        props = rr.get("properties", {})
        assert "summary" in props, "ReviewResult missing summary"

    def test_review_result_has_one_pager_sections(self, tmp_path):
        """ReviewResult schema must expose optional one_pager_sections field."""
        spec = self._get_openapi(tmp_path)
        rr = self._get_review_result_schema(spec)
        props = rr.get("properties", {})
        assert "one_pager_sections" in props, (
            f"ReviewResult missing one_pager_sections. Found: {list(props.keys())}"
        )


# =============================================================================
# Gate-RC2: Retrieval round-trip fidelity — optional fields survive persist+GET
# =============================================================================

def _golden_one_pager_sections() -> dict:
    """A valid one_pager_sections payload matching one-pager-schema.json."""
    return {
        "header": {
            "title": "クリエイティブレビュー サマリー",
            "subtitle": "MONOSTORE 夏セール",
            "review_date": "2026-03-22",
        },
        "good_points": {
            "heading": "良い点",
            "items": ["50%OFFの数字訴求が目立つ"],
        },
        "keep_as_is": {
            "heading": "守るべき点",
            "items": ["ブランドカラーの統一感"],
        },
        "improvements": {
            "heading": "改善提案",
            "items": [{"point": "CTAボタンが小さい", "action": "CTAを20%拡大"}],
        },
        "test_ideas": {
            "heading": "次に試すテスト案",
            "items": [{"hypothesis": "CTA文言変更でCTR向上", "variable": "CTAテキスト"}],
        },
        "evidence_sources": {
            "heading": "根拠・出典",
            "items": [{"evidence_type": "client_material", "evidence_source": "ブランドガイドライン v2.1"}],
        },
    }


class TestRetrievalRoundTripFidelity:
    """Persisted review with optional fields must survive GET retrieval."""

    @patch(
        "web.app.services.review.banner_review_service._call_multimodal_model",
        new_callable=AsyncMock,
    )
    def test_one_pager_sections_survives_round_trip(self, mock_gemini, tmp_path):
        """one_pager_sections in persisted review must be present in GET response."""
        golden = _golden_banner_review()
        golden["one_pager_sections"] = _golden_one_pager_sections()
        mock_gemini.return_value = (json.dumps(golden), MagicMock())

        client, asset_id, review_repo = _make_test_app(tmp_path, with_review_repo=True)

        # POST — persist review with one_pager_sections
        res = client.post("/api/reviews/banner", json={"asset_id": asset_id})
        assert res.status_code == 200
        run_id = res.json()["run_id"]
        assert run_id is not None
        # POST response must include one_pager_sections
        assert res.json()["review"].get("one_pager_sections") is not None

        # GET — retrieve and verify one_pager_sections is preserved
        res2 = client.get(f"/api/reviews/{run_id}")
        assert res2.status_code == 200
        output = res2.json()["output"]
        assert output.get("one_pager_sections") is not None, (
            "one_pager_sections dropped during GET retrieval"
        )
        assert output["one_pager_sections"]["header"]["title"] == "クリエイティブレビュー サマリー"

    @patch(
        "web.app.services.review.banner_review_service._call_multimodal_model",
        new_callable=AsyncMock,
    )
    def test_review_without_one_pager_sections_still_works(self, mock_gemini, tmp_path):
        """Review without one_pager_sections must still persist and retrieve cleanly."""
        golden = _golden_banner_review()
        # No one_pager_sections key
        mock_gemini.return_value = (json.dumps(golden), MagicMock())

        client, asset_id, review_repo = _make_test_app(tmp_path, with_review_repo=True)

        res = client.post("/api/reviews/banner", json={"asset_id": asset_id})
        assert res.status_code == 200
        run_id = res.json()["run_id"]

        res2 = client.get(f"/api/reviews/{run_id}")
        assert res2.status_code == 200
        output = res2.json()["output"]
        assert output.get("one_pager_sections") is None


# =============================================================================
# Gate-RC3: PDF 503 probe — valid body + WeasyPrint absent → 503
# =============================================================================

# =============================================================================
# Gate-SA1: One-pager nested OpenAPI strictness — required, format, extra
# =============================================================================

class TestOnePagerOpenApiStrictness:
    """OpenAPI must expose one-pager nested contract with strict constraints."""

    def _get_openapi(self, tmp_path):
        client, _ = _make_test_app(tmp_path)
        res = client.get("/openapi.json")
        assert res.status_code == 200
        return res.json()

    def _resolve_ref(self, spec, ref_or_schema):
        if "$ref" in ref_or_schema:
            ref_name = ref_or_schema["$ref"].split("/")[-1]
            return spec["components"]["schemas"][ref_name]
        return ref_or_schema

    def _get_review_result_schema(self, spec):
        schemas = spec["components"]["schemas"]
        for name in ("ReviewResult-Output", "ReviewResult"):
            if name in schemas:
                return schemas[name]
        raise AssertionError(f"ReviewResult not found in: {list(schemas.keys())}")

    def _get_one_pager_header_schema(self, spec):
        schemas = spec["components"]["schemas"]
        for name in ("OnePagerHeader", "OnePagerHeader-Input", "OnePagerHeader-Output"):
            if name in schemas:
                return schemas[name]
        raise AssertionError(f"OnePagerHeader not found in: {list(schemas.keys())}")

    def _get_one_pager_text_section_schema(self, spec):
        schemas = spec["components"]["schemas"]
        for name in ("OnePagerTextSection", "OnePagerTextSection-Input", "OnePagerTextSection-Output"):
            if name in schemas:
                return schemas[name]
        raise AssertionError(f"OnePagerTextSection not found in: {list(schemas.keys())}")

    def test_header_subtitle_is_required(self, tmp_path):
        """OnePagerHeader.subtitle must be in required fields (no default)."""
        spec = self._get_openapi(tmp_path)
        header = self._get_one_pager_header_schema(spec)
        required = header.get("required", [])
        assert "subtitle" in required, (
            f"subtitle not in OnePagerHeader required: {required}"
        )

    def test_header_review_date_has_date_format(self, tmp_path):
        """OnePagerHeader.review_date must have format: date in OpenAPI."""
        spec = self._get_openapi(tmp_path)
        header = self._get_one_pager_header_schema(spec)
        rd_prop = header["properties"]["review_date"]
        assert rd_prop.get("format") == "date", (
            f"review_date format is {rd_prop.get('format')!r}, expected 'date'"
        )

    def test_text_section_heading_is_required(self, tmp_path):
        """OnePagerTextSection.heading must be in required fields."""
        spec = self._get_openapi(tmp_path)
        section = self._get_one_pager_text_section_schema(spec)
        required = section.get("required", [])
        assert "heading" in required, (
            f"heading not in OnePagerTextSection required: {required}"
        )

    def test_one_pager_sections_in_review_result(self, tmp_path):
        """ReviewResult must expose one_pager_sections with a typed $ref."""
        spec = self._get_openapi(tmp_path)
        rr = self._get_review_result_schema(spec)
        ops = rr["properties"]["one_pager_sections"]
        # Must be anyOf with $ref or direct $ref — not bare {"type":"object"}
        has_ref = "$ref" in str(ops)
        assert has_ref, f"one_pager_sections not typed: {ops}"


class TestReviewResultOpenApiStrictness:
    """OpenAPI must reflect additionalProperties: false for ReviewResult and nested models."""

    def _get_openapi(self, tmp_path):
        client, _ = _make_test_app(tmp_path)
        res = client.get("/openapi.json")
        assert res.status_code == 200
        return res.json()

    def _find_schema(self, spec, *candidates):
        schemas = spec["components"]["schemas"]
        for name in candidates:
            if name in schemas:
                return schemas[name]
        raise AssertionError(f"None of {candidates} found in: {list(schemas.keys())}")

    def test_review_result_additional_properties_false(self, tmp_path):
        """ReviewResult OpenAPI schema must have additionalProperties: false."""
        spec = self._get_openapi(tmp_path)
        rr = self._find_schema(spec, "ReviewResult-Output", "ReviewResult")
        assert rr.get("additionalProperties") is False, (
            f"ReviewResult additionalProperties: {rr.get('additionalProperties')}"
        )

    def test_review_point_additional_properties_false(self, tmp_path):
        """ReviewPoint OpenAPI schema must have additionalProperties: false."""
        spec = self._get_openapi(tmp_path)
        rp = self._find_schema(spec, "ReviewPoint")
        assert rp.get("additionalProperties") is False, (
            f"ReviewPoint additionalProperties: {rp.get('additionalProperties')}"
        )

    def test_improvement_point_additional_properties_false(self, tmp_path):
        """ImprovementPoint OpenAPI schema must have additionalProperties: false."""
        spec = self._get_openapi(tmp_path)
        ip = self._find_schema(spec, "ImprovementPoint")
        assert ip.get("additionalProperties") is False, (
            f"ImprovementPoint additionalProperties: {ip.get('additionalProperties')}"
        )

    def test_test_idea_additional_properties_false(self, tmp_path):
        """TestIdea OpenAPI schema must have additionalProperties: false."""
        spec = self._get_openapi(tmp_path)
        ti = self._find_schema(spec, "TestIdea")
        assert ti.get("additionalProperties") is False, (
            f"TestIdea additionalProperties: {ti.get('additionalProperties')}"
        )

    def test_evidence_item_additional_properties_false(self, tmp_path):
        """EvidenceItem OpenAPI schema must have additionalProperties: false."""
        spec = self._get_openapi(tmp_path)
        ei = self._find_schema(spec, "EvidenceItem")
        assert ei.get("additionalProperties") is False, (
            f"EvidenceItem additionalProperties: {ei.get('additionalProperties')}"
        )

    def test_rubric_score_additional_properties_false(self, tmp_path):
        """RubricScore OpenAPI schema must have additionalProperties: false."""
        spec = self._get_openapi(tmp_path)
        rs = self._find_schema(spec, "RubricScore")
        assert rs.get("additionalProperties") is False, (
            f"RubricScore additionalProperties: {rs.get('additionalProperties')}"
        )


class TestPdf503Probe:
    """PDF export returns 503 when Playwright is unavailable."""

    def test_playwright_unavailable_returns_503(self, tmp_path):
        """POST /api/exports/pdf returns 503 when _async_playwright is None."""
        from unittest.mock import patch as _patch

        from web.app.main import app
        client = TestClient(app)

        golden = _golden_banner_review()
        with _patch("web.app.services.exports.pdf_export_service._async_playwright", None):
            res = client.post(
                "/api/exports/pdf",
                json={
                    "review": golden,
                    "title": "テスト",
                    "subtitle": "probe",
                },
            )
        assert res.status_code == 503, (
            f"Expected 503 but got {res.status_code}: {res.text}"
        )
        detail = res.json().get("detail", "")
        assert detail, "503 response must include error detail"
