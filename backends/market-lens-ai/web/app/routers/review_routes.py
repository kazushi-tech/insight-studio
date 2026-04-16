"""Review routes — banner review and ad-to-LP review endpoints."""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..repositories.asset_repository import AssetRepository
from ..repositories.creative_review_repository import (
    CreativeReviewRepository,
    CreativeReviewRun,
    ReviewOutput,
    RunStatus,
    _now,
)
from ..schemas.competitor_compare import CompareReviewRequest
from ..schemas.review_request import AdLpReviewRequest, BannerReviewRequest
from ..schemas.review_result import ReviewResult
from ..services.review.ad_lp_fit_service import (
    AdLpAssetNotFoundError,
    AdLpReviewError,
    review_ad_lp_fit,
)
from ..services.review.banner_review_service import (
    AssetNotFoundError,
    BannerReviewError,
    review_banner,
)
from ..services.review.competitor_compare_service import (
    CompareAssetNotFoundError,
    CompareReviewError,
    review_competitor_compare,
)
from ..smoke_mode import is_smoke_mode, smoke_banner_review, smoke_ad_lp_review


# -- Response models for OpenAPI contract ----------------------------------

class ReviewSubmissionResponse(BaseModel):
    """POST review response envelope — run_id + review payload."""

    run_id: Optional[str] = Field(
        None,
        description="Persisted run ID (null when persistence is disabled)",
    )
    review: ReviewResult = Field(
        ...,
        description="Review output conforming to review-output.schema.json",
    )


class StoredReviewResponse(BaseModel):
    """GET review response — persisted review retrieval payload."""

    run_id: str = Field(..., description="Review run ID")
    review_type: Optional[str] = Field(None, description="banner_review | ad_lp_review")
    status: Optional[str] = Field(None, description="Run status")
    created_at: Optional[str] = Field(None, description="ISO 8601 timestamp")
    output: ReviewResult = Field(..., description="Review output JSON")

logger = logging.getLogger("market-lens")

_REVIEW_ID_RE = re.compile(r"^[0-9a-f]{12}$")


def _classify_review_runtime_error(error_msg: str) -> tuple[int, str]:
    """Classify RuntimeError from LLM providers into HTTP status + user-facing detail."""
    normalized = error_msg.lower()

    # Auth / API key errors → 401
    if "api key" in normalized or "x-api-key" in normalized or "authentication" in normalized:
        return 401, f"AI プロバイダーの API キーが無効か、権限が不足しています。[{error_msg[:200]}]"

    # Rate limit → 502 (retryable)
    if "rate limit" in normalized or "too_many_requests" in normalized:
        return 502, f"AI プロバイダーのレート制限に達しました。少し待って再試行してください。[{error_msg[:200]}]"

    # Overloaded → 502 (retryable)
    if "overloaded" in normalized:
        return 502, f"AI プロバイダーが過負荷状態です。少し待って再試行してください。[{error_msg[:200]}]"

    # Credit / billing → 402
    if "credit" in normalized or "balance" in normalized or "billing" in normalized:
        return 402, f"AI プロバイダーのクレジット残高または請求設定を確認してください。[{error_msg[:200]}]"

    # Model issues → 422
    if "model" in normalized and any(
        kw in normalized
        for kw in ("not found", "invalid", "access", "available", "unsupported")
    ):
        return 422, f"AI モデル設定を確認してください。[{error_msg[:200]}]"

    # Timeout → 504
    if "timeout" in normalized or "timed out" in normalized:
        return 504, f"AI プロバイダーへの接続がタイムアウトしました。再試行してください。[{error_msg[:200]}]"

    # Connection error → 502 (retryable)
    if "connection" in normalized or "connect" in normalized:
        return 502, f"AI プロバイダーへの接続に失敗しました。再試行してください。[{error_msg[:200]}]"

    # Generic fallback → 502
    return 502, f"Review provider error: {error_msg[:240]}"


