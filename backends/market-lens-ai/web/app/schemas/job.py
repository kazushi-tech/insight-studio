"""Job & JobResult schemas (Phase 8)."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class JobType(str, Enum):
    watchlist_check = "watchlist_check"
    digest_delivery = "digest_delivery"


class JobStatus(str, Enum):
    active = "active"
    paused = "paused"
    completed = "completed"


class JobResultStatus(str, Enum):
    success = "success"
    failed = "failed"
    skipped = "skipped"


class JobCreate(BaseModel):
    """Request to create a scheduled job."""

    job_type: JobType
    cron_expression: str = Field(default="0 9 * * *", max_length=64)
    target_id: str = Field(default="", max_length=12)


class JobUpdate(BaseModel):
    """Request to update a job."""

    cron_expression: Optional[str] = Field(default=None, max_length=64)
    status: Optional[JobStatus] = None


class Job(BaseModel):
    """A scheduled job."""

    id: str
    job_type: JobType
    cron_expression: str = "0 9 * * *"
    target_id: str = ""
    status: JobStatus = JobStatus.active
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class JobResult(BaseModel):
    """Result of a single job execution."""

    id: str
    job_id: str
    status: JobResultStatus
    started_at: datetime
    completed_at: Optional[datetime] = None
    result_summary: str = ""
    error_message: str = ""
