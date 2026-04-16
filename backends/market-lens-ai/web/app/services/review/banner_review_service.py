"""Banner review service — orchestrates prompt, LLM call, and validation."""

from __future__ import annotations

import logging
import re
from typing import Optional

_ASSET_ID_RE = re.compile(r"^[0-9a-f]{12}$")

from ...llm_client import call_multimodal_model as _call_multimodal_model
from ...llm_client import call_text_model as _call_text_model
from ...repositories.asset_repository import AssetRepository
from ...schemas.review_result import ReviewResult
from .commentary_guardrail import check_commentary_guardrails
from .evidence_grounding_service import validate_evidence_grounding
from .review_output_validator import parse_review_json, validate_review_output
from .review_prompt_builder import build_banner_review_prompt

# Max retries for evidence grounding violations
_MAX_GROUNDING_RETRIES = 1
# Max retries for LLM output parse failures
_MAX_PARSE_RETRIES = 2
_REVIEW_MAX_OUTPUT_TOKENS = 2200

logger = logging.getLogger("market-lens")


class BannerReviewError(Exception):
    """Raised when banner review fails."""


class AssetNotFoundError(BannerReviewError):
    """Raised when asset_id has valid format but asset does not exist."""


async def review_banner(
    *,
    asset_id: str,
    repo: AssetRepository,
    brand_info: str = "",
    operator_memo: str = "",
    model: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
) -> ReviewResult:
    """Run a banner review and return validated structured result."""
    if not _ASSET_ID_RE.match(asset_id):
        raise BannerReviewError(f"Invalid asset_id format: {asset_id}")
    try:
        meta = repo.load_metadata(asset_id)
    except ValueError as e:
        raise BannerReviewError(f"Invalid asset_id format: {asset_id}") from e
    if meta is None:
        raise AssetNotFoundError(f"Asset not found: {asset_id}")

    base_prompt = build_banner_review_prompt(
        asset_file_name=meta.file_name,
        asset_width=meta.width,
        asset_height=meta.height,
        brand_info=brand_info,
        operator_memo=operator_memo,
    )

    # Load image data for multimodal review
    image_data = repo.load_data(asset_id)

    grounding_error_msg: str | None = None

    for attempt in range(_MAX_GROUNDING_RETRIES + 1):
        # On retry, append the grounding error to the prompt so the LLM can self-correct
        if grounding_error_msg:
            prompt = (
                base_prompt
                + "\n\n## 前回のエラー（必ず修正すること）\n"
                + grounding_error_msg
                + "\nevidence_source から禁止語句を除去し、具体的なソース名に置き換えてください。"
            )
            logger.info("Retrying banner review (attempt %d) after grounding violation", attempt + 1)
        else:
            prompt = base_prompt

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
                logger.info("Retrying LLM call (parse attempt %d) after parse error", parse_attempt + 1)

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
                        raise BannerReviewError(
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
            logger.warning("LLM output parse failed (attempt %d): %s", parse_attempt + 1, parse_err)

        if parse_err or data is None:
            raise BannerReviewError(f"LLM output parse failed: {parse_err}")

        report = validate_review_output(data)
        if not report.valid:
            errors = "; ".join(i.message for i in report.issues if i.severity == "error")
            raise BannerReviewError(f"Review output validation failed: {errors}")

        result = ReviewResult(**data)

        # Evidence grounding check — retry once if violated
        grounding = validate_evidence_grounding(result)
        if not grounding.valid:
            errors = "; ".join(i.message for i in grounding.issues if i.severity == "error")
            if attempt < _MAX_GROUNDING_RETRIES:
                grounding_error_msg = errors
                continue
            raise BannerReviewError(f"Evidence grounding violation: {errors}")

        # Commentary guardrail check
        guardrail = check_commentary_guardrails(result)
        if not guardrail.clean:
            violations = "; ".join(
                f"{v.category}: '{v.matched_text}' in {v.field}"
                for v in guardrail.violations
                if v.severity == "error"
            )
            raise BannerReviewError(f"Commentary guardrail violation: {violations}")

        return result

    # Should not reach here, but just in case
    raise BannerReviewError("Banner review failed after retries")
