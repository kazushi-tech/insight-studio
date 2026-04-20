"""Tests for analyzer.py — competitive LP prompt + deep comparison prompt + analyze branching + prompt size log."""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from web.app.analyzer import build_competitive_lp_prompt, build_deep_comparison_prompt, build_wide_comparison_prompt, analyze
from web.app.models import ExtractedData, TokenUsage


def _sample_extracted(url: str = "https://example.com", **kwargs) -> ExtractedData:
    return ExtractedData(
        url=url,
        title=kwargs.get("title", "Example LP"),
        meta_description=kwargs.get("meta_description", "Best LP ever"),
        h1=kwargs.get("h1", "Welcome"),
        hero_copy=kwargs.get("hero_copy", "Transform your business"),
        main_cta=kwargs.get("main_cta", "今すぐ申し込む"),
        pricing_snippet=kwargs.get("pricing_snippet", "¥980/月"),
        feature_bullets=kwargs.get("feature_bullets", ["Feature A", "Feature B"]),
        body_text_snippet=kwargs.get("body_text_snippet", "これはサンプルのLP本文です。"),
        og_type=kwargs.get("og_type", "website"),
        screenshot_path=kwargs.get("screenshot_path"),
        secondary_ctas=kwargs.get("secondary_ctas", []),
        faq_items=kwargs.get("faq_items", []),
        testimonials=kwargs.get("testimonials", []),
        urgency_elements=kwargs.get("urgency_elements", []),
        trust_badges=kwargs.get("trust_badges", []),
        guarantees=kwargs.get("guarantees", []),
        image_alts=kwargs.get("image_alts", []),
        banner_texts=kwargs.get("banner_texts", []),
        contact_paths=kwargs.get("contact_paths", []),
        promo_claims=kwargs.get("promo_claims", []),
        corporate_elements=kwargs.get("corporate_elements", []),
        offer_terms=kwargs.get("offer_terms", []),
        review_signals=kwargs.get("review_signals", []),
        shipping_signals=kwargs.get("shipping_signals", []),
    )


# ---------- build_competitive_lp_prompt ----------

class TestBuildCompetitiveLpPrompt:
    """Tests for the 1-URL competitive LP analysis prompt builder."""

    def test_contains_url(self):
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "https://example.com" in prompt

    def test_contains_evaluation_points(self):
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "業界" in prompt
        assert "競合" in prompt
        assert "ポジション" in prompt
        assert "CRO" in prompt

    def test_contains_site_data(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            title="Test LP Title",
            main_cta="無料で始める",
        ))
        assert "Test LP Title" in prompt
        assert "無料で始める" in prompt

    def test_contains_output_format_sections(self):
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "業界・ポジション推定" in prompt
        assert "CRO 6軸" in prompt or "スコアリング" in prompt
        assert "戦略的改善提案" in prompt

    def test_contains_features(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            feature_bullets=["高速配送", "24時間サポート"]
        ))
        assert "高速配送" in prompt
        assert "24時間サポート" in prompt

    def test_empty_features_shows_fallback(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(feature_bullets=[]))
        assert "取得不可" in prompt

    def test_role_instruction(self):
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "CROコンサルタント" in prompt

    def test_body_text_snippet_in_prompt(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            body_text_snippet="サンプル本文テキスト"
        ))
        assert "サンプル本文テキスト" in prompt

    def test_og_type_in_prompt(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(og_type="product"))
        assert "product" in prompt

    def test_data_availability_summary_in_prompt(self):
        """改善B: データ取得率サマリがプロンプトに含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "フィールド取得成功" in prompt

    def test_partial_data_utilization_in_prompt(self):
        """改善A: 部分データ活用指示がプロンプトに含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "【推定】ラベル付き" in prompt
        assert "本文抜粋" in prompt

    def test_screenshot_analysis_in_prompt(self):
        """改善D: スクリーンショット分析セクションがプロンプトに含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "スクリーンショット分析" in prompt
        assert "ファーストビュー" in prompt

    def test_secondary_ctas_in_prompt(self):
        """改善E: Secondary CTAsがプロンプトに含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "Secondary CTA" in prompt

    def test_faq_in_prompt(self):
        """改善E: FAQフィールドがプロンプトに含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "FAQ" in prompt

    def test_testimonials_in_prompt(self):
        """改善E: 顧客の声フィールドがプロンプトに含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "顧客の声" in prompt


# ---------- _format_site_data truncation ----------

class TestFormatSiteDataTruncation:
    """Tests for _format_site_data field truncation limits."""

    def test_body_text_snippet_truncated_to_800(self):
        long_text = "A" * 3000
        prompt = build_competitive_lp_prompt(_sample_extracted(body_text_snippet=long_text))
        assert "A" * 800 in prompt
        assert "A" * 801 not in prompt

    def test_feature_bullets_limited_to_5(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            feature_bullets=[f"Feature {i}" for i in range(10)]
        ))
        assert "Feature 4" in prompt
        assert "Feature 5" not in prompt

    def test_faq_items_limited_to_3(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            faq_items=[f"FAQ {i}" for i in range(6)]
        ))
        assert "FAQ 2" in prompt
        assert "FAQ 3" not in prompt

    def test_testimonials_limited_to_2(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            testimonials=[f"Review {i}" for i in range(5)]
        ))
        assert "Review 1" in prompt
        assert "Review 2" not in prompt

    def test_secondary_ctas_limited_to_3(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            secondary_ctas=[f"CTA {i}" for i in range(6)]
        ))
        assert "CTA 2" in prompt
        assert "CTA 3" not in prompt


# ---------- build_deep_comparison_prompt ----------

