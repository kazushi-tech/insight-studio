"""Admin routes — usage, failure monitoring, workspace overview (Phase 9)."""

from __future__ import annotations

import uuid
from collections import deque
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..auth import verify_token


class UsageEvent(BaseModel):
    id: str
    event_type: str
    workspace_id: str = ""
    detail: dict = Field(default_factory=dict)
    created_at: datetime


class UsageSummary(BaseModel):
    total_events: int = 0
    scans: int = 0
    reviews: int = 0
    generations: int = 0
    deliveries: int = 0
    period_start: datetime | None = None
    period_end: datetime | None = None


class FailureEntry(BaseModel):
    id: str
    event_type: str
    error_message: str
    created_at: datetime


class SystemStatus(BaseModel):
    status: str = "healthy"
    uptime_seconds: float = 0
    total_jobs: int = 0
    active_jobs: int = 0
    total_watchlists: int = 0
    total_deliveries: int = 0


def create_admin_router() -> APIRouter:
    """Factory that creates admin routes."""
    router = APIRouter(prefix="/api/admin", tags=["admin"])

    _events: deque[UsageEvent] = deque(maxlen=10_000)
    _failures: deque[FailureEntry] = deque(maxlen=1_000)
    _start_time = datetime.now(timezone.utc)

    def _new_id() -> str:
        return uuid.uuid4().hex[:12]

    def _now() -> datetime:
        return datetime.now(timezone.utc)

    @router.get("/usage", response_model=UsageSummary)
    async def get_usage(workspace_id: str | None = Query(default=None), _: str = Depends(verify_token)):
        filtered = _events
        if workspace_id:
            filtered = [e for e in _events if e.workspace_id == workspace_id]

        return UsageSummary(
            total_events=len(filtered),
            scans=sum(1 for e in filtered if e.event_type == "scan"),
            reviews=sum(1 for e in filtered if e.event_type == "review"),
            generations=sum(1 for e in filtered if e.event_type == "generation"),
            deliveries=sum(1 for e in filtered if e.event_type == "delivery"),
            period_start=filtered[0].created_at if filtered else None,
            period_end=filtered[-1].created_at if filtered else None,
        )

    @router.post("/usage/track", response_model=UsageEvent)
    async def track_event(event_type: str, workspace_id: str = "", detail: dict | None = None, _: str = Depends(verify_token)):
        event = UsageEvent(
            id=_new_id(),
            event_type=event_type,
            workspace_id=workspace_id,
            detail=detail or {},
            created_at=_now(),
        )
        _events.append(event)
        return event

    @router.get("/failures", response_model=list[FailureEntry])
    async def get_failures(limit: int = Query(default=20, ge=1, le=100), _: str = Depends(verify_token)):
        return list(reversed(_failures))[:limit]

    @router.post("/failures/report", response_model=FailureEntry)
    async def report_failure(event_type: str, error_message: str, _: str = Depends(verify_token)):
        entry = FailureEntry(
            id=_new_id(),
            event_type=event_type,
            error_message=error_message,
            created_at=_now(),
        )
        _failures.append(entry)
        return entry

    @router.get("/status", response_model=SystemStatus)
    async def get_status(_: str = Depends(verify_token)):
        now = _now()
        uptime = (now - _start_time).total_seconds()
        return SystemStatus(
            status="healthy",
            uptime_seconds=uptime,
        )

    return router
