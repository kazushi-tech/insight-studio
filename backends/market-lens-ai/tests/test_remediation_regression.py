"""Regression tests for remediation plan findings (Bundle-R2).

These tests ensure that runtime correctness fixes from Bundle-R1
cannot regress silently.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from web.app.schemas.creative_asset import CreativeAssetMetadata
from web.app.schemas.review_request import LandingPageInput
from pydantic import ValidationError

from web.app.schemas.review_result import (
    EvidenceItem,
    EvidenceType,
    ImprovementPoint,
    OnePagerHeader,
    OnePagerSections,
    OnePagerTextSection,
    ReviewPoint,
    ReviewResult,
    RubricScore,
    TestIdea,
)
from web.app.services.review.banner_review_service import (
    AssetNotFoundError,
    BannerReviewError,
    review_banner,
)
from web.app.services.review.ad_lp_fit_service import (
    AdLpAssetNotFoundError,
    AdLpReviewError,
    review_ad_lp_fit,
)
from web.app.services.review.review_prompt_builder import (
    BANNER_RUBRIC_IDS,
    LP_RUBRIC_IDS,
)
from web.app.services.exports.pdf_export_service import PdfExportError, export_pdf


# -- Helpers -----------------------------------------------------------------

def _golden_banner_review() -> dict:
    """A valid, guardrail-clean banner review output with ALL rubric IDs."""
    return {
        "review_type": "banner_review",
        "summary": "ECセールバナーとして基本的な訴求力を備えている",
        "product_identification": "ECセール — 50%OFFキャンペーンバナー",
        "good_points": [
            {"point": "50%OFFの数字訴求が目立つ", "reason": "赤背景に白文字で視認しやすい"}
        ],
        "keep_as_is": [],
        "improvements": [
            {"point": "CTAボタンが小さい", "reason": "CTAが目立たない", "action": "CTAを20%拡大"}
        ],
        "test_ideas": [],
        "evidence": [
            {"evidence_type": "client_material", "evidence_source": "ブランドガイドライン v2.1", "evidence_text": "メインカラーは赤"}
        ],
        "target_hypothesis": "20-40代女性",
        "message_angle": "期間限定値引き訴求",
        "rubric_scores": [
            {"rubric_id": "visual_impact", "score": 4, "comment": "数字が目を引く"},
            {"rubric_id": "message_clarity", "score": 3, "comment": "女性向け推測可能"},
            {"rubric_id": "cta_effectiveness", "score": 2, "comment": "CTAが小さい"},
            {"rubric_id": "brand_consistency", "score": 5, "comment": "カラー統一"},
            {"rubric_id": "information_balance", "score": 4, "comment": "適切な情報量"},
        ],
    }


def _golden_ad_lp_review() -> dict:
    """A valid, guardrail-clean ad-to-LP review output with ALL rubric IDs."""
    return {
        "review_type": "ad_lp_review",
        "summary": "広告とLPのメッセージは概ね一致している",
        "product_identification": "ECセール広告とLP",
        "good_points": [
            {"point": "50%OFFの訴求が一致", "reason": "広告のメッセージがLPで確認できる"}
        ],
        "keep_as_is": [],
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
            {"rubric_id": "first_view_clarity", "score": 4, "comment": "ファーストビューで明確"},
            {"rubric_id": "ad_to_lp_message_match", "score": 4, "comment": "メッセージ一致"},
            {"rubric_id": "benefit_clarity", "score": 4, "comment": "ベネフィットが明確"},
            {"rubric_id": "trust_elements", "score": 3, "comment": "会員数表示あり"},
            {"rubric_id": "cta_placement", "score": 3, "comment": "CTA配置は標準的"},
            {"rubric_id": "drop_off_risk", "score": 3, "comment": "離脱リスク中程度"},
            {"rubric_id": "input_friction", "score": 4, "comment": "入力フリクション低"},
            {"rubric_id": "story_consistency", "score": 4, "comment": "ストーリー一貫性あり"},
        ],
    }


def _make_repo(tmp_path):
    from web.app.repositories.file_asset_repository import FileAssetRepository
    repo = FileAssetRepository(base_dir=tmp_path / "assets")
    meta = CreativeAssetMetadata(
        file_name="banner.png", mime_type="image/png", size_bytes=1024,
        width=300, height=250,
    )
    repo.save(meta, b"\x89PNG")
    return repo, meta


def _sample_lp_input() -> LandingPageInput:
    return LandingPageInput(
        url="https://example-shop.co.jp/summer-sale",
        title="夏の大セール | MONOSTORE",
        meta_description="人気アイテムが最大50%OFF",
        first_view_text="夏の大セール 最大50%OFF",
        cta_text="セール会場へ",
        extracted_benefits=["最大50%OFF", "送料無料"],
        trust_elements=["会員数100万人"],
    )


# =============================================================================
# CR-R2.1: Real success-path tests
# =============================================================================

class TestBannerReviewSuccessPath:
    """Banner review returns valid result through full pipeline including guardrails."""

    @pytest.mark.asyncio
    async def test_clean_review_passes_guardrails(self, tmp_path):
        repo, meta = _make_repo(tmp_path)
        golden = _golden_banner_review()

        with patch(
            "web.app.services.review.banner_review_service._call_multimodal_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(golden), MagicMock()),
        ):
            result = await review_banner(
                asset_id=meta.asset_id, repo=repo, brand_info="MONOSTORE",
            )

        assert isinstance(result, ReviewResult)
        assert result.review_type == "banner_review"
        assert len(result.good_points) >= 1
        assert len(result.evidence) >= 1


class TestAdLpReviewSuccessPath:
    """Ad-LP review returns valid result through full pipeline including guardrails."""

    @pytest.mark.asyncio
    async def test_clean_review_passes_guardrails(self, tmp_path):
        repo, meta = _make_repo(tmp_path)
        golden = _golden_ad_lp_review()

        with patch(
            "web.app.services.review.ad_lp_fit_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(golden), MagicMock()),
        ):
            result = await review_ad_lp_fit(
                asset_id=meta.asset_id,
                landing_page=_sample_lp_input(),
                repo=repo,
            )

        assert isinstance(result, ReviewResult)
        assert result.review_type == "ad_lp_review"
        assert len(result.evidence) >= 2


# =============================================================================
# CR-R2.2: Contract strictness — rubric IDs must match review type
# =============================================================================

class TestRubricContractStrictness:
    """Review output rubric IDs must match expected set for the review type."""

    def test_banner_rubric_ids_match_expected(self):
        golden = _golden_banner_review()
        result = ReviewResult(**golden)
        actual_ids = {rs.rubric_id for rs in result.rubric_scores}
        # At least one expected rubric ID must be present
        assert actual_ids.issubset(set(BANNER_RUBRIC_IDS)), (
            f"Unexpected rubric IDs: {actual_ids - set(BANNER_RUBRIC_IDS)}"
        )

    def test_ad_lp_rubric_ids_match_expected(self):
        golden = _golden_ad_lp_review()
        result = ReviewResult(**golden)
        actual_ids = {rs.rubric_id for rs in result.rubric_scores}
        assert actual_ids.issubset(set(LP_RUBRIC_IDS)), (
            f"Unexpected rubric IDs: {actual_ids - set(LP_RUBRIC_IDS)}"
        )


# =============================================================================
# CR-R2.3: Negative integration — guardrail disconnect regression
# =============================================================================

class TestGuardrailDisconnectRegression:
    """If guardrails are bypassed or disconnected, review must fail."""

    @pytest.mark.asyncio
    async def test_forbidden_claim_rejected_at_service_level(self, tmp_path):
        """LLM output containing forbidden claim must be rejected by banner service."""
        repo, meta = _make_repo(tmp_path)
        bad = _golden_banner_review()
        bad["improvements"][0]["reason"] = "必ず効果が出るので変更すべき"

        with patch(
            "web.app.services.review.banner_review_service._call_multimodal_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(bad), MagicMock()),
        ):
            with pytest.raises(BannerReviewError, match="guardrail violation"):
                await review_banner(asset_id=meta.asset_id, repo=repo)

    @pytest.mark.asyncio
    async def test_vague_evidence_rejected_at_service_level(self, tmp_path):
        """LLM output with vague evidence source must be rejected."""
        repo, meta = _make_repo(tmp_path)
        bad = _golden_banner_review()
        bad["evidence"][0]["evidence_source"] = "一般的にバナーはこう作る"

        with patch(
            "web.app.services.review.banner_review_service._call_multimodal_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(bad), MagicMock()),
        ):
            with pytest.raises(BannerReviewError, match="Evidence grounding violation"):
                await review_banner(asset_id=meta.asset_id, repo=repo)

    @pytest.mark.asyncio
    async def test_destructive_commentary_rejected(self, tmp_path):
        """LLM output with destructive commentary must be rejected."""
        repo, meta = _make_repo(tmp_path)
        bad = _golden_banner_review()
        bad["summary"] = "このバナーは最悪の出来栄え"

        with patch(
            "web.app.services.review.banner_review_service._call_multimodal_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(bad), MagicMock()),
        ):
            with pytest.raises(BannerReviewError, match="guardrail violation"):
                await review_banner(asset_id=meta.asset_id, repo=repo)

    @pytest.mark.asyncio
    async def test_ad_lp_forbidden_claim_rejected(self, tmp_path):
        """Ad-LP service also rejects forbidden claims."""
        repo, meta = _make_repo(tmp_path)
        bad = _golden_ad_lp_review()
        bad["test_ideas"][0]["expected_impact"] = "CVR が上がります"

        with patch(
            "web.app.services.review.ad_lp_fit_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(bad), MagicMock()),
        ):
            with pytest.raises(AdLpReviewError, match="guardrail violation"):
                await review_ad_lp_fit(
                    asset_id=meta.asset_id,
                    landing_page=_sample_lp_input(),
                    repo=repo,
                )


# =============================================================================
# CR-R2.3: LP capture bypass regression
# =============================================================================

class TestLpCaptureBypassRegression:
    """Ad-LP review must use server-side capture when LP data is URL-only."""

    @pytest.mark.asyncio
    async def test_url_only_triggers_server_capture(self, tmp_path):
        """When LandingPageInput has only url, server-side capture must run."""
        repo, meta = _make_repo(tmp_path)
        url_only_lp = LandingPageInput(url="https://example.com/lp")

        with patch(
            "web.app.services.review.ad_lp_fit_service.capture_landing_page",
            new_callable=AsyncMock,
        ) as mock_capture, patch(
            "web.app.services.review.ad_lp_fit_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(_golden_ad_lp_review()), MagicMock()),
        ):
            from web.app.services.intake.landing_page_capture_service import LpCaptureResult
            mock_capture.return_value = LpCaptureResult(
                landing_page=_sample_lp_input(),
            )

            result = await review_ad_lp_fit(
                asset_id=meta.asset_id,
                landing_page=url_only_lp,
                repo=repo,
            )

        mock_capture.assert_called_once_with(
            "https://example.com/lp",
            fetch_timeout=20.0,
            fetch_max_retries=2,
        )
        assert isinstance(result, ReviewResult)

    @pytest.mark.asyncio
    async def test_url_only_capture_failure_raises(self, tmp_path):
        """When server-side capture fails, ad-LP review must raise."""
        repo, meta = _make_repo(tmp_path)
        url_only_lp = LandingPageInput(url="https://example.com/blocked")

        with patch(
            "web.app.services.review.ad_lp_fit_service.capture_landing_page",
            new_callable=AsyncMock,
        ) as mock_capture:
            from web.app.services.intake.landing_page_capture_service import LpCaptureResult
            mock_capture.return_value = LpCaptureResult(
                landing_page=LandingPageInput(url="https://example.com/blocked"),
                error="Fetch failed: HTTP 403",
            )

            with pytest.raises(AdLpReviewError, match="LP capture failed"):
                await review_ad_lp_fit(
                    asset_id=meta.asset_id,
                    landing_page=url_only_lp,
                    repo=repo,
                )

    @pytest.mark.asyncio
    async def test_full_lp_data_skips_capture(self, tmp_path):
        """When LP data is fully populated, server capture is NOT called."""
        repo, meta = _make_repo(tmp_path)
        full_lp = _sample_lp_input()

        with patch(
            "web.app.services.review.ad_lp_fit_service.capture_landing_page",
            new_callable=AsyncMock,
        ) as mock_capture, patch(
            "web.app.services.review.ad_lp_fit_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(_golden_ad_lp_review()), MagicMock()),
        ):
            result = await review_ad_lp_fit(
                asset_id=meta.asset_id,
                landing_page=full_lp,
                repo=repo,
            )

        mock_capture.assert_not_called()
        assert isinstance(result, ReviewResult)


# =============================================================================
# CR-R2.3: PDF truthfulness regression
# =============================================================================

class TestPdfTruthfulnessRegression:
    """PDF export must never return HTML bytes as application/pdf."""

    @pytest.mark.asyncio
    async def test_no_playwright_raises(self):
        """When _async_playwright is None, export_pdf raises PdfExportError."""
        from unittest.mock import patch as _patch
        review = ReviewResult(**_golden_banner_review())
        with _patch("web.app.services.exports.pdf_export_service._async_playwright", None):
            with pytest.raises(PdfExportError):
                await export_pdf(review)

    @pytest.mark.asyncio
    async def test_browser_not_installed_raises(self):
        """When browser binary is missing, export_pdf raises PdfExportError."""
        from unittest.mock import AsyncMock, MagicMock, patch as _patch

        mock_pw = AsyncMock()
        mock_pw.chromium.launch = AsyncMock(side_effect=Exception("not found"))
        mock_cm = AsyncMock()
        mock_cm.__aenter__ = AsyncMock(return_value=mock_pw)
        mock_cm.__aexit__ = AsyncMock(return_value=False)
        mock_fn = MagicMock(return_value=mock_cm)

        review = ReviewResult(**_golden_banner_review())
        with _patch("web.app.services.exports.pdf_export_service._async_playwright", mock_fn):
            with pytest.raises(PdfExportError):
                await export_pdf(review)


# =============================================================================
# CR-R2.3: Invalid asset ID regression
# =============================================================================

# =============================================================================
# CR-R2.4: Rubric contract drift regression
# =============================================================================

class TestRubricDriftRegression:
    """Rubric completeness and membership are enforced at runtime."""

    @pytest.mark.asyncio
    async def test_banner_missing_rubric_rejected(self, tmp_path):
        """Banner review with incomplete rubric IDs must be rejected."""
        repo, meta = _make_repo(tmp_path)
        bad = _golden_banner_review()
        # Remove all but one rubric
        bad["rubric_scores"] = [bad["rubric_scores"][0]]

        with patch(
            "web.app.services.review.banner_review_service._call_multimodal_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(bad), MagicMock()),
        ):
            with pytest.raises(BannerReviewError, match="Missing rubric IDs"):
                await review_banner(asset_id=meta.asset_id, repo=repo)

    @pytest.mark.asyncio
    async def test_ad_lp_missing_rubric_rejected(self, tmp_path):
        """Ad-LP review with incomplete rubric IDs must be rejected."""
        repo, meta = _make_repo(tmp_path)
        bad = _golden_ad_lp_review()
        bad["rubric_scores"] = [bad["rubric_scores"][0]]

        with patch(
            "web.app.services.review.ad_lp_fit_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(bad), MagicMock()),
        ):
            with pytest.raises(AdLpReviewError, match="Missing rubric IDs"):
                await review_ad_lp_fit(
                    asset_id=meta.asset_id,
                    landing_page=_sample_lp_input(),
                    repo=repo,
                )

    @pytest.mark.asyncio
    async def test_unexpected_rubric_id_rejected(self, tmp_path):
        """Review with unexpected rubric ID must be rejected."""
        repo, meta = _make_repo(tmp_path)
        bad = _golden_banner_review()
        bad["rubric_scores"].append(
            {"rubric_id": "nonexistent_metric", "score": 3, "comment": "bogus"}
        )

        with patch(
            "web.app.services.review.banner_review_service._call_multimodal_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(bad), MagicMock()),
        ):
            with pytest.raises(BannerReviewError, match="Unexpected rubric IDs"):
                await review_banner(asset_id=meta.asset_id, repo=repo)


# =============================================================================
# CR-R2.5: Route-level malformed asset_id regression
# =============================================================================

class TestReviewRouteMalformedAssetId:
    """Review routes must return 422 for malformed and 404 for missing assets."""

    def test_banner_malformed_asset_id_returns_422(self):
        from fastapi.testclient import TestClient
        from web.app.main import app
        client = TestClient(app)
        res = client.post(
            "/api/reviews/banner",
            json={"asset_id": "INVALID!!"},
        )
        assert res.status_code == 422

    def test_ad_lp_malformed_asset_id_returns_422(self):
        from fastapi.testclient import TestClient
        from web.app.main import app
        client = TestClient(app)
        res = client.post(
            "/api/reviews/ad-lp",
            json={
                "asset_id": "INVALID!!",
                "landing_page": {"url": "https://example.com/lp"},
            },
        )
        assert res.status_code == 422

    def test_banner_valid_format_missing_returns_404(self):
        from fastapi.testclient import TestClient
        from web.app.main import app
        client = TestClient(app)
        res = client.post(
            "/api/reviews/banner",
            json={"asset_id": "000000000000"},
        )
        assert res.status_code == 404

    def test_ad_lp_valid_format_missing_returns_404(self):
        from fastapi.testclient import TestClient
        from web.app.main import app
        client = TestClient(app)
        res = client.post(
            "/api/reviews/ad-lp",
            json={
                "asset_id": "000000000000",
                "landing_page": {"url": "https://example.com/lp"},
            },
        )
        assert res.status_code == 404


# =============================================================================
# CR-R2.3: Invalid asset ID regression (asset routes — pre-existing)
# =============================================================================

class TestInvalidAssetIdRegression:
    """Malformed asset IDs must return 4xx, never 500."""

    def test_malformed_id_get_metadata(self):
        import io
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from web.app.repositories.file_asset_repository import FileAssetRepository
        from web.app.routers.creative_asset_routes import create_asset_router

        repo = FileAssetRepository(base_dir="data/test_assets_temp")
        app = FastAPI()
        app.include_router(create_asset_router(repo))
        client = TestClient(app)

        resp = client.get("/api/assets/INVALID-ID!")
        assert resp.status_code == 422
        assert "Invalid asset_id" in resp.json()["detail"]

    def test_malformed_id_download(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from web.app.repositories.file_asset_repository import FileAssetRepository
        from web.app.routers.creative_asset_routes import create_asset_router

        repo = FileAssetRepository(base_dir="data/test_assets_temp")
        app = FastAPI()
        app.include_router(create_asset_router(repo))
        client = TestClient(app)

        resp = client.get("/api/assets/INVALID-ID!/download")
        assert resp.status_code == 422

    def test_malformed_id_delete(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from web.app.repositories.file_asset_repository import FileAssetRepository
        from web.app.routers.creative_asset_routes import create_asset_router

        repo = FileAssetRepository(base_dir="data/test_assets_temp")
        app = FastAPI()
        app.include_router(create_asset_router(repo))
        client = TestClient(app)

        resp = client.delete("/api/assets/INVALID-ID!")
        assert resp.status_code == 422

    def test_valid_format_not_found(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from web.app.repositories.file_asset_repository import FileAssetRepository
        from web.app.routers.creative_asset_routes import create_asset_router

        repo = FileAssetRepository(base_dir="data/test_assets_temp")
        app = FastAPI()
        app.include_router(create_asset_router(repo))
        client = TestClient(app)

        resp = client.get("/api/assets/abcdef123456")
        assert resp.status_code == 404


# =============================================================================
# Gate-F3: Contract artifact / runtime rubric sync
# =============================================================================

class TestRubricContractArtifactSync:
    """Schema/fixture rubric IDs must match runtime source of truth."""

    def test_schema_banner_rubric_ids_match_runtime(self):
        """review-output.schema.json banner rubric IDs == BANNER_RUBRIC_IDS."""
        import json as _json
        from pathlib import Path
        schema_path = Path("docs/creative-review/contracts/review-output.schema.json")
        schema = _json.loads(schema_path.read_text(encoding="utf-8"))
        schema_ids = set(schema["_rubric_contract"]["banner_review_rubric_ids"])
        assert schema_ids == set(BANNER_RUBRIC_IDS)

    def test_schema_lp_rubric_ids_match_runtime(self):
        """review-output.schema.json LP rubric IDs == LP_RUBRIC_IDS."""
        import json as _json
        from pathlib import Path
        schema_path = Path("docs/creative-review/contracts/review-output.schema.json")
        schema = _json.loads(schema_path.read_text(encoding="utf-8"))
        schema_ids = set(schema["_rubric_contract"]["ad_lp_review_rubric_ids"])
        assert schema_ids == set(LP_RUBRIC_IDS)

    def test_fixture_banner_rubric_ids_match_runtime(self):
        """expected_review_shape.json banner rubric IDs == BANNER_RUBRIC_IDS."""
        import json as _json
        from pathlib import Path
        fixture_path = Path("tests/fixtures/creative_review/expected_review_shape.json")
        fixture = _json.loads(fixture_path.read_text(encoding="utf-8"))
        fixture_ids = set(fixture["_rubric_contract"]["banner_review_rubric_ids"])
        assert fixture_ids == set(BANNER_RUBRIC_IDS)

    def test_fixture_lp_rubric_ids_match_runtime(self):
        """expected_review_shape.json LP rubric IDs == LP_RUBRIC_IDS."""
        import json as _json
        from pathlib import Path
        fixture_path = Path("tests/fixtures/creative_review/expected_review_shape.json")
        fixture = _json.loads(fixture_path.read_text(encoding="utf-8"))
        fixture_ids = set(fixture["_rubric_contract"]["ad_lp_review_rubric_ids"])
        assert fixture_ids == set(LP_RUBRIC_IDS)


# =============================================================================
# Gate-H2: Schema semantics — if/then structure enforces rubric ID sets
# =============================================================================

class TestSchemaSemanticsClosure:
    """Schema if/then must encode rubric ID enum + cardinality, not just metadata."""

    def _load_schema(self):
        import json as _json
        from pathlib import Path
        return _json.loads(
            Path("docs/creative-review/contracts/review-output.schema.json")
            .read_text(encoding="utf-8")
        )

    def test_banner_branch_has_rubric_enum(self):
        """Schema then-branch for banner_review must list all rubric IDs as enum."""
        schema = self._load_schema()
        then_branch = schema["then"]["properties"]["rubric_scores"]["items"]
        enum_ids = set(then_branch["properties"]["rubric_id"]["enum"])
        assert enum_ids == set(BANNER_RUBRIC_IDS), (
            f"Schema banner enum {enum_ids} != runtime {set(BANNER_RUBRIC_IDS)}"
        )

    def test_lp_branch_has_rubric_enum(self):
        """Schema else/then-branch for ad_lp_review must list all rubric IDs as enum."""
        schema = self._load_schema()
        else_then = schema["else"]["then"]["properties"]["rubric_scores"]["items"]
        enum_ids = set(else_then["properties"]["rubric_id"]["enum"])
        assert enum_ids == set(LP_RUBRIC_IDS), (
            f"Schema LP enum {enum_ids} != runtime {set(LP_RUBRIC_IDS)}"
        )

    def test_banner_branch_enforces_cardinality(self):
        """Schema banner branch must enforce minItems=8, maxItems=8."""
        schema = self._load_schema()
        rubric = schema["then"]["properties"]["rubric_scores"]
        assert rubric["minItems"] == len(BANNER_RUBRIC_IDS)
        assert rubric["maxItems"] == len(BANNER_RUBRIC_IDS)

    def test_lp_branch_enforces_cardinality(self):
        """Schema LP branch must enforce minItems=8, maxItems=8."""
        schema = self._load_schema()
        rubric = schema["else"]["then"]["properties"]["rubric_scores"]
        assert rubric["minItems"] == len(LP_RUBRIC_IDS)
        assert rubric["maxItems"] == len(LP_RUBRIC_IDS)

    def test_fixture_role_documented(self):
        """Fixture must document its role and limitations vs schema."""
        import json as _json
        from pathlib import Path
        fixture = _json.loads(
            Path("tests/fixtures/creative_review/expected_review_shape.json")
            .read_text(encoding="utf-8")
        )
        contract = fixture.get("_rubric_contract", {})
        desc = contract.get("description", "")
        # Must mention it is not the enforcement layer
        assert "source of truth" in desc.lower() or "validator" in desc.lower(), (
            "Fixture _rubric_contract.description must clarify source-of-truth relationship"
        )


# =============================================================================
# Gate-L1: Schema per-ID presence — allOf/contains rules exist for each rubric
# =============================================================================

class TestSchemaPerIdPresence:
    """Schema must express per-ID presence via allOf/contains, not just enum+cardinality."""

    def _load_schema(self):
        import json as _json
        from pathlib import Path
        return _json.loads(
            Path("docs/creative-review/contracts/review-output.schema.json")
            .read_text(encoding="utf-8")
        )

    def test_banner_branch_has_allof_contains(self):
        """Banner rubric_scores must have allOf with contains for each rubric ID."""
        schema = self._load_schema()
        rubric = schema["then"]["properties"]["rubric_scores"]
        assert "allOf" in rubric, "Banner branch missing allOf for per-ID presence"
        contains_ids = set()
        for rule in rubric["allOf"]:
            assert "contains" in rule, f"allOf entry missing contains: {rule}"
            rid = rule["contains"]["properties"]["rubric_id"]["const"]
            contains_ids.add(rid)
        assert contains_ids == set(BANNER_RUBRIC_IDS), (
            f"Banner allOf/contains IDs {contains_ids} != runtime {set(BANNER_RUBRIC_IDS)}"
        )

    def test_lp_branch_has_allof_contains(self):
        """LP rubric_scores must have allOf with contains for each rubric ID."""
        schema = self._load_schema()
        rubric = schema["else"]["then"]["properties"]["rubric_scores"]
        assert "allOf" in rubric, "LP branch missing allOf for per-ID presence"
        contains_ids = set()
        for rule in rubric["allOf"]:
            assert "contains" in rule, f"allOf entry missing contains: {rule}"
            rid = rule["contains"]["properties"]["rubric_id"]["const"]
            contains_ids.add(rid)
        assert contains_ids == set(LP_RUBRIC_IDS), (
            f"LP allOf/contains IDs {contains_ids} != runtime {set(LP_RUBRIC_IDS)}"
        )

    def test_banner_contains_count_matches_cardinality(self):
        """Number of contains rules must equal minItems/maxItems (no duplicates pass)."""
        schema = self._load_schema()
        rubric = schema["then"]["properties"]["rubric_scores"]
        assert len(rubric["allOf"]) == rubric["minItems"] == rubric["maxItems"]

    def test_lp_contains_count_matches_cardinality(self):
        """Number of contains rules must equal minItems/maxItems (no duplicates pass)."""
        schema = self._load_schema()
        rubric = schema["else"]["then"]["properties"]["rubric_scores"]
        assert len(rubric["allOf"]) == rubric["minItems"] == rubric["maxItems"]


# =============================================================================
# Gate-SA1/SA2: One-pager runtime strict contract — rejection tests
# =============================================================================

def _valid_one_pager_sections() -> dict:
    """Minimal valid one_pager_sections payload matching canonical contract."""
    return {
        "header": {
            "title": "レビューサマリー",
            "subtitle": "MONOSTORE 夏セール",
            "review_date": "2026-03-22",
        },
        "good_points": {"heading": "良い点", "items": ["視認性が高い"]},
        "keep_as_is": {"heading": "守るべき点", "items": ["ブランドカラー統一"]},
        "improvements": {
            "heading": "改善提案",
            "items": [{"point": "CTA拡大", "action": "20%拡大"}],
        },
        "test_ideas": {
            "heading": "テスト案",
            "items": [{"hypothesis": "CTA変更でCTR向上", "variable": "CTAテキスト"}],
        },
        "evidence_sources": {
            "heading": "根拠",
            "items": [{"evidence_type": "client_material", "evidence_source": "ガイドライン v2.1"}],
        },
    }


class TestOnePagerRuntimeStrictness:
    """One-pager models must enforce canonical strictness at runtime."""

    def test_valid_payload_accepted(self):
        """Valid one_pager_sections payload must parse without error."""
        sections = OnePagerSections(**_valid_one_pager_sections())
        assert sections.header.title == "レビューサマリー"

    def test_extra_key_in_header_rejected(self):
        """Extra key in OnePagerHeader must raise ValidationError."""
        data = _valid_one_pager_sections()
        data["header"]["bogus_field"] = "should fail"
        with pytest.raises(ValidationError, match="bogus_field"):
            OnePagerSections(**data)

    def test_extra_key_in_text_section_rejected(self):
        """Extra key in OnePagerTextSection must raise ValidationError."""
        data = _valid_one_pager_sections()
        data["good_points"]["extra"] = "nope"
        with pytest.raises(ValidationError, match="extra"):
            OnePagerSections(**data)

    def test_extra_key_in_root_rejected(self):
        """Extra key in OnePagerSections root must raise ValidationError."""
        data = _valid_one_pager_sections()
        data["bonus_section"] = {"heading": "x", "items": ["y"]}
        with pytest.raises(ValidationError, match="bonus_section"):
            OnePagerSections(**data)

    def test_missing_subtitle_rejected(self):
        """Missing subtitle (now required) must raise ValidationError."""
        data = _valid_one_pager_sections()
        del data["header"]["subtitle"]
        with pytest.raises(ValidationError, match="subtitle"):
            OnePagerSections(**data)

    def test_missing_heading_rejected(self):
        """Missing heading (now required) must raise ValidationError."""
        data = _valid_one_pager_sections()
        del data["good_points"]["heading"]
        with pytest.raises(ValidationError, match="heading"):
            OnePagerSections(**data)

    def test_blank_item_in_text_section_rejected(self):
        """Empty string item in items array must raise ValidationError."""
        data = _valid_one_pager_sections()
        data["good_points"]["items"] = ["valid item", ""]
        with pytest.raises(ValidationError):
            OnePagerSections(**data)

    def test_review_date_invalid_format_rejected(self):
        """Non-date string for review_date must raise ValidationError."""
        data = _valid_one_pager_sections()
        data["header"]["review_date"] = "not-a-date"
        with pytest.raises(ValidationError):
            OnePagerSections(**data)

    def test_review_date_valid_date_accepted(self):
        """Valid YYYY-MM-DD string for review_date must parse to date."""
        from datetime import date as date_type
        data = _valid_one_pager_sections()
        sections = OnePagerSections(**data)
        assert isinstance(sections.header.review_date, date_type)
        assert str(sections.header.review_date) == "2026-03-22"

    def test_empty_items_list_rejected(self):
        """Empty items list must raise ValidationError (minItems: 1)."""
        data = _valid_one_pager_sections()
        data["keep_as_is"]["items"] = []
        with pytest.raises(ValidationError):
            OnePagerSections(**data)


# -- ReviewResult root/nested strictness (Pack-RRS1/RRS2/RRS3) ----------------


class TestReviewResultStrictness:
    """Validate ReviewResult and nested models reject extra keys (additionalProperties: false)."""

    def test_valid_banner_review_accepted(self):
        """Valid golden payload must still parse without error."""
        data = _golden_banner_review()
        result = ReviewResult(**data)
        assert result.review_type == "banner_review"

    def test_root_extra_key_rejected(self):
        """Extra key at ReviewResult root must raise ValidationError."""
        data = _golden_banner_review()
        data["bogus_root_field"] = "should fail"
        with pytest.raises(ValidationError, match="bogus_root_field"):
            ReviewResult(**data)

    def test_good_points_extra_key_rejected(self):
        """Extra key in good_points item (ReviewPoint) must raise ValidationError."""
        data = _golden_banner_review()
        data["good_points"][0]["extra"] = "nope"
        with pytest.raises(ValidationError, match="extra"):
            ReviewResult(**data)

    def test_keep_as_is_extra_key_rejected(self):
        """Extra key in keep_as_is item (ReviewPoint) must raise ValidationError."""
        data = _golden_banner_review()
        data["keep_as_is"] = [{"point": "test", "reason": "test", "extra": "nope"}]
        with pytest.raises(ValidationError, match="extra"):
            ReviewResult(**data)

    def test_improvements_extra_key_rejected(self):
        """Extra key in improvements item (ImprovementPoint) must raise ValidationError."""
        data = _golden_banner_review()
        data["improvements"][0]["extra"] = "nope"
        with pytest.raises(ValidationError, match="extra"):
            ReviewResult(**data)

    def test_test_ideas_extra_key_rejected(self):
        """Extra key in test_ideas item (TestIdea) must raise ValidationError."""
        data = _golden_banner_review()
        data["test_ideas"] = [{"hypothesis": "h", "variable": "v", "expected_impact": "e", "extra": "nope"}]
        with pytest.raises(ValidationError, match="extra"):
            ReviewResult(**data)

    def test_evidence_extra_key_rejected(self):
        """Extra key in evidence item (EvidenceItem) must raise ValidationError."""
        data = _golden_banner_review()
        data["evidence"][0]["extra"] = "nope"
        with pytest.raises(ValidationError, match="extra"):
            ReviewResult(**data)

    def test_rubric_scores_extra_key_rejected(self):
        """Extra key in rubric_scores item (RubricScore) must raise ValidationError."""
        data = _golden_banner_review()
        data["rubric_scores"][0]["extra"] = "nope"
        with pytest.raises(ValidationError, match="extra"):
            ReviewResult(**data)
