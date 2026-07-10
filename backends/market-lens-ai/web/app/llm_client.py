"""LLM routing for analysis/review workloads (Claude + Gemini)."""

from __future__ import annotations

from .anthropic_client import call_anthropic, call_anthropic_multimodal

PROVIDER_ANTHROPIC = "anthropic"
PROVIDER_GEMINI = "google"

_GEMINI_PROVIDER_ALIASES = frozenset({"google", "gemini", "google-gemini"})


def normalize_provider(provider: str | None, model: str | None = None) -> str:
    if provider and provider.lower() in _GEMINI_PROVIDER_ALIASES:
        return PROVIDER_GEMINI
    if model and model.lower().startswith("gemini"):
        return PROVIDER_GEMINI
    return PROVIDER_ANTHROPIC


def provider_label(provider: str | None, model: str | None = None) -> str:
    if normalize_provider(provider, model) == PROVIDER_GEMINI:
        return "Gemini"
    return "Claude"


async def call_text_model(
    prompt: str,
    *,
    provider: str | None = None,
    model: str | None = None,
    max_output_tokens: int | None = None,
    api_key: str | None = None,
) -> tuple[str, object]:
    if normalize_provider(provider, model) == PROVIDER_GEMINI:
        from .gemini_client import call_gemini
        return await call_gemini(
            prompt,
            model=model,
            max_output_tokens=max_output_tokens,
            api_key=api_key,
        )
    return await call_anthropic(
        prompt,
        model=model,
        max_output_tokens=max_output_tokens,
        api_key=api_key,
    )


async def call_multimodal_model(
    prompt: str,
    *,
    image_data: bytes,
    mime_type: str = "image/png",
    provider: str | None = None,
    model: str | None = None,
    max_output_tokens: int | None = None,
    api_key: str | None = None,
) -> tuple[str, object]:
    if normalize_provider(provider, model) == PROVIDER_GEMINI:
        from .gemini_client import call_gemini_multimodal
        return await call_gemini_multimodal(
            prompt,
            image_data=image_data,
            mime_type=mime_type,
            model=model,
            max_output_tokens=max_output_tokens,
            api_key=api_key,
        )
    return await call_anthropic_multimodal(
        prompt,
        image_data=image_data,
        mime_type=mime_type,
        model=model,
        max_output_tokens=max_output_tokens,
        api_key=api_key,
    )
