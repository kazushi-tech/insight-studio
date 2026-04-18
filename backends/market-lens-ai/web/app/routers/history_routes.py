"""History (scan list / detail / delete) routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..repositories.scan_repository import ScanRepository
from ..schemas.report_envelope import build_envelope_from_md, report_envelope_enabled
from ..services import history_service
from ..user_context import get_optional_user_id


def create_history_router(repo: ScanRepository) -> APIRouter:
    """Factory that creates a history router wired to the given repository."""
    router = APIRouter()

    @router.get("/api/scans")
    async def list_scans(owner_id: str | None = Depends(get_optional_user_id)):
        return history_service.list_scans(owner_id, repo)

    @router.get("/api/scans/{run_id}")
    async def get_scan(run_id: str, owner_id: str | None = Depends(get_optional_user_id)):
        try:
            result = history_service.get_scan(run_id, owner_id, repo)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid run_id")
        if not result:
            raise HTTPException(status_code=404, detail="Scan not found")
        return result.model_dump(exclude={"owner_id"})

    @router.get("/api/scans/{run_id}/report.json")
    async def get_scan_envelope(run_id: str, owner_id: str | None = Depends(get_optional_user_id)):
        if not report_envelope_enabled():
            raise HTTPException(status_code=404, detail="ReportEnvelope v0 is not enabled.")
        try:
            result = history_service.get_scan(run_id, owner_id, repo)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid run_id")
        if not result:
            raise HTTPException(status_code=404, detail="Scan not found")
        envelope = build_envelope_from_md(
            report_id=run_id,
            kind="scan",
            report_md=result.report_md or "",
        )
        return envelope.model_dump()

    @router.delete("/api/scans/{run_id}")
    async def delete_scan(run_id: str, owner_id: str | None = Depends(get_optional_user_id)):
        try:
            deleted = history_service.delete_scan(run_id, owner_id, repo)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid run_id")
        if not deleted:
            raise HTTPException(status_code=404, detail="Scan not found")
        return {"ok": True}

    return router
