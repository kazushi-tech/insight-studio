"""Claude-only LLM routing for analysis/review workloads."""

from __future__ import annotations

from .anthropic_client import call_anthropic, call_anthropic_multimodal

PROVIDER_ANTHROPIC = "anthropic"


def normalize_provider(provider: str | None, model: str | None = None) -> str:
    return PROVIDER_ANTHROPIC


def provider_label(provider: str | None, model: str | None = None) -> str:
    return "Claude"


async def call_text_model(
    prompt: str,
    *,
    provider: str | None = None,
    model: str | None = None,
    max_output_tokens: int | None = None,
    api_key: str | None = None,
) -> tuple[str, object]:
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
    return await call_anthropic_multimodal(
        prompt,
        image_data=image_data,
        mime_type=mime_type,
        model=model,
        max_output_tokens=max_output_tokens,
        api_key=api_key,
    )
