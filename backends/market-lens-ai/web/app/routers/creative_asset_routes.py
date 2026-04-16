"""Creative asset upload / retrieve / delete routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import Response

from ..repositories.asset_repository import AssetRepository
from ..schemas.creative_asset import CreativeAssetResponse
from ..services.intake.asset_upload_service import UploadError, upload_asset

logger = logging.getLogger("market-lens")


def create_asset_router(repo: AssetRepository) -> APIRouter:
    """Factory that creates creative-asset routes wired to the given repository."""
    router = APIRouter(prefix="/api/assets", tags=["creative-assets"])

    @router.post("", response_model=CreativeAssetResponse, status_code=201)
    async def upload(file: UploadFile):
        data = await file.read()
        content_type = file.content_type or "application/octet-stream"
        try:
            return await upload_asset(
                file_name=file.filename or "unknown",
                mime_type=content_type,
                data=data,
                repo=repo,
            )
        except UploadError as e:
            raise HTTPException(status_code=422, detail=str(e))

    @router.get("/{asset_id}", response_model=CreativeAssetResponse)
    async def get_metadata(asset_id: str):
        try:
            meta = repo.load_metadata(asset_id)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid asset_id format: {asset_id}")
        if meta is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        return CreativeAssetResponse(
            asset_id=meta.asset_id,
            file_name=meta.file_name,
            mime_type=meta.mime_type,
            size_bytes=meta.size_bytes,
            width=meta.width,
            height=meta.height,
            asset_type=meta.asset_type.value,
            created_at=meta.created_at,
        )

    @router.get("/{asset_id}/download")
    async def download(asset_id: str):
        try:
            meta = repo.load_metadata(asset_id)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid asset_id format: {asset_id}")
        if meta is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        data = repo.load_data(asset_id)
        if data is None:
            raise HTTPException(status_code=404, detail="Asset data not found")
        return Response(content=data, media_type=meta.mime_type)

    @router.delete("/{asset_id}", status_code=204)
    async def delete_asset(asset_id: str):
        try:
            if not repo.delete(asset_id):
                raise HTTPException(status_code=404, detail="Asset not found")
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid asset_id format: {asset_id}")

    return router
