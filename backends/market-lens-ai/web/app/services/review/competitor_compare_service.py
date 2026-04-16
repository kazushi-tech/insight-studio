"""Competitor compare review service — orchestrates prompt, LLM call, and validation (M5.3)."""

from __future__ import annotations

import logging
from typing import Optional

from ...llm_client import call_text_model as _call_text_model
from ...repositories.asset_repository import AssetRepository
from ...schemas.competitor_compare import CompetitorData
from ...schemas.review_result import ReviewResult
from .compare_prompt_builder import build_compare_review_prompt
from .review_output_validator import parse_review_json, validate_review_output

logger = logging.getLogger("market-lens")


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
    return result
