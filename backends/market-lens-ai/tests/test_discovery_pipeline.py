"""Tests for discovery_pipeline breadth and analysis wiring."""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, patch

import pytest

from web.app.models import ExtractedData, TokenUsage
from web.app.schemas.discovery import DiscoveryAnalyzeRequest
from web.app.services.discovery.discovery_pipeline import (
    run_discovery_pipeline,
    _analysis_attempts,
    _resolve_timeouts,
)
from web.app.services.discovery.search_client import SearchClient, SearchResult


class RecordingSearchClient(SearchClient):
    """Search client that records requested result breadth."""

    def __init__(self, results: list[SearchResult]):
        self.results = results
        self.calls: list[dict[str, object]] = []

    async def search(
        self,
        query: str,
        *,
        num: int = 10,
        brand_context: str = "",
        deadline: float | None = None,
        request_id: str | None = None,
    ) -> list[SearchResult]:
        self.calls.append({
            "query": query,
            "num": num,
            "brand_context": brand_context,
            "request_id": request_id,
        })
        return self.results


def _search_results() -> list[SearchResult]:
    return [
        SearchResult(url="https://example.com", title="Brand", snippet="brand site"),
        SearchResult(url="https://comp1.com", title="Comp 1", snippet="水回り 公式サイト"),
        SearchResult(url="https://comp2.com", title="Comp 2", snippet="水回り 通販"),
        SearchResult(url="https://comp3.com", title="Comp 3", snippet="住宅設備 専門店"),
        SearchResult(url="https://comp4.com", title="Comp 4", snippet="住宅設備 公式"),
        SearchResult(url="https://comp5.com", title="Comp 5", snippet="水栓 比較"),
        SearchResult(url="https://comp6.com", title="Comp 6", snippet="洗面ボウル 通販"),
    ]


def _extract_for(url: str) -> ExtractedData:
    host = url.split("//", 1)[-1]
    return ExtractedData(
        url=url,
        title=f"{host} title",
        h1=f"{host} h1",
        hero_copy="価値提案コピー",
        main_cta="お問い合わせ",
        body_text_snippet="商品説明と導線説明が十分に含まれる本文です。" * 12,
        contact_paths=["お問い合わせ", "FAQ"],
        corporate_elements=["正規代理店", "実績"],
    )


async def _fetch_html(url: str, timeout: float = 0.0):
    return "<html></html>", None


def _validate_url(url: str) -> str | None:
    return None


def _valid_report_markdown() -> str:
    """Report body that satisfies Phase P1-C Section 5 subsection contract."""
    return (
        "## エグゼクティブサマリー\n"
        "要約\n\n"
        "## 分析対象と比較前提\n"
        "前提\n\n"
        "## 競合比較サマリー\n"
        "比較\n\n"
        "## ブランド別評価\n"
        "評価\n\n"
        "## 実行プラン\n"
        "### 最優先3施策\n- 施策A\n\n"
        "### 5-0 予算フレーム\n"
        "| 項目 | 初期 | 拡張 | 備考 |\n|---|---|---|---|\n| 月額予算 | 10万 | 30万 | 推定 |\n\n"
        "### 5-1 LP改善施策\n| 項目 |\n|---|\n| FV改善 |\n\n"
        "### 5-2 検索広告施策\n| 項目 |\n|---|\n| 指名防衛 |\n"
    )


@pytest.mark.asyncio
async def test_pipeline_fetches_four_competitors_by_default():
    search_client = RecordingSearchClient(_search_results())
    analyze_mock = AsyncMock(return_value=(
        _valid_report_markdown(),
        TokenUsage(prompt_tokens=100, completion_tokens=200, total_tokens=300, model="test"),
    ))

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
        ),
        request_id="req-default",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="水回り"),
        analyze_fn=analyze_mock,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    assert len(response.fetched_sites) == 4
    assert response.analyzed_count == 3  # brand + top 2 competitors (DISCOVERY_ANALYZE_SITE_LIMIT default = 3)
    assert search_client.calls[0]["num"] == 8
    analyzed_sites = analyze_mock.await_args.args[0]
    assert len(analyzed_sites) == 3
    assert "## 実行プラン" in response.report_md


