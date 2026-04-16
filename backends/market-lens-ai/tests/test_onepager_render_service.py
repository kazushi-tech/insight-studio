"""Tests for one-pager HTML render service."""

from __future__ import annotations

import pytest

from web.app.schemas.review_result import (
    EvidenceItem,
    EvidenceType,
    ImprovementPoint,
    ReviewPoint,
    ReviewResult,
    RubricScore,
    TestIdea,
)
from web.app.services.exports.onepager_render_service import render_onepager_html


def _make_review() -> ReviewResult:
    return ReviewResult(
        review_type="banner_review",
        summary="ECセールバナーとして基本的な訴求力を備えている",
        good_points=[
            ReviewPoint(point="50%OFFの数字訴求が目立つ", reason="赤背景に白文字で視認しやすい"),
        ],
        keep_as_is=[
            ReviewPoint(point="ブランドカラーの統一感", reason="ガイドラインに沿っている"),
        ],
        improvements=[
            ImprovementPoint(
                point="CTAボタンが小さい", reason="CTAが目立たない", action="CTAを20%拡大する",
            ),
        ],
        test_ideas=[
            TestIdea(
                hypothesis="CTA文言変更でCTR向上", variable="CTAテキスト",
                expected_impact="CTR 5-10%向上",
            ),
        ],
        evidence=[
            EvidenceItem(
                evidence_type=EvidenceType.client_material,
                evidence_source="ブランドガイドライン v2.1",
                evidence_text="メインカラーは赤",
            ),
        ],
        target_hypothesis="20-40代女性",
        message_angle="期間限定値引き訴求",
        rubric_scores=[
            RubricScore(rubric_id="hook_strength", score=4, comment="数字が目を引く"),
        ],
    )


class TestRenderOnepagerHtml:
    def test_returns_html_string(self):
        html = render_onepager_html(_make_review())
        assert isinstance(html, str)
        assert html.startswith("<!DOCTYPE html>")

    def test_contains_title(self):
        html = render_onepager_html(_make_review(), title="テストタイトル")
        assert "テストタイトル" in html

    def test_contains_subtitle(self):
        html = render_onepager_html(_make_review(), subtitle="テストブランド")
        assert "テストブランド" in html

    def test_contains_review_date(self):
        html = render_onepager_html(_make_review(), review_date="2026-03-22")
        assert "2026-03-22" in html

    def test_contains_summary(self):
        html = render_onepager_html(_make_review())
        assert "基本的な訴求力を備えている" in html

    def test_contains_good_points(self):
        html = render_onepager_html(_make_review())
        assert "50%OFFの数字訴求が目立つ" in html
        assert "良い点" in html

    def test_contains_keep_as_is(self):
        html = render_onepager_html(_make_review())
        assert "ブランドカラーの統一感" in html
        assert "守るべき点" in html

    def test_contains_improvements(self):
        html = render_onepager_html(_make_review())
        assert "CTAボタンが小さい" in html
        assert "改善提案" in html
        assert "CTAを20%拡大する" in html

    def test_contains_test_ideas(self):
        html = render_onepager_html(_make_review())
        assert "CTA文言変更でCTR向上" in html
        assert "次に試すテスト案" in html

    def test_contains_evidence(self):
        html = render_onepager_html(_make_review())
        assert "ブランドガイドライン v2.1" in html
        assert "根拠" in html

    def test_html_escapes_special_chars(self):
        review = _make_review()
        review.summary = 'テスト<script>alert("xss")</script>'
        html = render_onepager_html(review)
        assert "<script>" not in html
        assert "&lt;script&gt;" in html

    def test_no_section_missing(self):
        html = render_onepager_html(_make_review())
        assert "良い点" in html
        assert "守るべき点" in html
        assert "改善提案" in html
        assert "次に試すテスト案" in html
        assert "根拠" in html