class TestBuildDeepComparisonPrompt:
    """Tests for the multi-URL deep comparison prompt builder."""

    def test_contains_all_urls(self):
        data = [
            _sample_extracted("https://a.com"),
            _sample_extracted("https://b.com"),
        ]
        prompt = build_deep_comparison_prompt(data)
        assert "https://a.com" in prompt
        assert "https://b.com" in prompt

    def test_contains_agency_role(self):
        data = [
            _sample_extracted("https://a.com"),
            _sample_extracted("https://b.com"),
        ]
        prompt = build_deep_comparison_prompt(data)
        assert "代理店" in prompt
        assert "シニアストラテジスト" in prompt

    def test_three_urls(self):
        data = [_sample_extracted(f"https://{c}.com") for c in ["a", "b", "c"]]
        prompt = build_deep_comparison_prompt(data)
        for c in ["a", "b", "c"]:
            assert f"https://{c}.com" in prompt

    def test_deep_comparison_has_partial_data_rules(self):
        """改善A: deep comparisonにも部分データ活用指示がある."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "「取得不可」を弱みの根拠にしてはならない" in prompt
        assert "【推定】" in prompt

    def test_deep_comparison_has_mobile_evaluation(self):
        """モバイル最適化の注記が含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "モバイル最適化" in prompt



    def test_deep_comparison_has_score_basis_tags(self):
        """C-1: 異種サイト間のスコアキャリブレーション指示が含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "基準タグ" in prompt
        assert "(獲得型EC基準)" in prompt

    def test_deep_comparison_has_mobile_estimation_note(self):
        """C-2: モバイル最適化スコアの推定ベース注記が含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "推定ベース" in prompt

    def test_actions_are_prioritized_before_notes(self):
        """実行プランがprompt内に存在する."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "実行プラン" in prompt

    def test_three_site_prompt_stays_compact_enough(self):
        """3サイト比較でもプロンプトが過度に肥大化しない."""
        long_body = "これは比較用の本文です。" * 120
        data = [
            _sample_extracted(
                f"https://{name}.com",
                body_text_snippet=long_body,
                image_alts=["最大45%OFF", "お問い合わせはこちら", "売れ筋トップ10"],
                banner_texts=["新生活応援セール", "おすすめ商品", "ランキング"],
                contact_paths=["お問い合わせ", "FAQ", "見積もり依頼"],
                promo_claims=["送料無料", "在庫限り", "1〜3日発送"],
                corporate_elements=["正規代理店", "開業13年の実績", "メーカー直営"],
            )
            for name in ("a", "b", "c")
        ]
        prompt = build_deep_comparison_prompt(data)
        # Upper bound includes the shared evaluation + market estimate blocks
        # that are now always embedded (A-8 rollout). The cap still catches
        # runaway growth while accommodating the deterministic anchor data.
        assert len(prompt) < 26000

    def test_four_site_uses_wide_prompt_shape(self):
        """4サイト以上では高シグナル優先の軽量プロンプトを使う."""
        data = [_sample_extracted(f"https://{c}.com") for c in ["a", "b", "c", "d"]]
        prompt = build_wide_comparison_prompt(data)
        assert "高シグナル優先" in prompt
        # Phase P1-A: target relaxed from 2200 → 3500〜3800 字 so Section 5
        # subsections (最優先3施策 / 5-0 / 5-1 / 5-2) fit without truncation.
        assert "3500" in prompt and "3800" in prompt


# ---------- Agency-grade: 5-section fixed structure ----------

class TestAgencyGradeFiveSections:
    """Tests that the prompt enforces the 5 fixed section structure."""

    def _prompt(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        return build_deep_comparison_prompt(data)

    def test_section_1_executive_summary(self):
        assert "エグゼクティブサマリー" in self._prompt()

    def test_section_2_analysis_targets(self):
        assert "分析対象と比較前提" in self._prompt()

    def test_section_3_competitive_summary(self):
        assert "競合比較サマリー" in self._prompt()

    def test_section_4_brand_evaluation(self):
        assert "ブランド別評価" in self._prompt()

    def test_section_5_action_plan(self):
        assert "実行プラン" in self._prompt()

    def test_no_section_6_in_prompt(self):
        """注記・前提条件はprompt側には含まれない（report_generatorがowner）."""
        prompt = self._prompt()
        assert "### 6. 注記・前提条件" not in prompt


# ---------- Agency-grade: evidence strength ----------

class TestAgencyGradeEvidenceStrength:
    """Tests that evidence strength and basis fields are required in the prompt."""

    def _prompt(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        return build_deep_comparison_prompt(data)

    def test_evidence_strength_in_action_table(self):
        """アクション表に証拠強度列が含まれる."""
        prompt = self._prompt()
        assert "証拠強度" in prompt

    def test_basis_field_in_action_table(self):
        """アクション表に根拠フィールド列が含まれる."""
        prompt = self._prompt()
        assert "根拠フィールド" in prompt

    def test_three_tier_labels(self):
        """確認済み / 推定 / 評価保留 の3ラベルが使われる."""
        prompt = self._prompt()
        assert "確認済み" in prompt
        assert "推定" in prompt
        assert "評価保留" in prompt


# ---------- Agency-grade: evaluation-hold exclusion ----------

class TestEvaluationHoldExclusion:
    """Tests that evaluation-hold sites are excluded from main comparison."""

    def _prompt(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        return build_deep_comparison_prompt(data)

    def test_hold_sites_excluded_from_main_table(self):
        """評価保留サイトが主比較表から除外される指示がある."""
        prompt = self._prompt()
        assert "参考観測枠" in prompt
        assert "主比較表" in prompt or "主比較から除外" in prompt

    def test_three_category_classification(self):
        """入力ブランド（control） / 実競合比較対象 / 参考観測枠 の3区分が明示される."""
        prompt = self._prompt()
        assert "入力ブランド" in prompt
        assert "実競合比較対象" in prompt
        assert "参考観測枠" in prompt


# ---------- Agency-grade: heading safety ----------

class TestHeadingSafety:
    """Tests that incomplete headings are prohibited."""

    def _prompt(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        return build_deep_comparison_prompt(data)

    def test_incomplete_heading_prohibition(self):
        """不完全見出し（説得アー等）の禁止指示がある."""
        prompt = self._prompt()
        assert "不完全な見出し" in prompt

    def test_persuasion_architecture_not_main_heading(self):
        """「説得アーキテクチャ」が本文の大見出しに使われない指示がある."""
        prompt = self._prompt()
        assert "説得アーキテクチャ" in prompt
        assert "大見出しに使わない" in prompt

    def test_heading_fixation_rule(self):
        """見出し固定ルールが含まれる."""
        prompt = self._prompt()
        assert "見出し固定ルール" in prompt


# ---------- Agency-grade: sports supplement criteria ----------

class TestSportsSupplementCriteria:
    """Tests that sports supplement-specific evaluation criteria are in the prompt."""

    def _prompt(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        return build_deep_comparison_prompt(
            data,
            discovery_metadata={"industry": "スポーツサプリメント"},
        )

    def test_anti_doping(self):
        assert "アンチドーピング" in self._prompt()

    def test_gmp_certification(self):
        assert "GMP" in self._prompt()

    def test_subscription_pricing(self):
        assert "定期便" in self._prompt()

    def test_taste_continuity(self):
        prompt = self._prompt()
        assert "飲みやすさ" in prompt or "継続しやすさ" in prompt

    def test_athlete_results(self):
        prompt = self._prompt()
        assert "アスリート使用実績" in prompt or "アスリート実績" in prompt


# ---------- Agency-grade: new extracted fields in prompt ----------

class TestNewExtractedFieldsInPrompt:
    """Tests that new extracted fields (offer/review/shipping) appear in prompt."""

    def test_offer_terms_field(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            offer_terms=["初回限定50%OFF"]
        ))
        assert "オファー条件" in prompt
        assert "初回限定50%OFF" in prompt

    def test_review_signals_field(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            review_signals=["★4.5 (120件)"]
        ))
        assert "レビュー信号" in prompt
        assert "★4.5 (120件)" in prompt

    def test_shipping_signals_field(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(
            shipping_signals=["送料無料"]
        ))
        assert "配送条件" in prompt
        assert "送料無料" in prompt

    def test_empty_offer_shows_none(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(offer_terms=[]))
        assert "オファー条件" in prompt
        assert "検出なし" in prompt


# ---------- Agency-grade: overstatement prohibition ----------

class TestOverstatementProhibition:
    """Tests that overstatement terms are prohibited in the prompt."""

    def _prompt(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        return build_deep_comparison_prompt(data)

    def test_prohibits_strongest(self):
        assert "最強" in self._prompt()

    def test_prohibits_only(self):
        assert "唯一" in self._prompt()

    def test_prohibits_certain_improvement(self):
        assert "確実に改善" in self._prompt()


# ---------- analyze() branching ----------

class TestAnalyzeBranching:
    """Tests that analyze() routes to the correct prompt builder."""

    @pytest.mark.asyncio
    async def test_single_url_uses_lp_prompt(self):
        data = [_sample_extracted("https://single.com")]
        mock_return = ("LP review result", TokenUsage(prompt_tokens=10, completion_tokens=20))

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            result_text, usage = await analyze(data)
            called_prompt = mock_text.call_args[0][0]
            assert "CROコンサルタント" in called_prompt
            assert result_text == "LP review result"

    @pytest.mark.asyncio
    async def test_multi_url_uses_comparison_prompt(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        mock_return = ("Comparison result", TokenUsage(prompt_tokens=10, completion_tokens=20))

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            result_text, usage = await analyze(data)
            called_prompt = mock_text.call_args[0][0]
            assert "シニアストラテジスト" in called_prompt
            assert result_text == "Comparison result"

    @pytest.mark.asyncio
    async def test_multi_url_passes_6144_max_tokens(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        mock_return = ("result", TokenUsage())

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            await analyze(data)
            assert mock_text.call_args[1]["max_output_tokens"] == 6144

    @pytest.mark.asyncio
    async def test_three_url_passes_7168_max_tokens(self):
        data = [
            _sample_extracted("https://a.com"),
            _sample_extracted("https://b.com"),
            _sample_extracted("https://c.com"),
        ]
        mock_return = ("result", TokenUsage())

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            await analyze(data)
            assert mock_text.call_args[1]["max_output_tokens"] == 7168

    @pytest.mark.asyncio
    async def test_four_url_passes_6144_max_tokens(self):
        data = [
            _sample_extracted("https://a.com"),
            _sample_extracted("https://b.com"),
            _sample_extracted("https://c.com"),
            _sample_extracted("https://d.com"),
        ]
        mock_return = ("result", TokenUsage())

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            await analyze(data)
            assert mock_text.call_args[1]["max_output_tokens"] == 6144

    @pytest.mark.asyncio
    async def test_four_url_uses_wide_prompt(self):
        data = [
            _sample_extracted("https://a.com"),
            _sample_extracted("https://b.com"),
            _sample_extracted("https://c.com"),
            _sample_extracted("https://d.com"),
        ]
        mock_return = ("result", TokenUsage())

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            await analyze(data)
            called_prompt = mock_text.call_args[0][0]
            assert "高シグナル優先" in called_prompt

    @pytest.mark.asyncio
    async def test_single_url_passes_2560_max_tokens(self):
        data = [_sample_extracted("https://a.com")]
        mock_return = ("result", TokenUsage())

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            await analyze(data)
            assert mock_text.call_args[1]["max_output_tokens"] == 2560

    @pytest.mark.asyncio
    async def test_api_key_forwarded(self):
        data = [_sample_extracted()]
        mock_return = ("result", TokenUsage())

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            await analyze(data, api_key="test-key-123")
            assert mock_text.call_args[1]["api_key"] == "test-key-123"

    @pytest.mark.asyncio
    async def test_model_forwarded(self):
        data = [_sample_extracted()]
        mock_return = ("result", TokenUsage())

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            await analyze(data, model="gemini-2.5-flash")
            assert mock_text.call_args[1]["model"] == "gemini-2.5-flash"


# ---------- multimodal integration ----------

class TestMultimodalIntegration:
    """Tests for screenshot-based multimodal analysis."""

    @pytest.mark.asyncio
    async def test_screenshot_loaded_when_available(self, tmp_path):
        screenshot_file = tmp_path / "screenshot.png"
        screenshot_file.write_bytes(b"fake-png-data")
        data = [_sample_extracted(screenshot_path=str(screenshot_file))]
        mock_return = ("multimodal result", TokenUsage(prompt_tokens=10, completion_tokens=20))

        with patch("web.app.analyzer._call_multimodal_model", new_callable=AsyncMock, return_value=mock_return) as mock_mm:
            result_text, usage = await analyze(data)
            mock_mm.assert_called_once()
            assert mock_mm.call_args[1]["image_data"] == b"fake-png-data"
            assert result_text == "multimodal result"

    @pytest.mark.asyncio
    async def test_fallback_to_text_when_no_screenshot(self):
        data = [_sample_extracted(screenshot_path=None)]
        mock_return = ("text result", TokenUsage())

        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return) as mock_text:
            with patch("web.app.analyzer._call_multimodal_model", new_callable=AsyncMock) as mock_mm:
                result_text, _ = await analyze(data)
                mock_mm.assert_not_called()
                mock_text.assert_called_once()
                assert result_text == "text result"

    @pytest.mark.asyncio
    async def test_fallback_on_multimodal_error(self, tmp_path, caplog):
        screenshot_file = tmp_path / "screenshot.png"
        screenshot_file.write_bytes(b"fake-png-data")
        data = [_sample_extracted(screenshot_path=str(screenshot_file))]
        text_return = ("text fallback", TokenUsage())

        with patch("web.app.analyzer._call_multimodal_model", new_callable=AsyncMock, side_effect=RuntimeError("API error")) as mock_mm:
            with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=text_return) as mock_text:
                with caplog.at_level(logging.WARNING, logger="web.app.analyzer"):
                    result_text, _ = await analyze(data)
                    mock_mm.assert_called_once()
                    mock_text.assert_called_once()
                    assert result_text == "text fallback"
                    assert "Multimodal analysis failed" in caplog.text


# ---------- prompt size log ----------

class TestPromptSizeLog:
    """Tests for prompt size logging in analyze()."""

    @pytest.mark.asyncio
    async def test_single_url_logs_prompt_size(self, caplog):
        data = [_sample_extracted()]
        mock_return = ("result", TokenUsage())
        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return):
            with caplog.at_level(logging.INFO, logger="web.app.analyzer"):
                await analyze(data)
                assert "prompt_size prompt_type=lp site_count=1" in caplog.text
                assert "prompt_chars=" in caplog.text
                assert "has_screenshot=False" in caplog.text

    @pytest.mark.asyncio
    async def test_multi_url_logs_prompt_size(self, caplog):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        mock_return = ("result", TokenUsage())
        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return):
            with caplog.at_level(logging.INFO, logger="web.app.analyzer"):
                await analyze(data)
                assert "prompt_size prompt_type=comparison site_count=2" in caplog.text

    @pytest.mark.asyncio
    async def test_screenshot_flag_true_when_path_set(self, caplog):
        data = [_sample_extracted(screenshot_path="/tmp/fake.png")]
        mock_return = ("result", TokenUsage())
        with patch("web.app.analyzer._call_text_model", new_callable=AsyncMock, return_value=mock_return):
            with caplog.at_level(logging.INFO, logger="web.app.analyzer"):
                await analyze(data)
                assert "has_screenshot=True" in caplog.text


# ---------- data quality annotations (Phase 2 品質改善) ----------

class TestDataQualityAnnotations:
    """Tests for _hero_copy_quality_note and prompt data quality guards."""

    def test_nav_label_hero_gets_note(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(hero_copy="BRAND／ブランド"))
        assert "ナビゲーションラベルの可能性" in prompt

    def test_normal_hero_no_note(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(hero_copy="Transform your business"))
        assert "本文抜粋を参照】" not in prompt

    def test_long_text_with_brand_no_note(self):
        prompt = build_competitive_lp_prompt(_sample_extracted(hero_copy="新ブランド誕生。世界を変えるプロダクト体験。"))
        assert "本文抜粋を参照】" not in prompt

    def test_prompt_has_nav_label_rule(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "【注意】" in prompt

    def test_prompt_has_data_quality_guard(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "データ制限" in prompt


# ---------- Phase 3: CRO quality improvement tests ----------

class TestDeepComparisonCROQuality:
    """Tests for CRO quality improvements in deep comparison prompt."""

    def test_deep_comparison_has_6_section_format(self):
        """Agency-grade 5セクション固定フォーマットが含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "エグゼクティブサマリー" in prompt
        assert "分析対象と比較前提" in prompt
        assert "競合比較サマリー" in prompt
        assert "ブランド別評価" in prompt
        assert "実行プラン" in prompt

    def test_deep_comparison_has_evidence_strength(self):
        """証拠強度ラベルが含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "確認済み" in prompt
        assert "推定" in prompt
        assert "評価保留" in prompt

    def test_deep_comparison_has_heading_safety_rule(self):
        """見出し固定ルールが含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "見出し固定ルール" in prompt
        assert "5セクション" in prompt

    def test_deep_comparison_has_sports_supplement_criteria(self):
        """スポーツサプリ業界観点が含まれる（業界指定時）."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data, discovery_metadata={"industry": "スポーツサプリメント"})
        assert "アンチドーピング" in prompt
        assert "GMP" in prompt

    def test_deep_comparison_has_action_plan_table(self):
        """アクションプランテーブルが含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "根拠フィールド" in prompt
        assert "証拠強度" in prompt


    def test_deep_comparison_has_urgency_elements(self):
        """緊急性要素が競合比較プロンプトに含まれる（販促シグナルまたはフィールド名）."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "販促シグナル" in prompt or "urgency_elements" in prompt

    def test_format_site_data_shows_urgency(self):
        """_format_site_dataに緊急性要素フィールドが表示される."""
        data = _sample_extracted(urgency_elements=["残り5個", "期間限定セール"])
        prompt = build_competitive_lp_prompt(data)
        assert "緊急性要素" in prompt
        assert "残り5個" in prompt

    def test_format_site_data_shows_trust_badges(self):
        """_format_site_dataに信頼バッジフィールドが表示される."""
        data = _sample_extracted(trust_badges=["SSL認証", "ISO 27001"])
        prompt = build_competitive_lp_prompt(data)
        assert "信頼バッジ" in prompt
        assert "SSL認証" in prompt

    def test_format_site_data_shows_guarantees(self):
        """_format_site_dataに保証フィールドが表示される."""
        data = _sample_extracted(guarantees=["30日間返金保証"])
        prompt = build_competitive_lp_prompt(data)
        assert "保証・リスク反転" in prompt
        assert "30日間返金保証" in prompt

    def test_format_site_data_shows_no_urgency_when_empty(self):
        """緊急性要素がない場合「検出なし」が表示される."""
        data = _sample_extracted(urgency_elements=[])
        prompt = build_competitive_lp_prompt(data)
        assert "緊急性要素" in prompt
        assert "検出なし" in prompt


# ---------- Single LP prompt CRO quality ----------

class TestSingleLPCROQuality:
    """Tests for CRO quality improvements in single LP prompt."""

    def test_lp_has_numeric_rubric(self):
        """単体分析にも6軸10点スコアリングが含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "10点満点" in prompt or "1-10" in prompt
        assert "FV訴求力" in prompt
        assert "価格心理学" in prompt

    def test_lp_has_persuasion_framework(self):
        """単体分析にもCialdini 6原理が含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "Cialdini" in prompt
        assert "Authority" in prompt

    def test_lp_has_funnel_analysis(self):
        """単体分析にもAIDCA分析が含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "AIDCA" in prompt
        assert "Attention" in prompt

    def test_lp_has_industry_patterns(self):
        """単体分析にも業界特化分析が含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "業界特化" in prompt
        assert "SaaS" in prompt

    def test_lp_has_cv_improvement_estimate(self):
        """単体分析にも期待CV向上率が含まれる."""
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "期待CV向上率" in prompt


# ==============================================================================
# Follow-up fix tests (レビュー指摘対応)
# ==============================================================================


class TestFollowUpFix1NotesSingleOwner:
    """修正1: 注記・前提条件がちょうど1回しか出ないことを確認."""

    def test_notes_not_in_deep_prompt_sections(self):
        """deep promptのセクション出力に注記・前提条件が含まれない."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "### 6. 注記・前提条件" not in prompt

    def test_notes_not_in_wide_prompt_sections(self):
        """wide promptのセクション出力に注記・前提条件が含まれない."""
        data = [_sample_extracted(f"https://{c}.com") for c in ["a", "b", "c", "d"]]
        prompt = build_wide_comparison_prompt(data)
        assert "### 6. 注記・前提条件" not in prompt