def create_review_router(
    repo: AssetRepository,
    review_repo: CreativeReviewRepository | None = None,
) -> APIRouter:
    """Factory that creates review routes wired to the given asset repository."""
    router = APIRouter(prefix="/api/reviews", tags=["creative-reviews"])

    def _persist(review_type: str, asset_id: str, result: ReviewResult, req) -> str | None:
        """Persist review run and output if review_repo is wired.

        Returns the run_id if persisted, None otherwise.
        """
        if review_repo is None:
            return None
        run = CreativeReviewRun(
            review_type=review_type,
            asset_id=asset_id,
            lp_url=getattr(getattr(req, "landing_page", None), "url", None),
            status=RunStatus.completed,
            operator_memo=getattr(req, "operator_memo", ""),
            brand_info=getattr(req, "brand_info", ""),
            completed_at=_now(),
        )
        review_repo.save_run(run)
        review_repo.save_output(ReviewOutput(
            run_id=run.run_id,
            output_json=result.model_dump(),
            model_used=getattr(req, "model", None),
        ))
        logger.info("Review persisted: run_id=%s", run.run_id)
        return run.run_id

    @router.post("/banner", response_model=ReviewSubmissionResponse)
    async def banner_review(req: BannerReviewRequest):
        if is_smoke_mode():
            logger.info("[SMOKE] Returning deterministic banner review")
            # Validate asset exists (still check repo)
            try:
                meta = repo.load_metadata(req.asset_id)
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Invalid asset_id: {req.asset_id}")
            if meta is None:
                raise HTTPException(status_code=404, detail=f"Asset not found: {req.asset_id}")
            result = smoke_banner_review()
            run_id = _persist("banner_review", req.asset_id, result, req)
            return {"run_id": run_id, "review": result}

        try:
            result = await review_banner(
                asset_id=req.asset_id,
                repo=repo,
                brand_info=req.brand_info,
                operator_memo=req.operator_memo,
                model=req.model,
                provider=req.provider,
                api_key=req.api_key,
            )
            run_id = _persist("banner_review", req.asset_id, result, req)
            return {"run_id": run_id, "review": result}
        except AssetNotFoundError as e:
            logger.warning("Banner review asset not found: %s", e)
            raise HTTPException(status_code=404, detail=str(e))
        except BannerReviewError as e:
            detail = str(e)
            if "LLM output parse" in detail or "output validation failed" in detail:
                logger.warning("Banner review LLM parse error: %s", e)
                raise HTTPException(status_code=502, detail=detail)
            logger.warning("Banner review failed: %s", e)
            raise HTTPException(status_code=422, detail=detail)
        except ValueError as e:
            logger.warning("Banner review bad request: %s", e)
            raise HTTPException(status_code=400, detail=f"Invalid request: {e}")
        except RuntimeError as e:
            status_code, detail = _classify_review_runtime_error(str(e))
            logger.error("Banner review provider error (→%d): %s", status_code, e)
            raise HTTPException(status_code=status_code, detail=detail)

    @router.post("/ad-lp", response_model=ReviewSubmissionResponse)
    async def ad_lp_review(req: AdLpReviewRequest):
        if is_smoke_mode():
            logger.info("[SMOKE] Returning deterministic ad-LP review")
            try:
                meta = repo.load_metadata(req.asset_id)
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Invalid asset_id: {req.asset_id}")
            if meta is None:
                raise HTTPException(status_code=404, detail=f"Asset not found: {req.asset_id}")
            result = smoke_ad_lp_review()
            run_id = _persist("ad_lp_review", req.asset_id, result, req)
            return {"run_id": run_id, "review": result}

        try:
            result = await review_ad_lp_fit(
                asset_id=req.asset_id,
                landing_page=req.landing_page,
                repo=repo,
                brand_info=req.brand_info,
                operator_memo=req.operator_memo,
                model=req.model,
                provider=req.provider,
                api_key=req.api_key,
            )
            run_id = _persist("ad_lp_review", req.asset_id, result, req)
            return {"run_id": run_id, "review": result}
        except AdLpAssetNotFoundError as e:
            logger.warning("Ad-LP review asset not found: %s", e)
            raise HTTPException(status_code=404, detail=str(e))
        except AdLpReviewError as e:
            detail = str(e)
            if "LLM output parse" in detail or "output validation failed" in detail:
                logger.warning("Ad-LP review LLM parse error: %s", e)
                raise HTTPException(status_code=502, detail=detail)
            logger.warning("Ad-LP review failed: %s", e)
            raise HTTPException(status_code=422, detail=detail)
        except ValueError as e:
            logger.warning("Ad-LP review bad request: %s", e)
            raise HTTPException(status_code=400, detail=f"Invalid request: {e}")
        except RuntimeError as e:
            status_code, detail = _classify_review_runtime_error(str(e))
            logger.error("Ad-LP review provider error (→%d): %s", status_code, e)
            raise HTTPException(status_code=status_code, detail=detail)

    @router.post("/compare", response_model=ReviewSubmissionResponse)
    async def compare_review(req: CompareReviewRequest):
        try:
            result = await review_competitor_compare(
                asset_id=req.asset_id,
                competitors=req.competitors,
                repo=repo,
                brand_info=req.brand_info,
                operator_memo=req.operator_memo,
                model=req.model,
                provider=req.provider,
                api_key=req.api_key,
            )
            run_id = _persist("competitor_compare", req.asset_id, result, req)
            return {"run_id": run_id, "review": result}
        except CompareAssetNotFoundError as e:
            logger.warning("Compare review asset not found: %s", e)
            raise HTTPException(status_code=404, detail=str(e))
        except CompareReviewError as e:
            logger.warning("Compare review failed: %s", e)
            raise HTTPException(status_code=422, detail=str(e))

    @router.get("/{review_id}", response_model=StoredReviewResponse)
    async def get_review(review_id: str):
        if not _REVIEW_ID_RE.match(review_id):
            raise HTTPException(status_code=422, detail=f"Invalid review_id format: {review_id}")

        if review_repo is None:
            raise HTTPException(
                status_code=501,
                detail="Review persistence is not configured.",
            )

        try:
            output = review_repo.load_output(review_id)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid review_id format: {review_id}")

        if output is None:
            raise HTTPException(status_code=404, detail=f"Review not found: {review_id}")

        run = review_repo.load_run(review_id)
        return {
            "run_id": review_id,
            "review_type": run.review_type if run else None,
            "status": run.status if run else None,
            "created_at": run.created_at.isoformat() if run else None,
            "output": ReviewResult(**output.output_json),
        }

    return router
