"""Durable analysis worker entrypoint.

The HTTP process only enqueues and polls jobs in worker mode.  This module is
the sole process that executes the analysis payloads and owns their leases.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Mapping

from .analysis_backend import (
    AnalysisJob,
    AnalysisJobStatus,
    AnalysisJobType,
    HEARTBEAT_SECONDS,
    JobBackendMode,
    PostgresAnalysisJobBackend,
    WORKER_CONCURRENCY,
    create_analysis_job_backend,
)
from ..observability import (
    capture_exception_safe,
    initialize_sentry,
    log_event,
    workspace_hash,
)
from ..tenant_auth import (
    TenantContext,
    get_managed_session_factory,
    reset_current_tenant_context,
    set_current_tenant_context,
)


ProgressCallback = Callable[[str, int | None], Awaitable[bool]]
JobHandler = Callable[[AnalysisJob, ProgressCallback], Awaitable[Mapping[str, Any]]]


@dataclass(frozen=True)
class WorkerRuntime:
    worker_id: str
    concurrency: int = WORKER_CONCURRENCY
    heartbeat_seconds: int = HEARTBEAT_SECONDS


class AnalysisJobCanceled(RuntimeError):
    """Raised at a durable step boundary after the lease was canceled/lost."""


class AnalysisWorker:
    def __init__(
        self,
        backend: PostgresAnalysisJobBackend,
        handlers: Mapping[AnalysisJobType, JobHandler],
        *,
        runtime: WorkerRuntime | None = None,
    ) -> None:
        self.backend = backend
        self.handlers = dict(handlers)
        self.runtime = runtime or WorkerRuntime(worker_id=_worker_id())
        if self.runtime.concurrency != WORKER_CONCURRENCY:
            raise ValueError("Analysis worker concurrency is fixed at 2")
        if self.runtime.heartbeat_seconds >= self.backend.settings.lease_seconds:
            raise ValueError("Heartbeat must be shorter than the lease")

    async def run_once(self) -> bool:
        self.backend.register_worker(self.runtime.worker_id)
        try:
            if not self.backend.heartbeat_worker(
                self.runtime.worker_id,
                state="ready",
                active_jobs=0,
            ):
                raise RuntimeError("Analysis worker registration disappeared")
            job = self.backend.claim_next(self.runtime.worker_id)
            if job is None:
                return False
            if not self.backend.heartbeat_worker(
                self.runtime.worker_id,
                state="busy",
                active_jobs=1,
            ):
                raise RuntimeError("Analysis worker heartbeat failed")
            await self._process(job)
            return True
        finally:
            self.backend.mark_worker_stopped(self.runtime.worker_id)

    async def run_forever(self, *, poll_interval_seconds: float = 1.0) -> None:
        """Continuously claim jobs, with exactly two active execution slots."""

        active: set[asyncio.Task[None]] = set()
        last_liveness_at = 0.0

        def publish_liveness(*, force: bool = False) -> None:
            nonlocal last_liveness_at
            current = time.monotonic()
            if not force and current - last_liveness_at < self.runtime.heartbeat_seconds:
                return
            active_jobs = len(active)
            state = "busy" if active_jobs else "ready"
            if not self.backend.heartbeat_worker(
                self.runtime.worker_id,
                state=state,
                active_jobs=active_jobs,
            ):
                raise RuntimeError("Analysis worker heartbeat registry is unavailable")
            last_liveness_at = current

        self.backend.register_worker(self.runtime.worker_id)
        try:
            publish_liveness(force=True)
            while True:
                publish_liveness()
                claimed_any = False
                while len(active) < self.runtime.concurrency:
                    job = self.backend.claim_next(self.runtime.worker_id)
                    if job is None:
                        break
                    active.add(asyncio.create_task(self._process(job)))
                    claimed_any = True
                if claimed_any:
                    publish_liveness(force=True)
                if active:
                    done, active = await asyncio.wait(
                        active,
                        timeout=max(0.05, poll_interval_seconds),
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for task in done:
                        await task
                    if done:
                        publish_liveness(force=True)
                else:
                    await asyncio.sleep(max(0.05, poll_interval_seconds))
        finally:
            for task in active:
                task.cancel()
            if active:
                await asyncio.gather(*active, return_exceptions=True)
            self.backend.mark_worker_stopped(self.runtime.worker_id)

    async def _process(self, job: AnalysisJob) -> None:
        handler = self.handlers.get(job.job_type)
        if handler is None:
            failed = self.backend.fail(
                job.id,
                self.runtime.worker_id,
                {"code": "unsupported_job_type", "retryable": False},
                retryable=False,
            )
            if failed:
                self._record_terminal_job(job.id, AnalysisJobStatus.failed)
            return

        token = set_current_tenant_context(
            TenantContext(
                auth_kind="worker",
                owner_id=job.owner_id,
                workspace_id=job.workspace_id,
                project_id=job.project_id,
                app_user_id=job.created_by_user_id,
            )
        )
        started = time.monotonic()
        heartbeat_task: asyncio.Task[None] | None = None
        cancellation_observed = asyncio.Event()

        async def progress(stage: str, progress_pct: int | None = None) -> bool:
            if cancellation_observed.is_set():
                raise AnalysisJobCanceled("analysis job is no longer active")
            stage_value = getattr(stage, "value", stage)
            active = self.backend.heartbeat(
                job.id,
                self.runtime.worker_id,
                stage=str(stage_value),
                progress_pct=progress_pct,
            )
            if not active:
                cancellation_observed.set()
                raise AnalysisJobCanceled("analysis job is no longer active")
            return True

        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(self.runtime.heartbeat_seconds)
                if not self.backend.heartbeat(job.id, self.runtime.worker_id):
                    cancellation_observed.set()
                    return

        try:
            log_event(
                "info",
                "analysis_job_started",
                job_id=job.id,
                workspace_hash=workspace_hash(job.workspace_id),
                stage="claimed",
            )
            heartbeat_task = asyncio.create_task(heartbeat())
            await progress("starting", 1)
            raw_result = handler(job, progress)
            if inspect.isawaitable(raw_result):
                raw_result = await raw_result
            result = _json_mapping(raw_result)

            # A provider call cannot always be interrupted safely.  Recheck the
            # lease immediately after it returns so a canceled job can never
            # persist an artifact, usage row, or terminal success.
            await progress("finalizing", 95)

            encoded = json.dumps(
                result,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            ).encode("utf-8")
            artifact_id = self.backend.record_artifact(
                job,
                artifact_type=f"{job.job_type.value}_result",
                storage_kind="database",
                storage_ref=f"analysis_jobs/{job.id}/result",
                content_sha256=hashlib.sha256(encoded).hexdigest(),
                size_bytes=len(encoded),
                mime_type="application/json",
            )
            if artifact_id is None:
                cancellation_observed.set()
                raise AnalysisJobCanceled("analysis job was canceled before artifact persistence")
            await progress("recording_usage", 97)
            usage = result.get("token_usage")
            usage_map = usage if isinstance(usage, Mapping) else {}
            self.backend.record_ai_usage(
                job,
                provider=str(job.payload.get("provider") or "configured"),
                model=(str(job.payload["model"]) if job.payload.get("model") else None),
                operation=job.job_type.value,
                input_tokens=int(usage_map.get("input_tokens") or 0),
                output_tokens=int(usage_map.get("output_tokens") or 0),
            )
            await progress("completing", 99)
            completed = self.backend.complete(job.id, self.runtime.worker_id, result)
            if completed:
                self._record_terminal_job(job.id, AnalysisJobStatus.succeeded)
                log_event(
                    "info",
                    "analysis_job_completed",
                    job_id=job.id,
                    workspace_hash=workspace_hash(job.workspace_id),
                    stage="complete",
                    duration_ms=round((time.monotonic() - started) * 1000, 1),
                )
        except AnalysisJobCanceled:
            self._record_terminal_job(job.id, AnalysisJobStatus.canceled)
            log_event(
                "info",
                "analysis_job_canceled",
                job_id=job.id,
                workspace_hash=workspace_hash(job.workspace_id),
                stage="canceled",
                duration_ms=round((time.monotonic() - started) * 1000, 1),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            retryable = _is_retryable(exc)
            error_code = type(exc).__name__[:80]
            capture_exception_safe(
                exc,
                error_code=error_code,
                stage="analysis_job",
            )
            failed = self.backend.fail(
                job.id,
                self.runtime.worker_id,
                {"code": error_code, "retryable": retryable},
                retryable=retryable,
            )
            if failed and (not retryable or job.attempts >= self.backend.settings.max_attempts):
                self._record_terminal_job(job.id, AnalysisJobStatus.failed)
            log_event(
                "error",
                "analysis_job_failed",
                job_id=job.id,
                workspace_hash=workspace_hash(job.workspace_id),
                stage="failed",
                duration_ms=round((time.monotonic() - started) * 1000, 1),
                error_code=error_code,
            )
        finally:
            if heartbeat_task is not None:
                heartbeat_task.cancel()
                try:
                    await heartbeat_task
                except asyncio.CancelledError:
                    pass
            reset_current_tenant_context(token)

    def _record_terminal_job(
        self,
        job_id: str,
        status: AnalysisJobStatus,
    ) -> None:
        try:
            self.backend.record_worker_job_result(
                self.runtime.worker_id,
                job_id,
                status,
            )
        except Exception as exc:
            capture_exception_safe(
                exc,
                error_code=type(exc).__name__,
                stage="worker_heartbeat",
            )
            log_event(
                "error",
                "analysis_worker_evidence_failed",
                job_id=job_id,
                stage="worker_heartbeat",
                error_code=type(exc).__name__[:80],
            )


def build_default_handlers(repository_bundle) -> dict[AnalysisJobType, JobHandler]:
    async def scan_handler(job: AnalysisJob, progress: ProgressCallback):
        from ..models import ScanRequest
        from ..services.scan_service import execute_scan

        req = ScanRequest(**job.payload)

        async def on_stage(stage: str, extra: dict[str, Any]):
            await progress(stage, extra.get("progress_pct"))

        result = await execute_scan(
            req,
            repository_bundle.scan_repo,
            owner_id=job.owner_id,
            on_stage=on_stage,
        )
        return result.model_dump(mode="json")

    async def discovery_handler(job: AnalysisJob, progress: ProgressCallback):
        from ..schemas.discovery import DiscoveryAnalyzeRequest
        from ..services.discovery.candidate_ranker import validate_candidates_with_llm
        from ..services.discovery.discovery_pipeline import run_discovery_pipeline

        req = DiscoveryAnalyzeRequest(**job.payload)

        async def on_stage(stage, extra: dict[str, Any]):
            await progress(str(getattr(stage, "value", stage)), extra.get("progress_pct"))

        result = await run_discovery_pipeline(
            req,
            request_id=job.id,
            owner_id=job.owner_id,
            on_stage=on_stage,
            validate_candidates_fn=validate_candidates_with_llm,
        )
        return result.model_dump(mode="json")

    async def compare_handler(job: AnalysisJob, progress: ProgressCallback):
        from ..schemas.competitor_compare import CompareReviewRequest
        from ..services.review.competitor_compare_service import review_competitor_compare

        req = CompareReviewRequest(**job.payload)
        await progress("analyzing", 30)

        async def cancel_check() -> None:
            await progress("analyzing", 30)

        result = await review_competitor_compare(
            asset_id=req.asset_id,
            competitors=req.competitors,
            repo=repository_bundle.asset_repo,
            brand_info=req.brand_info,
            operator_memo=req.operator_memo,
            model=req.model,
            provider=req.provider,
            cancel_check=cancel_check,
        )
        return result.model_dump(mode="json")

    async def creative_handler(job: AnalysisJob, progress: ProgressCallback):
        from ..schemas.review_request import AdLpReviewRequest, BannerReviewRequest
        from ..services.review.ad_lp_fit_service import review_ad_lp_fit
        from ..services.review.banner_review_service import review_banner

        kind = str(job.payload.get("review_kind") or "banner")
        body = dict(job.payload)
        body.pop("review_kind", None)
        await progress("analyzing", 30)

        async def cancel_check() -> None:
            await progress("analyzing", 30)

        if kind == "ad_lp":
            req = AdLpReviewRequest(**body)
            result = await review_ad_lp_fit(
                asset_id=req.asset_id,
                landing_page=req.landing_page,
                repo=repository_bundle.asset_repo,
                brand_info=req.brand_info,
                operator_memo=req.operator_memo,
                model=req.model,
                provider=req.provider,
                cancel_check=cancel_check,
            )
        else:
            req = BannerReviewRequest(**body)
            result = await review_banner(
                asset_id=req.asset_id,
                repo=repository_bundle.asset_repo,
                brand_info=req.brand_info,
                operator_memo=req.operator_memo,
                model=req.model,
                provider=req.provider,
                cancel_check=cancel_check,
            )
        return result.model_dump(mode="json")

    return {
        AnalysisJobType.scan: scan_handler,
        AnalysisJobType.discovery: discovery_handler,
        AnalysisJobType.compare: compare_handler,
        AnalysisJobType.creative_review: creative_handler,
    }


def _json_mapping(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    if not isinstance(value, Mapping):
        raise TypeError("Analysis handler must return a mapping")
    return json.loads(json.dumps(dict(value), ensure_ascii=False, default=str))


def _is_retryable(exc: Exception) -> bool:
    status_code = getattr(exc, "status_code", None)
    if status_code is not None:
        return int(status_code) in {408, 425, 429, 500, 502, 503, 504}
    return not isinstance(exc, (TypeError, ValueError))


def _worker_id() -> str:
    # Keep infrastructure hostnames, process ids and credentials out of the
    # durable readiness registry.  The random id is sufficient to distinguish
    # multiple live worker processes.
    return f"wrk_{uuid.uuid4().hex[:24]}"


async def _main() -> None:
    from ..repositories.tenant_db_repository import create_tenant_repository_bundle

    initialize_sentry()
    try:
        backend = create_analysis_job_backend(get_managed_session_factory())
        if getattr(backend, "mode", None) != JobBackendMode.worker:
            raise RuntimeError("Analysis worker requires MARKET_LENS_JOB_BACKEND=worker")
        bundle = create_tenant_repository_bundle(verify_connection=True)
        worker = AnalysisWorker(backend, build_default_handlers(bundle))
        await worker.run_forever()
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        capture_exception_safe(
            exc,
            error_code=type(exc).__name__,
            stage="worker_runtime",
        )
        raise


if __name__ == "__main__":
    asyncio.run(_main())