class TestFollowUpFix2CompactFields:
    """修正2: compact formatにoffer_terms/review_signals/shipping_signalsが含まれる."""

    def _compact_prompt(self, **kwargs):
        data = [_sample_extracted("https://a.com", **kwargs), _sample_extracted("https://b.com")]
        return build_deep_comparison_prompt(data)

    def test_offer_terms_in_deep_prompt(self):
        prompt = self._compact_prompt(offer_terms=["初回限定50%OFF"])
        assert "初回限定50%OFF" in prompt

    def test_review_signals_in_deep_prompt(self):
        prompt = self._compact_prompt(review_signals=["★4.5 (120件)"])
        assert "★4.5 (120件)" in prompt

    def test_shipping_signals_in_deep_prompt(self):
        prompt = self._compact_prompt(shipping_signals=["送料無料"])
        assert "送料無料" in prompt

    def test_offer_terms_in_wide_prompt(self):
        data = [
            _sample_extracted(f"https://{c}.com", offer_terms=["定期便20%OFF"])
            for c in ["a", "b", "c", "d"]
        ]
        prompt = build_wide_comparison_prompt(data)
        assert "定期便20%OFF" in prompt

    def test_review_signals_in_wide_prompt(self):
        data = [
            _sample_extracted(f"https://{c}.com", review_signals=["レビュー500件"])
            for c in ["a", "b", "c", "d"]
        ]
        prompt = build_wide_comparison_prompt(data)
        assert "レビュー500件" in prompt


