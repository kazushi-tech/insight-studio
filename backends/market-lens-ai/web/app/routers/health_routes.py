"""Health check routes."""

from __future__ import annotations

import os

from fastapi import APIRouter

from ..services.discovery.pipeline_metrics import get_health_snapshot

router = APIRouter()


@router.get("/api/health")
async def health():
    return {
        "ok": True,
        "service": "market-lens",
        "commit": os.getenv("RENDER_GIT_COMMIT", "unknown"),
        "discovery_pipeline": get_health_snapshot(),
    }
