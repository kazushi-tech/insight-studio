"""Async Gemini client for analysis workloads (wrapper over google-generativeai)."""

from __future__ import annotations

import asyncio
import logging
import os

from .models import TokenUsage
from .gemini_budget import (
    assert_gemini_budget_available,
    estimate_text_tokens,
    normalize_gemini_model,
    record_gemini_usage,
)

logger = logging.getLogger("market-lens.gemini")

_DEFAULT_MODEL = normalize_gemini_model(os.getenv("GEMINI_ANALYSIS_MODEL", "gemini-3.1-flash-lite"))
_DEFAULT_MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "8192"))
_DEFAULT_TEMPERATURE = float(os.getenv("GEMINI_TEMPERATURE", "0.2"))


def _call_sync(
    prompt: str,
    *,
    model: str,
    max_output_tokens: int,
    temperature: float,
    api_key: str,
) -> tuple[str, int, int]:
    """Sync Gemini call. Returns (text, prompt_tokens, completion_tokens)."""
    last_err: Exception | None = None

    # 1) google.genai (newer SDK)
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        client = genai.Client(api_key=api_key)
        cfg = types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
        resp = client.models.generate_content(model=model, contents=prompt, config=cfg)
        text = getattr(resp, "text", None) or ""
        if not text:
            raise RuntimeError("Gemini (google.genai) response contained no text.")
        usage = getattr(resp, "usage_metadata", None)
        prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
        completion_tokens = getattr(usage, "candidates_token_count", 0) or 0
        return text, prompt_tokens, completion_tokens
    except Exception as e:
        last_err = e

    # 2) google.generativeai (older SDK)
    try:
        import google.generativeai as genai_old  # type: ignore

        genai_old.configure(api_key=api_key)
        gm = genai_old.GenerativeModel(model_name=model)
        resp = gm.generate_content(
            prompt,
            generation_config={"temperature": temperature, "max_output_tokens": max_output_tokens},
        )
        text = getattr(resp, "text", None) or ""
        if not text:
            raise RuntimeError("Gemini (google.generativeai) response contained no text.")
        usage = getattr(resp, "usage_metadata", None)
        prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
        completion_tokens = getattr(usage, "candidates_token_count", 0) or 0
        return text, prompt_tokens, completion_tokens
    except Exception as e:
        raise RuntimeError(
            f"Gemini API 呼び出しに失敗しました: {last_err} / {e}"
        ) from e