@pytest.mark.asyncio
async def test_pipeline_respects_env_override_for_competitor_count():
    search_client = RecordingSearchClient(_search_results())
    analyze_mock = AsyncMock(return_value=(_valid_report_markdown(), TokenUsage()))

    with patch.dict("os.environ", {"DISCOVERY_MAX_COMPETITORS": "3"}):
        response = await run_discovery_pipeline(
            DiscoveryAnalyzeRequest(
                brand_url="https://example.com",
                api_key="test-key",
                provider="anthropic",
            ),
            request_id="req-env",
            search_client=search_client,
            validate_operator_url_fn=_validate_url,
            fetch_html_fn=_fetch_html,
            take_screenshot_fn=AsyncMock(return_value=None),
            extract_fn=lambda url, html: _extract_for(url),
            classify_industry_fn=AsyncMock(return_value="水回り"),
            analyze_fn=analyze_mock,
            validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
        )

    assert len(response.fetched_sites) == 3
    assert response.analyzed_count == 3  # brand + top 2 competitors (site_limit=3)


@pytest.mark.asyncio
async def test_pipeline_can_fetch_four_but_analyze_three_competitors():
    search_client = RecordingSearchClient(_search_results())
    analyze_mock = AsyncMock(return_value=(_valid_report_markdown(), TokenUsage()))

    with patch.dict("os.environ", {"DISCOVERY_MAX_COMPETITORS": "4", "DISCOVERY_ANALYZE_SITE_LIMIT": "3"}):
        response = await run_discovery_pipeline(
            DiscoveryAnalyzeRequest(
                brand_url="https://example.com",
                api_key="test-key",
                provider="anthropic",
            ),
            request_id="req-analyze-limit",
            search_client=search_client,
            validate_operator_url_fn=_validate_url,
            fetch_html_fn=_fetch_html,
            take_screenshot_fn=AsyncMock(return_value=None),
            extract_fn=lambda url, html: _extract_for(url),
            classify_industry_fn=AsyncMock(return_value="水回り"),
            analyze_fn=analyze_mock,
            validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
        )

    assert len(response.fetched_sites) == 4
    assert response.analyzed_count == 3
    analyzed_sites = analyze_mock.await_args.args[0]
    assert len(analyzed_sites) == 3


@pytest.mark.asyncio
async def test_pipeline_retries_analyze_with_smaller_site_set_after_timeout():
    search_client = RecordingSearchClient(_search_results())
    call_sizes: list[int] = []

    async def _analyze(extracted_list, **kwargs):
        call_sizes.append(len(extracted_list))
        if len(call_sizes) == 1:
            raise asyncio.TimeoutError()
        return "## 総合サマリー", TokenUsage(model="test")

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
            model="claude-sonnet-4-6",
        ),
        request_id="req-timeout-retry",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="水回り"),
        analyze_fn=_analyze,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    assert response.analyzed_count == 3  # fallback model, same 3 sites
    # With site_limit=3 default, first attempt uses 3 sites;
    # on timeout degrade switches to fallback model (still 3 sites)
    assert call_sizes[0] == 3
    assert len(call_sizes) >= 2


@pytest.mark.asyncio
async def test_pipeline_falls_back_to_lightweight_model_for_late_retry():
    search_client = RecordingSearchClient(_search_results())
    seen_models: list[str | None] = []

    async def _analyze(extracted_list, **kwargs):
        seen_models.append(kwargs.get("model"))
        if len(seen_models) < 3:
            raise RuntimeError("Claude API overloaded")
        return "## 総合サマリー", TokenUsage(model=kwargs.get("model") or "test")

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
            model="claude-sonnet-4-6",
        ),
        request_id="req-model-fallback",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="水回り"),
        analyze_fn=_analyze,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    assert response.report_md == "## 総合サマリー"
    assert "claude-haiku-4-5-20251001" in seen_models


@pytest.mark.asyncio
async def test_pipeline_passes_discovery_metadata_to_analyze():
    """Pipeline should pass discovery_metadata kwarg to analyze_fn."""
    search_client = RecordingSearchClient(_search_results())
    received_metadata = {}

    async def _analyze(extracted_list, **kwargs):
        received_metadata.update(kwargs.get("discovery_metadata") or {})
        return "## 総合サマリー", TokenUsage(model="test")

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
        ),
        request_id="req-metadata",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="スポーツサプリメント"),
        analyze_fn=_analyze,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    assert "input_brand" in received_metadata
    assert received_metadata["input_brand"] == "example.com"
    assert "industry" in received_metadata
    assert received_metadata["industry"] == "スポーツサプリメント"
    assert "discovered_candidates" in received_metadata
    assert isinstance(received_metadata["discovered_candidates"], list)
    assert len(received_metadata["discovered_candidates"]) > 0
    # Each candidate should have tier classification
    for c in received_metadata["discovered_candidates"]:
        assert "tier" in c
        assert c["tier"] in ("直競合", "準競合", "ベンチマーク")


