"""Discovery pipeline service — extracted from discovery_routes.py.

Runs the full one-click discovery pipeline with stage callbacks.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional
from urllib.parse import urlparse

from ...analyzer import analyze
from ...extractor import extract
from ...fetcher import fetch_html, take_screenshot
from ...llm_client import PROVIDER_ANTHROPIC, normalize_provider, provider_label
from ...models import ScanResult
from ...policies import validate_operator_url
from ...report_generator import ReportBundle, generate_report_bundle
from ...schemas.discovery import (
    DiscoveryAnalyzeRequest,
    DiscoveryAnalyzeResponse,
    FetchedSite,
)
from ...schemas.discovery_job import DiscoveryJobStage
from .anthropic_search_client import AnthropicSearchClient, SearchClient, SearchClientError
from .candidate_ranker import (
    compute_extraction_quality,
    detect_garbled_ratio,
    _EXTRACTION_QUALITY_LOW,
    _EXTRACTION_QUALITY_WARN,
    rank_candidates,
    RankedCandidate,
)
from .keyword_extractor import classify_industry, extract_domain, extract_search_queries
from .pipeline_metrics import PipelineBudgetTracker

logger = logging.getLogger("market-lens.discovery.pipeline")

_PAGE_FETCH_ANALYSIS_SOURCE = "page_fetch"
_FAILED_ANALYSIS_SOURCE = "failed"
_DEFAULT_MAX_COMPETITORS = 4
_MIN_MAX_COMPETITORS = 2
_MAX_MAX_COMPETITORS = 6
_DEFAULT_ANALYZE_SITE_LIMIT = 3  # brand + top 2 competitors (was 4; reduced to keep analyze within budget)
_DEFAULT_DISCOVERY_FALLBACK_MODEL = "claude-haiku-4-5-20251001"

StageCallback = Callable[[DiscoveryJobStage, dict], Awaitable[None] | None]
ValidateUrlFn = Callable[[str], str | None]
FetchHtmlFn = Callable[..., Awaitable[tuple[str, str | None]]]
TakeScreenshotFn = Callable[..., Awaitable[str | None]]
ExtractFn = Callable[[str, str], object]
ClassifyIndustryFn = Callable[..., Awaitable[str]]
AnalyzeFn = Callable[..., Awaitable[tuple[str, object | None]]]
ValidateCandidatesFn = Callable[..., Awaitable[list]]
DailyLimitReachedFn = Callable[[], bool]
MarkSearchConsumedFn = Callable[[], None]


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


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


def _humanize_search_error(detail: str) -> tuple[int, str]:
    normalized = detail.lower()
    if "api key" in normalized or "x-api-key" in normalized or "authentication" in normalized or "unauthorized" in normalized:
        return 401, "Discovery 検索で使用する Claude API キーが無効か、権限が不足しています。"
    if "rate limit" in normalized or "too_many_requests" in normalized or "try again later" in normalized:
        return 502, "Claude Web Search が混み合っています。少し待って再試行してください。"
    if "max_uses_exceeded" in normalized:
        return 502, "Claude Web Search の検索回数上限に達しました。設定を確認してください。"
    if "query_too_long" in normalized or "invalid_tool_input" in normalized:
        return 502, "競合検索クエリが不正です。入力内容を見直してください。"
    if "web search" in normalized and "enabled" in normalized:
        return 502, "Claude Web Search が有効化されていません。Anthropic Console の設定を確認してください。"
    if "unavailable" in normalized:
        return 502, "Claude Web Search が一時的に利用できません。少し待って再試行してください。"
    if "timed out" in normalized or "deadline exceeded" in normalized:
        return 502, "競合検索がタイムアウトしました。少し待って再試行してください。"
    if detail:
        cleaned = detail
        for prefix in ("Anthropic Search error:", "Anthropic Search error", "Anthropic web search error:"):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):].strip()
                break
        if cleaned:
            return 502, f"競合検索に失敗しました: {cleaned[:240]}"
    return 502, "競合検索に失敗しました。少し待って再試行してください。"


def _search_error_type(exc: SearchClientError) -> str:
    cause = exc.__cause__
    if cause is not None:
        return type(cause).__name__
    return type(exc).__name__


class PipelineError(Exception):
    """Raised when the discovery pipeline fails with a user-facing error."""

    def __init__(self, status_code: int, detail: str, *, stage: str = "", retryable: bool = True):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.stage = stage
        self.retryable = retryable


@dataclass(frozen=True)
class AnalysisAttempt:
    label: str
    site_limit: int
    model: str | None
    timeout_sec: float
    progress_pct: int


def _log_stage(
    request_id: str,
    brand_url: str,
    stage: str,
    elapsed_ms: float,
    outcome: str = "ok",
    error_type: str | None = None,
) -> None:
    extra = {"request_id": request_id, "brand_url": brand_url, "stage": stage,
             "elapsed_ms": round(elapsed_ms, 1), "outcome": outcome}
    if error_type:
        extra["error_type"] = error_type
    logger.info(
        "discovery_stage request_id=%s stage=%s elapsed_ms=%.1f outcome=%s%s",
        request_id, stage, elapsed_ms, outcome,
        f" error_type={error_type}" if error_type else "",
    )


async def _notify_stage(
    on_stage: StageCallback | None,
    stage: DiscoveryJobStage,
    extra: dict | None = None,
) -> None:
    if on_stage is None:
        return
    result = on_stage(stage, extra or {})
    if asyncio.iscoroutine(result):
        await result


def _resolve_timeouts() -> dict[str, float]:
    return {
        "brand_fetch_timeout": float(os.getenv("DISCOVERY_BRAND_FETCH_TIMEOUT_SEC", "10")),
        "competitor_fetch_timeout": float(os.getenv("DISCOVERY_COMPETITOR_FETCH_TIMEOUT_SEC", "12")),
        "classify_timeout": float(os.getenv("DISCOVERY_CLASSIFY_TIMEOUT_SEC", "6")),
        "search_timeout": float(os.getenv("DISCOVERY_SEARCH_TIMEOUT_SEC", "45")),
        "analyze_timeout": float(os.getenv("DISCOVERY_ANALYZE_TIMEOUT_SEC", "210")),
    }


def _resolve_max_competitors() -> int:
    raw = os.getenv("DISCOVERY_MAX_COMPETITORS", str(_DEFAULT_MAX_COMPETITORS))
    try:
        value = int(raw)
    except ValueError:
        value = _DEFAULT_MAX_COMPETITORS
    return max(_MIN_MAX_COMPETITORS, min(value, _MAX_MAX_COMPETITORS))


def _resolve_analyze_site_limit() -> int:
    raw = os.getenv("DISCOVERY_ANALYZE_SITE_LIMIT", str(_DEFAULT_ANALYZE_SITE_LIMIT))
    try:
        value = int(raw)
    except ValueError:
        value = _DEFAULT_ANALYZE_SITE_LIMIT
    return max(2, min(value, _MAX_MAX_COMPETITORS + 1))


def _resolve_discovery_fallback_model(primary_model: str | None) -> str | None:
    fallback = (os.getenv("ANTHROPIC_DISCOVERY_FALLBACK_MODEL", _DEFAULT_DISCOVERY_FALLBACK_MODEL) or "").strip()
    if not fallback or fallback == primary_model:
        return None
    return fallback


def _is_retryable_analysis_exception(exc: Exception) -> bool:
    if isinstance(exc, asyncio.TimeoutError):
        return True
    normalized = str(exc).lower()
    retry_tokens = (
        "timeout",
        "timed out",
        "overloaded",
        "rate limit",
        "too many requests",
        "try again later",
        "unavailable",
        "temporarily",
        "connection",
        "network",
        "deadline exceeded",
        "busy",
        "503",
        "529",
    )
    return any(token in normalized for token in retry_tokens)


def _is_retryable_quality_issue(issues: list[str]) -> bool:
    if not issues:
        return False
    retryable_tokens = (
        "末尾欠け",
        "見出し欠損",
        "セクション欠損",
        "テーブル",
        "構造エラー",
        "Section 5",
        "Section 4 途中切断",
        # Phase P1-C: explicit subsection misses must also trigger a retry.
        "最優先3施策",
        "予算フレーム",
        "LP改善施策",
        "検索広告施策",
    )
    return any(any(token in issue for token in retryable_tokens) for issue in issues)


def _evaluate_discovery_report_quality(
    *,
    search_id: str,
    extracted_list: list,
    report_md: str,
):
    required_markers = (
        "エグゼクティブサマリー",
        "分析対象と比較前提",
        "競合比較サマリー",
        "ブランド別評価",
        "実行プラン",
    )
    marker_hits = sum(1 for marker in required_markers if marker in report_md)
    if marker_hits < 2:
        return ReportBundle(
            report_md=report_md,
            quality_issues=[],
            quality_is_critical=False,
            quality_status="pass",
        )

    result = ScanResult(
        run_id=search_id,
        urls=[d.url for d in extracted_list],
        status="completed",
        extracted=list(extracted_list),
    )
    return generate_report_bundle(result, report_md)


def _analysis_attempts(
    competitor_count: int,
    *,
    requested_site_limit: int,
    primary_model: str | None,
    fallback_model: str | None,
    base_timeout_sec: float,
    remaining_overall_sec: float,
) -> list[AnalysisAttempt]:
    """Return a bounded fallback chain for discovery compare analysis."""
    available_sites = 1 + max(0, competitor_count)
    initial_limit = max(2, min(requested_site_limit, available_sites))

    site_limits: list[int] = [initial_limit]
    if initial_limit > 3:
        site_limits.append(3)
    if initial_limit > 2:
        site_limits.append(2)

    # Budget proportional timeout_cap: reserve 20s for post-analyze stages
    budget = max(120.0, remaining_overall_sec - 20.0)

    attempts: list[AnalysisAttempt] = []
    seen: set[tuple[int, str | None]] = set()
    progress_values = [90, 93, 96, 98]

    def _append_attempt(site_limit: int, model: str | None, label: str, timeout_cap: float):
        key = (site_limit, model)
        if key in seen:
            return
        seen.add(key)
        timeout_sec = min(timeout_cap, base_timeout_sec, max(45.0, remaining_overall_sec - 15.0))
        attempts.append(
            AnalysisAttempt(
                label=label,
                site_limit=site_limit,
                model=model,
                timeout_sec=timeout_sec,
                progress_pct=progress_values[min(len(attempts), len(progress_values) - 1)],
            )
        )

    _append_attempt(
        initial_limit,
        primary_model,
        f"比較分析を実行中です（{initial_limit}サイト比較）",
        max(180.0, budget * 0.45),
    )
    if 3 in site_limits and 3 != initial_limit:
        _append_attempt(3, primary_model, "比較分析を軽量化して再試行中です（3サイト比較）", max(105.0, budget * 0.25))
    if fallback_model is not None:
        target_limit = 3 if available_sites >= 3 else min(initial_limit, 2)
        _append_attempt(target_limit, fallback_model, "軽量モデルで比較分析を再試行中です", max(90.0, budget * 0.20))
    if 2 in site_limits:
        _append_attempt(2, fallback_model or primary_model, "最小構成で比較分析を再試行中です（2サイト比較）", max(75.0, budget * 0.10))
    return attempts


async def run_discovery_pipeline(
    req: DiscoveryAnalyzeRequest,
    *,
    request_id: str,
    owner_id: str | None = None,
    search_client: SearchClient | None = None,
    on_stage: StageCallback | None = None,
    validate_operator_url_fn: ValidateUrlFn = validate_operator_url,
    fetch_html_fn: FetchHtmlFn = fetch_html,
    take_screenshot_fn: TakeScreenshotFn = take_screenshot,
    extract_fn: ExtractFn = extract,
    classify_industry_fn: ClassifyIndustryFn = classify_industry,
    analyze_fn: AnalyzeFn = analyze,
    validate_candidates_fn: ValidateCandidatesFn | None = None,
    daily_limit_reached: DailyLimitReachedFn | None = None,
    mark_search_consumed: MarkSearchConsumedFn | None = None,
) -> DiscoveryAnalyzeResponse:
    """Run the full discovery pipeline.

    Raises PipelineError on failure (with user-facing details).
    """
    pipeline_start = time.monotonic()
    timeouts = _resolve_timeouts()
    max_competitors = _resolve_max_competitors()
    analyze_site_limit = _resolve_analyze_site_limit()
    brand_fetch_timeout = timeouts["brand_fetch_timeout"]
    competitor_fetch_timeout = timeouts["competitor_fetch_timeout"]
    classify_timeout = timeouts["classify_timeout"]
    search_timeout = timeouts["search_timeout"]
    analyze_timeout = timeouts["analyze_timeout"]

    overall_budget_sec = float(os.getenv("DISCOVERY_OVERALL_JOB_TIMEOUT_SEC", "360"))
    tracker = PipelineBudgetTracker(overall_budget=overall_budget_sec, job_id=request_id)

    # 1. URL validation
    brand_fetch_urls: list[str] = []
    brand_validation_errors: list[str] = []
    for candidate_url in _build_fetch_url_candidates(req.brand_url):
        error = validate_operator_url_fn(candidate_url)
        if error:
            brand_validation_errors.append(error)
            continue
        brand_fetch_urls.append(candidate_url)

    if not brand_fetch_urls:
        raise PipelineError(
            422, _summarize_errors(brand_validation_errors),
            stage="brand_fetch", retryable=False,
        )

    # 2. Daily rate limit
    if daily_limit_reached is not None and daily_limit_reached():
        raise PipelineError(429, "Daily limit reached.", stage="queued", retryable=False)

    # 3. BYOK: API key resolution
    normalized_provider = normalize_provider(req.provider, req.model)
    if normalized_provider != PROVIDER_ANTHROPIC:
        raise PipelineError(
            422,
            "Discovery では Gemini provider / model はサポートしていません。Claude を使用してください。",
            stage="queued", retryable=False,
        )
    analysis_provider = PROVIDER_ANTHROPIC

    search_api_key = req.search_api_key or req.api_key or os.getenv("ANTHROPIC_API_KEY", "")
    if not search_api_key:
        raise PipelineError(
            400,
            "Claude API key is required for Discovery search unless the server has ANTHROPIC_API_KEY configured.",
            stage="queued", retryable=False,
        )
    analysis_api_key = req.api_key or req.search_api_key or os.getenv("ANTHROPIC_API_KEY", "")

    brand_domain = extract_domain(req.brand_url)
    search_id = _new_id()

    # --- Stage: brand_fetch ---
    await _notify_stage(on_stage, DiscoveryJobStage.brand_fetch)
    tracker.begin_stage("brand_fetch")

    t0 = time.monotonic()
    brand_html = ""
    brand_fetch_url = req.brand_url
    brand_attempt_errors: list[str] = []
    for candidate_url in brand_fetch_urls:
        try:
            html, brand_err = await asyncio.wait_for(
                fetch_html_fn(candidate_url, timeout=brand_fetch_timeout),
                timeout=brand_fetch_timeout + 2,
            )
        except asyncio.TimeoutError:
            brand_attempt_errors.append(f"{candidate_url}: Timeout")
            continue
        if brand_err:
            brand_attempt_errors.append(f"{candidate_url}: {brand_err}")
            continue
        brand_fetch_url = candidate_url
        brand_html = html
        break

    elapsed = (time.monotonic() - t0) * 1000
    if not brand_html:
        error_summary = _summarize_errors(brand_attempt_errors)
        error_type = (
            "asyncio.TimeoutError"
            if brand_attempt_errors and all("Timeout" in e for e in brand_attempt_errors)
            else "fetch_error"
        )
        _log_stage(request_id, req.brand_url, "brand_fetch", elapsed, "error", error_type)
        raise PipelineError(
            502, f"ブランドURLの取得に失敗 (stage=brand_fetch): {error_summary}",
            stage="brand_fetch",
        )
    _log_stage(request_id, req.brand_url, "brand_fetch", elapsed)
    tracker.end_stage("brand_fetch")
    brand_extracted = extract_fn(brand_fetch_url, brand_html)

    # --- Stage: classify_industry ---
    await _notify_stage(on_stage, DiscoveryJobStage.classify_industry)
    tracker.begin_stage("classify_industry")

    industry = ""
    t0 = time.monotonic()
    try:
        industry = await asyncio.wait_for(
            classify_industry_fn(brand_extracted, search_api_key),
            timeout=classify_timeout,
        )
        _log_stage(request_id, req.brand_url, "classify_industry", (time.monotonic() - t0) * 1000)
    except asyncio.TimeoutError:
        _log_stage(request_id, req.brand_url, "classify_industry", (time.monotonic() - t0) * 1000, "timeout", "asyncio.TimeoutError")
        logger.warning("Industry classification timed out, using domain-only queries")
    except Exception as exc:
        _log_stage(request_id, req.brand_url, "classify_industry", (time.monotonic() - t0) * 1000, "error", type(exc).__name__)
        logger.warning("Industry classification failed, using domain-only queries")
    tracker.end_stage("classify_industry")

    # --- Stage: search ---
    await _notify_stage(on_stage, DiscoveryJobStage.search)
    tracker.begin_stage("search")

    queries = extract_search_queries(req.brand_url, brand_extracted, industry)
    if not queries:
        queries = extract_search_queries(req.brand_url)
    query = queries[0]

    brand_context_parts = [req.brand_url]
    if industry:
        brand_context_parts.append(industry)
    if brand_extracted.title:
        brand_context_parts.append(brand_extracted.title)
    brand_context = " | ".join(part for part in brand_context_parts if part)

    if search_client is None:
        resolved_key = search_api_key or os.getenv("ANTHROPIC_API_KEY", "")
        search_client = AnthropicSearchClient(api_key=resolved_key)

    t0 = time.monotonic()
    search_deadline = time.monotonic() + search_timeout - 2.0
    try:
        results = await asyncio.wait_for(
            search_client.search(
                query, num=max(8, max_competitors + 4), brand_context=brand_context,
                deadline=search_deadline, request_id=request_id,
            ),
            timeout=search_timeout,
        )
    except asyncio.TimeoutError:
        elapsed = (time.monotonic() - t0) * 1000
        _log_stage(request_id, req.brand_url, "search", elapsed, "timeout", "asyncio.TimeoutError")
        raise PipelineError(502, "競合検索がタイムアウト (stage=search)", stage="search")
    except SearchClientError as exc:
        elapsed = (time.monotonic() - t0) * 1000
        _log_stage(request_id, req.brand_url, "search", elapsed, "error", _search_error_type(exc))
        status_code, human_detail = _humanize_search_error(str(exc))
        raise PipelineError(status_code, f"{human_detail} (stage=search)", stage="search") from exc
    except Exception as exc:
        elapsed = (time.monotonic() - t0) * 1000
        error_type = type(exc).__name__
        _log_stage(request_id, req.brand_url, "search", elapsed, "error", error_type)
        safe_msg = _sanitize_secret(
            str(exc), req.api_key, search_api_key, os.getenv("ANTHROPIC_API_KEY", ""),
        )
        logger.error("Discovery search unexpected error: request_id=%s type=%s detail=%s", request_id, error_type, safe_msg)
        status_code, human_detail = _humanize_search_error(safe_msg)
        raise PipelineError(status_code, f"{human_detail} (stage=search)", stage="search") from exc
    _log_stage(request_id, req.brand_url, "search", (time.monotonic() - t0) * 1000)
    tracker.end_stage("search")

    # D-2: Second query disabled — a single wider query keeps latency bounded while
    # still giving enough backfill candidates for quality gating.

    if mark_search_consumed is not None:
        mark_search_consumed()

    # 8. Industry-aware ranking
    industry_keywords = [industry] if industry else None
    ranked = rank_candidates(results, brand_domain, industry_keywords)
    if not ranked:
        raise PipelineError(404, "競合サイトが見つかりませんでした。", stage="search", retryable=False)

    # D-1: LLM-based candidate validation
    if industry and search_api_key and validate_candidates_fn is not None:
        t0_validate = time.monotonic()
        try:
            ranked = await validate_candidates_fn(
                ranked, brand_domain, industry, search_api_key,
            )
            _log_stage(request_id, req.brand_url, "llm_validate", (time.monotonic() - t0_validate) * 1000)
        except Exception as exc:
            _log_stage(request_id, req.brand_url, "llm_validate", (time.monotonic() - t0_validate) * 1000, "error", type(exc).__name__)
            logger.warning("LLM candidate validation failed, using heuristic ranking: %s", exc)

    if not ranked:
        raise PipelineError(404, "競合サイトが見つかりませんでした。", stage="search", retryable=False)

    # Keep comparison breadth configurable while avoiding unbounded fan-out.
    top_candidates = ranked[:max_competitors]

    # --- Stage: fetch_competitors ---
    await _notify_stage(on_stage, DiscoveryJobStage.fetch_competitors, {
        "candidate_count": len(ranked),
    })
    tracker.begin_stage("fetch")

    sem = asyncio.Semaphore(5)
    t0 = time.monotonic()

    async def _fetch_one(cand):
        safe_fetch_urls: list[str] = []
        validation_errors: list[str] = []
        for candidate_url in _build_fetch_url_candidates(cand.url):
            ssrf_err = validate_operator_url_fn(candidate_url)
            if ssrf_err:
                validation_errors.append(ssrf_err)
                continue
            safe_fetch_urls.append(candidate_url)

        fetch_errors: list[str] = []
        for candidate_url in safe_fetch_urls:
            try:
                async with sem:
                    try:
                        html, err = await asyncio.wait_for(
                            fetch_html_fn(candidate_url, timeout=competitor_fetch_timeout),
                            timeout=competitor_fetch_timeout + 2,
                        )
                    except asyncio.TimeoutError:
                        fetch_errors.append(f"{candidate_url}: Timeout")
                        continue
                if err:
                    fetch_errors.append(f"{candidate_url}: {err}")
                    continue
                data = extract_fn(candidate_url, html)
                if os.environ.get("DISCOVERY_SCREENSHOT", "").lower() in ("1", "true"):
                    ss_dir = tempfile.mkdtemp(prefix="discovery_ss_")
                    ss_path = os.path.join(ss_dir, f"ss_{uuid.uuid4().hex[:8]}.png")
                    ss_err = await take_screenshot_fn(candidate_url, ss_path)
                    if not ss_err:
                        data.screenshot_path = ss_path
                    else:
                        shutil.rmtree(ss_dir, ignore_errors=True)
                return FetchedSite(
                    url=candidate_url,
                    domain=extract_domain(candidate_url) or cand.domain,
                    title=data.title or cand.title,
                    description=data.meta_description or cand.snippet,
                    og_image_url=data.og_image_url,
                    analysis_source=_PAGE_FETCH_ANALYSIS_SOURCE,
                    error=None,
                ), data
            except Exception as exc:
                logger.warning("Unexpected error fetching %s: %s(%s)", candidate_url, type(exc).__name__, exc)
                fetch_errors.append(f"{candidate_url}: {type(exc).__name__}")
                continue

        fallback_url = safe_fetch_urls[0] if safe_fetch_urls else cand.url
        error_summary = _summarize_errors(fetch_errors or validation_errors)
        return FetchedSite(
            url=fallback_url,
            domain=extract_domain(fallback_url) or cand.domain,
            title=cand.title or cand.domain,
            description=cand.snippet or "",
            analysis_source=_FAILED_ANALYSIS_SOURCE,
            error=f"取得失敗: {error_summary}",
        ), None

    # Phase 1: top candidates in parallel
    fetch_results = await asyncio.gather(*[_fetch_one(c) for c in top_candidates])

    fetched_sites: list[FetchedSite] = []
    competitor_extracted = []
    fail_count = 0
    for site, data in fetch_results:
        if data is not None:
            fetched_sites.append(site)
            competitor_extracted.append(data)
        else:
            fail_count += 1

    # Phase 2: backfill from remaining candidates (parallel batch)
    needed = max_competitors - len(competitor_extracted)
    backfill_candidates = ranked[max_competitors:max_competitors + needed + 2]
    if needed > 0 and backfill_candidates:
        backfill_results = await asyncio.gather(*[_fetch_one(c) for c in backfill_candidates])
        for site, data in backfill_results:
            if len(competitor_extracted) >= max_competitors:
                break
            if data is not None:
                fetched_sites.append(site)
                competitor_extracted.append(data)
            else:
                fail_count += 1

    fetch_elapsed = (time.monotonic() - t0) * 1000
    _log_stage(
        request_id, req.brand_url, "fetch_competitors", fetch_elapsed,
        "ok" if competitor_extracted else "error",
        f"full={len(fetched_sites)},fail={fail_count}",
    )

    if not competitor_extracted:
        raise PipelineError(
            502, "全ての競合サイトの取得に失敗しました (stage=fetch_competitors)。",
            stage="fetch_competitors",
        )

    # ── Task A: Quality gate — exclude low-quality / garbled extractions ──
    quality_passed: list[tuple[FetchedSite, object]] = []
    quality_excluded: list[str] = []

    for site, data in zip(fetched_sites, competitor_extracted):
        quality = compute_extraction_quality(data)

        # Garbled text detection on body
        body_text = data.body_text_snippet or ""
        garbled_ratio = detect_garbled_ratio(
            f"{data.title or ''} {body_text} {data.hero_copy or ''}"
        )

        if quality < _EXTRACTION_QUALITY_LOW:
            quality_excluded.append(f"{site.domain} (品質スコア={quality:.2f})")
            logger.info(
                "quality_gate_excluded domain=%s quality=%.2f garbled=%.2f",
                site.domain, quality, garbled_ratio,
            )
            continue

        if garbled_ratio > 0.20:
            quality_excluded.append(f"{site.domain} (文字化け率={garbled_ratio:.2f})")
            logger.info(
                "quality_gate_excluded domain=%s garbled=%.2f",
                site.domain, garbled_ratio,
            )
            continue

        # Mark low-quality (but passable) for confidence labeling in analysis
        if quality < _EXTRACTION_QUALITY_WARN:
            data._extraction_quality_score = quality
            data._is_low_quality = True
        else:
            data._extraction_quality_score = quality
            data._is_low_quality = False

        quality_passed.append((site, data))

    # Replace excluded with backfill candidates if possible
    if quality_excluded:
        logger.info(
            "quality_gate excluded=%d passed=%d domains=[%s]",
            len(quality_excluded), len(quality_passed),
            ", ".join(quality_excluded),
        )

    # Rebuild lists from quality-passed results
    fetched_sites = [s for s, _ in quality_passed]
    competitor_extracted = [d for _, d in quality_passed]

    # Backfill if we lost competitors
    backfill_start = max_competitors + fail_count  # past already-fetched candidates
    for cand in ranked[backfill_start:]:
        if len(competitor_extracted) >= max_competitors:
            break
        site, data = await _fetch_one(cand)
        if data is None:
            continue

        quality = compute_extraction_quality(data)
        garbled = detect_garbled_ratio(
            f"{data.title or ''} {data.body_text_snippet or ''} {data.hero_copy or ''}"
        )
        if quality < _EXTRACTION_QUALITY_LOW or garbled > 0.20:
            logger.info(
                "quality_gate_backfill_excluded domain=%s quality=%.2f garbled=%.2f",
                cand.domain, quality, garbled,
            )
            continue

        data._extraction_quality_score = quality
        data._is_low_quality = quality < _EXTRACTION_QUALITY_WARN

        fetched_sites.append(site)
        competitor_extracted.append(data)

    if not competitor_extracted:
        raise PipelineError(
            502, "品質ゲートにより全ての競合サイトが除外されました (stage=fetch_competitors)。",
            stage="fetch_competitors",
        )

    tracker.end_stage("fetch")

    # ── Build discovery metadata for report context ──
    _tier_label = {"direct": "直競合", "indirect": "準競合", "benchmark": "ベンチマーク"}
    discovery_metadata = {
        "input_brand": brand_domain,
        "input_brand_url": req.brand_url,
        "industry": industry,
        "discovered_candidates": [
            {
                "domain": c.domain,
                "title": c.title,
                "score": c.score,
                "tier": _tier_label.get(c.competitive_tier, c.competitive_tier),
            }
            for c in ranked
        ],
        "excluded_candidates": [
            {"domain": desc.split(" (")[0], "reason": desc}
            for desc in quality_excluded
        ],
    }

    # --- Stage: analyze ---
    tracker.begin_stage("analyze")
    await _notify_stage(on_stage, DiscoveryJobStage.analyze, {
        "candidate_count": len(ranked),
        "fetched_count": len(fetched_sites),
        "analyzed_count": min(1 + len(competitor_extracted), analyze_site_limit),
    })

    discovery_analysis_model = (
        os.getenv("ANTHROPIC_DISCOVERY_ANALYSIS_MODEL")
        or req.model
    )
    fallback_analysis_model = _resolve_discovery_fallback_model(discovery_analysis_model)
    analysis_provider_label = provider_label(analysis_provider, discovery_analysis_model)
    overall_job_timeout = float(os.getenv("DISCOVERY_OVERALL_JOB_TIMEOUT_SEC", "360"))
    remaining_overall_sec = max(60.0, overall_job_timeout - (time.monotonic() - pipeline_start))
    attempts = _analysis_attempts(
        len(competitor_extracted),
        requested_site_limit=analyze_site_limit,
        primary_model=discovery_analysis_model,
        fallback_model=fallback_analysis_model,
        base_timeout_sec=analyze_timeout,
        remaining_overall_sec=remaining_overall_sec,
    )

    report_md = ""
    token_usage = None
    analyzed_count = 0
    quality_status = "pass"
    quality_issues: list[str] = []
    quality_is_critical = False
    last_exc: Exception | None = None
    last_status_code = 502
    last_human_detail = "比較分析に失敗しました。"
    attempt_timings: list[dict] = []
    partial_report_md: str | None = None
    partial_sites_analyzed: int = 0

    for attempt_index, attempt in enumerate(attempts, start=1):
        analyzed_competitors = competitor_extracted[: max(1, attempt.site_limit - 1)]
        all_extracted = [brand_extracted] + analyzed_competitors
        # Update metadata per attempt so the prompt reflects actual analysis targets
        omitted = competitor_extracted[max(1, attempt.site_limit - 1):]
        discovery_metadata["analyzed_targets"] = [
            {"domain": urlparse(d.url).hostname or d.url, "url": d.url}
            for d in all_extracted
        ]
        discovery_metadata["omitted_candidates"] = [
            {
                "domain": urlparse(d.url).hostname or d.url,
                "url": d.url,
                "reason": "degrade-retry による分析対象縮小" if attempt_index > 1 else "分析上限超過",
            }
            for d in omitted
        ]
        await _notify_stage(on_stage, DiscoveryJobStage.analyze, {
            "candidate_count": len(ranked),
            "fetched_count": len(fetched_sites),
            "analyzed_count": len(all_extracted),
            "progress_pct": attempt.progress_pct,
            "message": attempt.label,
        })

        t0 = time.monotonic()
        actual_remaining = max(0.0, overall_job_timeout - (time.monotonic() - pipeline_start))
        if actual_remaining < 25.0:
            logger.warning(
                "discovery_analyze_budget_exhausted request_id=%s attempt=%d remaining=%.1f",
                request_id, attempt_index, actual_remaining,
            )
            break
        # Reserve budget for at least one degrade retry (min 35s) if more attempts remain
        has_more_attempts = attempt_index < len(attempts)
        retry_reserve = 35.0 if has_more_attempts else 5.0
        effective_timeout = min(
            attempt.timeout_sec,
            max(30.0, actual_remaining - retry_reserve),
        )
        # Use compact prompt from the start when budget is tight
        use_compact = (attempt_index > 1) or (actual_remaining < 90.0)
        try:
            candidate_report_md, candidate_token_usage = await asyncio.wait_for(
                analyze_fn(
                    all_extracted,
                    model=attempt.model,
                    provider=analysis_provider,
                    api_key=analysis_api_key,
                    discovery_metadata=discovery_metadata,
                    compact_output=use_compact,
                ),
                timeout=effective_timeout,
            )
            elapsed = (time.monotonic() - t0) * 1000
            _log_stage(request_id, req.brand_url, "analyze", elapsed, "ok", f"attempt={attempt_index} compact={use_compact} timeout={effective_timeout:.0f}s")
            logger.info(
                "discovery_analyze_attempt_success request_id=%s attempt=%d sites=%d model=%s elapsed_ms=%.1f",
                request_id, attempt_index, len(all_extracted), attempt.model or discovery_analysis_model, elapsed,
            )
            quality_bundle = _evaluate_discovery_report_quality(
                search_id=search_id,
                extracted_list=all_extracted,
                report_md=candidate_report_md,
            )
            retryable_quality = (
                quality_bundle.quality_is_critical
                and _is_retryable_quality_issue(quality_bundle.quality_issues)
            )

            retry_remaining = max(0.0, overall_job_timeout - (time.monotonic() - pipeline_start))
            if retryable_quality and retry_remaining > 60.0 and attempt_index == 1:
                retry_timeout = min(90.0, max(30.0, retry_remaining - 15.0))
                # Phase P1-C: first quality retry keeps the full token budget —
                # compact mode reduces output tokens and can worsen truncation,
                # so reserve it for subsequent (outer-loop) retries.
                use_compact_retry = attempt_index >= 2
                logger.warning(
                    "discovery_quality_retry request_id=%s attempt=%d sites=%d compact=%s issues=%s",
                    request_id, attempt_index, len(all_extracted), use_compact_retry, quality_bundle.quality_issues,
                )
                try:
                    compact_report_md, compact_token_usage = await asyncio.wait_for(
                        analyze_fn(
                            all_extracted,
                            model=attempt.model,
                            provider=analysis_provider,
                            api_key=analysis_api_key,
                            discovery_metadata=discovery_metadata,
                            compact_output=use_compact_retry,
                        ),
                        timeout=retry_timeout,
                    )
                    compact_quality_bundle = _evaluate_discovery_report_quality(
                        search_id=search_id,
                        extracted_list=all_extracted,
                        report_md=compact_report_md,
                    )
                    candidate_report_md = compact_report_md
                    candidate_token_usage = compact_token_usage
                    quality_bundle = compact_quality_bundle
                    retryable_quality = (
                        quality_bundle.quality_is_critical
                        and _is_retryable_quality_issue(quality_bundle.quality_issues)
                    )
                except Exception as exc:
                    safe_msg = _sanitize_secret(
                        str(exc), req.api_key, analysis_api_key, search_api_key, os.getenv("ANTHROPIC_API_KEY", ""),
                    )
                    logger.warning(
                        "Discovery quality retry failed: request_id=%s attempt=%d compact=%s detail=%s",
                        request_id, attempt_index, use_compact_retry, safe_msg,
                    )
            elif retryable_quality:
                if attempt_index > 1:
                    logger.info(
                        "discovery_quality_retry_skipped_after_first_attempt request_id=%s attempt=%d remaining=%.1f issues=%s",
                        request_id, attempt_index, retry_remaining, quality_bundle.quality_issues,
                    )
                else:
                    logger.warning(
                        "discovery_quality_retry_skipped request_id=%s remaining=%.1f",
                        request_id, retry_remaining,
                    )

            # Track best partial result for fallback (even if quality is critical, keep for emergency use)
            if partial_report_md is None or len(candidate_report_md) > len(partial_report_md):
                partial_report_md = candidate_report_md
                partial_sites_analyzed = len(all_extracted)

            report_md = candidate_report_md
            token_usage = candidate_token_usage
            analyzed_count = len(all_extracted)
            quality_status = quality_bundle.quality_status
            quality_issues = quality_bundle.quality_issues
            quality_is_critical = quality_bundle.quality_is_critical
            attempt_timings.append({
                "attempt_index": attempt_index,
                "site_limit": attempt.site_limit,
                "model": attempt.model or discovery_analysis_model,
                "elapsed_sec": round(elapsed / 1000, 2),
                "effective_timeout": round(effective_timeout, 1),
                "outcome": "quality_degrade" if (retryable_quality and attempt_index < len(attempts)) else "ok",
                "compact": use_compact,
                "quality_retry_used": retryable_quality and retry_remaining > 60.0 and attempt_index == 1,
            })

            if retryable_quality and attempt_index < len(attempts):
                logger.warning(
                    "Discovery report quality still critical; degrading attempt: request_id=%s attempt=%d/%d issues=%s",
                    request_id, attempt_index, len(attempts), quality_issues,
                )
                continue
            break
        except Exception as exc:
            elapsed = (time.monotonic() - t0) * 1000
            safe_msg = _sanitize_secret(
                str(exc), req.api_key, analysis_api_key, search_api_key, os.getenv("ANTHROPIC_API_KEY", ""),
            )
            last_exc = exc
            last_status_code, last_human_detail = _humanize_analysis_error(analysis_provider_label, safe_msg)
            retryable = _is_retryable_analysis_exception(exc) and attempt_index < len(attempts)
            outcome = "timeout" if isinstance(exc, asyncio.TimeoutError) else "error"
            _log_stage(request_id, req.brand_url, "analyze", elapsed, outcome, type(exc).__name__)
            attempt_timings.append({
                "attempt_index": attempt_index,
                "site_limit": attempt.site_limit,
                "model": attempt.model or discovery_analysis_model,
                "elapsed_sec": round(elapsed / 1000, 2),
                "effective_timeout": round(effective_timeout, 1),
                "outcome": outcome,
                "compact": use_compact,
                "quality_retry_used": False,
            })
            if retryable:
                logger.warning(
                    "Discovery analyze attempt failed; retrying with degraded plan: request_id=%s attempt=%d/%d sites=%d model=%s detail=%s",
                    request_id, attempt_index, len(attempts), len(all_extracted), attempt.model or discovery_analysis_model, safe_msg,
                )
                continue
            logger.error(
                "Discovery analysis failed after attempt %d: request_id=%s provider=%s detail=%s",
                attempt_index, request_id, analysis_provider_label, safe_msg,
            )
            break

    if not report_md:
        failed_summary = tracker.summary()
        logger.warning("PIPELINE_FAILED_SUMMARY %s", failed_summary)
        logger.warning("discovery_analyze_attempt_trace %s", json.dumps(attempt_timings))

        partial_fallback_enabled = os.getenv("DISCOVERY_PARTIAL_REPORT_FALLBACK_ENABLED", "false").lower() == "true"
        if partial_fallback_enabled and partial_report_md:
            banner = f"> ⚠️ タイムアウトにより部分レポート（分析済 {partial_sites_analyzed} サイト）\n\n"
            report_md = banner + partial_report_md
            tracker.record("analyze_partial_fallback_used", {"sites": partial_sites_analyzed})
            logger.warning(
                "discovery_partial_fallback_used request_id=%s sites=%d",
                request_id, partial_sites_analyzed,
            )
        else:
            if isinstance(last_exc, asyncio.TimeoutError):
                raise PipelineError(
                    502,
                    "比較分析がタイムアウトしました。軽量化再試行も完了できませんでした (stage=analyze)",
                    stage="analyze",
                ) from last_exc
            raise PipelineError(
                last_status_code,
                f"{last_human_detail} 軽量化再試行でも解消できませんでした。 (stage=analyze)",
                stage="analyze",
            ) from last_exc

    tracker.end_stage("analyze")

    total_elapsed = (time.monotonic() - pipeline_start) * 1000
    pipeline_summary = tracker.summary()
    logger.info(
        "discovery_pipeline_complete request_id=%s brand=%s provider=%s total_ms=%.1f stages_ok",
        request_id, brand_domain, provider_label(analysis_provider, req.model), total_elapsed,
    )
    logger.info("PIPELINE_SUMMARY %s", pipeline_summary)
    logger.info("discovery_analyze_attempt_trace %s", json.dumps(attempt_timings))

    return DiscoveryAnalyzeResponse(
        search_id=search_id,
        brand_url=req.brand_url,
        brand_domain=brand_domain,
        query_used=query,
        candidate_count=len(ranked),
        fetched_sites=fetched_sites,
        analyzed_count=analyzed_count,
        report_md=report_md,
        quality_status=quality_status,
        quality_issues=quality_issues,
        quality_is_critical=quality_is_critical,
        token_usage=token_usage,
        industry=industry,
        excluded_candidates=quality_excluded,
    )
