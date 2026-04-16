"""Tests for ad-to-LP fit review service."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from web.app.schemas.creative_asset import CreativeAssetMetadata
from web.app.schemas.review_request import LandingPageInput
from web.app.schemas.review_result import ReviewResult
from web.app.services.review.ad_lp_fit_service import (
    AdLpReviewError,
    review_ad_lp_fit,
)
from web.app.services.review.review_prompt_builder import (
    LP_RUBRIC_IDS,
    build_ad_lp_review_prompt,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "creative_review"


def _golden_ad_lp_review() -> dict:
    """A valid ad-to-LP review output matching the contract."""
    return {
        "review_type": "ad_lp_review",
        "summary": "広告とLPのメッセージは概ね一致しているが、CTAの整合性に改善余地がある",
        "good_points": [
            {"point": "50%OFFの訴求が広告とLPで一致", "reason": "広告の割引メッセージがLPファーストビューで即座に確認できる"}
        ],
        "keep_as_is": [
            {"point": "セール訴求の一貫性", "reason": "広告クリック後に期待通りの内容が展開される"}
        ],
        "improvements": [
            {"point": "CTAの文言が広告とLPで異なる", "reason": "広告は「今すぐ見る」だがLPは「セール会場へ」", "action": "CTAの文言を統一するか、LPでも広告の文言を引き継ぐ"}
        ],
        "test_ideas": [
            {"hypothesis": "LP側のCTAを広告と同じ文言にすると遷移率が向上する可能性がある", "variable": "LP CTA文言", "expected_impact": "直帰率低減が期待できる（仮説）"}
        ],
        "evidence": [
            {"evidence_type": "client_material", "evidence_source": "広告バナー ec_sale_banner_300x250.png", "evidence_text": "50%OFF訴求と「今すぐ見る」CTA"},
            {"evidence_type": "competitor_public", "evidence_source": "LP https://example-shop.co.jp/summer-sale", "evidence_text": "ファーストビューに50%OFF、CTAは「セール会場へ」"}
        ],
        "target_hypothesis": "セール情報に敏感な20-40代女性のオンラインショッピング利用者",
        "message_angle": "期間限定セールの訴求一貫性",
        "rubric_scores": [
            {"rubric_id": "first_view_clarity", "score": 4, "comment": "ファーストビューでセール訴求が明確"},
            {"rubric_id": "ad_to_lp_message_match", "score": 4, "comment": "割引メッセージは一致、CTA文言に差異あり"},
            {"rubric_id": "benefit_clarity", "score": 4, "comment": "50%OFFと送料無料が明確"},
            {"rubric_id": "trust_elements", "score": 3, "comment": "会員数とレビュー評価の信頼要素あり"},
            {"rubric_id": "cta_placement", "score": 3, "comment": "CTAはあるが配置が最適とは言えない"},
            {"rubric_id": "drop_off_risk", "score": 3, "comment": "軽微な離脱要因あり"},
            {"rubric_id": "input_friction", "score": 4, "comment": "入力摩擦は低い"},
            {"rubric_id": "story_consistency", "score": 4, "comment": "セール→商品→購入の流れが一貫"},
        ],
    }


def _sample_lp_input() -> LandingPageInput:
    return LandingPageInput(
        url="https://example-shop.co.jp/summer-sale",
        title="夏の大セール | MONOSTORE - 最大50%OFF",
        meta_description="人気アイテムが最大50%OFF",
        first_view_text="夏の大セール 最大50%OFF 期間限定",
        cta_text="セール会場へ",
        extracted_benefits=["最大50%OFF", "送料無料", "期間限定"],
        trust_elements=["会員数100万人突破", "レビュー評価4.5"],
    )


# -- Prompt Builder Tests -----------------------------------------------------

class TestBuildAdLpReviewPrompt:
    def test_contains_lp_rubric_ids(self):
        prompt = build_ad_lp_review_prompt(
            asset_file_name="t.png", landing_page=_sample_lp_input()
        )
        for rid in LP_RUBRIC_IDS:
            assert rid in prompt

    def test_contains_lp_info(self):
        lp = _sample_lp_input()
        prompt = build_ad_lp_review_prompt(
            asset_file_name="t.png", landing_page=lp
        )
        assert lp.url in prompt
        assert "MONOSTORE" in prompt
        assert "セール会場へ" in prompt

    def test_contains_match_instructions(self):
        prompt = build_ad_lp_review_prompt(
            asset_file_name="t.png", landing_page=_sample_lp_input()
        )
        assert "match" in prompt or "一致" in prompt

    def test_partial_lp_data_prompt_warning(self):
        """LP データが不足している場合に警告テキストが含まれること"""
        lp = LandingPageInput(url="https://example.com", title="タイトル")
        prompt = build_ad_lp_review_prompt(
            asset_file_name="t.png", landing_page=lp
        )
        assert "LP データ取得状況に関する注意" in prompt
        assert "スコア 1-2 を付けることは禁止" in prompt

    def test_full_lp_data_no_warning(self):
        """LP データが十分な場合に警告テキストが含まれないこと"""
        lp = _sample_lp_input()
        prompt = build_ad_lp_review_prompt(
            asset_file_name="t.png", landing_page=lp
        )
        assert "LP データ取得状況に関する注意" not in prompt

    def test_contains_banner_visual_analysis_instruction(self):
        """バナー画像の視覚分析指示が含まれること"""
        prompt = build_ad_lp_review_prompt(
            asset_file_name="t.png", landing_page=_sample_lp_input()
        )
        assert "バナーの視覚要素分析" in prompt


# -- Ad-to-LP Review Service Tests (mocked LLM) ------------------------------

class TestReviewAdLpFit:
    @pytest.mark.asyncio
    async def test_success(self, tmp_path):
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = CreativeAssetMetadata(
            file_name="banner.png", mime_type="image/png", size_bytes=1024,
            width=300, height=250,
        )
        repo.save(meta, b"\x89PNG")

        golden = _golden_ad_lp_review()
        with patch(
            "web.app.services.review.ad_lp_fit_service._call_multimodal_model",
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
        assert len(result.evidence) >= 2  # LP + ad evidence

    @pytest.mark.asyncio
    async def test_multimodal_fallback_on_non_image_error(self, tmp_path):
        """マルチモーダル呼び出し失敗時にtext-onlyフォールバックすること"""
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = CreativeAssetMetadata(
            file_name="banner.png", mime_type="image/png", size_bytes=1024,
            width=300, height=250,
        )
        repo.save(meta, b"\x89PNG")

        golden = _golden_ad_lp_review()
        with patch(
            "web.app.services.review.ad_lp_fit_service._call_multimodal_model",
            new_callable=AsyncMock,
            side_effect=RuntimeError("API connection failed"),
        ), patch(
            "web.app.services.review.ad_lp_fit_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(golden), MagicMock()),
        ) as mock_text:
            result = await review_ad_lp_fit(
                asset_id=meta.asset_id,
                landing_page=_sample_lp_input(),
                repo=repo,
            )
            mock_text.assert_called_once()
            assert result.review_type == "ad_lp_review"

    @pytest.mark.asyncio
    async def test_image_none_uses_text_only(self, tmp_path):
        """image_data=None 時にtext-onlyフォールバックすること"""
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = CreativeAssetMetadata(
            file_name="banner.png", mime_type="image/png", size_bytes=1024,
            width=300, height=250,
        )
        repo.save(meta, b"\x89PNG")

        golden = _golden_ad_lp_review()
        with patch.object(repo, "load_data", return_value=None), patch(
            "web.app.services.review.ad_lp_fit_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(json.dumps(golden), MagicMock()),
        ) as mock_text:
            result = await review_ad_lp_fit(
                asset_id=meta.asset_id,
                landing_page=_sample_lp_input(),
                repo=repo,
            )
            mock_text.assert_called_once()
            assert result.review_type == "ad_lp_review"

    @pytest.mark.asyncio
    async def test_asset_not_found(self, tmp_path):
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        with pytest.raises(AdLpReviewError, match="Asset not found"):
            await review_ad_lp_fit(
                asset_id="000000000000",
                landing_page=_sample_lp_input(),
                repo=repo,
            )

    @pytest.mark.asyncio
    async def test_invalid_llm_output(self, tmp_path):
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = CreativeAssetMetadata(
            file_name="banner.png", mime_type="image/png", size_bytes=1024,
        )
        repo.save(meta, b"\x89PNG")

        with patch(
            "web.app.services.review.ad_lp_fit_service._call_multimodal_model",
            new_callable=AsyncMock,
            return_value=("broken json {{{", MagicMock()),
        ):
            with pytest.raises(AdLpReviewError, match="parse failed"):
                await review_ad_lp_fit(
                    asset_id=meta.asset_id,
                    landing_page=_sample_lp_input(),
                    repo=repo,
                )


# -- Fixture Shape Tests -----------------------------------------------------

class TestAdLpFixtureShape:
    def test_ad_lp_fixtures_have_required_fields(self):
        for i in range(1, 7):
            path = FIXTURES_DIR / f"ad_lp_review_input_{i:02d}.json"
            if not path.exists():
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            assert "fixture_id" in data
            assert data["review_type"] == "ad_lp_review"
            assert "asset" in data
            assert "landing_page" in data
            lp = data["landing_page"]
            assert "url" in lp
