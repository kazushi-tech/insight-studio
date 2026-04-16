"""Generation routes — AI Banner Generation API (M5.7)."""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from ..schemas.banner_generation import BannerGenRequest, BannerGenResult, BannerGenStatus
from ..schemas.review_result import ReviewResult
from ..services.generation.banner_gen_service import BannerGenService

_ID_RE = re.compile(r"^[0-9a-f]{12}$")


def create_generation_router(
    gen_service: BannerGenService | None = None,
    review_result_loader=None,
    asset_loader=None,
    asset_metadata_loader=None,
) -> APIRouter:
    """Factory that creates generation routes.

    Args:
        gen_service: Optional BannerGenService override (for testing).
        review_result_loader: Callable(run_id) -> ReviewResult | None.
        asset_loader: Callable(asset_id) -> bytes | None. Loads original image.
        asset_metadata_loader: Callable(asset_id) -> metadata | None. Loads asset metadata.
    """
    router = APIRouter(prefix="/api/generation", tags=["generation"])
    svc = gen_service or BannerGenService()

    @router.post("/banner", response_model=BannerGenResult)
    async def generate_banner(req: BannerGenRequest):
        if review_result_loader is None:
            raise HTTPException(
                status_code=501,
                detail="Review result loader not configured",
            )

        loaded = review_result_loader(req.review_run_id)
        if loaded is None:
            raise HTTPException(
                status_code=422,
                detail=f"Review not found: {req.review_run_id}",
            )

        # review_result_loader may return (ReviewResult, asset_id) or just ReviewResult
        if isinstance(loaded, tuple):
            review_result, asset_id = loaded
        else:
            review_result, asset_id = loaded, None

        # Load original image for reference
        original_image = None
        original_width = None
        original_height = None
        if asset_id:
            if asset_loader:
                original_image = asset_loader(asset_id)
            if asset_metadata_loader:
                meta = asset_metadata_loader(asset_id)
                if meta:
                    original_width = getattr(meta, 'width', None)
                    original_height = getattr(meta, 'height', None)

        result = await svc.generate(
            review_run_id=req.review_run_id,
            review_result=review_result,
            style_guidance=req.style_guidance,
            model=req.model,
            api_key=req.api_key,
            original_image=original_image,
            original_width=original_width,
            original_height=original_height,
        )
        return result

    @router.get("/{gen_id}", response_model=BannerGenResult)
    async def get_generation(gen_id: str):
        if not _ID_RE.match(gen_id):
            raise HTTPException(status_code=422, detail=f"Invalid gen_id: {gen_id}")
        result = svc.get_result(gen_id)
        if result is None:
            raise HTTPException(status_code=404, detail=f"Generation not found: {gen_id}")
        return result

    @router.get("/{gen_id}/image")
    async def get_generation_image(gen_id: str):
        if not _ID_RE.match(gen_id):
            raise HTTPException(status_code=422, detail=f"Invalid gen_id: {gen_id}")

        result = svc.get_result(gen_id)
        if result is None:
            raise HTTPException(status_code=404, detail=f"Generation not found: {gen_id}")

        if result.status == BannerGenStatus.pending or result.status == BannerGenStatus.generating:
            raise HTTPException(
                status_code=409,
                detail=f"Image not ready — generation status: {result.status}",
            )

        if result.status == BannerGenStatus.failed:
            raise HTTPException(
                status_code=422,
                detail=f"Generation failed: {result.error_message}",
            )

        image_bytes = svc.get_image(gen_id)
        if image_bytes is None:
            raise HTTPException(status_code=404, detail="Image file not found")

        return Response(content=image_bytes, media_type="image/png")

    return router
