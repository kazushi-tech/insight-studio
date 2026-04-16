from web.app.llm_client import (
    PROVIDER_ANTHROPIC,
    normalize_provider,
    provider_label,
)


def test_normalize_provider_defaults_to_anthropic_without_hints():
    assert normalize_provider(None, None) == PROVIDER_ANTHROPIC


def test_normalize_provider_always_returns_anthropic_regardless_of_model():
    assert normalize_provider(None, "gemini-2.5-flash") == PROVIDER_ANTHROPIC


def test_normalize_provider_returns_anthropic_for_claude_model():
    assert normalize_provider(None, "claude-sonnet-4-6") == PROVIDER_ANTHROPIC


def test_normalize_provider_ignores_provider_arg():
    assert normalize_provider("google", None) == PROVIDER_ANTHROPIC


def test_provider_label_always_returns_claude():
    assert provider_label(None, None) == "Claude"


def test_provider_label_returns_claude_even_for_gemini_hints():
    assert provider_label("google", "gemini-2.5-flash") == "Claude"
