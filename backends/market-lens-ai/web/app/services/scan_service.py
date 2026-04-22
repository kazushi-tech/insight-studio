"""Scan orchestration service."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path

from ..analyzer import analyze
from ..llm_client import provider_label
from ..extractor import extract
from ..fetcher import fetch_html, take_screenshot
from ..models import ExtractedData, ScanRequest, ScanResponse, ScanResult
from ..report_generator import generate_report_bundle
from ..repositories.scan_repository import ScanRepository

logger = logging.getLogger("market-lens")


def _is_retryable_quality_issue(issues: list[str]) -> bool:
    if not issues:
        return False
    retryable_tokens = (
        "末尾欠け",
        "見出し欠損",
        "セクション欠損",
        "テーブル",
        "構造エラー",
    )
    return any(any(token in issue for token in retryable_tokens) for issue in issues)


def _sanitize_secret(text: str, *secrets: str | None) -> str:
    """Replace any occurrence of known secrets in text with '***'."""
    result = text
    for s in secrets:
        if s and s in result:
            result = result.replace(s, "***")
    return result


def _humanize_llm_error(provider_name: str, detail: str) -> str:
    normalized = detail.lower()

    if "タイムアウトしました" in detail or "timed out" in normalized or "timeout" in normalized:
        return f"LLM分析がタイムアウトしました。{provider_name} への応答に時間がかかりすぎています。しばらく待って再試行してください。"

    if provider_name == "Claude":
        if "x-api-key" in normalized or "api key" in normalized or "authentication" in normalized:
            return "LLM分析に失敗しました。Claude API キーが無効か、権限が不足しています。"
        if "credit" in normalized or "quota" in normalized or "rate limit" in normalized:
            return "LLM分析に失敗しました。Claude API の利用上限またはクレジット残高を確認してください。"
        if "model" in normalized and (
            "not found" in normalized
            or "invalid" in normalized
            or "access" in normalized
            or "available" in normalized
            or "unsupported" in normalized
        ):
            return "LLM分析に失敗しました。Claude モデル設定またはモデル利用権限を確認してください。"
    else:
        if "api key" in normalized or "authentication" in normalized:
            return "LLM分析に失敗しました。Gemini API キーが無効か、権限が不足しています。"
        if "quota" in normalized or "rate limit" in normalized:
            return "LLM分析に失敗しました。Gemini API の利用上限を確認してください。"

    if detail:
        return f"LLM分析に失敗しました。{provider_name} 呼び出しエラー: {detail[:240]}"
    return f"LLM分析に失敗しました。{provider_name} の APIキーとモデル設定を確認してください。"


async def _crawl_one(url: str, idx: int, run_dir: Path) -> ExtractedData:
    """Fetch, extract, and screenshot a single URL."""
    t0 = time.time()
    html, err = await fetch_html(url)
    if err:
        logger.warning("Fetch failed for %s: %s", url, err)
        return ExtractedData(url=url, error=err)
    data = extract(url, html)
    ss_path = str(run_dir / f"screenshot_{idx}.png")
    ss_err = await take_screenshot(url, ss_path)
    if not ss_err:
        data.screenshot_path = ss_path
    logger.info("crawl_done url=%s idx=%d elapsed=%.1fs", url, idx, time.time() - t0)
    return data


async def execute_scan(req: ScanRequest, repo: ScanRepository, *, owner_id: str | None, on_stage=None) -> ScanResponse:
    """Run a full scan pipeline and persist the result.

    on_stage: optional async callable(stage: str, extra: dict) for async-job progress reporting.
    """
    start = time.time()
    result = ScanResult(urls=req.urls, status="running", owner_id=owner_id)
    logger.info("Scan started: run_id=%s urls=%s", result.run_id, req.urls)

    if on_stage:
        await on_stage("fetching_lps", {"progress_pct": 20})

    run_dir = Path("data/scans") / result.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    crawl_results = await asyncio.gather(
        *[_crawl_one(url, i, run_dir) for i, url in enumerate(req.urls)],
        return_exceptions=True,
    )
    extracted_list: list[ExtractedData] = []
    for url, r in zip(req.urls, crawl_results):
        if isinstance(r, BaseException):
            logger.error("Crawl exception for %s: %s", url, r)
            extracted_list.append(ExtractedData(url=url, error=str(r)))
        else:
            extracted_list.append(r)
    result.extracted = extracted_list

    # LLM analysis
    if on_stage:
        await on_stage("analyzing", {"progress_pct": 60})
    llm_failed = False
    current_provider_label = provider_label(req.provider, req.model)
    logger.info(
        "Scan LLM start run_id=%s provider=%s model=%s has_byok=%s",
        result.run_id, req.provider, req.model, bool(req.api_key),
    )
    try:
        analysis_md, usage = await analyze(
            extracted_list,
            model=req.model,
            provider=req.provider,
            api_key=req.api_key,
            compact_output=False,
        )
        result.token_usage = usage
    except Exception as e:
        llm_failed = True
        env_key = os.getenv("ANTHROPIC_API_KEY", "")
        safe_msg = _sanitize_secret(str(e), req.api_key, env_key)
        logger.error("LLM analysis failed for run_id=%s: %s", result.run_id, safe_msg)
        analysis_md = f"LLM分析エラー: {current_provider_label} 呼び出しに失敗しました"
        result.error = _humanize_llm_error(current_provider_label, safe_msg)

    report_bundle = None
    if not llm_failed:
        report_bundle = generate_report_bundle(result, analysis_md)
        if (
            len(req.urls) > 1
            and report_bundle.quality_is_critical
            and _is_retryable_quality_issue(report_bundle.quality_issues)
        ):
            logger.warning(
                "scan_quality_retry run_id=%s issues=%s",
                result.run_id,
                report_bundle.quality_issues,
            )
            try:
                analysis_md, usage = await analyze(
                    extracted_list,
                    model=req.model,
                    provider=req.provider,
                    api_key=req.api_key,
                    compact_output=True,
                )
                result.token_usage = usage
                report_bundle = generate_report_bundle(result, analysis_md)
            except Exception as e:
                safe_msg = _sanitize_secret(str(e), req.api_key, os.getenv("ANTHROPIC_API_KEY", ""))
                logger.error("Compact retry failed for run_id=%s: %s", result.run_id, safe_msg)

    result.status = "error" if llm_failed else "completed"
    result.total_time_sec = round(time.time() - start, 1)
    # Re-render once with the final elapsed time so Appendix metadata stays accurate.
    report_bundle = generate_report_bundle(result, analysis_md)
    result.report_md = report_bundle.report_md
    result.quality_status = report_bundle.quality_status
    result.quality_issues = report_bundle.quality_issues
    result.quality_is_critical = report_bundle.quality_is_critical

    repo.save(result)
    logger.info("Scan completed: run_id=%s time=%.1fs", result.run_id, result.total_time_sec)

    return ScanResponse(
        run_id=result.run_id,
        status=result.status,
        report_md=result.report_md,
        quality_status=result.quality_status,
        quality_issues=result.quality_issues,
        quality_is_critical=result.quality_is_critical,
        total_time_sec=result.total_time_sec,
        error=result.error,
    )
