"""Scan routes."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException

from ..models import ScanRequest, ScanResponse, ScanResult, ExtractedData
from ..policies import validate_urls
from ..repositories.scan_repository import ScanRepository
from ..services.scan_service import execute_scan
from ..smoke_mode import is_smoke_mode, smoke_scan_result
from ..user_context import get_optional_user_id

logger = logging.getLogger("market-lens")


def create_scan_router(repo: ScanRepository) -> APIRouter:
    """Factory that creates a scan router wired to the given repository."""
    router = APIRouter()

    @router.post("/api/scan", response_model=ScanResponse)
    async def scan(req: ScanRequest, owner_id: str | None = Depends(get_optional_user_id)):
        if is_smoke_mode():
            logger.info("[SMOKE] Returning deterministic scan result")
            run_id = uuid.uuid4().hex[:12]
            result_data = smoke_scan_result(req.urls, run_id)
            # Persist to repo so history endpoints work
            scan_result = ScanResult(
                run_id=run_id,
                owner_id=owner_id,
                status="completed",
                urls=req.urls,
                extracted=[ExtractedData(**e) for e in result_data.get("_extracted", [])],
                report_md=result_data["report_md"],
                total_time_sec=result_data["total_time_sec"],
            )
            repo.save(scan_result)
            return ScanResponse(**result_data)

        errors = validate_urls(req.urls)
        if errors:
            logger.info("Scan rejected: %s", errors)
            raise HTTPException(status_code=422, detail=errors)
        return await execute_scan(req, repo, owner_id=owner_id)

    return router
