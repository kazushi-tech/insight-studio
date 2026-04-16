"""Anthropic API client wrapper — powered by the official AsyncAnthropic SDK."""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import time

import anthropic
from anthropic import AsyncAnthropic

from .models import TokenUsage

_DEFAULT_ANTHROPIC_MODEL = (
    os.getenv("ANTHROPIC_ANALYSIS_MODEL")
    or os.getenv("ANTHROPIC_MODEL")
    or "claude-sonnet-4-6"
)
_MODEL_ALIASES = {
    "claude-sonnet-4.6": "claude-sonnet-4-6",
    "claude-sonnet-4": "claude-sonnet-4-6",
    "claude-sonnet-4-0": "claude-sonnet-4-6",
    "claude-sonnet-4-20250514": "claude-sonnet-4-6",
}

logger = logging.getLogger("market-lens.anthropic")

_MAX_CONNECT_RETRIES = int(os.getenv("ANTHROPIC_CONNECT_RETRIES", "3"))
_STATUS_RETRY_BASE_SEC = float(os.getenv("ANTHROPIC_STATUS_RETRY_BASE_SEC", "2"))


def normalize_anthropic_model(model: str | None = None) -> str:
    requested = (model or "").strip()
    if not requested:
        return _DEFAULT_ANTHROPIC_MODEL
    return _MODEL_ALIASES.get(requested, requested)


def _fallback_anthropic_models() -> tuple[str, ...]:
    configured = os.getenv("ANTHROPIC_FALLBACK_MODELS", "")
    return tuple(candidate.strip() for candidate in configured.split(",") if candidate.strip())


def candidate_anthropic_models(model: str | None = None) -> list[str]:
    primary = normalize_anthropic_model(model)
    candidates = [primary]
    if primary != _DEFAULT_ANTHROPIC_MODEL:
        candidates.append(_DEFAULT_ANTHROPIC_MODEL)
    for fallback in _fallback_anthropic_models():
        normalized = normalize_anthropic_model(fallback)
        if normalized not in candidates:
            candidates.append(normalized)
    return candidates


def _resolve_api_key(api_key: str | None = None) -> str:
    return api_key or os.getenv("ANTHROPIC_API_KEY", "")


def _build_client(api_key: str | None = None) -> AsyncAnthropic:
    """BYOK対応: リクエストごとにクライアント生成."""
    key = _resolve_api_key(api_key)
    if not key:
        raise ValueError("API key is required. Please provide your Claude API key.")
    timeout = float(os.getenv("ANTHROPIC_TIMEOUT_SEC", "120"))
    max_retries = int(os.getenv("ANTHROPIC_CONNECT_RETRIES", "2"))
    return AsyncAnthropic(
        api_key=key,
        timeout=timeout,
        max_retries=max_retries,
    )


def _should_retry_with_fallback(detail: str) -> bool:
    normalized = detail.lower()
    model_markers = (
        "model",
        "not found",
        "invalid model",
        "unknown model",
        "access to model",
        "not available",
        "unsupported",
    )
    return any(marker in normalized for marker in model_markers)


def _status_code(exc: anthropic.APIStatusError) -> int | None:
    status_code = getattr(exc, "status_code", None)
    if isinstance(status_code, int):
        return status_code
    response = getattr(exc, "response", None)
    response_status = getattr(response, "status_code", None)
    return response_status if isinstance(response_status, int) else None


def _retry_after_seconds(exc: anthropic.APIStatusError) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or {}
    for key in ("retry-after", "Retry-After"):
        raw = headers.get(key)
        if raw is None:
            continue
        try:
            return max(0.0, float(str(raw).strip()))
        except ValueError:
            continue
    return None


def _is_retryable_status_error(exc: anthropic.APIStatusError, detail: str) -> bool:
    status_code = _status_code(exc)
    if status_code in (408, 409, 425, 429, 500, 502, 503, 504, 529):
        return True
    normalized = detail.lower()
    return any(
        token in normalized
        for token in (
            "rate limit",
            "too many requests",
            "overloaded",
            "unavailable",
            "temporarily",
            "try again later",
            "high demand",
            "timeout",
            "busy",
        )
    )


def _status_retry_delay_sec(exc: anthropic.APIStatusError, attempt: int) -> float:
    retry_after = _retry_after_seconds(exc)
    backoff = min(30.0, _STATUS_RETRY_BASE_SEC * (2 ** attempt))
    if retry_after is None:
        return backoff
    return max(backoff, min(retry_after, 60.0))


def _extract_text_from_message(message: anthropic.types.Message) -> str:
    """SDKレスポンスからテキスト抽出（text blockのみ）."""
    texts = [block.text for block in message.content if block.type == "text"]
    if not texts:
        raise RuntimeError("Anthropic response did not contain text content.")
    result = "\n".join(texts).strip()
    if not result:
        raise RuntimeError("Anthropic response contained empty text content.")
    return result


def _usage_from_message(message: anthropic.types.Message, model: str) -> TokenUsage:
    return TokenUsage(
        prompt_tokens=message.usage.input_tokens,
        completion_tokens=message.usage.output_tokens,
        total_tokens=message.usage.input_tokens + message.usage.output_tokens,
        model=message.model or model,
    )


