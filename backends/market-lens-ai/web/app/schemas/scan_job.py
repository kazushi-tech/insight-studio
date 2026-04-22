"""Pydantic schemas for Scan async job + polling."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class ScanJobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class ScanJobStage(str, Enum):
    queued = "queued"
    fetching_lps = "fetching_lps"
    analyzing = "analyzing"
    complete = "complete"
    failed = "failed"


STAGE_PROGRESS: dict[str, int] = {
    "queued": 0,
    "fetching_lps": 30,
    "analyzing": 70,
    "complete": 100,
    "failed": 0,
}

STAGE_MESSAGES: dict[str, str] = {
    "queued": "ジョブを準備中です",
    "fetching_lps": "LP を取得・抽出中です",
    "analyzing": "比較分析を実行中です",
    "complete": "分析が完了しました",
    "failed": "エラーが発生しました",
}

STAGE_RETRY_AFTER: dict[str, int] = {
    "queued": 2,
    "fetching_lps": 5,
    "analyzing": 10,
    "complete": 5,
    "failed": 5,
}


class ScanJobError(BaseModel):
    status_code: int = 500
    detail: str = ""
    retryable: bool = True


class ScanJobStartResponse(BaseModel):
    job_id: str
    status: ScanJobStatus
    stage: ScanJobStage
    poll_url: str
    retry_after_sec: int = 3


class ScanJobResponse(BaseModel):
    job_id: str
    status: ScanJobStatus
    stage: ScanJobStage
    progress_pct: int = 0
    created_at: datetime
    started_at: Optional[datetime] = None
    updated_at: datetime
    heartbeat_at: Optional[datetime] = None
    urls: list[str]
    message: str = ""
    result: Optional[dict[str, Any]] = None
    error: Optional[ScanJobError] = None
    retry_after_sec: Optional[int] = None


class ScanJobRecord(BaseModel):
    """Internal job record stored in repository (not exposed directly)."""

    job_id: str
    owner_id: str = ""
    urls: list[str]
    provider: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = Field(default=None, repr=False)
    status: ScanJobStatus = ScanJobStatus.queued
    stage: ScanJobStage = ScanJobStage.queued
    progress_pct: int = 0
    message: str = ""
    created_at: datetime
    started_at: Optional[datetime] = None
    updated_at: datetime
    heartbeat_at: Optional[datetime] = None
    error: Optional[ScanJobError] = None
