"""Job runner — executes jobs with idempotency guarantees (Phase 8)."""

from __future__ import annotations

import logging

from ..schemas.job import JobResultStatus, JobStatus, JobType
from .scheduler import JobScheduler

logger = logging.getLogger("market-lens.runner")


class JobRunner:
    """Runs scheduled jobs with idempotency protection."""

    def __init__(self, scheduler: JobScheduler, monitor=None):
        self._scheduler = scheduler
        self._monitor = monitor

    async def run_job(self, job_id: str) -> bool:
        """Execute a single job. Returns True if executed, False if skipped."""
        job = self._scheduler.get_job(job_id)
        if job is None:
            logger.error("Job %s not found", job_id)
            return False

        if job.status != JobStatus.active:
            logger.info("Job %s is %s, skipping", job_id, job.status)
            return False

        if not await self._scheduler.try_acquire(job_id):
            self._scheduler.record_result(
                job_id,
                JobResultStatus.skipped,
                summary="Already running (idempotency guard)",
            )
            return False

        try:
            if job.job_type == JobType.watchlist_check:
                summary = await self._run_watchlist_check(job.target_id)
            elif job.job_type == JobType.digest_delivery:
                summary = await self._run_digest_delivery(job.target_id)
            else:
                summary = f"Unknown job type: {job.job_type}"

            self._scheduler.record_result(job_id, JobResultStatus.success, summary=summary)
            logger.info("Job %s completed: %s", job_id, summary)
            return True

        except Exception as exc:
            self._scheduler.record_result(
                job_id,
                JobResultStatus.failed,
                error=str(exc),
            )
            logger.error("Job %s failed: %s", job_id, exc)
            return False

        finally:
            await self._scheduler.release(job_id)

    async def run_due_jobs(self) -> int:
        """Run all active jobs. Returns count of executed jobs."""
        jobs = self._scheduler.list_jobs()
        count = 0
        for job in jobs:
            if job.status == JobStatus.active:
                if await self.run_job(job.id):
                    count += 1
        return count

    async def _run_watchlist_check(self, target_id: str) -> str:
        """Run watchlist check for a specific watchlist."""
        if self._monitor and target_id:
            results = await self._monitor.check_watchlist(target_id)
            changes = sum(1 for r in results if r.changes_detected)
            return f"Checked {len(results)} entries, {changes} changes detected"
        return "Watchlist check completed (no monitor configured)"

    async def _run_digest_delivery(self, target_id: str) -> str:
        """Run digest delivery (placeholder)."""
        return "Digest delivery completed"