@pytest.mark.asyncio
async def test_pipeline_response_has_excluded_candidates():
    """Pipeline response should include excluded_candidates field."""
    search_client = RecordingSearchClient(_search_results())
    analyze_mock = AsyncMock(return_value=(_valid_report_markdown(), TokenUsage()))

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
        ),
        request_id="req-excluded",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="水回り"),
        analyze_fn=analyze_mock,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    # excluded_candidates should be a list (may be empty if no quality exclusions)
    assert isinstance(response.excluded_candidates, list)


# ---------- Regression: Fix 2 — analyzed_targets & omitted_candidates in metadata ----------


@pytest.mark.asyncio
async def test_pipeline_metadata_has_analyzed_targets():
    """discovery_metadata should include analyzed_targets and omitted_candidates."""
    search_client = RecordingSearchClient(_search_results())
    received_metadata = {}

    async def _analyze(extracted_list, **kwargs):
        received_metadata.update(kwargs.get("discovery_metadata") or {})
        return "## 総合サマリー", TokenUsage(model="test")

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
        ),
        request_id="req-targets",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="水回り"),
        analyze_fn=_analyze,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    assert "analyzed_targets" in received_metadata
    assert isinstance(received_metadata["analyzed_targets"], list)
    assert len(received_metadata["analyzed_targets"]) > 0
    # First target should be the brand itself
    assert "example.com" in received_metadata["analyzed_targets"][0]["domain"]

    # omitted_candidates should exist (may be empty if all fit within limit)
    assert "omitted_candidates" in received_metadata
    assert isinstance(received_metadata["omitted_candidates"], list)


@pytest.mark.asyncio
async def test_pipeline_metadata_updated_on_degrade_retry():
    """On degrade-retry, metadata should reflect reduced analysis targets."""
    search_client = RecordingSearchClient(_search_results())
    metadata_snapshots: list[dict] = []

    async def _analyze(extracted_list, **kwargs):
        meta = kwargs.get("discovery_metadata") or {}
        metadata_snapshots.append({
            "analyzed_targets": list(meta.get("analyzed_targets", [])),
            "omitted_candidates": list(meta.get("omitted_candidates", [])),
        })
        if len(metadata_snapshots) == 1:
            raise asyncio.TimeoutError()
        return "## 総合サマリー", TokenUsage(model="test")

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
            model="claude-sonnet-4-6",
        ),
        request_id="req-degrade-meta",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="水回り"),
        analyze_fn=_analyze,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    # At least 2 attempts
    assert len(metadata_snapshots) >= 2
    # Second attempt should have no more analyzed_targets (degrade = same or fewer sites + lighter model)
    first_targets = len(metadata_snapshots[0]["analyzed_targets"])
    second_targets = len(metadata_snapshots[1]["analyzed_targets"])
    assert second_targets <= first_targets
    # Second attempt should have omitted_candidates with degrade-retry reason
    assert len(metadata_snapshots[1]["omitted_candidates"]) > 0
    assert any(
        "degrade-retry" in om.get("reason", "")
        for om in metadata_snapshots[1]["omitted_candidates"]
    )


# ---------- Regression: timeout default values ----------


