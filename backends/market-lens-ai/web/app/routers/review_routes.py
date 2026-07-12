"""Review routes — banner review and ad-to-LP review endpoints."""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from ..auth import get_verified_owner_id, verify_admin_or_integration
from ..jobs.analysis_backend import (
    AnalysisJobStatus,
    AnalysisJobType,
    JobBackendMode,
)
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
from ..schemas.review_job import (
    ReviewJobKind,
    ReviewJobResponse,
    ReviewJobResultResponse,
    ReviewJobStartResponse,
    ReviewJobStatus,
)
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
    *,
    analysis_job_backend=None,
) -> APIRouter:
    """Factory that creates review routes wired to the given asset repository."""
    router = APIRouter(
        prefix="/api/reviews",
        tags=["creative-reviews"],
        dependencies=[Depends(verify_admin_or_integration)],
    )

    def _analysis_backend_mode():
        mode = getattr(analysis_job_backend, "mode", None)
        if analysis_job_backend is not None and mode is None:
            raise HTTPException(
                status_code=503,
                detail="Analysis job backend is unavailable.",
            )
        return mode

    def _require_inline_review() -> None:
        if _analysis_backend_mode() in {
            JobBackendMode.worker,
            JobBackendMode.workflow,
        }:
            raise HTTPException(
                status_code=409,
                detail="Use the durable /jobs endpoint for this review.",
            )

    def _require_durable_review() -> None:
        if _analysis_backend_mode() not in {
            JobBackendMode.worker,
            JobBackendMode.workflow,
        }:
            raise HTTPException(
                status_code=501,
                detail="Durable review jobs are not configured.",
            )

    def _public_status(status_value: AnalysisJobStatus) -> ReviewJobStatus:
        return {
            AnalysisJobStatus.queued: ReviewJobStatus.queued,
            AnalysisJobStatus.running: ReviewJobStatus.running,
            AnalysisJobStatus.succeeded: ReviewJobStatus.completed,
            AnalysisJobStatus.failed: ReviewJobStatus.failed,
            AnalysisJobStatus.canceled: ReviewJobStatus.cancelled,
        }[status_value]

    def _review_type_for_job(job) -> ReviewJobKind:
        if job.job_type == AnalysisJobType.compare:
            return ReviewJobKind.competitor_compare
        review_kind = str(job.payload.get("review_kind") or "")
        if review_kind == "banner":
            return ReviewJobKind.banner_review
        if review_kind == "ad_lp":
            return ReviewJobKind.ad_lp_review
        raise HTTPException(status_code=404, detail="Review job not found.")

    def _load_durable_review_job(job_id: str, owner_id: str):
        _require_durable_review()
        job = analysis_job_backend.get(job_id)
        if job is None or job.job_type not in {
            AnalysisJobType.compare,
            AnalysisJobType.creative_review,
        }:
            raise HTTPException(status_code=404, detail="Review job not found.")
        if job.owner_id and job.owner_id != owner_id:
            raise HTTPException(status_code=404, detail="Review job not found.")
        _review_type_for_job(job)
        return job

    def _job_response(job) -> ReviewJobResponse:
        return ReviewJobResponse(
            job_id=job.id,
            review_type=_review_type_for_job(job),
            status=_public_status(job.status),
            stage=job.stage,
            progress_pct=job.progress_pct,
            created_at=job.created_at,
            started_at=job.started_at,
            updated_at=job.updated_at,
            heartbeat_at=job.heartbeat_at,
            result=dict(job.result) if job.result is not None else None,
            error=dict(job.error) if job.error is not None else None,
            retry_after_sec=(2 if job.status in {AnalysisJobStatus.queued, AnalysisJobStatus.running} else None),
        )

    def _enqueue_review(
        req,
        *,
        job_type: AnalysisJobType,
        review_type: ReviewJobKind,
        idempotency_key: str,
        review_kind: str | None = None,
    ) -> ReviewJobStartResponse:
        _require_durable_review()
        key = idempotency_key.strip()
        if not key:
            raise HTTPException(status_code=422, detail="Idempotency-Key is required.")
        if getattr(req, "api_key", None):
            raise HTTPException(
                status_code=422,
                detail="BYOK credentials cannot be queued; use the configured service provider.",
            )
        payload = req.model_dump(mode="json", exclude={"api_key"})
        if review_kind is not None:
            payload["review_kind"] = review_kind
        job = analysis_job_backend.enqueue(
            job_type,
            payload,
            idempotency_key=key,
        )
        return ReviewJobStartResponse(
            job_id=job.id,
            review_type=review_type,
            status=_public_status(job.status),
            stage=job.stage,
            poll_url=f"/api/reviews/jobs/{job.id}",
            result_url=f"/api/reviews/jobs/{job.id}/result",
            retry_after_sec=3,
        )

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
        _require_inline_review()
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
        _require_inline_review()
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
        _require_inline_review()
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

    @router.post(
        "/banner/jobs",
        status_code=202,
        response_model=ReviewJobStartResponse,
    )
    async def start_banner_review_job(
        req: BannerReviewRequest,
        idempotency_key: str = Header(..., alias="Idempotency-Key"),
    ):
        return _enqueue_review(
            req,
            job_type=AnalysisJobType.creative_review,
            review_type=ReviewJobKind.banner_review,
            review_kind="banner",
            idempotency_key=idempotency_key,
        )

    @router.post(
        "/ad-lp/jobs",
        status_code=202,
        response_model=ReviewJobStartResponse,
    )
    async def start_ad_lp_review_job(
        req: AdLpReviewRequest,
        idempotency_key: str = Header(..., alias="Idempotency-Key"),
    ):
        return _enqueue_review(
            req,
            job_type=AnalysisJobType.creative_review,
            review_type=ReviewJobKind.ad_lp_review,
            review_kind="ad_lp",
            idempotency_key=idempotency_key,
        )

    @router.post(
        "/compare/jobs",
        status_code=202,
        response_model=ReviewJobStartResponse,
    )
    async def start_compare_review_job(
        req: CompareReviewRequest,
        idempotency_key: str = Header(..., alias="Idempotency-Key"),
    ):
        return _enqueue_review(
            req,
            job_type=AnalysisJobType.compare,
            review_type=ReviewJobKind.competitor_compare,
            idempotency_key=idempotency_key,
        )

    @router.get("/jobs/{job_id}", response_model=ReviewJobResponse)
    async def get_review_job(
        job_id: str,
        owner_id: str = Depends(get_verified_owner_id),
    ):
        return _job_response(_load_durable_review_job(job_id, owner_id))

    @router.get("/jobs/{job_id}/result", response_model=ReviewJobResultResponse)
    async def get_review_job_result(
        job_id: str,
        owner_id: str = Depends(get_verified_owner_id),
    ):
        job = _load_durable_review_job(job_id, owner_id)
        if job.status != AnalysisJobStatus.succeeded or job.result is None:
            raise HTTPException(
                status_code=409,
                detail="Review job is not completed.",
            )
        return ReviewJobResultResponse(
            job_id=job.id,
            run_id=job.id,
            review_type=_review_type_for_job(job),
            review=ReviewResult(**job.result),
        )

    @router.post("/jobs/{job_id}/cancel", response_model=ReviewJobResponse)
    async def cancel_review_job(
        job_id: str,
        owner_id: str = Depends(get_verified_owner_id),
    ):
        job = _load_durable_review_job(job_id, owner_id)
        canceled = analysis_job_backend.cancel(job.id)
        if canceled is None:
            raise HTTPException(status_code=404, detail="Review job not found.")
        return _job_response(canceled)

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
