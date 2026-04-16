"""Tests for AnthropicSearchClient."""

from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, Mock, patch

import anthropic
import pytest

from web.app.services.discovery.anthropic_search_client import (
    AnthropicSearchClient,
    SearchClientError,
    SearchResult,
)


def _message_payload(
    *,
    text: str,
    search_results: list[tuple[str, str]] | None = None,
    tool_error: str | None = None,
    citations: list[dict] | None = None,
) -> dict:
    blocks: list[dict] = []
    if search_results is not None or tool_error is not None:
        if tool_error is not None:
            tool_content: object = {
                "type": "web_search_tool_result_error",
                "error_code": tool_error,
            }
        else:
            tool_content = [
                {
                    "type": "web_search_result",
                    "url": url,
                    "title": title,
                    "encrypted_content": "opaque",
                }
                for url, title in (search_results or [])
            ]
        blocks.append(
            {
                "type": "web_search_tool_result",
                "tool_use_id": "tool-1",
                "content": tool_content,
            }
        )
    blocks.append(
        {
            "type": "text",
            "text": text,
            "citations": citations or [],
        }
    )
    return {"content": blocks}


class TestAnthropicSearchClient:
    @pytest.mark.asyncio
    async def test_search_prefers_structured_results(self):
        payload = _message_payload(
            text=(
                '{"results":['
                '{"url":"https://competitor1.com","title":"Competitor One","snippet":"same market"},'
                '{"url":"https://competitor2.com","title":"Competitor Two","snippet":"another direct rival"}'
                ']}'
            ),
            search_results=[
                ("https://news.example/article", "News Article"),
                ("https://competitor1.com", "Competitor One"),
            ],
        )

        with patch.object(
            AnthropicSearchClient,
            "_request_message",
            new_callable=AsyncMock,
            return_value=payload,
        ):
            client = AnthropicSearchClient(api_key="test-key")
            results = await client.search("test query")

        assert [result.url for result in results] == [
            "https://competitor1.com",
            "https://competitor2.com",
            "https://news.example/article",
        ]
        assert results[0].snippet == "same market"

    @pytest.mark.asyncio
    async def test_search_uses_tool_results_when_text_not_json(self):
        payload = _message_payload(
            text="Competitors: https://competitor1.com https://competitor2.com",
            search_results=[
                ("https://competitor1.com", "Competitor One"),
                ("https://competitor2.com", "Competitor Two"),
            ],
            citations=[
                {
                    "type": "web_search_result_location",
                    "url": "https://competitor1.com",
                    "title": "Competitor One",
                    "cited_text": "Direct competitor in the same market",
                }
            ],
        )

        with patch.object(
            AnthropicSearchClient,
            "_request_message",
            new_callable=AsyncMock,
            return_value=payload,
        ):
            client = AnthropicSearchClient(api_key="test-key")
            results = await client.search("test query", num=2)

        assert len(results) == 2
        assert results[0] == SearchResult(
            url="https://competitor1.com",
            title="Competitor One",
            snippet="Direct competitor in the same market",
        )

    @pytest.mark.asyncio
    async def test_search_missing_api_key(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        client = AnthropicSearchClient(api_key="")

        with pytest.raises(SearchClientError, match="Claude API key"):
            await client.search("test")

    @pytest.mark.asyncio
    async def test_search_propagates_request_id_to_request_message(self):
        payload = _message_payload(
            text='{"results":[{"url":"https://competitor1.com","title":"Competitor One","snippet":""}]}',
            search_results=[("https://competitor1.com", "Competitor One")],
        )

        with patch.object(
            AnthropicSearchClient,
            "_request_message",
            new_callable=AsyncMock,
            return_value=payload,
        ) as mock_request:
            client = AnthropicSearchClient(api_key="test-key")
            await client.search("test query", request_id="req-123")

        assert mock_request.await_args.kwargs["request_id"] == "req-123"

    @pytest.mark.asyncio
    async def test_search_tries_next_model_when_primary_fails(self, monkeypatch):
        monkeypatch.setenv(
            "ANTHROPIC_DISCOVERY_SEARCH_FALLBACK_MODELS",
            "claude-3-5-sonnet-20241022",
        )
        payload = _message_payload(
            text='{"results":[{"url":"https://competitor1.com","title":"Competitor One","snippet":""}]}',
            search_results=[("https://competitor1.com", "Competitor One")],
        )

        client = AnthropicSearchClient(
            api_key="test-key",
            model="claude-sonnet-4-6",
        )
        with patch.object(
            client,
            "_request_message",
            new_callable=AsyncMock,
            side_effect=[
                SearchClientError("Anthropic Search error: unavailable"),
                payload,
            ],
        ) as mock_request:
            results = await client.search("test query")

        assert [result.url for result in results] == ["https://competitor1.com"]
        assert mock_request.await_count == 2

    @pytest.mark.asyncio
    async def test_request_message_retries_timeout_then_succeeds(self):
        payload = _message_payload(
            text='{"results":[{"url":"https://competitor1.com","title":"Competitor One","snippet":""}]}',
            search_results=[("https://competitor1.com", "Competitor One")],
        )
        client = AnthropicSearchClient(api_key="test-key")
        client._retry_delay_sec = 0.01

        mock_messages = Mock()
        mock_messages.create = AsyncMock(
            side_effect=[
                asyncio.TimeoutError(),
                payload,
            ]
        )
        mock_client = Mock(messages=mock_messages)

        with patch.object(client, "_build_client", return_value=mock_client):
            message = await client._request_message(
                model="claude-sonnet-4-6",
                prompt="test",
                timeout_sec=5.0,
            )

        assert message == payload
        assert mock_messages.create.await_count == 2

    @pytest.mark.asyncio
    async def test_request_message_retries_tool_error_then_succeeds(self):
        client = AnthropicSearchClient(api_key="test-key")
        client._retry_delay_sec = 0.01

        mock_messages = Mock()
        mock_messages.create = AsyncMock(
            side_effect=[
                _message_payload(text="{}", tool_error="too_many_requests"),
                _message_payload(
                    text='{"results":[{"url":"https://competitor1.com","title":"Competitor One","snippet":""}]}',
                    search_results=[("https://competitor1.com", "Competitor One")],
                ),
            ]
        )
        mock_client = Mock(messages=mock_messages)

        with patch.object(client, "_build_client", return_value=mock_client):
            message = await client._request_message(
                model="claude-sonnet-4-6",
                prompt="test",
                timeout_sec=5.0,
            )

        assert message["content"][0]["type"] == "web_search_tool_result"
        assert mock_messages.create.await_count == 2

    @pytest.mark.asyncio
    async def test_request_message_retries_status_error_then_succeeds(self):
        client = AnthropicSearchClient(api_key="test-key")
        client._retry_delay_sec = 0.01

        status_err = anthropic.APIStatusError(
            message="too many requests",
            response=Mock(status_code=429, headers={"retry-after": "0"}),
            body={"error": {"message": "too many requests"}},
        )
        mock_messages = Mock()
        mock_messages.create = AsyncMock(
            side_effect=[
                status_err,
                _message_payload(
                    text='{"results":[{"url":"https://competitor1.com","title":"Competitor One","snippet":""}]}',
                    search_results=[("https://competitor1.com", "Competitor One")],
                ),
            ]
        )
        mock_client = Mock(messages=mock_messages)

        with patch.object(client, "_build_client", return_value=mock_client):
            message = await client._request_message(
                model="claude-sonnet-4-6",
                prompt="test",
                timeout_sec=5.0,
            )

        assert message["content"][0]["type"] == "web_search_tool_result"
        assert mock_messages.create.await_count == 2

    def test_fallback_models_prefer_discovery_specific_env(self, monkeypatch):
        monkeypatch.setenv(
            "ANTHROPIC_DISCOVERY_SEARCH_FALLBACK_MODELS",
            "claude-3-5-sonnet-20241022,claude-3-5-sonnet-20241022",
        )

        client = AnthropicSearchClient(
            api_key="test-key",
            model="claude-sonnet-4-6",
        )

        assert client._fallback_models == [
            "claude-sonnet-4-6",
            "claude-3-5-sonnet-20241022",
        ]
