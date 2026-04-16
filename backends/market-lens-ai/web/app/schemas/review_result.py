"""Review result schemas — matches review-output.schema.json contract."""

from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

# Item-level non-blank constraint (canonical: minLength: 1 per item string)
_NonBlank = Annotated[str, StringConstraints(min_length=1)]


class EvidenceType(str, Enum):
    client_material = "client_material"
    approved_proposal = "approved_proposal"
    winning_creative = "winning_creative"
    competitor_public = "competitor_public"
    platform_guideline = "platform_guideline"


class ReviewPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    point: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ImprovementPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    point: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    action: str = Field(min_length=1)


class TestIdea(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hypothesis: str = Field(min_length=1)
    variable: str = Field(min_length=1)
    expected_impact: str = Field(min_length=1)


class EvidenceItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_type: EvidenceType
    evidence_source: str = Field(min_length=1)
    evidence_text: str = Field(min_length=1)


class RubricScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rubric_id: str = Field(min_length=1)
    score: Optional[int] = Field(default=None, ge=1, le=5)
    comment: str = Field(min_length=1)


# -- One-Pager section models (one-pager-schema.json) -----------------------
# Strict alignment: required fields, format: date, extra="forbid", item min_length


class OnePagerHeader(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1)
    subtitle: str  # required (canonical: required + no minLength)
    review_date: date  # canonical: format: date (YYYY-MM-DD)


class OnePagerTextSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heading: str  # required (canonical: required)
    items: list[_NonBlank] = Field(min_length=1)  # each item minLength: 1


class OnePagerImprovementItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    point: str = Field(min_length=1)
    action: str = Field(min_length=1)


class OnePagerImprovementSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heading: str  # required
    items: list[OnePagerImprovementItem] = Field(min_length=1)


class OnePagerTestIdeaItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hypothesis: str = Field(min_length=1)
    variable: str = Field(min_length=1)


class OnePagerTestIdeasSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heading: str  # required
    items: list[OnePagerTestIdeaItem] = Field(min_length=1)


class OnePagerEvidenceItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidence_type: EvidenceType
    evidence_source: str = Field(min_length=1)


class OnePagerEvidenceSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heading: str  # required
    items: list[OnePagerEvidenceItem] = Field(min_length=1)


class OnePagerSections(BaseModel):
    """One-pager sections — matches one-pager-schema.json contract (strict)."""

    model_config = ConfigDict(extra="forbid")

    header: OnePagerHeader
    good_points: OnePagerTextSection
    keep_as_is: OnePagerTextSection
    improvements: OnePagerImprovementSection
    test_ideas: OnePagerTestIdeasSection
    evidence_sources: OnePagerEvidenceSection


class CategoryContext(BaseModel):
    """Industry category context inferred from ad creative."""

    model_config = ConfigDict(extra="forbid")

    inferred_category: str = Field(min_length=1)
    observations: list[str] = Field(min_length=1)


class ValuePropositionAnalysis(BaseModel):
    """Price/incentive value proposition analysis (conditional)."""

    model_config = ConfigDict(extra="forbid")

    purchase_threshold: str = Field(min_length=1)
    incentive: str = Field(min_length=1)
    perceived_value_assessment: str = Field(min_length=1)
    communication_clarity: str = Field(min_length=1)


class PositioningInsight(BaseModel):
    """Competitor positioning insight for compare reviews (M5.3)."""

    model_config = ConfigDict(extra="forbid")

    dimension: str = Field(min_length=1)
    our_position: str = Field(min_length=1)
    competitor_position: str = Field(min_length=1)
    gap_analysis: str = Field(min_length=1)
    recommendation: str = Field(min_length=1)


class VisibleTextElement(BaseModel):
    """Text element extracted from the banner image for faithful reproduction."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["headline", "sub_copy", "cta", "price", "note", "brand_name"] = Field(...)
    text: str = Field(min_length=1)  # 正確なテキスト文字列
    approximate_position: str = Field(default="")  # top-left, center, bottom-right 等


class ReviewResult(BaseModel):
    """Structured review output — contract-aligned with review-output.schema.json."""

    model_config = ConfigDict(extra="forbid")

    review_type: str = Field(pattern=r"^(banner_review|ad_lp_review|competitor_compare)$")
    summary: str = Field(min_length=1)
    product_identification: str = Field(default="", description="画像から特定された製品・ブランド")
    good_points: list[ReviewPoint] = Field(min_length=1)
    keep_as_is: list[ReviewPoint] = Field(default_factory=list)
    improvements: list[ImprovementPoint] = Field(min_length=1)
    test_ideas: list[TestIdea] = Field(default_factory=list, max_length=5)
    evidence: list[EvidenceItem] = Field(min_length=1)
    target_hypothesis: str = Field(min_length=1)
    message_angle: str = Field(min_length=1)
    rubric_scores: list[RubricScore] = Field(min_length=1)
    one_pager_sections: Optional[OnePagerSections] = Field(
        None, description="1枚資料用セクション（任意）"
    )
    positioning_insights: Optional[list[PositioningInsight]] = Field(
        None, description="競合比較ポジショニング分析（competitor_compare時）"
    )
    visible_text_elements: list[VisibleTextElement] = Field(
        default_factory=list, description="画像から抽出されたテキスト要素（バナー生成時のテキスト保持用）"
    )
    category_context: Optional[CategoryContext] = Field(
        None, description="業界カテゴリコンテキスト（推定）"
    )
    value_proposition_analysis: Optional[ValuePropositionAnalysis] = Field(
        None, description="価格・インセンティブ分析（条件付き）"
    )