class TestFollowUpFix3WideContract:
    """修正3: wide promptが5セクションcontractに揃っている."""

    def _wide_prompt(self):
        data = [_sample_extracted(f"https://{c}.com") for c in ["a", "b", "c", "d"]]
        return build_wide_comparison_prompt(data)

    def test_wide_has_executive_summary(self):
        assert "エグゼクティブサマリー" in self._wide_prompt()

    def test_wide_has_analysis_targets(self):
        assert "分析対象と比較前提" in self._wide_prompt()

    def test_wide_has_competitive_summary(self):
        assert "競合比較サマリー" in self._wide_prompt()

    def test_wide_has_brand_evaluation(self):
        assert "ブランド別評価" in self._wide_prompt()

    def test_wide_has_action_plan(self):
        assert "実行プラン" in self._wide_prompt()

    def test_wide_no_old_section_names(self):
        """旧セクション名「対象整理」が含まれない."""
        prompt = self._wide_prompt()
        assert "## 対象整理" not in prompt

    def test_wide_uses_kakunin_label(self):
        """「確認済み」ラベルが使用される（旧「高信頼」ではない）."""
        prompt = self._wide_prompt()
        assert "確認済み" in prompt


class TestFollowUpFix5ConsistentTaxonomy:
    """修正5: 証拠強度taxonomyが一貫している."""

    def test_evidence_trace_uses_kakunin(self):
        """_EVIDENCE_TRACE_REQUIREMENTS が「確認済み」を使用."""
        from web.app.analyzer import _EVIDENCE_TRACE_REQUIREMENTS
        assert "確認済み" in _EVIDENCE_TRACE_REQUIREMENTS
        assert "推定" in _EVIDENCE_TRACE_REQUIREMENTS
        assert "評価保留" in _EVIDENCE_TRACE_REQUIREMENTS

    def test_evidence_trace_not_use_strong(self):
        """_EVIDENCE_TRACE_REQUIREMENTS に「強」「弱」の旧taxonomyが含まれない."""
        from web.app.analyzer import _EVIDENCE_TRACE_REQUIREMENTS
        assert "**強**" not in _EVIDENCE_TRACE_REQUIREMENTS
        assert "**中**" not in _EVIDENCE_TRACE_REQUIREMENTS
        assert "**弱**" not in _EVIDENCE_TRACE_REQUIREMENTS