async def call_anthropic(
    prompt: str,
    model: str | None = None,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    api_key: str | None = None,
) -> tuple[str, TokenUsage]:
    """Call Anthropic Messages API and return (text, usage). Raises on failure."""
    models = candidate_anthropic_models(model)
    client = _build_client(api_key)
    logger.info("call_anthropic requested_model=%s candidates=%s max_tokens=%s", model, models, max_output_tokens)

    last_error: Exception | None = None
    for m in models:
        for attempt in range(_MAX_CONNECT_RETRIES + 1):
            try:
                _t0 = time.monotonic()
                message = await client.messages.create(
                    model=m,
                    max_tokens=max_output_tokens or int(os.getenv("ANTHROPIC_MAX_OUTPUT_TOKENS", "4096")),
                    temperature=temperature if temperature is not None else float(os.getenv("ANTHROPIC_TEMPERATURE", "0.2")),
                    messages=[{"role": "user", "content": prompt}],
                )
                _elapsed = time.monotonic() - _t0
                logger.info("call_anthropic SUCCESS model=%s elapsed=%.1fs tokens=%s", m, _elapsed, getattr(getattr(message, 'usage', None), 'output_tokens', '?'))
                return _extract_text_from_message(message), _usage_from_message(message, m)
            except anthropic.NotFoundError as e:
                logger.warning("Model %s not found (%.1fs), trying fallback: %s", m, time.monotonic() - _t0, e)
                last_error = e
                break
            except anthropic.APIStatusError as e:
                detail = str(e)
                if _should_retry_with_fallback(detail):
                    logger.warning("Model error for %s, trying fallback: %s", m, e)
                    last_error = e
                    break
                if attempt < _MAX_CONNECT_RETRIES and _is_retryable_status_error(e, detail):
                    wait = _status_retry_delay_sec(e, attempt)
                    logger.warning(
                        "Retryable status error on attempt %d/%d for %s, retrying in %.1fs: %s",
                        attempt + 1, _MAX_CONNECT_RETRIES + 1, m, wait, e,
                    )
                    last_error = e
                    await asyncio.sleep(wait)
                    continue
                raise RuntimeError(detail) from e
            except anthropic.APIConnectionError as e:
                last_error = e
                if attempt < _MAX_CONNECT_RETRIES:
                    wait = 2 ** (attempt + 1)
                    logger.warning(
                        "Connection error on attempt %d/%d for %s, retrying in %ds: %s",
                        attempt + 1, _MAX_CONNECT_RETRIES + 1, m, wait, e,
                    )
                    await asyncio.sleep(wait)
                    continue
                logger.error("All connection retries exhausted for model %s", m)
                break

    if last_error:
        if isinstance(last_error, anthropic.APIConnectionError):
            raise RuntimeError(
                f"Anthropic API への接続に失敗しました（{_MAX_CONNECT_RETRIES + 1}回試行）。"
                "ネットワーク状況を確認してください。"
            ) from last_error
        raise RuntimeError(f"All models failed. Last error: {last_error}") from last_error
    raise RuntimeError("No models available.")


async def call_anthropic_multimodal(
    prompt: str,
    image_data: bytes,
    mime_type: str = "image/png",
    model: str | None = None,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    api_key: str | None = None,
) -> tuple[str, TokenUsage]:
    """Text + Image → Text response via Anthropic Messages API."""
    models = candidate_anthropic_models(model)
    client = _build_client(api_key)

    last_error: Exception | None = None
    for m in models:
        for attempt in range(_MAX_CONNECT_RETRIES + 1):
            try:
                message = await client.messages.create(
                    model=m,
                    max_tokens=max_output_tokens or int(os.getenv("ANTHROPIC_MAX_OUTPUT_TOKENS", "4096")),
                    temperature=temperature if temperature is not None else float(os.getenv("ANTHROPIC_TEMPERATURE", "0.2")),
                    messages=[{
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": mime_type,
                                    "data": base64.b64encode(image_data).decode("utf-8"),
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    }],
                )
                return _extract_text_from_message(message), _usage_from_message(message, m)
            except anthropic.NotFoundError as e:
                logger.warning("Multimodal model %s not found, trying fallback: %s", m, e)
                last_error = e
                break
            except anthropic.APIStatusError as e:
                detail = str(e)
                if _should_retry_with_fallback(detail):
                    logger.warning("Multimodal model error for %s, trying fallback: %s", m, e)
                    last_error = e
                    break
                if attempt < _MAX_CONNECT_RETRIES and _is_retryable_status_error(e, detail):
                    wait = _status_retry_delay_sec(e, attempt)
                    logger.warning(
                        "Retryable multimodal status error on attempt %d/%d for %s, retrying in %.1fs: %s",
                        attempt + 1, _MAX_CONNECT_RETRIES + 1, m, wait, e,
                    )
                    last_error = e
                    await asyncio.sleep(wait)
                    continue
                raise RuntimeError(detail) from e
            except anthropic.APIConnectionError as e:
                last_error = e
                if attempt < _MAX_CONNECT_RETRIES:
                    wait = 2 ** (attempt + 1)
                    logger.warning(
                        "Multimodal connection error on attempt %d/%d for %s, retrying in %ds: %s",
                        attempt + 1, _MAX_CONNECT_RETRIES + 1, m, wait, e,
                    )
                    await asyncio.sleep(wait)
                    continue
                logger.error("All connection retries exhausted for multimodal model %s", m)
                break

    if last_error:
        if isinstance(last_error, anthropic.APIConnectionError):
            raise RuntimeError(
                f"Anthropic API への接続に失敗しました（{_MAX_CONNECT_RETRIES + 1}回試行）。"
                "ネットワーク状況を確認してください。"
            ) from last_error
        raise RuntimeError(f"All models failed. Last error: {last_error}") from last_error
    raise RuntimeError("No models available.")
