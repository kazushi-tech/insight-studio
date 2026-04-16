"""Tests for generation prompt builder (M5.7)."""

from __future__ import annotations

from web.app.schemas.review_result import ReviewResult
from web.app.services.generation.gen_prompt_builder import build_banner_gen_prompt


_BASE_REVIEW_DATA = {
    "review_type": "banner_review",
    "summary": "Test",
    "good_points": [{"point": "Strong color", "reason": "R"}],
    "keep_as_is": [{"point": "K", "reason": "R"}],
    "improvements": [{"point": "CTA weak", "reason": "R", "action": "Make CTA larger"}],
    "test_ideas": [{"hypothesis": "H", "variable": "V", "expected_impact": "E"}],
    "evidence": [{"evidence_type": "competitor_public", "evidence_source": "s", "evidence_text": "t"}],
    "target_hypothesis": "Young professionals",
    "message_angle": "Value proposition",
    "rubric_scores": [{"rubric_id": "visual_impact", "score": 4, "comment": "Good"}],
}


def _mock_review(**overrides):
    data = {**_BASE_REVIEW_DATA, **overrides}
    return ReviewResult(**data)


class TestBuildBannerGenPrompt:
    def test_contains_improvements(self):
        prompt = build_banner_gen_prompt(review_result=_mock_review())
        assert "CTA weak" in prompt
        assert "Make CTA larger" in prompt

    def test_contains_good_points(self):
        prompt = build_banner_gen_prompt(review_result=_mock_review())
        assert "Strong color" in prompt

    def test_contains_target(self):
        prompt = build_banner_gen_prompt(review_result=_mock_review())
        assert "Young professionals" in prompt

    def test_contains_message_angle(self):
        prompt = build_banner_gen_prompt(review_result=_mock_review())
        assert "Value proposition" in prompt

    def test_style_guidance_appended(self):
        prompt = build_banner_gen_prompt(
            review_result=_mock_review(),
            style_guidance="Minimalist design",
        )
        assert "Minimalist design" in prompt

    def test_no_style_guidance(self):
        prompt = build_banner_gen_prompt(review_result=_mock_review())
        assert "スタイルガイダンス" not in prompt

    def test_text_elements_included_in_prompt(self):
        review = _mock_review(visible_text_elements=[
            {"role": "headline", "text": "春のセール", "approximate_position": "top-center"},
            {"role": "cta", "text": "今すぐ購入", "approximate_position": "bottom-right"},
        ])
        prompt = build_banner_gen_prompt(review_result=review)
        assert "最重要: テキスト要素の完全保持" in prompt
        assert "春のセール" in prompt
        assert "今すぐ購入" in prompt
        assert "（top-center）" in prompt

    def test_text_elements_empty_uses_fallback(self):
        review = _mock_review(visible_text_elements=[])
        prompt = build_banner_gen_prompt(review_result=review)
        assert "テキスト要素について" in prompt
        assert "最重要: テキスト要素の完全保持" not in prompt

    def test_text_elements_empty_position_no_parens(self):
        review = _mock_review(visible_text_elements=[
            {"role": "headline", "text": "見出し", "approximate_position": ""},
        ])
        prompt = build_banner_gen_prompt(review_result=review)
        assert "【headline】「見出し」" in prompt
        assert "（）" not in prompt

    def test_text_elements_with_position_has_parens(self):
        review = _mock_review(visible_text_elements=[
            {"role": "price", "text": "¥1,980", "approximate_position": "center"},
        ])
        prompt = build_banner_gen_prompt(review_result=review)
        assert "（center）" in prompt
