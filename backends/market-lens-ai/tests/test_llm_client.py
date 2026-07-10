from unittest.mock import AsyncMock, patch

import pytest

from web.app.llm_client import (
    PROVIDER_ANTHROPIC,
    PROVIDER_GEMINI,
    call_multimodal_model,
    normalize_provider,
    provider_label,
)


def test_normalize_provider_defaults_to_anthropic_without_hints():
    assert normalize_provider(None, None) == PROVIDER_ANTHROPIC


def test_normalize_provider_returns_gemini_for_gemini_model():
    assert normalize_provider(None, "gemini-2.5-flash") == PROVIDER_GEMINI


def test_normalize_provider_returns_anthropic_for_claude_model():
    assert normalize_provider(None, "claude-sonnet-4-6") == PROVIDER_ANTHROPIC


def test_normalize_provider_returns_gemini_for_google_provider():
    assert normalize_provider("google", None) == PROVIDER_GEMINI


def test_normalize_provider_returns_gemini_for_gemini_provider():
    assert normalize_provider("gemini", None) == PROVIDER_GEMINI


def test_provider_label_returns_claude_for_anthropic():
    assert provider_label(None, None) == "Claude"


def test_provider_label_returns_gemini_for_gemini_hints():
    assert provider_label("google", "gemini-2.5-flash") == "Gemini"


def test_provider_label_returns_gemini_for_gemini_provider_only():
    assert provider_label("gemini", None) == "Gemini"


@pytest.mark.asyncio
async def test_multimodal_routes_gemini_provider_to_gemini_client():
    expected = ("gemini image result", object())
    with (
        patch("web.app.gemini_client.call_gemini_multimodal", new_callable=AsyncMock, return_value=expected) as gemini,
        patch("web.app.llm_client.call_anthropic_multimodal", new_callable=AsyncMock) as anthropic,
    ):
        actual = await call_multimodal_model(
            "画像を確認",
            image_data=b"png-bytes",
            mime_type="image/png",
            provider="google",
            model="gemini-3.1-flash-lite",
            api_key="AIza-test",
        )

    assert actual == expected
    gemini.assert_awaited_once_with(
        "画像を確認",
        image_data=b"png-bytes",
        mime_type="image/png",
        model="gemini-3.1-flash-lite",
        max_output_tokens=None,
        api_key="AIza-test",
    )
    anthropic.assert_not_awaited()


@pytest.mark.asyncio
async def test_multimodal_routes_anthropic_provider_to_anthropic_client():
    expected = ("claude image result", object())
    with (
        patch("web.app.gemini_client.call_gemini_multimodal", new_callable=AsyncMock) as gemini,
        patch("web.app.llm_client.call_anthropic_multimodal", new_callable=AsyncMock, return_value=expected) as anthropic,
    ):
        actual = await call_multimodal_model(
            "画像を確認",
            image_data=b"png-bytes",
            provider="anthropic",
            model="claude-sonnet-4-6",
            api_key="sk-ant-test",
        )

    assert actual == expected
    anthropic.assert_awaited_once()
    gemini.assert_not_awaited()
