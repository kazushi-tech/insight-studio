"""Scheduler routes — Job CRUD + execution API (Phase 8)."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import verify_auth_optional, verify_token

from ..schemas.job import Job, JobCreate, JobResult, JobType, JobUpdate
from ..jobs.scheduler import JobScheduler
from ..jobs.runner import JobRunner

_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_MAX_JOBS = 50


def _check_id(val: str, name: str = "id") -> None:
    if not _ID_RE.match(val):
        raise HTTPException(status_code=422, detail=f"Invalid {name}: {val}")


def _validate_cron(expr: str) -> datetime | None:
    """Validate cron expression and return next_run_at, or raise 422."""
    if not expr:
        return None
    if not croniter.is_valid(expr):
        raise HTTPException(status_code=422, detail=f"Invalid cron expression: {expr}")
    return croniter(expr, datetime.now(timezone.utc)).get_next(datetime)


def create_scheduler_router(
    scheduler: JobScheduler | None = None,
    runner: JobRunner | None = None,
) -> APIRouter:
    """Factory that creates scheduler routes."""
    router = APIRouter(prefix="/api/jobs", tags=["scheduler"])
    _scheduler = scheduler or JobScheduler()
    _runner = runner or JobRunner(_scheduler)

    @router.post("", response_model=Job)
    async def create_job(req: JobCreate, _: str = Depends(verify_token)):
        if len(_scheduler.list_jobs()) >= _MAX_JOBS:
            raise HTTPException(status_code=422, detail=f"Job limit reached ({_MAX_JOBS})")
        next_run = _validate_cron(req.cron_expression)
        job = _scheduler.create_job(req)
        if next_run:
            job = _scheduler.update_next_run(job.id, next_run)
        return job

    @router.get("", response_model=list[Job])
    async def list_jobs(job_type: JobType | None = Query(default=None), _: str | None = Depends(verify_auth_optional)):
        return _scheduler.list_jobs(job_type=job_type)

    @router.get("/{job_id}", response_model=Job)
    async def get_job(job_id: str, _: str | None = Depends(verify_auth_optional)):
        _check_id(job_id, "job_id")
        job = _scheduler.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

    @router.patch("/{job_id}", response_model=Job)
    async def update_job(job_id: str, req: JobUpdate, _: str = Depends(verify_token)):
        _check_id(job_id, "job_id")
        if req.cron_expression is not None:
            next_run = _validate_cron(req.cron_expression)
        else:
            next_run = None
        job = _scheduler.update_job(job_id, req)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        if next_run:
            job = _scheduler.update_next_run(job.id, next_run)
        return job

    @router.delete("/{job_id}")
    async def delete_job(job_id: str, _: str = Depends(verify_token)):
        _check_id(job_id, "job_id")
        if not _scheduler.delete_job(job_id):
            raise HTTPException(status_code=404, detail="Job not found")
        return {"deleted": True}

    @router.post("/{job_id}/run", response_model=dict)
    async def run_job(job_id: str, _: str = Depends(verify_token)):
        _check_id(job_id, "job_id")
        job = _scheduler.get_job(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        executed = await _runner.run_job(job_id)
        return {"executed": executed, "job_id": job_id}

    @router.get("/{job_id}/results", response_model=list[JobResult])
    async def get_results(job_id: str, limit: int = Query(default=10, ge=1, le=50), _: str | None = Depends(verify_auth_optional)):
        _check_id(job_id, "job_id")
        return _scheduler.get_results(job_id, limit=limit)

    @router.post("/run-all", response_model=dict)
    async def run_all_jobs(_: str = Depends(verify_token)):
        count = await _runner.run_due_jobs()
        return {"executed_count": count}

    return router
