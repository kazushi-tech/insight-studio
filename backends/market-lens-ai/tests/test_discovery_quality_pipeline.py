from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from web.app.models import ExtractedData, TokenUsage
from web.app.schemas.discovery import DiscoveryAnalyzeRequest
from web.app.services.discovery.discovery_pipeline import run_discovery_pipeline
from web.app.services.discovery.search_client import SearchClient, SearchResult


class RecordingSearchClient(SearchClient):
    def __init__(self, results: list[SearchResult]):
        self.results = results

    async def search(
        self,
        query: str,
        *,
        num: int = 10,
        brand_context: str = "",
        deadline: float | None = None,
        request_id: str | None = None,
    ) -> list[SearchResult]:
        return self.results


def _search_results() -> list[SearchResult]:
    return [
        SearchResult(url="https://example.com", title="Brand", snippet="brand site"),
        SearchResult(url="https://comp1.com", title="Comp 1", snippet="sports supplement"),
        SearchResult(url="https://comp2.com", title="Comp 2", snippet="running supplement"),
        SearchResult(url="https://comp3.com", title="Comp 3", snippet="marathon supplement"),
    ]


def _extract_for(url: str) -> ExtractedData:
    host = url.split("//", 1)[-1]
    return ExtractedData(
        url=url,
        title=f"{host} title",
        h1=f"{host} h1",
        hero_copy="価値提案コピー",
        main_cta="購入する",
        body_text_snippet="十分な本文情報です。" * 12,
        contact_paths=["購入", "FAQ"],
        corporate_elements=["実績", "信頼"],
    )


async def _fetch_html(url: str, timeout: float = 0.0):
    return "<html></html>", None


def _validate_url(url: str) -> str | None:
    return None


def _valid_report() -> str:
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
        "### 最優先3施策\n"
        "- 施策A\n\n"
        "### 5-0 予算フレーム\n"
        "| 項目 | 初期 | 拡張 | 備考 |\n"
        "|---|---|---|---|\n"
        "| 月額予算帯 | 10万円 | 30万円 | 推定 |\n\n"
        "### 5-1 LP改善施策\n"
        "| 項目 |\n|---|\n| FV改善 |\n\n"
        "### 5-2 検索広告施策\n"
        "| 項目 |\n|---|\n| 指名防衛 |\n"
    )


@pytest.mark.asyncio
async def test_discovery_pipeline_returns_structured_quality_fields():
    search_client = RecordingSearchClient(_search_results())
    analyze_mock = AsyncMock(return_value=(
        _valid_report(),
        TokenUsage(prompt_tokens=100, completion_tokens=200, total_tokens=300, model="test"),
    ))

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
        ),
        request_id="req-discovery-quality-pass",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="スポーツサプリメント"),
        analyze_fn=analyze_mock,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    assert response.quality_status == "pass"
    assert response.quality_is_critical is False
    # Phase P1-C: optional subsections (5-3 Meta / 5-4 KPI) may raise
    # info-level notices, but no critical "セクション欠損:" entry should appear.
    critical_entries = [
        i for i in response.quality_issues if i.startswith("セクション欠損:")
    ]
    assert critical_entries == []


@pytest.mark.asyncio
async def test_discovery_pipeline_retries_compact_output_after_quality_failure():
    search_client = RecordingSearchClient(_search_results())
    analyze_mock = AsyncMock(side_effect=[
        (
            "## エグゼクティブサマリー\n"
            "## 分析対象と比較前提\n"
            "| 壊れた行",
            TokenUsage(prompt_tokens=100, completion_tokens=200, total_tokens=300, model="test"),
        ),
        (
            _valid_report(),
            TokenUsage(prompt_tokens=120, completion_tokens=220, total_tokens=340, model="test"),
        ),
    ])

    response = await run_discovery_pipeline(
        DiscoveryAnalyzeRequest(
            brand_url="https://example.com",
            api_key="test-key",
            provider="anthropic",
        ),
        request_id="req-discovery-quality-retry",
        search_client=search_client,
        validate_operator_url_fn=_validate_url,
        fetch_html_fn=_fetch_html,
        take_screenshot_fn=AsyncMock(return_value=None),
        extract_fn=lambda url, html: _extract_for(url),
        classify_industry_fn=AsyncMock(return_value="スポーツサプリメント"),
        analyze_fn=analyze_mock,
        validate_candidates_fn=AsyncMock(side_effect=lambda candidates, *args, **kwargs: candidates),
    )

    assert response.quality_is_critical is False
    assert analyze_mock.await_count == 2
    first_kwargs = analyze_mock.await_args_list[0].kwargs
    second_kwargs = analyze_mock.await_args_list[1].kwargs
    assert first_kwargs.get("compact_output") is False
    # Phase P1-C: first quality retry keeps full token budget; compact mode is
    # now reserved for attempt>=2 so the shrink never worsens truncation.
    assert second_kwargs.get("compact_output") is False
