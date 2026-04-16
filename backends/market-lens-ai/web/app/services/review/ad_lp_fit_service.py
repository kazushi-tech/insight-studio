"""Ad-to-LP fit review service — evaluates message match between ad and LP."""

from __future__ import annotations

import logging
import re
from typing import Optional

_ASSET_ID_RE = re.compile(r"^[0-9a-f]{12}$")

from ...llm_client import call_multimodal_model as _call_multimodal_model
from ...llm_client import call_text_model as _call_text_model
from ...repositories.asset_repository import AssetRepository
from ...schemas.review_request import LandingPageInput
from ...schemas.review_result import ReviewResult
from ..intake.landing_page_capture_service import capture_landing_page
from .commentary_guardrail import check_commentary_guardrails
from .evidence_grounding_service import validate_evidence_grounding
from .review_output_validator import parse_review_json, validate_review_output
from .review_prompt_builder import build_ad_lp_review_prompt

# Max retries for LLM output parse failures
_MAX_PARSE_RETRIES = 2
_REVIEW_MAX_OUTPUT_TOKENS = 2500
_LP_CAPTURE_TIMEOUT_SEC = 20.0  # 日本ECサイト対応
_LP_CAPTURE_MAX_RETRIES = 2

logger = logging.getLogger("market-lens")


class AdLpReviewError(Exception):
    """Raised when ad-to-LP review fails."""


class AdLpAssetNotFoundError(AdLpReviewError):
    """Raised when asset_id has valid format but asset does not exist."""


async def review_ad_lp_fit(
    *,
    asset_id: str,
    landing_page: LandingPageInput,
    repo: AssetRepository,
    brand_info: str = "",
    operator_memo: str = "",
    model: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
) -> ReviewResult:
    """Run an ad-to-LP fit review and return validated structured result."""
    if not _ASSET_ID_RE.match(asset_id):
        raise AdLpReviewError(f"Invalid asset_id format: {asset_id}")
    try:
        meta = repo.load_metadata(asset_id)
    except ValueError as e:
        raise AdLpReviewError(f"Invalid asset_id format: {asset_id}") from e
    if meta is None:
        raise AdLpAssetNotFoundError(f"Asset not found: {asset_id}")

    # Load image data for multimodal review
    image_data = repo.load_data(asset_id)

    # Server-side LP capture: if LP data is URL-only, fetch structured data
    if landing_page.url and not landing_page.title and not landing_page.first_view_text:
        logger.info("LP data is URL-only — running server-side capture for %s", landing_page.url)
        capture_result = await capture_landing_page(
            landing_page.url,
            fetch_timeout=_LP_CAPTURE_TIMEOUT_SEC,
            fetch_max_retries=_LP_CAPTURE_MAX_RETRIES,
        )
        if capture_result.error:
            raise AdLpReviewError(
                f"LP capture failed for {landing_page.url}: {capture_result.error}"
            )
        landing_page = capture_result.landing_page

    prompt = build_ad_lp_review_prompt(
        asset_file_name=meta.file_name,
        asset_width=meta.width,
        asset_height=meta.height,
        landing_page=landing_page,
        brand_info=brand_info,
        operator_memo=operator_memo,
    )

    parse_err: str | None = None
    data: dict | None = None

    for parse_attempt in range(_MAX_PARSE_RETRIES + 1):
        call_prompt = prompt
        if parse_attempt > 0 and parse_err:
            call_prompt = (
                prompt
                + "\n\n## 前回のエラー（必ず修正すること）\n"
                + parse_err
                + "\n必ず有効なJSONのみを返してください。マークダウンフェンスや説明文は不要です。"
            )
            logger.info("Retrying ad-LP LLM call (parse attempt %d) after parse error", parse_attempt + 1)

        if image_data is not None:
            try:
                raw_text, _usage = await _call_multimodal_model(
                    call_prompt,
                    image_data=image_data,
                    mime_type=meta.mime_type or "image/png",
                    provider=provider,
                    model=model,
                    max_output_tokens=_REVIEW_MAX_OUTPUT_TOKENS,
                    api_key=api_key,
                )
            except Exception as multimodal_exc:
                exc_detail = str(multimodal_exc)
                logger.warning(
                    "Multimodal call failed for asset %s (%s): %s — falling back to text-only",
                    asset_id, type(multimodal_exc).__name__, exc_detail,
                )
                image_error_markers = (
                    "could not process",
                    "invalid image",
                    "image too large",
                    "unsupported image",
                    "unable to process image",
                )
                if any(marker in exc_detail.lower() for marker in image_error_markers):
                    raise AdLpReviewError(
                        f"画像の処理に失敗しました (asset_id={asset_id}, "
                        f"mime_type={meta.mime_type}): {exc_detail[:200]}"
                    ) from multimodal_exc
                raw_text, _usage = await _call_text_model(
                    call_prompt,
                    provider=provider,
                    model=model,
                    max_output_tokens=_REVIEW_MAX_OUTPUT_TOKENS,
                    api_key=api_key,
                )
        else:
            raw_text, _usage = await _call_text_model(
                call_prompt,
                provider=provider,
                model=model,
                max_output_tokens=_REVIEW_MAX_OUTPUT_TOKENS,
                api_key=api_key,
            )

        data, parse_err = parse_review_json(raw_text)
        if data is not None and parse_err is None:
            break
        logger.warning("Ad-LP LLM output parse failed (attempt %d): %s", parse_attempt + 1, parse_err)

    if parse_err or data is None:
        raise AdLpReviewError(f"LLM output parse failed: {parse_err}")

    report = validate_review_output(data)
    if not report.valid:
        errors = "; ".join(i.message for i in report.issues if i.severity == "error")
        raise AdLpReviewError(f"Review output validation failed: {errors}")

    result = ReviewResult(**data)

    # Evidence grounding check
    grounding = validate_evidence_grounding(result)
    if not grounding.valid:
        errors = "; ".join(i.message for i in grounding.issues if i.severity == "error")
        raise AdLpReviewError(f"Evidence grounding violation: {errors}")

    # Commentary guardrail check
    guardrail = check_commentary_guardrails(result)
    if not guardrail.clean:
        violations = "; ".join(
            f"{v.category}: '{v.matched_text}' in {v.field}"
            for v in guardrail.violations
            if v.severity == "error"
        )
        raise AdLpReviewError(f"Commentary guardrail violation: {violations}")

    return result
