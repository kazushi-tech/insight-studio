"""Public async contracts for durable creative and competitor reviews."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel

from .review_result import ReviewResult


class ReviewJobKind(str, Enum):
    competitor_compare = "competitor_compare"
    banner_review = "banner_review"
    ad_lp_review = "ad_lp_review"


class ReviewJobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class ReviewJobStartResponse(BaseModel):
    job_id: str
    review_type: ReviewJobKind
    status: ReviewJobStatus = ReviewJobStatus.queued
    stage: str = "queued"
    poll_url: str
    result_url: str
    retry_after_sec: int = 3


class ReviewJobResponse(BaseModel):
    job_id: str
    review_type: ReviewJobKind
    status: ReviewJobStatus
    stage: str
    progress_pct: int = 0
    created_at: datetime
    started_at: datetime | None = None
    updated_at: datetime
    heartbeat_at: datetime | None = None
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None
    retry_after_sec: int | None = None


class ReviewJobResultResponse(BaseModel):
    job_id: str
    run_id: str
    review_type: ReviewJobKind
    review: ReviewResult
