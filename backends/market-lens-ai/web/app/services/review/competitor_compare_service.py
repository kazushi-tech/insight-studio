"""Competitor compare review service — orchestrates prompt, LLM call, and validation (M5.3)."""

from __future__ import annotations

import logging
from typing import Optional

from ...confidence_tier_validator import validate_and_annotate
from ...deterministic_evaluator import BrandEvaluation
from ...llm_client import call_text_model as _call_text_model
from ...repositories.asset_repository import AssetRepository
from ...schemas.competitor_compare import CompetitorData
from ...schemas.review_result import ReviewResult
from .compare_prompt_builder import build_compare_review_prompt
from .review_output_validator import parse_review_json, validate_review_output

logger = logging.getLogger("market-lens")


def _pseudo_evaluations(competitors: list[CompetitorData]) -> tuple[BrandEvaluation, ...]:
    """Build L5-baseline evaluations for compare competitors.

    CompetitorData only carries url/title/description, so trust-tier signals
    higher than L5 (self-claim) can never be substantiated. We encode that
    as the deterministic baseline so the confidence tier validator's
    L5-only rules apply to compare-context over-reach claims.
    """
    evaluations: list[BrandEvaluation] = []
    for c in competitors:
        label = c.domain or c.url or ""
        evaluations.append(
            BrandEvaluation(
                url=c.url or "",
                brand_label=label,
                trust_tier="L5",
                trust_tier_label="自社訴求・スローガン",
                axis_verdicts=(),
            )
        )
    return tuple(evaluations)


def _log_compare_overreach(
    result: ReviewResult, competitors: list[CompetitorData]
) -> None:
    """Scan Compare review output for over-reach claims and log (warn-only).

    Compare output is structured JSON, so rewriting is deferred to a
    future PR. For now we surface detections in Render logs so quality
    incidents can be tracked without touching the response contract.
    """
    try:
        text_parts: list[str] = [result.summary or ""]
        for p in result.good_points:
            text_parts.extend([p.point, p.reason])
        for p in result.keep_as_is:
            text_parts.extend([p.point, p.reason])
        for p in result.improvements:
            text_parts.extend([p.point, p.reason, p.action])
        for t in result.test_ideas:
            text_parts.extend([t.hypothesis, t.variable, t.expected_impact])
        for r in result.rubric_scores:
            text_parts.append(r.comment)
        if result.positioning_insights:
            for pi in result.positioning_insights:
                text_parts.extend(
                    [
                        pi.dimension,
                        pi.our_position,
                        pi.competitor_position,
                        pi.gap_analysis,
                        pi.recommendation,
                    ]
                )
        text_blob = "\n\n".join(part for part in text_parts if part)
        outcome = validate_and_annotate(
            report_markdown=text_blob,
            brand_evaluations=_pseudo_evaluations(competitors),
            context="compare",
        )
        if not outcome.is_clean:
            for v in outcome.violations:
                logger.warning(
                    "compare_overreach_detected brand=%s tier=%s rule=%s claim=%r",
                    v.brand, v.trust_tier, v.rule_id, v.original_claim,
                )
    except Exception as exc:
        logger.warning("confidence_tier_validator (compare) failed: %s", exc)


class CompareReviewError(Exception):
    """Raised when competitor compare review fails."""


class CompareAssetNotFoundError(CompareReviewError):
    """Raised when asset_id has valid format but asset does not exist."""


async def review_competitor_compare(
    *,
    asset_id: str,
    competitors: list[CompetitorData],
    repo: AssetRepository,
    brand_info: str = "",
    operator_memo: str = "",
    model: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
) -> ReviewResult:
    """Run a competitor compare review and return validated structured result."""
    try:
        meta = repo.load_metadata(asset_id)
    except ValueError as e:
        raise CompareReviewError(f"Invalid asset_id format: {asset_id}") from e
    if meta is None:
        raise CompareAssetNotFoundError(f"Asset not found: {asset_id}")

    prompt = build_compare_review_prompt(
        asset_file_name=meta.file_name,
        asset_width=meta.width,
        asset_height=meta.height,
        competitors=competitors,
        brand_info=brand_info,
        operator_memo=operator_memo,
    )

    raw_text, _usage = await _call_text_model(
        prompt,
        provider=provider,
        model=model,
        api_key=api_key,
    )

    data, parse_err = parse_review_json(raw_text)
    if parse_err or data is None:
        raise CompareReviewError(f"LLM output parse failed: {parse_err}")

    report = validate_review_output(data)
    if not report.valid:
        errors = "; ".join(i.message for i in report.issues if i.severity == "error")
        raise CompareReviewError(f"Review output validation failed: {errors}")

    result = ReviewResult(**data)
    _log_compare_overreach(result, competitors)
    return result