# ---------------------------------------------------------------------------
# Phase 4: 水回りCRO品質改善テスト
# ---------------------------------------------------------------------------


class TestPhase4FormatSiteData:
    """Phase 4 新フィールドが _format_site_data に含まれるか."""

    def test_image_alts_in_prompt(self):
        data = _sample_extracted(image_alts=["TOTO 水栓金具", "最大45%OFF"])
        prompt = build_competitive_lp_prompt(data)
        assert "画像alt" in prompt
        assert "最大45%OFF" in prompt

    def test_banner_texts_in_prompt(self):
        data = _sample_extracted(banner_texts=["売れ筋トップ10"])
        prompt = build_competitive_lp_prompt(data)
        assert "バナー" in prompt
        assert "売れ筋トップ10" in prompt

    def test_contact_paths_in_prompt(self):
        data = _sample_extracted(contact_paths=["お問い合わせ → /contact"])
        prompt = build_competitive_lp_prompt(data)
        assert "お問い合わせ" in prompt
        assert "導線" in prompt

    def test_promo_claims_in_prompt(self):
        data = _sample_extracted(promo_claims=["送料無料（税込5,500円以上）"])
        prompt = build_competitive_lp_prompt(data)
        assert "送料無料" in prompt
        assert "販促訴求" in prompt

    def test_corporate_elements_in_prompt(self):
        data = _sample_extracted(corporate_elements=["正規代理店", "開業から13年の実績"])
        prompt = build_competitive_lp_prompt(data)
        assert "正規代理店" in prompt
        assert "法人" in prompt

    def test_evidence_strength_in_prompt(self):
        data = _sample_extracted()
        prompt = build_competitive_lp_prompt(data)
        assert "証拠強度" in prompt


