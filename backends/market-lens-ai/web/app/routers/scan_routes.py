"""Scan routes."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from ..models import ScanRequest, ScanResponse, ScanResult, ExtractedData
from ..policies import validate_urls
from ..repositories.scan_repository import ScanRepository
from ..repositories.scan_job_repository import ScanJobRepository
from ..schemas.scan_job import (
    STAGE_MESSAGES,
    STAGE_PROGRESS,
    STAGE_RETRY_AFTER,
    ScanJobError,
    ScanJobRecord,
    ScanJobResponse,
    ScanJobStage,
    ScanJobStartResponse,
    ScanJobStatus,
)
from ..services.scan_service import execute_scan
from ..smoke_mode import is_smoke_mode, smoke_scan_result
from ..user_context import get_optional_user_id

logger = logging.getLogger("market-lens")


def _new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_scan_router(repo: ScanRepository, job_repo: ScanJobRepository | None = None) -> APIRouter:
    """Factory that creates a scan router wired to the given repository."""
    router = APIRouter()

    # ── Sync endpoint (legacy) ─────────────────────────────────

    @router.post("/api/scan", response_model=ScanResponse)
    async def scan(req: ScanRequest, owner_id: str | None = Depends(get_optional_user_id)):
        if is_smoke_mode():
            logger.info("[SMOKE] Returning deterministic scan result")
            run_id = uuid.uuid4().hex[:12]
            result_data = smoke_scan_result(req.urls, run_id)
            scan_result = ScanResult(
                run_id=run_id,
                owner_id=owner_id,
                status="completed",
                urls=req.urls,
                extracted=[ExtractedData(**e) for e in result_data.get("_extracted", [])],
                report_md=result_data["report_md"],
                total_time_sec=result_data["total_time_sec"],
            )
            repo.save(scan_result)
            return ScanResponse(**result_data)

        errors = validate_urls(req.urls)
        if errors:
            logger.info("Scan rejected: %s", errors)
            raise HTTPException(status_code=422, detail=errors)
        return await execute_scan(req, repo, owner_id=owner_id)

    # ── Async job endpoints ────────────────────────────────────

    _running_tasks: dict[str, asyncio.Task] = {}
    _overall_job_timeout = float(os.getenv("SCAN_OVERALL_JOB_TIMEOUT_SEC", "600"))
    _stale_threshold_sec = float(os.getenv("SCAN_STALE_THRESHOLD_SEC", "300"))

    def _touch_record(record: ScanJobRecord, now: datetime | None = None) -> datetime:
        current = now or _now()
        record.updated_at = current
        record.heartbeat_at = current
        return current

    def _mark_stage(
        record: ScanJobRecord,
        stage: ScanJobStage,
        *,
        progress_pct: int | None = None,
        message: str | None = None,
        now: datetime | None = None,
    ) -> None:
        _touch_record(record, now)
        record.stage = stage
        if progress_pct is not None:
            record.progress_pct = progress_pct
        if message is not None:
            record.message = message

    @router.post("/api/scan/jobs", status_code=202)
    async def start_scan_job(req: ScanRequest, request: Request, owner_id: str | None = Depends(get_optional_user_id)):
        """Start an async scan job. Returns 202 with poll URL."""
        if job_repo is None:
            raise HTTPException(status_code=501, detail="Async scan job support is not configured.")

        errors = validate_urls(req.urls)
        if errors:
            raise HTTPException(status_code=422, detail=errors)

        job_id = _new_job_id()
        now = _now()
        record = ScanJobRecord(
            job_id=job_id,
            owner_id=owner_id or request.headers.get("X-Insight-User", ""),
            urls=req.urls,
            provider=req.provider,
            model=req.model,
            api_key=req.api_key,
            status=ScanJobStatus.queued,
            stage=ScanJobStage.queued,
            progress_pct=0,
            message=STAGE_MESSAGES["queued"],
            created_at=now,
            updated_at=now,
            heartbeat_at=now,
        )
        job_repo.save_job(record)

        async def _run_job():
            nonlocal record
            heartbeat_task = None
            try:
                record.status = ScanJobStatus.running
                record.started_at = _now()
                _touch_record(record, record.started_at)
                job_repo.save_job(record)

                async def _heartbeat():
                    while True:
                        await asyncio.sleep(10)
                        _touch_record(record)
                        job_repo.save_job(record)

                heartbeat_task = asyncio.create_task(_heartbeat())

                async def _on_stage(stage: str, extra: dict):
                    _mark_stage(
                        record,
                        ScanJobStage(stage),
                        progress_pct=extra.get("progress_pct", STAGE_PROGRESS.get(stage, 0)),
                        message=extra.get("message", STAGE_MESSAGES.get(stage, "")),
                    )
                    job_repo.save_job(record)

                result = await asyncio.wait_for(
                    execute_scan(req, repo, owner_id=record.owner_id or None, on_stage=_on_stage),
                    timeout=_overall_job_timeout,
                )

                result_dict = result.model_dump(mode="json")
                job_repo.save_result(job_id, result_dict)

                record.status = ScanJobStatus.completed
                _mark_stage(record, ScanJobStage.complete, progress_pct=100, message=STAGE_MESSAGES["complete"])
                job_repo.save_job(record)
                logger.info("Scan job completed: job_id=%s urls=%s", job_id, req.urls)

            except asyncio.TimeoutError:
                record.status = ScanJobStatus.failed
                _mark_stage(record, ScanJobStage.failed, message=STAGE_MESSAGES["failed"])
                record.error = ScanJobError(
                    status_code=504,
                    detail=f"分析がタイムアウトしました（全体{int(_overall_job_timeout)}秒超過）。再試行してください。",
                    retryable=True,
                )
                job_repo.save_job(record)
                logger.warning("Scan job timed out: job_id=%s", job_id)

            except Exception as exc:
                record.status = ScanJobStatus.failed
                _mark_stage(record, ScanJobStage.failed, message=STAGE_MESSAGES["failed"])
                record.error = ScanJobError(
                    status_code=500,
                    detail=f"予期しないエラーが発生しました: {type(exc).__name__}",
                    retryable=True,
                )
                job_repo.save_job(record)
                logger.error("Scan job unexpected error: job_id=%s error=%s", job_id, exc, exc_info=True)

            finally:
                if heartbeat_task and not heartbeat_task.done():
                    heartbeat_task.cancel()
                    try:
                        await heartbeat_task
                    except asyncio.CancelledError:
                        pass
                _running_tasks.pop(job_id, None)

        task = asyncio.create_task(_run_job())
        _running_tasks[job_id] = task

        return ScanJobStartResponse(
            job_id=job_id,
            status=ScanJobStatus.queued,
            stage=ScanJobStage.queued,
            poll_url=f"/api/scan/jobs/{job_id}",
            retry_after_sec=3,
        )

    @router.get("/api/scan/jobs/{job_id}")
    async def get_scan_job_status(job_id: str, request: Request, owner_id: str | None = Depends(get_optional_user_id)):
        """Poll scan job status."""
        if job_repo is None:
            raise HTTPException(status_code=501, detail="Async scan job support is not configured.")

        record = job_repo.load_job(job_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Job not found.")

        # Owner scope check
        request_owner = owner_id or request.headers.get("X-Insight-User", "")
        if record.owner_id and request_owner != record.owner_id:
            raise HTTPException(status_code=404, detail="Job not found.")

        # Stale running detection
        if record.status in (ScanJobStatus.running, ScanJobStatus.queued):
            now = _now()
            heartbeat_ref = record.heartbeat_at or record.updated_at
            heartbeat_elapsed_sec = (now - heartbeat_ref).total_seconds()
            task = _running_tasks.get(job_id)
            task_gone = task is None or task.done()
            missing_heartbeat = heartbeat_elapsed_sec > _stale_threshold_sec or (task_gone and heartbeat_elapsed_sec > 10)
            if missing_heartbeat:
                record.status = ScanJobStatus.failed
                _mark_stage(record, ScanJobStage.failed, message=STAGE_MESSAGES["failed"], now=now)
                record.error = ScanJobError(
                    status_code=504,
                    detail=f"ジョブが応答しなくなりました（経過: {int(heartbeat_elapsed_sec)}秒）。再試行してください。",
                    retryable=True,
                )
                job_repo.save_job(record)
                logger.warning(
                    "Stale scan job auto-failed: job_id=%s heartbeat_elapsed=%ds task_gone=%s",
                    job_id, int(heartbeat_elapsed_sec), task_gone,
                )

        result = None
        if record.status == ScanJobStatus.completed:
            result = job_repo.load_result(job_id)

        return ScanJobResponse(
            job_id=record.job_id,
            status=record.status,
            stage=record.stage,
            progress_pct=record.progress_pct,
            created_at=record.created_at,
            started_at=record.started_at,
            updated_at=record.updated_at,
            heartbeat_at=record.heartbeat_at,
            urls=record.urls,
            message=record.message,
            result=result,
            error=record.error,
            retry_after_sec=STAGE_RETRY_AFTER.get(record.stage.value, 5),
        )

    return router
