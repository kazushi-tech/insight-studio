"""Tests for Anthropic model normalization, fallback candidate selection, and SDK calls."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import anthropic
import pytest

from web.app.anthropic_client import (
    _build_client,
    _extract_text_from_message,
    _usage_from_message,
    call_anthropic,
    call_anthropic_multimodal,
    candidate_anthropic_models,
    normalize_anthropic_model,
)
from web.app.models import TokenUsage


# ---------------------------------------------------------------------------
# Helpers to build mock SDK objects
# ---------------------------------------------------------------------------

def _make_text_block(text: str):
    block = MagicMock()
    block.type = "text"
    block.text = text
    return block


def _make_tool_block():
    block = MagicMock()
    block.type = "tool_use"
    block.text = None
    return block


def _make_usage(input_tokens: int = 10, output_tokens: int = 20):
    usage = MagicMock()
    usage.input_tokens = input_tokens
    usage.output_tokens = output_tokens
    return usage


def _make_message(text: str = "Hello", model: str = "claude-sonnet-4-6",
                  input_tokens: int = 10, output_tokens: int = 20):
    msg = MagicMock(spec=anthropic.types.Message)
    msg.content = [_make_text_block(text)]
    msg.usage = _make_usage(input_tokens, output_tokens)
    msg.model = model
    return msg


# ---------------------------------------------------------------------------
# Existing tests: model normalization
# ---------------------------------------------------------------------------

class TestAnthropicModelNormalization:
    def test_current_sonnet_alias_is_stable(self):
        assert normalize_anthropic_model("claude-sonnet-4-6") == "claude-sonnet-4-6"

    def test_plain_sonnet_alias_maps_to_current_model(self):
        assert normalize_anthropic_model("claude-sonnet-4") == "claude-sonnet-4-6"

    def test_legacy_snapshot_alias_maps_to_current_model(self):
        assert normalize_anthropic_model("claude-sonnet-4-20250514") == "claude-sonnet-4-6"

    def test_default_model_is_current_sonnet(self):
        assert normalize_anthropic_model(None) == "claude-sonnet-4-6"

    def test_candidate_models_default_to_primary_only(self, monkeypatch):
        monkeypatch.delenv("ANTHROPIC_FALLBACK_MODELS", raising=False)
        candidates = candidate_anthropic_models("claude-sonnet-4-6")
        assert candidates == ["claude-sonnet-4-6"]

    def test_candidate_models_include_env_fallbacks_without_duplicates(self, monkeypatch):
        monkeypatch.setenv(
            "ANTHROPIC_FALLBACK_MODELS",
            "claude-3-7-sonnet-20250219,claude-3-7-sonnet-20250219",
        )
        candidates = candidate_anthropic_models("claude-sonnet-4-6")
        assert candidates == ["claude-sonnet-4-6", "claude-3-7-sonnet-20250219"]


# ---------------------------------------------------------------------------
# Helper function tests
# ---------------------------------------------------------------------------

class TestExtractTextFromMessage:
    def test_extracts_single_text_block(self):
        msg = _make_message("result text")
        assert _extract_text_from_message(msg) == "result text"

    def test_joins_multiple_text_blocks(self):
        msg = MagicMock(spec=anthropic.types.Message)
        msg.content = [_make_text_block("first"), _make_text_block("second")]
        assert _extract_text_from_message(msg) == "first\nsecond"

    def test_raises_when_no_text_content(self):
        msg = MagicMock(spec=anthropic.types.Message)
        msg.content = [_make_tool_block()]
        with pytest.raises(RuntimeError, match="did not contain text content"):
            _extract_text_from_message(msg)

    def test_ignores_non_text_blocks(self):
        msg = MagicMock(spec=anthropic.types.Message)
        msg.content = [_make_tool_block(), _make_text_block("only this")]
        assert _extract_text_from_message(msg) == "only this"


class TestUsageFromMessage:
    def test_returns_correct_token_usage(self):
        msg = _make_message(input_tokens=100, output_tokens=50)
        usage = _usage_from_message(msg, "test-model")
        assert usage.prompt_tokens == 100
        assert usage.completion_tokens == 50
        assert usage.total_tokens == 150
        assert usage.model == "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# call_anthropic tests
# ---------------------------------------------------------------------------

class TestCallAnthropic:
    @pytest.mark.asyncio
    @patch("web.app.anthropic_client._build_client")
    async def test_success(self, mock_build):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=_make_message("response"))
        mock_build.return_value = mock_client

        text, usage = await call_anthropic("test prompt", api_key="sk-test")
        assert text == "response"
        assert isinstance(usage, TokenUsage)
        assert usage.prompt_tokens == 10
        assert usage.completion_tokens == 20

    @pytest.mark.asyncio
    @patch("web.app.anthropic_client._build_client")
    async def test_notfound_fallback(self, mock_build, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_FALLBACK_MODELS", "claude-3-7-sonnet-20250219")
        mock_client = AsyncMock()
        not_found = anthropic.NotFoundError(
            message="model not found",
            response=MagicMock(status_code=404, headers={}),
            body={"error": {"message": "model not found"}},
        )
        mock_client.messages.create = AsyncMock(
            side_effect=[not_found, _make_message("fallback ok")]
        )
        mock_build.return_value = mock_client

        text, usage = await call_anthropic("test", api_key="sk-test")
        assert text == "fallback ok"
        assert mock_client.messages.create.call_count == 2

    @pytest.mark.asyncio
    @patch("web.app.anthropic_client._build_client")
    async def test_connection_error(self, mock_build):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(
            side_effect=anthropic.APIConnectionError(request=MagicMock())
        )
        mock_build.return_value = mock_client

        with pytest.raises(RuntimeError, match="接続に失敗しました"):
            await call_anthropic("test", api_key="sk-test")

    @pytest.mark.asyncio
    @patch("web.app.anthropic_client._build_client")
    async def test_status_error_with_model_keyword_triggers_fallback(self, mock_build, monkeypatch):
        monkeypatch.setenv("ANTHROPIC_FALLBACK_MODELS", "claude-3-7-sonnet-20250219")
        mock_client = AsyncMock()
        status_err = anthropic.APIStatusError(
            message="model not available in this region",
            response=MagicMock(status_code=400, headers={}),
            body={"error": {"message": "model not available in this region"}},
        )
        mock_client.messages.create = AsyncMock(
            side_effect=[status_err, _make_message("fallback ok")]
        )
        mock_build.return_value = mock_client

        text, _ = await call_anthropic("test", api_key="sk-test")
        assert text == "fallback ok"

    @pytest.mark.asyncio
    @patch("web.app.anthropic_client._build_client")
    async def test_status_error_without_model_keyword_raises_immediately(self, mock_build):
        mock_client = AsyncMock()
        status_err = anthropic.APIStatusError(
            message="invalid api key",
            response=MagicMock(status_code=401, headers={}),
            body={"error": {"message": "invalid api key"}},
        )
        mock_client.messages.create = AsyncMock(side_effect=status_err)
        mock_build.return_value = mock_client

        with pytest.raises(RuntimeError, match="invalid api key"):
            await call_anthropic("test", api_key="sk-test")
        assert mock_client.messages.create.call_count == 1

    @pytest.mark.asyncio
    @patch("web.app.anthropic_client._build_client")
    @patch("web.app.anthropic_client.asyncio.sleep", new_callable=AsyncMock)
    async def test_rate_limit_status_error_retries_same_model(self, mock_sleep, mock_build):
        mock_client = AsyncMock()
        status_err = anthropic.APIStatusError(
            message="rate limit exceeded",
            response=MagicMock(status_code=429, headers={"retry-after": "0"}),
            body={"error": {"message": "rate limit exceeded"}},
        )
        mock_client.messages.create = AsyncMock(
            side_effect=[status_err, _make_message("retry ok")]
        )
        mock_build.return_value = mock_client

        text, _ = await call_anthropic("test", api_key="sk-test")
        assert text == "retry ok"
        assert mock_client.messages.create.call_count == 2
        mock_sleep.assert_awaited()

    @pytest.mark.asyncio
    @patch("web.app.anthropic_client.AsyncAnthropic")
    async def test_byok_passes_api_key_to_client(self, mock_cls):
        mock_instance = AsyncMock()
        mock_instance.messages.create = AsyncMock(return_value=_make_message("ok"))
        mock_cls.return_value = mock_instance

        await call_anthropic("test", api_key="sk-user-key-123")
        mock_cls.assert_called_once()
        call_kwargs = mock_cls.call_args[1]
        assert call_kwargs["api_key"] == "sk-user-key-123"


# ---------------------------------------------------------------------------
# call_anthropic_multimodal tests
# ---------------------------------------------------------------------------

class TestCallAnthropicMultimodal:
    @pytest.mark.asyncio
    @patch("web.app.anthropic_client._build_client")
    async def test_multimodal_success(self, mock_build):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=_make_message("image analysis"))
        mock_build.return_value = mock_client

        text, usage = await call_anthropic_multimodal(
            "describe this image",
            image_data=b"\x89PNG\r\n",
            mime_type="image/png",
            api_key="sk-test",
        )
        assert text == "image analysis"
        assert isinstance(usage, TokenUsage)

        # Verify image block was sent in the message
        call_kwargs = mock_client.messages.create.call_args[1]
        content = call_kwargs["messages"][0]["content"]
        assert content[0]["type"] == "image"
        assert content[0]["source"]["type"] == "base64"
        assert content[1]["type"] == "text"

    @pytest.mark.asyncio
    @patch("web.app.anthropic_client._build_client")
    async def test_multimodal_connection_error(self, mock_build):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(
            side_effect=anthropic.APIConnectionError(request=MagicMock())
        )
        mock_build.return_value = mock_client

        with pytest.raises(RuntimeError, match="接続に失敗しました"):
            await call_anthropic_multimodal(
                "test", image_data=b"\x89PNG", api_key="sk-test"
            )


# ---------------------------------------------------------------------------
# _build_client tests
# ---------------------------------------------------------------------------

class TestBuildClient:
    def test_raises_without_api_key(self):
        with patch.dict("os.environ", {}, clear=False):
            with patch("web.app.anthropic_client._resolve_api_key", return_value=""):
                with pytest.raises(ValueError, match="API key is required"):
                    _build_client()
