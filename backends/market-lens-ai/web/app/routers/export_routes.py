"""Export routes — one-pager HTML and PDF export endpoints."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from ..schemas.review_result import ReviewResult
from ..services.exports.onepager_render_service import render_onepager_html
from ..services.exports.pdf_export_service import PdfExportError, export_pdf

logger = logging.getLogger("market-lens")


class ExportRequest(BaseModel):
    """Request body for export endpoints."""

    review: ReviewResult
    title: str = "クリエイティブレビュー サマリー"
    subtitle: str = ""
    review_date: Optional[str] = None


router = APIRouter(prefix="/api/exports", tags=["exports"])


@router.post("/onepager", response_class=HTMLResponse)
async def export_onepager_html(req: ExportRequest):
    """Generate and return a one-pager HTML document."""
    try:
        html_content = render_onepager_html(
            req.review,
            title=req.title,
            subtitle=req.subtitle,
            review_date=req.review_date,
        )
        return HTMLResponse(content=html_content)
    except Exception as e:
        logger.error("One-pager HTML generation failed: %s", e)
        raise HTTPException(status_code=500, detail=f"HTML generation failed: {e}")


@router.post("/pdf")
async def export_pdf_endpoint(req: ExportRequest):
    """Generate and return a PDF document."""
    try:
        pdf_bytes = await export_pdf(
            req.review,
            title=req.title,
            subtitle=req.subtitle,
            review_date=req.review_date,
        )
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": "attachment; filename=creative-review.pdf",
            },
        )
    except PdfExportError as e:
        logger.error("PDF export failed: %s", e)
        raise HTTPException(status_code=503, detail=str(e))
