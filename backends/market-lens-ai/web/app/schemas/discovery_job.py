"""Pydantic schemas for Discovery async job + polling."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class DiscoveryJobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class DiscoveryJobStage(str, Enum):
    queued = "queued"
    brand_fetch = "brand_fetch"
    classify_industry = "classify_industry"
    search = "search"
    fetch_competitors = "fetch_competitors"
    analyze = "analyze"
    complete = "complete"
    failed = "failed"


STAGE_PROGRESS: dict[str, int] = {
    "queued": 0,
    "brand_fetch": 10,
    "classify_industry": 20,
    "search": 45,
    "fetch_competitors": 70,
    "analyze": 90,
    "complete": 100,
}

STAGE_MESSAGES: dict[str, str] = {
    "queued": "ジョブを準備中です",
    "brand_fetch": "ブランドURLを取得中です",
    "classify_industry": "業種を分類中です",
    "search": "競合検索を実行中です",
    "fetch_competitors": "競合サイトを取得中です",
    "analyze": "比較分析を実行中です",
    "complete": "分析が完了しました",
    "failed": "エラーが発生しました",
}


class DiscoveryJobError(BaseModel):
    status_code: int = 500
    detail: str = ""
    retryable: bool = True


class DiscoveryJobResultSummary(BaseModel):
    candidate_count: Optional[int] = None
    fetched_count: Optional[int] = None
    analyzed_count: Optional[int] = None


class DiscoveryJobStartResponse(BaseModel):
    job_id: str
    status: DiscoveryJobStatus
    stage: DiscoveryJobStage
    poll_url: str
    retry_after_sec: int = 3


STAGE_RETRY_AFTER: dict[str, int] = {
    "queued": 2,
    "brand_fetch": 2,
    "classify_industry": 2,
    "search": 3,
    "fetch_competitors": 3,
    "analyze": 5,
    "complete": 5,
    "failed": 5,
}


class DiscoveryJobResponse(BaseModel):
    job_id: str
    status: DiscoveryJobStatus
    stage: DiscoveryJobStage
    progress_pct: int = 0
    created_at: datetime
    started_at: Optional[datetime] = None
    updated_at: datetime
    heartbeat_at: Optional[datetime] = None
    stage_started_at: Optional[datetime] = None
    last_progress_at: Optional[datetime] = None
    brand_url: str
    message: str = ""
    result: Optional[dict[str, Any]] = None
    error: Optional[DiscoveryJobError] = None
    result_summary: Optional[DiscoveryJobResultSummary] = None
    retry_after_sec: Optional[int] = None


class DiscoveryJobRecord(BaseModel):
    """Internal job record stored in repository (not exposed directly)."""

    job_id: str
    owner_id: str = ""
    brand_url: str
    provider: str = "anthropic"
    model: Optional[str] = None
    status: DiscoveryJobStatus = DiscoveryJobStatus.queued
    stage: DiscoveryJobStage = DiscoveryJobStage.queued
    progress_pct: int = 0
    message: str = ""
    created_at: datetime
    started_at: Optional[datetime] = None
    updated_at: datetime
    heartbeat_at: Optional[datetime] = None
    stage_started_at: Optional[datetime] = None
    last_progress_at: Optional[datetime] = None
    result_summary: Optional[DiscoveryJobResultSummary] = None
    error: Optional[DiscoveryJobError] = None
