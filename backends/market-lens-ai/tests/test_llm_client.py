from web.app.llm_client import (
    PROVIDER_ANTHROPIC,
    PROVIDER_GEMINI,
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