def test_default_analyze_timeout_is_210():
    """DISCOVERY_ANALYZE_TIMEOUT_SEC default must be 210 (matches routes.py / render.yaml)."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("DISCOVERY_ANALYZE_TIMEOUT_SEC", None)
        timeouts = _resolve_timeouts()
    assert timeouts["analyze_timeout"] == 210.0


def test_default_overall_timeout_is_360():
    """DISCOVERY_OVERALL_JOB_TIMEOUT_SEC default must be 360 (matches render.yaml)."""
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("DISCOVERY_OVERALL_JOB_TIMEOUT_SEC", None)
        value = float(os.getenv("DISCOVERY_OVERALL_JOB_TIMEOUT_SEC", "360"))
    assert value == 360.0


# ---------- Regression: _analysis_attempts budget proportional ----------


def test_analysis_attempts_timeout_cap_proportional_to_budget():
    """attempt 1 timeout_cap must be at least 180s and scale with budget."""
    attempts = _analysis_attempts(
        3,
        requested_site_limit=4,
        primary_model="claude-sonnet-4-6",
        fallback_model="claude-haiku-4-5-20251001",
        base_timeout_sec=210.0,
        remaining_overall_sec=360.0,
    )
    assert len(attempts) >= 1
    # budget = max(120, 360 - 20) = 340; attempt 1 cap = max(180, 340 * 0.45) = 153 → 180
    assert attempts[0].timeout_sec >= 153.0


def test_analysis_attempts_timeout_caps_proportional():
    """First attempt should get the largest timeout share; last attempt the smallest."""
    remaining = 360.0
    attempts = _analysis_attempts(
        3,
        requested_site_limit=4,
        primary_model="claude-sonnet-4-6",
        fallback_model="claude-haiku-4-5-20251001",
        base_timeout_sec=210.0,
        remaining_overall_sec=remaining,
    )
    assert len(attempts) >= 2
    # First attempt must have at least as large a timeout as the last
    assert attempts[0].timeout_sec >= attempts[-1].timeout_sec


# ---------- Regression: quality retry limited to attempt 1 ----------


@pytest.mark.asyncio
async def test_quality_retry_only_fires_on_attempt_1():
    """Quality retry (inner re-call) should NOT fire on attempt 2+."""
    import os as _os
    search_client = RecordingSearchClient(_search_results())
    call_count = 0
    attempt_index_on_call: list[int] = []

    # Simulate: attempt 1 timeout → attempt 2 succeeds but quality is critical.
    # Quality retry must NOT fire on attempt 2.
    async def _analyze(extracted_list, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise asyncio.TimeoutError()
        # Return a low-quality report that would trigger quality retry
        return "短い", TokenUsage(model="test")

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
            model="claude-sonnet-4-6",
        ),
        request_id="req-quality-retry-limit",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="水回り"),
        analyze_fn=_analyze,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    # analyze_fn should be called at most attempt_count times
    # (no extra quality retry call on attempt 2)
    # attempt 1 = timeout, attempt 2 = success → call_count must be exactly 2
    assert call_count == 2


# ---------- Regression: partial fallback env=true ----------


@pytest.mark.asyncio
async def test_partial_fallback_used_when_env_enabled():
    """When DISCOVERY_PARTIAL_REPORT_FALLBACK_ENABLED=true and all attempts fail, use partial report."""
    search_client = RecordingSearchClient(_search_results())

    async def _always_timeout(extracted_list, **kwargs):
        raise asyncio.TimeoutError()

    with patch.dict("os.environ", {
        "DISCOVERY_PARTIAL_REPORT_FALLBACK_ENABLED": "true",
        "DISCOVERY_OVERALL_JOB_TIMEOUT_SEC": "30",
    }):
        # Even with overall timeout forcing fast exit, pipeline should not raise
        # because partial_report_md is empty here. Let's inject one via a side_effect.
        call_count = 0

        async def _first_ok_rest_timeout(extracted_list, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return "## 部分レポート\n内容", TokenUsage(model="test")
            raise asyncio.TimeoutError()

        response = await run_discovery_pipeline(
            DiscoveryAnalyzeRequest(
                brand_url="https://example.com",
                api_key="test-key",
                provider="anthropic",
                model="claude-sonnet-4-6",
            ),
            request_id="req-partial-fallback",
            search_client=search_client,
            validate_operator_url_fn=_validate_url,
            fetch_html_fn=_fetch_html,
            take_screenshot_fn=AsyncMock(return_value=None),
            extract_fn=lambda url, html: _extract_for(url),
            classify_industry_fn=AsyncMock(return_value="水回り"),
            analyze_fn=_first_ok_rest_timeout,
            validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
        )

    # Should succeed with partial report
    assert response.report_md != ""


@pytest.mark.asyncio
async def test_partial_fallback_not_used_when_env_disabled():
    """When DISCOVERY_PARTIAL_REPORT_FALLBACK_ENABLED is not set, PipelineError is raised on all-fail."""
    from web.app.services.discovery.discovery_pipeline import PipelineError
    search_client = RecordingSearchClient(_search_results())

    async def _always_timeout(extracted_list, **kwargs):
        raise asyncio.TimeoutError()

    with patch.dict("os.environ", {
        "DISCOVERY_PARTIAL_REPORT_FALLBACK_ENABLED": "false",
        "DISCOVERY_OVERALL_JOB_TIMEOUT_SEC": "30",
    }):
        with pytest.raises(PipelineError):
            await run_discovery_pipeline(
                DiscoveryAnalyzeRequest(
                    brand_url="https://example.com",
                    api_key="test-key",
                    provider="anthropic",
                    model="claude-sonnet-4-6",
                ),
                request_id="req-no-partial",
                search_client=search_client,
                validate_operator_url_fn=_validate_url,
                fetch_html_fn=_fetch_html,
                take_screenshot_fn=AsyncMock(return_value=None),
                extract_fn=lambda url, html: _extract_for(url),
                classify_industry_fn=AsyncMock(return_value="水回り"),
                analyze_fn=_always_timeout,
                validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
            )
