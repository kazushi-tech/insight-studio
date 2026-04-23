"""Discovery API routes — competitor URL discovery (M5.2)."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import verify_byok_or_token
from ..analyzer import analyze
from ..extractor import extract
from ..fetcher import fetch_html, take_screenshot
from ..models import ExtractedData
from ..policies import validate_operator_url
from ..repositories.discovery_job_repository import DiscoveryJobRepository
from ..schemas.discovery import (
    DiscoveryAnalyzeRequest,
    DiscoveryAnalyzeResponse,
    FetchedSite,
)
from ..schemas.discovery_job import (
    STAGE_MESSAGES,
    STAGE_PROGRESS,
    STAGE_RETRY_AFTER,
    DiscoveryJobError,
    DiscoveryJobRecord,
    DiscoveryJobResponse,
    DiscoveryJobResultSummary,
    DiscoveryJobStage,
    DiscoveryJobStartResponse,
    DiscoveryJobStatus,
)
from ..schemas.report_envelope import build_envelope_from_md, report_envelope_enabled
from ..services.discovery.candidate_ranker import validate_candidates_with_llm
from ..services.discovery.discovery_pipeline import PipelineError, run_discovery_pipeline
from ..services.discovery.keyword_extractor import classify_industry
from ..llm_client import PROVIDER_ANTHROPIC, normalize_provider, provider_label
from ..services.discovery.anthropic_search_client import (
    SearchClient,
)

logger = logging.getLogger("market-lens.discovery")

_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_PAGE_FETCH_ANALYSIS_SOURCE = "page_fetch"
_FAILED_ANALYSIS_SOURCE = "failed"

# In-memory daily usage counter (reset per process restart)
_daily_search_count = 0
_daily_limit = int(os.getenv("DISCOVERY_DAILY_LIMIT", "100"))


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _rebuild_url(url: str, *, scheme: str | None = None, hostname: str | None = None) -> str:
    parsed = urlparse(url)
    if not parsed.hostname:
        return url

    target_scheme = scheme or parsed.scheme
    target_hostname = hostname or parsed.hostname

    netloc = target_hostname
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    if parsed.username:
        auth = parsed.username
        if parsed.password:
            auth = f"{auth}:{parsed.password}"
        netloc = f"{auth}@{netloc}"

    return parsed._replace(scheme=target_scheme, netloc=netloc).geturl()


def _build_fetch_url_candidates(url: str) -> list[str]:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.hostname:
        return [url]

    candidates = [url]
    host_variants: list[str] = []
    if parsed.hostname.startswith("www."):
        host_variants.append(parsed.hostname[4:])

    for host in host_variants:
        candidate = _rebuild_url(url, hostname=host)
        if candidate not in candidates:
            candidates.append(candidate)

    if parsed.scheme == "https":
        http_candidate = _rebuild_url(url, scheme="http")
        if http_candidate not in candidates:
            candidates.append(http_candidate)
        for host in host_variants:
            candidate = _rebuild_url(url, scheme="http", hostname=host)
            if candidate not in candidates:
                candidates.append(candidate)

    return candidates


def _summarize_errors(errors: list[str]) -> str:
    unique_errors: list[str] = []
    for error in errors:
        if error and error not in unique_errors:
            unique_errors.append(error)

    if not unique_errors:
        return "不明な取得エラー"
    if len(unique_errors) == 1:
        return unique_errors[0]

    summary = " / ".join(unique_errors[:2])
    if len(unique_errors) > 2:
        summary = f"{summary} / 他{len(unique_errors) - 2}件"
    return summary


def _sanitize_secret(text: str, *secrets: str | None) -> str:
    sanitized = text
    for secret in secrets:
        if secret and secret in sanitized:
            sanitized = sanitized.replace(secret, "***")
    return sanitized


_ERROR_CODE_RE = re.compile(r"Error code:\s*(\d+)")


def _humanize_analysis_error(provider_name: str, detail: str) -> tuple[int, str]:
    normalized = detail.lower()
    suffix = f" [{detail[:200]}]" if detail else ""

    code_match = _ERROR_CODE_RE.search(detail)
    status_code = int(code_match.group(1)) if code_match else None

    if "x-api-key" in normalized or "api key" in normalized or "authentication" in normalized:
        return 401, f"Claude API キーが無効か、権限が不足しています。{suffix}"
    if status_code == 429 or ("rate limit" in normalized and status_code != 529):
        return 502, f"Claude API のレート制限に達しました。少し待って再試行してください。{suffix}"
    if status_code == 529 or "overloaded" in normalized:
        return 502, f"Claude API が過負荷状態です。少し待って再試行してください。{suffix}"
    if "credit" in normalized or "balance" in normalized or "billing" in normalized:
        return 502, f"Claude API のクレジット残高または請求設定を確認してください。{suffix}"
    if "quota" in normalized:
        return 502, f"Claude API の利用上限に達しました。{suffix}"
    if "model" in normalized and (
        "not found" in normalized or "invalid" in normalized or "access" in normalized
        or "available" in normalized or "unsupported" in normalized
    ):
        return 502, f"Claude モデル設定またはモデル利用権限を確認してください。{suffix}"
    if detail:
        return 502, f"{provider_name} 呼び出しエラー: {detail[:240]}"
    return 502, f"{provider_name} の APIキーとモデル設定を確認してください。"


def _ensure_discovery_provider_supported(
    provider: str | None,
    model: str | None,
) -> str:
    normalized = normalize_provider(provider, model)
    if normalized != PROVIDER_ANTHROPIC:
        raise HTTPException(
            status_code=422,
            detail=(
                "Discovery では Gemini provider / model はサポートしていません。"
                "Claude を使用してください。"
            ),
        )
    return PROVIDER_ANTHROPIC


def create_discovery_router(
    search_client: SearchClient | None = None,
    *,
    db_session_factory=None,
    job_repo: DiscoveryJobRepository | None = None,
) -> APIRouter:
    """Factory that creates discovery routes.

    Args:
        search_client: Optional search client override (for testing).
        db_session_factory: Optional SQLAlchemy session factory for persistence.
        job_repo: Optional job repository for async job support.
    """
    router = APIRouter(prefix="/api/discovery", tags=["discovery"])

    def _daily_limit_reached() -> bool:
        return _daily_search_count >= _daily_limit

    def _mark_search_consumed() -> None:
        global _daily_search_count
        _daily_search_count += 1

    async def _run_pipeline(
        req: DiscoveryAnalyzeRequest,
        *,
        request_id: str,
        owner_id: str | None = None,
        on_stage=None,
    ) -> DiscoveryAnalyzeResponse:
        return await run_discovery_pipeline(
            req,
            request_id=request_id,
            owner_id=owner_id,
            search_client=search_client,
            on_stage=on_stage,
            validate_operator_url_fn=validate_operator_url,
            fetch_html_fn=fetch_html,
            take_screenshot_fn=take_screenshot,
            extract_fn=extract,
            classify_industry_fn=classify_industry,
            analyze_fn=analyze,
            validate_candidates_fn=validate_candidates_with_llm,  # B-06: re-enabled for industry filtering
            daily_limit_reached=_daily_limit_reached,
            mark_search_consumed=_mark_search_consumed,
        )

    # --- Timeout configuration (env-overridable) ---
    _brand_fetch_timeout = float(os.getenv("DISCOVERY_BRAND_FETCH_TIMEOUT_SEC", "30"))
    _competitor_fetch_timeout = float(os.getenv("DISCOVERY_COMPETITOR_FETCH_TIMEOUT_SEC", "20"))
    _classify_timeout = float(os.getenv("DISCOVERY_CLASSIFY_TIMEOUT_SEC", "6"))
    _search_timeout = float(os.getenv("DISCOVERY_SEARCH_TIMEOUT_SEC", "90"))
    _analyze_timeout = float(os.getenv("DISCOVERY_ANALYZE_TIMEOUT_SEC", "210"))
    try:
        _max_competitors = int(os.getenv("DISCOVERY_MAX_COMPETITORS", "4"))
    except ValueError:
        _max_competitors = 4
    _max_competitors = max(2, min(_max_competitors, 6))

    def _log_stage(
        request_id: str,
        brand_url: str,
        stage: str,
        elapsed_ms: float,
        outcome: str = "ok",
        error_type: str | None = None,
    ) -> None:
        """Emit structured stage timing log."""
        extra = {
            "request_id": request_id,
            "brand_url": brand_url,
            "stage": stage,
            "elapsed_ms": round(elapsed_ms, 1),
            "outcome": outcome,
        }
        if error_type:
            extra["error_type"] = error_type
        logger.info(
            "discovery_stage request_id=%s stage=%s elapsed_ms=%.1f outcome=%s%s",
            request_id, stage, elapsed_ms, outcome,
            f" error_type={error_type}" if error_type else "",
        )

    # ── Async Job endpoints ─────────────────────────────────────

    # In-memory map of running asyncio tasks (job_id -> Task)
    # WARNING: WEB_CONCURRENCY > 1 の場合、このインメモリ辞書は worker 間で共有されない。
    # 必ず WEB_CONCURRENCY=1 (Render 既定) で運用すること。
    _web_concurrency = os.getenv("WEB_CONCURRENCY", "1")
    if _web_concurrency != "1":
        logger.warning(
            "WEB_CONCURRENCY=%s detected. Discovery async jobs use an in-memory task dict "
            "that is NOT shared across workers. Set WEB_CONCURRENCY=1 to avoid job polling failures.",
            _web_concurrency,
        )
    _running_tasks: dict[str, asyncio.Task] = {}
    _overall_job_timeout = float(os.getenv("DISCOVERY_OVERALL_JOB_TIMEOUT_SEC", "360"))
    _stale_threshold_sec = float(os.getenv("DISCOVERY_STALE_THRESHOLD_SEC", "300"))

    def _touch_record(record: DiscoveryJobRecord, now: datetime | None = None) -> datetime:
        current = now or _now()
        record.updated_at = current
        record.heartbeat_at = current
        return current

    def _mark_stage_progress(
        record: DiscoveryJobRecord,
        stage: DiscoveryJobStage,
        *,
        progress_pct: int | None = None,
        message: str | None = None,
        now: datetime | None = None,
    ) -> datetime:
        current = _touch_record(record, now)
        if record.stage != stage or record.stage_started_at is None:
            record.stage_started_at = current
        record.last_progress_at = current
        record.stage = stage
        if progress_pct is not None:
            record.progress_pct = progress_pct
        if message is not None:
            record.message = message
        return current

    def _stage_stall_timeout_sec(stage: DiscoveryJobStage) -> float:
        # fetch_competitors can legitimately run longer now that we fetch up to 4
        # competitors and each candidate may retry multiple URL variants before
        # quality-gated backfill. Keep the stage budget bounded by overall timeout.
        fetch_competitors_budget = min(
            max(((_competitor_fetch_timeout + 2.0) * 4.0 * max(2.0, _max_competitors / 2.0)) + 20.0, 90.0),
            max(_overall_job_timeout - 15.0, 90.0),
        )
        defaults: dict[DiscoveryJobStage, float] = {
            DiscoveryJobStage.queued: 30.0,
            DiscoveryJobStage.brand_fetch: max(_brand_fetch_timeout + 20.0, 30.0),
            DiscoveryJobStage.classify_industry: max(_classify_timeout + 20.0, 30.0),
            DiscoveryJobStage.search: max(_search_timeout + 20.0, 60.0),
            DiscoveryJobStage.fetch_competitors: fetch_competitors_budget,
            DiscoveryJobStage.analyze: min(max(_analyze_timeout + 15.0, 90.0), max(_overall_job_timeout - 5.0, 90.0)),
            DiscoveryJobStage.complete: 30.0,
            DiscoveryJobStage.failed: 30.0,
        }
        env_key = f"DISCOVERY_{stage.value.upper()}_STALL_TIMEOUT_SEC"
        return float(os.getenv(env_key, str(defaults.get(stage, 60.0))))

    @router.post("/jobs", status_code=202)
    async def start_discovery_job(req: DiscoveryAnalyzeRequest, request: Request, _token: str = Depends(verify_byok_or_token)):
        """Start an async discovery job. Returns 202 with poll URL."""
        if job_repo is None:
            raise HTTPException(status_code=501, detail="Async job support is not configured.")

        supported_provider = _ensure_discovery_provider_supported(req.provider, req.model)
        owner_id = request.headers.get("X-Insight-User", "")
        job_id = _new_id()
        now = _now()

        record = DiscoveryJobRecord(
            job_id=job_id,
            owner_id=owner_id,
            brand_url=req.brand_url,
            provider=supported_provider,
            model=req.model,
            status=DiscoveryJobStatus.queued,
            stage=DiscoveryJobStage.queued,
            progress_pct=0,
            message=STAGE_MESSAGES["queued"],
            created_at=now,
            updated_at=now,
            heartbeat_at=now,
            stage_started_at=now,
            last_progress_at=now,
        )
        job_repo.save_job(record)

        async def _run_job():
            nonlocal record
            heartbeat_task = None
            try:
                record.status = DiscoveryJobStatus.running
                record.started_at = _now()
                _touch_record(record, record.started_at)
                job_repo.save_job(record)

                async def _heartbeat():
                    while True:
                        await asyncio.sleep(10)
                        _touch_record(record)
                        job_repo.save_job(record)

                heartbeat_task = asyncio.create_task(_heartbeat())

                async def _on_stage(stage: DiscoveryJobStage, extra: dict):
                    _mark_stage_progress(
                        record,
                        stage,
                        progress_pct=extra.get("progress_pct", STAGE_PROGRESS.get(stage.value, 0)),
                        message=extra.get("message", STAGE_MESSAGES.get(stage.value, "")),
                    )
                    if extra.get("candidate_count") is not None:
                        if record.result_summary is None:
                            record.result_summary = DiscoveryJobResultSummary()
                        record.result_summary.candidate_count = extra["candidate_count"]
                    if extra.get("fetched_count") is not None:
                        if record.result_summary is None:
                            record.result_summary = DiscoveryJobResultSummary()
                        record.result_summary.fetched_count = extra["fetched_count"]
                    if extra.get("analyzed_count") is not None:
                        if record.result_summary is None:
                            record.result_summary = DiscoveryJobResultSummary()
                        record.result_summary.analyzed_count = extra["analyzed_count"]
                    job_repo.save_job(record)

                result = await asyncio.wait_for(
                    run_discovery_pipeline(
                        req,
                        request_id=job_id,
                        owner_id=owner_id,
                        search_client=search_client,
                        on_stage=_on_stage,
                        validate_operator_url_fn=validate_operator_url,
                        fetch_html_fn=fetch_html,
                        take_screenshot_fn=take_screenshot,
                        extract_fn=extract,
                        classify_industry_fn=classify_industry,
                        analyze_fn=analyze,
                        validate_candidates_fn=validate_candidates_with_llm,  # B-06: re-enabled for industry filtering
                        daily_limit_reached=_daily_limit_reached,
                        mark_search_consumed=_mark_search_consumed,
                    ),
                    timeout=_overall_job_timeout,
                )

                result_dict = result.model_dump(mode="json")
                job_repo.save_result(job_id, result_dict)

                record.status = DiscoveryJobStatus.completed
                _mark_stage_progress(
                    record,
                    DiscoveryJobStage.complete,
                    progress_pct=100,
                    message=STAGE_MESSAGES["complete"],
                )
                record.result_summary = DiscoveryJobResultSummary(
                    candidate_count=result.candidate_count,
                    fetched_count=len(result.fetched_sites),
                    analyzed_count=result.analyzed_count,
                )
                job_repo.save_job(record)
                logger.info("Discovery job completed: job_id=%s brand=%s", job_id, req.brand_url)

            except asyncio.TimeoutError:
                last_stage = record.stage.value if record.stage else "unknown"
                record.status = DiscoveryJobStatus.failed
                _mark_stage_progress(
                    record,
                    DiscoveryJobStage.failed,
                    message=STAGE_MESSAGES["failed"],
                )
                record.error = DiscoveryJobError(
                    status_code=504,
                    detail=f"分析がタイムアウトしました（全体{int(_overall_job_timeout)}秒超過、最終ステージ: {last_stage}）",
                    retryable=True,
                )
                job_repo.save_job(record)
                logger.warning("Discovery job timed out: job_id=%s stage=%s", job_id, last_stage)

            except PipelineError as exc:
                record.status = DiscoveryJobStatus.failed
                _mark_stage_progress(
                    record,
                    DiscoveryJobStage.failed,
                    message=STAGE_MESSAGES["failed"],
                )
                record.error = DiscoveryJobError(
                    status_code=exc.status_code,
                    detail=exc.detail,
                    retryable=exc.retryable,
                )
                job_repo.save_job(record)
                logger.warning("Discovery job failed: job_id=%s error=%s", job_id, exc.detail)

            except Exception as exc:
                record.status = DiscoveryJobStatus.failed
                _mark_stage_progress(
                    record,
                    DiscoveryJobStage.failed,
                    message=STAGE_MESSAGES["failed"],
                )
                record.error = DiscoveryJobError(
                    status_code=500,
                    detail=f"予期しないエラーが発生しました: {type(exc).__name__}",
                    retryable=True,
                )
                job_repo.save_job(record)
                logger.error("Discovery job unexpected error: job_id=%s error=%s", job_id, exc, exc_info=True)

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

        return DiscoveryJobStartResponse(
            job_id=job_id,
            status=DiscoveryJobStatus.queued,
            stage=DiscoveryJobStage.queued,
            poll_url=f"/api/discovery/jobs/{job_id}",
            retry_after_sec=3,
        )

    @router.get("/jobs/{job_id}")
    async def get_discovery_job(job_id: str, request: Request, _token: str = Depends(verify_byok_or_token)):
        """Poll discovery job status."""
        if job_repo is None:
            raise HTTPException(status_code=501, detail="Async job support is not configured.")

        record = job_repo.load_job(job_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Job not found.")

        # Owner scope check
        owner_id = request.headers.get("X-Insight-User", "")
        if record.owner_id and owner_id != record.owner_id:
            raise HTTPException(status_code=404, detail="Job not found.")

        # Stale running detection: if job hasn't updated in threshold and task is gone, fail it
        if record.status in (DiscoveryJobStatus.running, DiscoveryJobStatus.queued):
            now = _now()
            heartbeat_ref = record.heartbeat_at or record.updated_at
            heartbeat_elapsed_sec = (now - heartbeat_ref).total_seconds()
            stage_ref = record.last_progress_at or record.stage_started_at or record.updated_at
            stage_elapsed_sec = (now - stage_ref).total_seconds()
            stage_timeout_sec = _stage_stall_timeout_sec(record.stage)
            task = _running_tasks.get(job_id)
            task_gone = task is None or task.done()
            stalled_stage = stage_elapsed_sec > stage_timeout_sec
            # deploy 直後の in-flight job が誤殺されないよう 10s → 30s に緩和
            missing_heartbeat = heartbeat_elapsed_sec > _stale_threshold_sec or (task_gone and heartbeat_elapsed_sec > 30)
            if stalled_stage or missing_heartbeat:
                last_stage = record.stage.value if record.stage else "unknown"
                record.status = DiscoveryJobStatus.failed
                stage_label = STAGE_MESSAGES.get(last_stage, last_stage)
                _mark_stage_progress(
                    record,
                    DiscoveryJobStage.failed,
                    message=STAGE_MESSAGES["failed"],
                    now=now,
                )
                if stalled_stage:
                    detail = (
                        f"「{stage_label}」が{int(stage_elapsed_sec)}秒以上進行していません。"
                        " 再試行してください。"
                    )
                else:
                    detail = (
                        f"ジョブが応答しなくなりました（最終ステージ: {last_stage}、"
                        f"経過: {int(heartbeat_elapsed_sec)}秒）。再試行してください。"
                    )
                record.error = DiscoveryJobError(
                    status_code=504,
                    detail=detail,
                    retryable=True,
                )
                job_repo.save_job(record)
                logger.warning(
                    "Stale job auto-failed: job_id=%s last_stage=%s heartbeat_elapsed=%ds stage_elapsed=%ds task_gone=%s stalled_stage=%s",
                    job_id, last_stage, int(heartbeat_elapsed_sec), int(stage_elapsed_sec), task_gone, stalled_stage,
                )

        result = None
        if record.status == DiscoveryJobStatus.completed:
            result = job_repo.load_result(job_id)

        return DiscoveryJobResponse(
            job_id=record.job_id,
            status=record.status,
            stage=record.stage,
            progress_pct=record.progress_pct,
            created_at=record.created_at,
            started_at=record.started_at,
            updated_at=record.updated_at,
            heartbeat_at=record.heartbeat_at,
            stage_started_at=record.stage_started_at,
            last_progress_at=record.last_progress_at,
            brand_url=record.brand_url,
            message=record.message,
            result=result,
            error=record.error,
            result_summary=record.result_summary,
            retry_after_sec=STAGE_RETRY_AFTER.get(record.stage.value, 3),
        )

    @router.get("/jobs/{job_id}/report.json")
    async def get_discovery_envelope(
        job_id: str,
        request: Request,
        _token: str = Depends(verify_byok_or_token),
    ):
        """Return a ReportEnvelope v0 for a completed discovery job.

        Flag-gated by REPORT_ENVELOPE_V0. Owner scoping matches the parent
        `/jobs/{job_id}` endpoint.
        """
        if not report_envelope_enabled():
            raise HTTPException(status_code=404, detail="ReportEnvelope v0 is not enabled.")
        if job_repo is None:
            raise HTTPException(status_code=501, detail="Async job support is not configured.")

        record = job_repo.load_job(job_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Job not found.")

        owner_id = request.headers.get("X-Insight-User", "")
        if record.owner_id and owner_id != record.owner_id:
            raise HTTPException(status_code=404, detail="Job not found.")

        if record.status != DiscoveryJobStatus.completed:
            raise HTTPException(status_code=409, detail="Discovery job is not completed yet.")

        result = job_repo.load_result(job_id)
        report_md = ""
        if result is not None:
            report_md = getattr(result, "report_md", "") or ""

        envelope = build_envelope_from_md(
            report_id=job_id,
            kind="discovery",
            report_md=report_md,
        )
        return envelope.model_dump()

    return router
