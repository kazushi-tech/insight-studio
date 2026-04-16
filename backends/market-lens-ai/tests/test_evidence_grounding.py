"""Tests for evidence grounding service and commentary guardrail."""

from __future__ import annotations

import pytest

from web.app.schemas.review_result import (
    EvidenceItem,
    ImprovementPoint,
    ReviewPoint,
    ReviewResult,
    RubricScore,
    TestIdea,
)
from web.app.services.review.commentary_guardrail import check_commentary_guardrails
from web.app.services.review.evidence_grounding_service import (
    validate_evidence_grounding,
)


def _make_review(**overrides) -> ReviewResult:
    """Build a minimal valid ReviewResult for testing."""
    defaults = dict(
        review_type="banner_review",
        summary="テスト用レビュー要約",
        good_points=[ReviewPoint(point="良い点A", reason="理由A")],
        keep_as_is=[ReviewPoint(point="維持点A", reason="理由A")],
        improvements=[ImprovementPoint(point="改善点A", reason="理由A", action="アクションA")],
        test_ideas=[TestIdea(hypothesis="仮説A", variable="変数A", expected_impact="CTR向上が期待できる（仮説）")],
        evidence=[EvidenceItem(
            evidence_type="client_material",
            evidence_source="ブランドガイドライン v2.1",
            evidence_text="メインカラーは赤",
        )],
        target_hypothesis="20-40代女性",
        message_angle="お得感訴求",
        rubric_scores=[RubricScore(rubric_id="hook_strength", score=4, comment="目を引く")],
    )
    defaults.update(overrides)
    return ReviewResult(**defaults)


# -- Evidence Grounding Tests -------------------------------------------------

class TestEvidenceGrounding:
    def test_valid_evidence_passes(self):
        result = _make_review()
        report = validate_evidence_grounding(result)
        assert report.valid is True

    def test_empty_evidence_blocked_by_schema(self):
        """Empty evidence is caught by Pydantic min_length=1 before reaching grounding."""
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            _make_review(evidence=[])

    def test_vague_source_fails(self):
        result = _make_review(
            evidence=[EvidenceItem(
                evidence_type="client_material",
                evidence_source="一般的にバナーはこう作る",
                evidence_text="テスト",
            )]
        )
        report = validate_evidence_grounding(result)
        assert report.valid is False
        assert any("一般的に" in i.message for i in report.issues)

    def test_multiple_vague_patterns_detected(self):
        result = _make_review(
            evidence=[
                EvidenceItem(
                    evidence_type="platform_guideline",
                    evidence_source="業界ではこれが普通は使われる",
                    evidence_text="テスト",
                )
            ]
        )
        report = validate_evidence_grounding(result)
        assert report.valid is False
        vague_issues = [i for i in report.issues if "Vague" in i.message]
        assert len(vague_issues) >= 1

    def test_brief_source_gives_info(self):
        result = _make_review(
            evidence=[EvidenceItem(
                evidence_type="client_material",
                evidence_source="doc",
                evidence_text="テスト内容",
            )]
        )
        report = validate_evidence_grounding(result)
        assert report.valid is True  # info doesn't break validity
        info_issues = [i for i in report.issues if i.severity == "info"]
        assert len(info_issues) >= 1


# -- Commentary Guardrail Tests -----------------------------------------------

class TestCommentaryGuardrail:
    def test_clean_review_passes(self):
        result = _make_review()
        report = check_commentary_guardrails(result)
        assert report.clean is True
        assert len(report.violations) == 0

    def test_forbidden_effect_assertion(self):
        result = _make_review(
            improvements=[ImprovementPoint(
                point="CTA変更",
                reason="必ず効果が出るので変更すべき",
                action="変更する",
            )]
        )
        report = check_commentary_guardrails(result)
        assert report.clean is False
        assert any(v.category == "効果の断定" for v in report.violations)

    def test_forbidden_cvr_assertion(self):
        result = _make_review(
            test_ideas=[TestIdea(
                hypothesis="色を変える",
                variable="背景色",
                expected_impact="CVR が上がります",
            )]
        )
        report = check_commentary_guardrails(result)
        assert report.clean is False

    def test_forbidden_industry_common_sense(self):
        result = _make_review(
            rubric_scores=[RubricScore(
                rubric_id="hook_strength",
                score=3,
                comment="業界では赤が常識です",
            )]
        )
        report = check_commentary_guardrails(result)
        assert report.clean is False
        assert any(v.category == "未確認の業界常識" for v in report.violations)

    def test_destructive_commentary_rejected(self):
        result = _make_review(
            summary="このバナーは最悪の出来栄えです"
        )
        report = check_commentary_guardrails(result)
        assert report.clean is False
        assert any(v.category == "全否定表現" for v in report.violations)

    def test_destructive_amateur_insult(self):
        result = _make_review(
            rubric_scores=[RubricScore(
                rubric_id="visual_flow",
                score=1,
                comment="素人が作ったようなレイアウト",
            )]
        )
        report = check_commentary_guardrails(result)
        assert report.clean is False
        assert any(v.category == "侮辱的表現" for v in report.violations)

    def test_hypothesis_expression_passes(self):
        """仮説表現は OK — 「期待できる」「可能性がある」等."""
        result = _make_review(
            test_ideas=[TestIdea(
                hypothesis="CTA色を変更する",
                variable="CTAカラー",
                expected_impact="CTR向上が期待できる（仮説）",
            )]
        )
        report = check_commentary_guardrails(result)
        assert report.clean is True

    def test_competitor_copy_rejected(self):
        result = _make_review(
            improvements=[ImprovementPoint(
                point="競合デザイン参考",
                reason="競合Aのようにそのままコピーすれば良い",
                action="コピーする",
            )]
        )
        report = check_commentary_guardrails(result)
        assert report.clean is False
        assert any(v.category == "競合表現の転用" for v in report.violations)
