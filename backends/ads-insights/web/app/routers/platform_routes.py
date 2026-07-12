"""Operational routes for the managed platform database."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..api_errors import problem_response
from ..platform_db import PlatformDatabaseUnavailable, assert_database_ready


router = APIRouter(prefix="/api/platform", tags=["platform"])


@router.get("/readiness")
def platform_readiness(request: Request):
    try:
        assert_database_ready()
    except PlatformDatabaseUnavailable:
        return problem_response(
            request,
            status_code=503,
            code="database_unavailable",
            category="dependency",
            user_message="サービスの準備が整っていません。時間をおいて再試行してください。",
            retryable=True,
        )
    return {"ok": True, "status": "ready", "database": "ready"}