class TestPhase4SiteTypeRubric:
    """サイト種別別ルーブリックが deep comparison に含まれる."""

    def test_has_site_type_classification(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "正規代理店EC" in prompt
        assert "専門店EC" in prompt
        assert "メーカー" in prompt or "ブランド" in prompt
        assert "サポート" in prompt

    def test_has_site_type_cv_expectations(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "主要CV" in prompt or "CTA" in prompt


class TestPhase4UncertaintyManagement:
    """不確実性管理（証拠強度タグ）がプロンプトに含まれる."""

    def test_has_evidence_tags(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "【確認済み】" in prompt or "【高信頼】" in prompt
        assert "【推定】" in prompt
        assert "評価不能" in prompt or "評価保留" in prompt

    def test_has_pending_rules(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "評価保留" in prompt or "評価不能" in prompt
        assert "低スコア" in prompt or "低評価" in prompt

    def test_single_lp_has_evidence_tags(self):
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "【高信頼】" in prompt
        assert "評価不能" in prompt or "評価保留" in prompt


class TestPhase4DualLayerScoring:
    """二層スコアリング関連のスコア基準がプロンプトに含まれる."""

    def test_has_site_completeness_score(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "サイト完成度" in prompt or "サイト種別" in prompt

    def test_has_ad_receptacle_score(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "獲得対応力" in prompt or "広告受け皿" in prompt

    def test_single_lp_has_dual_layer(self):
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "サイト完成度" in prompt
        assert "広告受け皿" in prompt


class TestPhase4AdOperationActions:
    """実行プラン（広告運用設計レイヤー）がプロンプトに含まれる."""

    def test_has_winning_appeal(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "推奨訴求" in prompt or "勝ち筋" in prompt

    def test_has_avoid_appeal(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "避ける訴求" in prompt or "弱い訴求" in prompt or "負け訴求" in prompt

    def test_has_recommended_query(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "主戦場クエリ" in prompt or "検索クエリ" in prompt or "クエリ意図" in prompt

    def test_has_recommended_landing(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "推奨着地先" in prompt

    def test_has_execution_plan(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "7日" in prompt
        assert "アクション" in prompt

    def test_single_lp_has_ad_actions(self):
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "勝ち訴求" in prompt
        assert "推奨着地先" in prompt
        assert "7日以内施策" in prompt


class TestPhase4WaterIndustryViewpoints:
    """水回り業界特化観点がプロンプトに含まれる."""

    def test_has_water_industry_viewpoints(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        metadata = {
            "input_brand": "example.com",
            "input_brand_url": "https://example.com",
            "industry": "水回り・住宅設備",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt = build_deep_comparison_prompt(data, discovery_metadata=metadata)
        assert "正規品" in prompt or "代理店保証" in prompt
        assert "施工" in prompt
        assert "納期" in prompt
        assert "法人見積" in prompt or "法人" in prompt
        assert "メンテナンス" in prompt

    def test_single_lp_has_water_industry(self):
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "水回り" in prompt or "住宅設備" in prompt


class TestPhase4ImageBannerUtilization:
    """画像・バナー訴求の活用指示がプロンプトに含まれる."""

    def test_deep_has_image_banner_rule(self):
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "画像alt" in prompt
        assert "バナーテキスト" in prompt
        assert "データ不足" in prompt

    def test_single_lp_has_image_banner_rule(self):
        prompt = build_competitive_lp_prompt(_sample_extracted())
        assert "画像alt" in prompt or "バナー" in prompt


# ---------- Phase: Discovery quality review — sports supplement improvements ----------


class TestDiscoveryContext:
    """Tests for discovery metadata context in comparison prompts."""

    def test_deep_has_target_alignment_section(self):
        """分析対象と比較前提セクションが出力に含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "分析対象と比較前提" in prompt

    def test_deep_with_metadata_shows_input_brand(self):
        """Discovery metadataがある場合、入力ブランドが表示される."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        metadata = {
            "input_brand": "saurus.co.jp",
            "input_brand_url": "https://saurus.co.jp",
            "industry": "スポーツサプリメント",
            "discovered_candidates": [
                {"domain": "comp1.com", "title": "Comp 1", "score": 80, "tier": "直競合"},
            ],
            "excluded_candidates": [
                {"domain": "excluded.com", "reason": "excluded.com (品質スコア=0.10)"},
            ],
        }
        prompt = build_deep_comparison_prompt(data, discovery_metadata=metadata)
        assert "saurus.co.jp" in prompt
        assert "入力ブランド" in prompt
        assert "comp1.com" in prompt
        assert "除外候補" in prompt or "品質ゲート" in prompt
        assert "excluded.com" in prompt

    def test_wide_with_metadata_shows_input_brand(self):
        """Wide comparison promptでもDiscovery metadataが含まれる."""
        data = [_sample_extracted(f"https://{c}.com") for c in "abcd"]
        metadata = {
            "input_brand": "saurus.co.jp",
            "input_brand_url": "https://saurus.co.jp",
            "industry": "スポーツサプリメント",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt = build_wide_comparison_prompt(data, discovery_metadata=metadata)
        assert "saurus.co.jp" in prompt
        assert "入力ブランド" in prompt

    def test_no_metadata_still_works(self):
        """metadataなしでも正常動作する."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data, discovery_metadata=None)
        assert "シニアストラテジスト" in prompt


class TestReferenceObservation:
    """Tests for 参考観測枠 (evaluation-pending sites separation)."""

    def test_low_quality_sites_separated(self):
        """品質低サイトは参考観測枠に分離される."""
        normal = _sample_extracted("https://good.com")
        low_quality = _sample_extracted("https://poor.com")
        low_quality._is_low_quality = True
        data = [normal, low_quality]
        prompt = build_deep_comparison_prompt(data)
        assert "参考観測枠" in prompt
        assert "評価保留" in prompt

    def test_no_reference_when_all_quality(self):
        """全サイト品質OKなら参考観測枠は出ない."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        # 参考観測枠のルールセクションは出ないはず
        assert "保留理由" not in prompt or "評価保留ルール" not in prompt

    def test_wide_low_quality_sites_separated(self):
        """Wide promptでも品質低サイトは分離される."""
        sites = [_sample_extracted(f"https://{c}.com") for c in "abcd"]
        sites[2]._is_low_quality = True
        prompt = build_wide_comparison_prompt(sites)
        assert "参考観測枠" in prompt

    def test_main_table_excludes_pending(self):
        """主比較テーブルには評価保留サイトを含めない指示がある."""
        normal = _sample_extracted("https://good.com")
        low_quality = _sample_extracted("https://poor.com")
        low_quality._is_low_quality = True
        prompt = build_deep_comparison_prompt([normal, low_quality])
        assert "参考観測枠" in prompt


class TestEvidenceTraceRequirements:
    """Tests for 根拠トレース requirements in action proposals."""

    def test_deep_has_evidence_field_column(self):
        """Deep comparison promptに根拠フィールド列がある."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "根拠フィールド" in prompt

    def test_deep_has_evidence_strength(self):
        """証拠強度（強/中/弱）がある."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        # Check for the 3-level evidence strength system
        assert "強" in prompt and "弱" in prompt

    def test_deep_has_funnel_stage(self):
        """ファネル段階（認知/興味/検討/確信/行動）がある."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "ファネル段階" in prompt

    def test_wide_has_evidence_trace(self):
        """Wide comparison promptにも根拠トレースがある."""
        data = [_sample_extracted(f"https://{c}.com") for c in "abcd"]
        prompt = build_wide_comparison_prompt(data)
        assert "根拠フィールド" in prompt
        assert "証拠強度" in prompt
        assert "ファネル段階" in prompt


class TestCompetitiveTierInstructions:
    """Tests for competitive tier classification instructions in prompts."""

    def test_deep_has_tier_classification(self):
        """Deep promptに競合層分類指示がある."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "直競合EC" in prompt
        assert "直競合ブランド" in prompt
        assert "ベンチマーク" in prompt

    def test_wide_has_tier_classification(self):
        """Wide promptに競合層分類指示がある."""
        data = [_sample_extracted(f"https://{c}.com") for c in "abcd"]
        prompt = build_wide_comparison_prompt(data)
        assert "直競合EC" in prompt
        assert "直競合ブランド" in prompt
        assert "ベンチマーク" in prompt

    def test_tier_column_in_summary_table(self):
        """総合サマリーテーブルに競合分類列がある."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "競合分類" in prompt


class TestSportsSupplementTemplate:
    """Tests for sports supplement industry template."""

    def test_sports_template_included_when_industry_matches(self):
        """スポーツサプリ業界のとき、固定観点テンプレが含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        metadata = {
            "input_brand": "saurus.co.jp",
            "input_brand_url": "https://saurus.co.jp",
            "industry": "スポーツサプリメント",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt = build_deep_comparison_prompt(data, discovery_metadata=metadata)
        assert "アンチドーピング" in prompt
        assert "GMP" in prompt
        assert "飲みやすさ" in prompt
        assert "定期便" in prompt
        assert "アスリート使用実績" in prompt
        assert "競技者向け" in prompt

    def test_sports_template_not_included_for_other_industries(self):
        """他業界のときはスポーツサプリ固定観点が含まれない."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        metadata = {
            "input_brand": "example.com",
            "input_brand_url": "https://example.com",
            "industry": "水回り・住宅設備",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt = build_deep_comparison_prompt(data, discovery_metadata=metadata)
        assert "アンチドーピング" not in prompt
        assert "アスリート使用実績" not in prompt

    def test_wide_sports_template_included(self):
        """Wide promptでもスポーツサプリテンプレが含まれる."""
        data = [_sample_extracted(f"https://{c}.com") for c in "abcd"]
        metadata = {
            "input_brand": "saurus.co.jp",
            "input_brand_url": "https://saurus.co.jp",
            "industry": "プロテイン・サプリメント",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt = build_wide_comparison_prompt(data, discovery_metadata=metadata)
        assert "アンチドーピング" in prompt

    def test_protein_industry_triggers_template(self):
        """『プロテイン』キーワードでもテンプレが発動する."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        metadata = {
            "input_brand": "x.com",
            "input_brand_url": "https://x.com",
            "industry": "プロテイン通販",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt = build_deep_comparison_prompt(data, discovery_metadata=metadata)
        assert "アンチドーピング" in prompt


class TestAssertionSuppressionRules:
    """Tests for 類推表現の抑制 rules."""

    def test_deep_has_assertion_suppression(self):
        """Deep promptに類推抑制ルールがある."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "類推表現の抑制" in prompt or "限定句" in prompt

    def test_wide_has_assertion_suppression(self):
        """Wide promptに類推抑制ルールがある."""
        data = [_sample_extracted(f"https://{c}.com") for c in "abcd"]
        prompt = build_wide_comparison_prompt(data)
        assert "類推表現の抑制" in prompt or "限定句" in prompt


# ---------- Regression: Fix 1 — Industry template conditional inclusion ----------


class TestIndustryTemplateConditional:
    """水回りテンプレートが業界条件で出し分けされる."""

    def test_water_template_absent_without_metadata(self):
        """metadata なしの場合、水回りテンプレートは含まれない."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        prompt = build_deep_comparison_prompt(data)
        assert "メンテナンス/交換部材" not in prompt

    def test_water_template_present_for_water_industry(self):
        """水回り業界のとき、固定観点テンプレが含まれる."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        metadata = {
            "input_brand": "example.com",
            "input_brand_url": "https://example.com",
            "industry": "キッチン・水回り設備",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt = build_deep_comparison_prompt(data, discovery_metadata=metadata)
        assert "正規品/代理店保証" in prompt
        assert "施工可否" in prompt
        assert "メンテナンス" in prompt

    def test_water_template_absent_for_sports_supplement(self):
        """スポーツサプリ業界では水回りテンプレートが含まれない."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        metadata = {
            "input_brand": "saurus.co.jp",
            "input_brand_url": "https://saurus.co.jp",
            "industry": "スポーツサプリメント",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt = build_deep_comparison_prompt(data, discovery_metadata=metadata)
        assert "メンテナンス/交換部材" not in prompt
        assert "アンチドーピング" in prompt

    def test_wide_water_template_conditional(self):
        """Wide promptでも水回りテンプレは条件付き."""
        data = [_sample_extracted(f"https://{c}.com") for c in "abcd"]
        # No metadata → no water template
        prompt_no_meta = build_wide_comparison_prompt(data)
        assert "代理店保証" not in prompt_no_meta

        # Water industry → water template present
        metadata = {
            "input_brand": "example.com",
            "input_brand_url": "https://example.com",
            "industry": "水栓・バス設備",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt_water = build_wide_comparison_prompt(data, discovery_metadata=metadata)
        assert "代理店保証" in prompt_water

    def test_sports_template_not_included_for_water_industry(self):
        """水回り業界ではスポーツサプリテンプレートが含まれない."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        metadata = {
            "input_brand": "example.com",
            "input_brand_url": "https://example.com",
            "industry": "水回り・住宅設備",
            "discovered_candidates": [],
            "excluded_candidates": [],
        }
        prompt = build_deep_comparison_prompt(data, discovery_metadata=metadata)
        assert "アンチドーピング" not in prompt
        assert "正規品/代理店保証" in prompt


# ---------- Regression: Fix 4 — Discovery context heading collision ----------


class TestDiscoveryContextHeading:
    """Discovery metadataセクションと出力仕様の対象整理が衝突しない."""

    def test_metadata_heading_not_collide_with_output_spec(self):
        """Discoveryメタデータのヘッダーは出力仕様の '## 対象整理' と別名."""
        data = [_sample_extracted("https://a.com"), _sample_extracted("https://b.com")]
        metadata = {
            "input_brand": "saurus.co.jp",
            "input_brand_url": "https://saurus.co.jp",
            "industry": "スポーツサプリメント",
            "discovered_candidates": [
                {"domain": "comp1.com", "title": "Comp 1", "score": 80, "tier": "直競合"},
            ],
            "excluded_candidates": [],
        }
        prompt = build_deep_comparison_prompt(data, discovery_metadata=metadata)
        # Discovery metadata uses different heading
        assert "## Discovery 入力メタデータ" in prompt
        # Output spec requests 分析対象と比較前提
        assert "分析対象と比較前提" in prompt
        # No collision — the old heading should NOT appear
        assert "## 対象整理（Discovery メタデータ）" not in prompt

    def test_metadata_shows_analyzed_targets(self):
        """analyzed_targets があればプロンプトに実分析対象が表示される."""
        from web.app.analyzer import _build_discovery_context_section
        metadata = {
            "input_brand": "example.com",
            "input_brand_url": "https://example.com",
            "industry": "テスト",
            "discovered_candidates": [],
            "excluded_candidates": [],
            "analyzed_targets": [
                {"domain": "example.com", "url": "https://example.com"},
                {"domain": "comp1.com", "url": "https://comp1.com"},
            ],
            "omitted_candidates": [
                {"domain": "comp2.com", "url": "https://comp2.com", "reason": "分析上限超過"},
            ],
        }
        section = _build_discovery_context_section(metadata)
        assert "実分析対象" in section
        assert "comp1.com" in section
        assert "分析対象外" in section
        assert "comp2.com" in section
        assert "分析上限超過" in section
