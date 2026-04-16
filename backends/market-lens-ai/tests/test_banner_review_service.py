"""Tests for banner review service, prompt builder, and output validator."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from web.app.schemas.creative_asset import CreativeAssetMetadata
from web.app.schemas.review_result import ReviewResult
from web.app.services.review.banner_review_service import (
    AssetNotFoundError,
    BannerReviewError,
    review_banner,
)
from web.app.services.review.review_output_validator import (
    parse_review_json,
    validate_review_output,
)
from web.app.services.review.review_prompt_builder import (
    BANNER_RUBRIC_IDS,
    build_banner_review_prompt,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "creative_review"


# -- Golden review fixture (matches expected_review_shape.json) ---------------

def _golden_banner_review() -> dict:
    """A valid banner review output matching the contract."""
    return {
        "review_type": "banner_review",
        "summary": "ECセールバナーとして基本的な訴求力を備えているが、視線誘導とCTAの改善余地がある",
        "product_identification": "MONOSTORE ECセール — 50%OFFキャンペーンバナー",
        "good_points": [
            {"point": "50%OFFの数字訴求が目立つ", "reason": "赤背景に白文字で割引率が視認しやすい"}
        ],
        "keep_as_is": [],
        "improvements": [
            {"point": "CTAボタンが小さい", "reason": "300x250サイズに対してCTAが目立たない", "action": "CTAボタンを20%拡大し、コントラストを上げる"}
        ],
        "test_ideas": [],
        "evidence": [
            {"evidence_type": "client_material", "evidence_source": "MONOSTOREブランドガイドライン v2.1", "evidence_text": "メインカラーは赤、サブカラーは白"}
        ],
        "target_hypothesis": "20-40代の女性で、セール情報に敏感なオンラインショッピング利用者",
        "message_angle": "期間限定の大幅値引きによるお得感訴求",
        "rubric_scores": [
            {"rubric_id": "visual_impact", "score": 4, "comment": "50%OFFの数字が目を引き視線誘導も適切"},
            {"rubric_id": "message_clarity", "score": 3, "comment": "女性向けは推測できるが明示されていない"},
            {"rubric_id": "cta_effectiveness", "score": 2, "comment": "CTAボタンが小さく見落としやすい"},
            {"rubric_id": "brand_consistency", "score": 5, "comment": "赤×白のブランドカラーが統一されている"},
            {"rubric_id": "information_balance", "score": 4, "comment": "300x250に適切な情報量で信頼感もある"},
        ],
    }


# -- Prompt Builder Tests -----------------------------------------------------

class TestBuildBannerReviewPrompt:
    def test_contains_rubric_ids(self):
        prompt = build_banner_review_prompt(asset_file_name="test.png")
        for rid in BANNER_RUBRIC_IDS:
            assert rid in prompt

    def test_contains_file_name(self):
        prompt = build_banner_review_prompt(asset_file_name="sale_banner.png")
        assert "sale_banner.png" in prompt

    def test_contains_brand_info(self):
        prompt = build_banner_review_prompt(
            asset_file_name="t.png", brand_info="MONOSTORE"
        )
        assert "MONOSTORE" in prompt

    def test_contains_size(self):
        prompt = build_banner_review_prompt(
            asset_file_name="t.png", asset_width=300, asset_height=250
        )
        assert "300x250" in prompt

    def test_contains_style_rules(self):
        prompt = build_banner_review_prompt(asset_file_name="t.png")
        assert "良い点を必ず先に出す" in prompt
        assert "断定は禁止" in prompt

    def test_contains_json_format(self):
        prompt = build_banner_review_prompt(asset_file_name="t.png")
        assert '"review_type": "banner_review"' in prompt

    def test_contains_visible_text_elements_extraction_instructions(self):
        prompt = build_banner_review_prompt(asset_file_name="t.png")
        assert "visible_text_elements" in prompt

    def test_contains_text_extraction_guidance(self):
        prompt = build_banner_review_prompt(asset_file_name="t.png")
        assert "テキスト要素" in prompt


# -- Output Validator Tests ---------------------------------------------------

class TestParseReviewJson:
    def test_plain_json(self):
        data, err = parse_review_json('{"review_type": "banner_review"}')
        assert err is None
        assert data["review_type"] == "banner_review"

    def test_markdown_fenced_json(self):
        raw = '```json\n{"review_type": "banner_review"}\n```'
        data, err = parse_review_json(raw)
        assert err is None
        assert data["review_type"] == "banner_review"

    def test_invalid_json(self):
        data, err = parse_review_json("not json at all")
        assert data is None
        assert "JSON parse error" in err

    def test_trailing_comma_repaired(self):
        raw = '{"review_type": "banner_review", "summary": "test",}'
        data, err = parse_review_json(raw)
        assert err is None
        assert data["review_type"] == "banner_review"

    def test_truncated_json_repaired(self):
        raw = '{"review_type": "banner_review", "scores": [{"id": "a", "score": 3}'
        data, err = parse_review_json(raw)
        assert err is None
        assert data["review_type"] == "banner_review"
        assert data["scores"][0]["score"] == 3

    def test_trailing_comma_in_array_repaired(self):
        raw = '{"items": [1, 2, 3,]}'
        data, err = parse_review_json(raw)
        assert err is None
        assert data["items"] == [1, 2, 3]


class TestValidateReviewOutput:
    def test_valid_output(self):
        report = validate_review_output(_golden_banner_review())
        assert report.valid is True
        assert len([i for i in report.issues if i.severity == "error"]) == 0

    def test_empty_evidence_fails(self):
        data = _golden_banner_review()
        data["evidence"] = []
        report = validate_review_output(data)
        assert report.valid is False

    def test_missing_field_fails(self):
        data = _golden_banner_review()
        del data["summary"]
        report = validate_review_output(data)
        assert report.valid is False


# -- Banner Review Service Tests (mocked LLM) --------------------------------

class TestReviewBanner:
    @pytest.mark.asyncio
    async def test_success(self, tmp_path):
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = CreativeAssetMetadata(
            file_name="banner.png", mime_type="image/png", size_bytes=1024,
            width=300, height=250,
        )
        repo.save(meta, b"\x89PNG")

        golden = _golden_banner_review()
        mock_response = json.dumps(golden)

        with patch(
            "web.app.services.review.banner_review_service._call_multimodal_model",
            new_callable=AsyncMock,
            return_value=(mock_response, MagicMock()),
        ):
            result = await review_banner(
                asset_id=meta.asset_id,
                repo=repo,
                brand_info="MONOSTORE",
            )

        assert isinstance(result, ReviewResult)
        assert result.review_type == "banner_review"
        assert len(result.good_points) >= 1
        assert len(result.evidence) >= 1

    @pytest.mark.asyncio
    async def test_asset_not_found(self, tmp_path):
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        with pytest.raises(BannerReviewError, match="Asset not found"):
            await review_banner(asset_id="000000000000", repo=repo)

    @pytest.mark.asyncio
    async def test_invalid_llm_output(self, tmp_path):
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = CreativeAssetMetadata(
            file_name="banner.png", mime_type="image/png", size_bytes=1024,
        )
        repo.save(meta, b"\x89PNG")

        with patch(
            "web.app.services.review.banner_review_service._call_multimodal_model",
            new_callable=AsyncMock,
            return_value=("not valid json", MagicMock()),
        ):
            with pytest.raises(BannerReviewError, match="parse failed"):
                await review_banner(asset_id=meta.asset_id, repo=repo)

    @pytest.mark.asyncio
    async def test_multimodal_failure_falls_back_to_text(self, tmp_path):
        """マルチモーダル呼び出し失敗時にtext-onlyフォールバックすること"""
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = CreativeAssetMetadata(
            file_name="banner.png", mime_type="image/png", size_bytes=1024,
            width=300, height=250,
        )
        repo.save(meta, b"\x89PNG")

        golden = _golden_banner_review()
        mock_response = json.dumps(golden)

        with patch(
            "web.app.services.review.banner_review_service._call_multimodal_model",
            new_callable=AsyncMock,
            side_effect=RuntimeError("API connection failed"),
        ), patch(
            "web.app.services.review.banner_review_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(mock_response, MagicMock()),
        ) as mock_text:
            result = await review_banner(asset_id=meta.asset_id, repo=repo)
            # text-only フォールバックが呼ばれることを確認
            mock_text.assert_called_once()
            assert result.review_type == "banner_review"

    @pytest.mark.asyncio
    async def test_missing_image_data_falls_back_to_text_only(self, tmp_path):
        """image_data=None 時にtext-onlyフォールバックすること"""
        from web.app.repositories.file_asset_repository import FileAssetRepository

        repo = FileAssetRepository(base_dir=tmp_path / "assets")
        meta = CreativeAssetMetadata(
            file_name="banner.png", mime_type="image/png", size_bytes=1024,
        )
        repo.save(meta, b"\x89PNG")

        golden = _golden_banner_review()
        mock_response = json.dumps(golden)

        with patch.object(repo, "load_data", return_value=None), patch(
            "web.app.services.review.banner_review_service._call_text_model",
            new_callable=AsyncMock,
            return_value=(mock_response, MagicMock()),
        ) as mock_text:
            result = await review_banner(asset_id=meta.asset_id, repo=repo)
            mock_text.assert_called_once()
            assert result.review_type == "banner_review"


# -- Fixture Shape Stability Tests -------------------------------------------

class TestFixtureShapeStability:
    """Ensure fixture files match the expected contract shape."""

    def test_expected_shape_validates_golden(self):
        shape_path = FIXTURES_DIR / "expected_review_shape.json"
        shape = json.loads(shape_path.read_text(encoding="utf-8"))
        example = shape.get("_examples", {}).get("valid_banner_review")
        assert example is not None
        # Validate against ReviewResult Pydantic model
        result = ReviewResult(**example)
        assert result.review_type == "banner_review"

    def test_banner_fixtures_have_required_fields(self):
        for i in range(1, 13):
            path = FIXTURES_DIR / f"banner_review_input_{i:02d}.json"
            if not path.exists():
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            assert "fixture_id" in data
            assert "review_type" in data
            assert data["review_type"] == "banner_review"
            assert "asset" in data
            assert "asset_id" in data["asset"]