def _call_multimodal_sync(
    prompt: str,
    *,
    image_data: bytes,
    mime_type: str,
    model: str,
    max_output_tokens: int,
    temperature: float,
    api_key: str,
) -> tuple[str, int, int]:
    """Sync Gemini image + text call. Returns (text, prompt_tokens, completion_tokens)."""
    last_err: Exception | None = None

    # 1) google.genai (newer SDK)
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        client = genai.Client(api_key=api_key)
        cfg = types.GenerateContentConfig(
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
        image_part = types.Part.from_bytes(data=image_data, mime_type=mime_type)
        resp = client.models.generate_content(
            model=model,
            contents=[prompt, image_part],
            config=cfg,
        )
        text = getattr(resp, "text", None) or ""
        if not text:
            raise RuntimeError("Gemini (google.genai) multimodal response contained no text.")
        usage = getattr(resp, "usage_metadata", None)
        prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
        completion_tokens = getattr(usage, "candidates_token_count", 0) or 0
        return text, prompt_tokens, completion_tokens
    except Exception as e:
        last_err = e

    # 2) google.generativeai (older SDK)
    try:
        import google.generativeai as genai_old  # type: ignore

        genai_old.configure(api_key=api_key)
        gm = genai_old.GenerativeModel(model_name=model)
        resp = gm.generate_content(
            [prompt, {"mime_type": mime_type, "data": image_data}],
            generation_config={"temperature": temperature, "max_output_tokens": max_output_tokens},
        )
        text = getattr(resp, "text", None) or ""
        if not text:
            raise RuntimeError("Gemini (google.generativeai) multimodal response contained no text.")
        usage = getattr(resp, "usage_metadata", None)
        prompt_tokens = getattr(usage, "prompt_token_count", 0) or 0
        completion_tokens = getattr(usage, "candidates_token_count", 0) or 0
        return text, prompt_tokens, completion_tokens
    except Exception as e:
        raise RuntimeError(
            f"Gemini 画像分析の呼び出しに失敗しました: {last_err} / {e}"
        ) from e


async def call_gemini(
    prompt: str,
    *,
    model: str | None = None,
    max_output_tokens: int | None = None,
    api_key: str | None = None,
) -> tuple[str, TokenUsage]:
    """Async Gemini text generation. Returns (text, TokenUsage)."""
    key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
    if not key:
        raise RuntimeError("Gemini API キーが必要です。GEMINI_API_KEY を設定するか BYOK キーを指定してください。")

    mdl = normalize_gemini_model(model or _DEFAULT_MODEL)
    max_tokens = max_output_tokens or _DEFAULT_MAX_OUTPUT_TOKENS

    logger.info("call_gemini model=%s max_tokens=%s has_byok=%s", mdl, max_tokens, bool(api_key))
    budget_estimate = assert_gemini_budget_available(
        model=mdl,
        prompt=prompt,
        max_output_tokens=max_tokens,
        feature="market-lens.analysis",
    )

    text, prompt_tokens, completion_tokens = await asyncio.to_thread(
        _call_sync,
        prompt,
        model=mdl,
        max_output_tokens=max_tokens,
        temperature=_DEFAULT_TEMPERATURE,
        api_key=key,
    )

    logger.info(
        "call_gemini SUCCESS model=%s prompt_tokens=%s completion_tokens=%s",
        mdl, prompt_tokens, completion_tokens,
    )
    usage_is_estimated = not (prompt_tokens or completion_tokens)
    usage_prompt_tokens = prompt_tokens or estimate_text_tokens(prompt)
    usage_completion_tokens = completion_tokens or estimate_text_tokens(text)
    record_gemini_usage(
        model=mdl,
        prompt_tokens=usage_prompt_tokens,
        completion_tokens=usage_completion_tokens,
        total_tokens=usage_prompt_tokens + usage_completion_tokens,
        feature="market-lens.analysis",
        estimated=usage_is_estimated,
        request_estimate=budget_estimate,
    )

    return text, TokenUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
        model=mdl,
    )


async def call_gemini_multimodal(
    prompt: str,
    *,
    image_data: bytes,
    mime_type: str = "image/png",
    model: str | None = None,
    max_output_tokens: int | None = None,
    api_key: str | None = None,
) -> tuple[str, TokenUsage]:
    """Async Gemini image + text generation. Returns (text, TokenUsage)."""
    key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
    if not key:
        raise RuntimeError("Gemini API キーが必要です。GEMINI_API_KEY を設定するか BYOK キーを指定してください。")
    if not image_data:
        raise ValueError("Gemini 画像分析には空でない image_data が必要です。")

    mdl = normalize_gemini_model(model or _DEFAULT_MODEL)
    max_tokens = max_output_tokens or _DEFAULT_MAX_OUTPUT_TOKENS
    logger.info(
        "call_gemini_multimodal model=%s max_tokens=%s mime_type=%s image_bytes=%s has_byok=%s",
        mdl,
        max_tokens,
        mime_type,
        len(image_data),
        bool(api_key),
    )
    budget_estimate = assert_gemini_budget_available(
        model=mdl,
        prompt=prompt,
        max_output_tokens=max_tokens,
        feature="market-lens.multimodal",
    )

    text, prompt_tokens, completion_tokens = await asyncio.to_thread(
        _call_multimodal_sync,
        prompt,
        image_data=image_data,
        mime_type=mime_type,
        model=mdl,
        max_output_tokens=max_tokens,
        temperature=_DEFAULT_TEMPERATURE,
        api_key=key,
    )

    usage_is_estimated = not (prompt_tokens or completion_tokens)
    # Token metadata is authoritative when returned. For older SDKs, reserve a
    # small image allowance in addition to the text estimate for budget logs.
    usage_prompt_tokens = prompt_tokens or (estimate_text_tokens(prompt) + 1024)
    usage_completion_tokens = completion_tokens or estimate_text_tokens(text)
    record_gemini_usage(
        model=mdl,
        prompt_tokens=usage_prompt_tokens,
        completion_tokens=usage_completion_tokens,
        total_tokens=usage_prompt_tokens + usage_completion_tokens,
        feature="market-lens.multimodal",
        estimated=usage_is_estimated,
        request_estimate=budget_estimate,
    )

    return text, TokenUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
        model=mdl,
    )
