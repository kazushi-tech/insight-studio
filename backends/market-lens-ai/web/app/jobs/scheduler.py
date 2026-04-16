"""Job scheduler — manages periodic tasks (Phase 8).

Uses a lightweight in-process approach. For production scale,
this can be swapped to APScheduler or Render Cron Jobs.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from ..schemas.job import (
    Job,
    JobCreate,
    JobResult,
    JobResultStatus,
    JobStatus,
    JobType,
    JobUpdate,
)

logger = logging.getLogger("market-lens.scheduler")


class JobScheduler:
    """In-memory job scheduler with idempotency."""

    def __init__(self):
        self._jobs: dict[str, Job] = {}
        self._results: dict[str, list[JobResult]] = {}
        self._running: set[str] = set()
        self._lock = asyncio.Lock()

    @staticmethod
    def _new_id() -> str:
        return uuid.uuid4().hex[:12]

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    # ── Job CRUD ──

    def create_job(self, req: JobCreate) -> Job:
        job = Job(
            id=self._new_id(),
            job_type=req.job_type,
            cron_expression=req.cron_expression,
            target_id=req.target_id,
            status=JobStatus.active,
            created_at=self._now(),
        )
        self._jobs[job.id] = job
        logger.info("Created job %s type=%s target=%s", job.id, job.job_type, job.target_id)
        return job

    def get_job(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def list_jobs(self, job_type: JobType | None = None) -> list[Job]:
        result = list(self._jobs.values())
        if job_type:
            result = [j for j in result if j.job_type == job_type]
        return sorted(result, key=lambda j: j.created_at, reverse=True)

    def update_job(self, job_id: str, req: JobUpdate) -> Job | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        updates: dict = {"updated_at": self._now()}
        if req.cron_expression is not None:
            updates["cron_expression"] = req.cron_expression
        if req.status is not None:
            updates["status"] = req.status
        updated = job.model_copy(update=updates)
        self._jobs[job_id] = updated
        return updated

    def update_next_run(self, job_id: str, next_run_at: datetime) -> Job | None:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        updated = job.model_copy(update={"next_run_at": next_run_at})
        self._jobs[job_id] = updated
        return updated

    def delete_job(self, job_id: str) -> bool:
        if job_id not in self._jobs:
            return False
        del self._jobs[job_id]
        return True

    # ── Execution with idempotency ──

    async def try_acquire(self, job_id: str) -> bool:
        """Try to acquire lock for a job. Returns False if already running."""
        async with self._lock:
            if job_id in self._running:
                logger.warning("Job %s already running, skipping", job_id)
                return False
            self._running.add(job_id)
            return True

    async def release(self, job_id: str) -> None:
        """Release lock for a job."""
        async with self._lock:
            self._running.discard(job_id)

    def record_result(self, job_id: str, status: JobResultStatus, summary: str = "", error: str = "") -> JobResult:
        """Record result of a job execution."""
        now = self._now()
        result = JobResult(
            id=self._new_id(),
            job_id=job_id,
            status=status,
            started_at=now,
            completed_at=now,
            result_summary=summary,
            error_message=error,
        )
        self._results.setdefault(job_id, []).append(result)

        # Update job's last_run_at
        job = self._jobs.get(job_id)
        if job:
            self._jobs[job_id] = job.model_copy(update={"last_run_at": now, "updated_at": now})

        return result

    def get_results(self, job_id: str, limit: int = 10) -> list[JobResult]:
        results = self._results.get(job_id, [])
        return sorted(results, key=lambda r: r.started_at, reverse=True)[:limit]

    def is_running(self, job_id: str) -> bool:
        return job_id in self._running
