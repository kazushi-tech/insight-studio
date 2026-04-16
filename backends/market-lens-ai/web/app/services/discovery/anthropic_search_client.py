"""Anthropic Search Client — use Claude web search for competitor discovery."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
from typing import Any

import anthropic
from anthropic import AsyncAnthropic

from ...anthropic_client import normalize_anthropic_model
from .search_client import SearchClient, SearchClientError, SearchResult

logger = logging.getLogger("market-lens.discovery")

_DEFAULT_MODEL = normalize_anthropic_model(
    os.getenv("ANTHROPIC_DISCOVERY_SEARCH_MODEL")
    or os.getenv("ANTHROPIC_ANALYSIS_MODEL")
    or os.getenv("ANTHROPIC_MODEL")
    or "claude-sonnet-4-6"
)
_DEFAULT_TOOL_TYPE = os.getenv(
    "ANTHROPIC_DISCOVERY_SEARCH_TOOL_VERSION",
    "web_search_20250305",
)
_URL_RE = re.compile(r'https?://[^\s<>"\'\)\]\}]+')


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    deduped: list[str] = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped


class AnthropicSearchClient(SearchClient):
    """Search competitor URLs using Claude's web search tool."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        self._api_key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
        self._model = normalize_anthropic_model(model or _DEFAULT_MODEL)
        self._fallback_models = self._build_fallback_models()
        self._tool_type = os.getenv(
            "ANTHROPIC_DISCOVERY_SEARCH_TOOL_VERSION",
            _DEFAULT_TOOL_TYPE,
        )
        self._max_uses = int(os.getenv("ANTHROPIC_DISCOVERY_SEARCH_MAX_USES", "2"))
        self._max_retries = int(os.getenv("DISCOVERY_SEARCH_MAX_RETRIES", "1"))
        self._retry_delay_sec = float(
            os.getenv("DISCOVERY_SEARCH_RETRY_DELAY_SEC", "1")
        )
        self._request_timeout_sec = float(
            os.getenv("DISCOVERY_GROUNDED_SEARCH_TIMEOUT_SEC", "30")
        )
        self._anthropic_timeout_sec = float(os.getenv("ANTHROPIC_TIMEOUT_SEC", "120"))

    def _build_fallback_models(self) -> list[str]:
        configured = [
            normalize_anthropic_model(candidate.strip())
            for candidate in os.getenv(
                "ANTHROPIC_DISCOVERY_SEARCH_FALLBACK_MODELS",
                "",
            ).split(",")
            if candidate.strip()
        ]
        return _dedupe_preserve_order([self._model, *configured])

    def _remaining(self, deadline: float | None) -> float | None:
        if deadline is None:
            return None
        return max(0.0, deadline - time.monotonic())

    def _has_retry_budget(
        self,
        deadline: float | None,
        *,
        projected_cost_sec: float = 0.0,
    ) -> bool:
        remaining = self._remaining(deadline)
        if remaining is None:
            return True
        return (remaining - projected_cost_sec) > max(2.0, self._retry_delay_sec + 1.0)

    def _request_log_context(
        self,
        *,
        request_id: str | None,
        model: str,
        attempt: int | None = None,
        timeout_sec: float | None = None,
    ) -> str:
        parts = [
            f"request_id={request_id}" if request_id else None,
            f"model={model}",
            f"attempt={attempt}" if attempt is not None else None,
            f"timeout_sec={timeout_sec:.1f}" if timeout_sec is not None else None,
            f"tool_type={self._tool_type}",
            f"max_uses={self._max_uses}",
        ]
        return " ".join(part for part in parts if part)

    def _retry_after_seconds(self, exc: anthropic.APIStatusError) -> float | None:
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

    def _retry_wait_sec(
        self,
        attempt: int,
        exc: anthropic.APIStatusError | None = None,
    ) -> float:
        backoff = min(20.0, self._retry_delay_sec * (2 ** attempt))
        if exc is None:
            return backoff
        retry_after = self._retry_after_seconds(exc)
        if retry_after is None:
            return backoff
        return max(backoff, min(retry_after, 30.0))

    def _build_client(self) -> AsyncAnthropic:
        if not self._api_key:
            raise SearchClientError(
                "Claude API key is required. Please provide your API key."
            )
        return AsyncAnthropic(
            api_key=self._api_key,
            timeout=max(self._request_timeout_sec, self._anthropic_timeout_sec),
            max_retries=0,
        )

    def _build_prompt(self, query: str, brand_context: str, num: int) -> str:
        context_line = f"Brand context: {brand_context}\n" if brand_context else ""
        return f"""Use the web_search tool to find direct competitor homepages for the following brand.

Search query: {query}
{context_line}Return JSON only in this exact format:
{{"results":[{{"url":"https://example.com","title":"Example","snippet":"short reason this is a direct competitor"}}]}}

Rules:
- Use web_search before answering
- Return at most {num} results
- Only include direct competitors in the same industry
- Prefer official company or service homepages
- Exclude the brand itself, directories, marketplaces, social profiles, news articles, and review sites
- Prefer canonical homepage URLs over deep article URLs
- snippet must be short and factual
"""

    async def search(
        self,
        query: str,
        *,
        num: int = 10,
        brand_context: str = "",
        deadline: float | None = None,
        request_id: str | None = None,
    ) -> list[SearchResult]:
        if not self._api_key:
            raise SearchClientError(
                "Claude API key is required. Please provide your API key."
            )

        num = min(num, 12)
        remaining = self._remaining(deadline)
        if remaining is not None:
            primary_timeout = min(self._request_timeout_sec, max(3.0, remaining - 1.0))
        else:
            primary_timeout = self._request_timeout_sec

        logger.info(
            "Anthropic Search request start %s fallback_models=%d deadline_remaining_sec=%s",
            self._request_log_context(
                request_id=request_id,
                model=self._model,
                timeout_sec=primary_timeout,
            ),
            len(self._fallback_models),
            (
                f"{self._remaining(deadline):.1f}"
                if self._remaining(deadline) is not None
                else "none"
            ),
        )

        prompt = self._build_prompt(query, brand_context, num)
        last_error: SearchClientError | None = None

        for candidate_model in self._fallback_models:
            try:
                message = await self._request_message(
                    model=candidate_model,
                    prompt=prompt,
                    timeout_sec=primary_timeout,
                    deadline=deadline,
                    request_id=request_id,
                )
            except SearchClientError as exc:
                if self._looks_like_api_key_error(str(exc)):
                    raise
                last_error = exc
                logger.warning(
                    "Anthropic Search model %s failed, trying next candidate %s detail=%s",
                    candidate_model,
                    self._request_log_context(
                        request_id=request_id,
                        model=candidate_model,
                        timeout_sec=primary_timeout,
                    ),
                    exc,
                )
                continue

            results = self._extract_results(message, num)
            if results:
                return results

            last_error = SearchClientError(
                f"Anthropic Search error: model {candidate_model} returned no competitor URLs"
            )
            logger.warning(
                "Anthropic Search model %s returned no usable URLs %s",
                candidate_model,
                self._request_log_context(
                    request_id=request_id,
                    model=candidate_model,
                    timeout_sec=primary_timeout,
                ),
            )

        if last_error is not None:
            raise last_error
        return []

    async def _request_message(
        self,
        *,
        model: str,
        prompt: str,
        timeout_sec: float,
        deadline: float | None = None,
        request_id: str | None = None,
    ) -> Any:
        client = self._build_client()

        for attempt in range(self._max_retries + 1):
            remaining = self._remaining(deadline)
            effective_timeout = timeout_sec
            if remaining is not None:
                effective_timeout = min(timeout_sec, max(2.0, remaining - 1.0))

            try:
                message = await asyncio.wait_for(
                    client.messages.create(
                        model=model,
                        max_tokens=1024,
                        temperature=0,
                        tools=[self._build_search_tool()],
                        messages=[{"role": "user", "content": prompt}],
                    ),
                    timeout=effective_timeout,
                )
            except asyncio.TimeoutError as exc:
                can_retry = (
                    attempt < self._max_retries
                    and self._has_retry_budget(
                        deadline,
                        projected_cost_sec=effective_timeout,
                    )
                )
                if can_retry:
                    logger.warning(
                        "Anthropic Search attempt %d timed out after %.0fs, retrying %s",
                        attempt + 1,
                        effective_timeout,
                        self._request_log_context(
                            request_id=request_id,
                            model=model,
                            attempt=attempt + 1,
                            timeout_sec=effective_timeout,
                        ),
                    )
                    await asyncio.sleep(self._retry_wait_sec(attempt))
                    continue
                raise SearchClientError(
                    f"Anthropic Search error: request timed out after {effective_timeout:.0f}s"
                ) from exc
            except anthropic.NotFoundError as exc:
                raise SearchClientError(
                    f"Anthropic Search error: model {model} is not available"
                ) from exc
            except anthropic.APIConnectionError as exc:
                can_retry = (
                    attempt < self._max_retries
                    and self._has_retry_budget(deadline, projected_cost_sec=1.0)
                )
                if can_retry:
                    logger.warning(
                        "Anthropic Search transport error, retrying %s detail=%s",
                        self._request_log_context(
                            request_id=request_id,
                            model=model,
                            attempt=attempt + 1,
                            timeout_sec=effective_timeout,
                        ),
                        exc,
                    )
                    await asyncio.sleep(self._retry_wait_sec(attempt))
                    continue
                raise SearchClientError(f"Anthropic Search error: {exc}") from exc
            except anthropic.APIStatusError as exc:
                detail = str(exc)
                if self._looks_like_api_key_error(detail):
                    raise SearchClientError(f"Invalid Claude API key: {detail}") from exc
                can_retry = (
                    attempt < self._max_retries
                    and self._is_retryable_status_error(exc, detail)
                    and self._has_retry_budget(deadline, projected_cost_sec=1.0)
                )
                if can_retry:
                    logger.warning(
                        "Anthropic Search upstream returned retryable error, retrying %s detail=%s",
                        self._request_log_context(
                            request_id=request_id,
                            model=model,
                            attempt=attempt + 1,
                            timeout_sec=effective_timeout,
                        ),
                        detail,
                    )
                    await asyncio.sleep(self._retry_wait_sec(attempt, exc))
                    continue
                raise SearchClientError(f"Anthropic Search error: {detail}") from exc

            tool_error = self._extract_tool_error(message)
            if tool_error:
                can_retry = (
                    attempt < self._max_retries
                    and self._is_retryable_tool_error(tool_error)
                    and self._has_retry_budget(deadline, projected_cost_sec=1.0)
                )
                if can_retry:
                    logger.warning(
                        "Anthropic Search tool error %s, retrying %s",
                        tool_error,
                        self._request_log_context(
                            request_id=request_id,
                            model=model,
                            attempt=attempt + 1,
                            timeout_sec=effective_timeout,
                        ),
                    )
                    await asyncio.sleep(self._retry_wait_sec(attempt))
                    continue
                raise SearchClientError(
                    f"Anthropic web search error: {tool_error}"
                )

            return message

        raise SearchClientError("Anthropic Search error: exhausted retries")

    def _build_search_tool(self) -> dict[str, Any]:
        return {
            "type": self._tool_type,
            "name": "web_search",
            "max_uses": self._max_uses,
        }

    def _extract_results(self, message: Any, max_results: int) -> list[SearchResult]:
        payload = self._to_plain(message)
        blocks = payload.get("content") or []

        citations = self._extract_citation_snippets(blocks)
        structured = self._parse_structured_results(
            self._extract_response_text(blocks),
            citations,
            max_results * 2,
        )
        searched = self._extract_tool_results(blocks, citations, max_results * 3)

        results: list[SearchResult] = []
        seen_urls: set[str] = set()
        for candidate in [*structured, *searched]:
            if candidate.url in seen_urls:
                continue
            results.append(candidate)
            seen_urls.add(candidate.url)
            if len(results) >= max_results:
                break

        return results

    def _extract_tool_error(self, message: Any) -> str | None:
        payload = self._to_plain(message)
        for block in payload.get("content") or []:
            if block.get("type") != "web_search_tool_result":
                continue
            content = block.get("content")
            if isinstance(content, dict) and content.get("type") == "web_search_tool_result_error":
                return str(content.get("error_code") or "unavailable")
        return None

    def _extract_response_text(self, blocks: list[dict[str, Any]]) -> str:
        texts = [
            block.get("text", "")
            for block in blocks
            if block.get("type") == "text" and block.get("text")
        ]
        return "\n".join(texts).strip()

    def _extract_citation_snippets(
        self,
        blocks: list[dict[str, Any]],
    ) -> dict[str, dict[str, str]]:
        snippets: dict[str, dict[str, str]] = {}
        for block in blocks:
            if block.get("type") != "text":
                continue
            for citation in block.get("citations") or []:
                if citation.get("type") not in {
                    "web_search_result_location",
                    "search_result_location",
                }:
                    continue
                url = citation.get("url")
                if not url:
                    continue
                snippets[url] = {
                    "title": citation.get("title") or "",
                    "snippet": citation.get("cited_text") or "",
                }
        return snippets

    def _extract_tool_results(
        self,
        blocks: list[dict[str, Any]],
        citations: dict[str, dict[str, str]],
        max_results: int,
    ) -> list[SearchResult]:
        results: list[SearchResult] = []
        for block in blocks:
            if block.get("type") != "web_search_tool_result":
                continue
            content = block.get("content")
            if not isinstance(content, list):
                continue
            for item in content:
                if item.get("type") != "web_search_result":
                    continue
                url = str(item.get("url") or "").strip()
                if not url.startswith(("http://", "https://")):
                    continue
                citation = citations.get(url, {})
                results.append(
                    SearchResult(
                        url=url,
                        title=(item.get("title") or citation.get("title") or "").strip(),
                        snippet=(citation.get("snippet") or "").strip(),
                    )
                )
                if len(results) >= max_results:
                    return results
        return results

    def _parse_structured_results(
        self,
        text: str,
        citations: dict[str, dict[str, str]],
        max_results: int,
    ) -> list[SearchResult]:
        if not text:
            return []

        normalized = text.strip()
        code_fence = re.search(r"```(?:json)?\s*(.*?)```", normalized, re.IGNORECASE | re.DOTALL)
        if code_fence:
            normalized = code_fence.group(1).strip()

        try:
            payload = json.loads(normalized)
        except json.JSONDecodeError:
            return self._fallback_parse(text, citations, max_results)

        if isinstance(payload, dict):
            raw_results = payload.get("results") or payload.get("urls")
        else:
            raw_results = payload

        if not isinstance(raw_results, list):
            return self._fallback_parse(text, citations, max_results)

        results: list[SearchResult] = []
        for entry in raw_results:
            if isinstance(entry, str):
                url = entry.strip()
                title = citations.get(url, {}).get("title", "")
                snippet = citations.get(url, {}).get("snippet", "")
            elif isinstance(entry, dict):
                url = str(entry.get("url") or "").strip()
                title = str(entry.get("title") or citations.get(url, {}).get("title", "")).strip()
                snippet = str(
                    entry.get("snippet") or citations.get(url, {}).get("snippet", "")
                ).strip()
            else:
                continue
            if not url.startswith(("http://", "https://")):
                continue
            results.append(SearchResult(url=url, title=title, snippet=snippet))
            if len(results) >= max_results:
                break
        return results

    def _fallback_parse(
        self,
        text: str,
        citations: dict[str, dict[str, str]],
        max_results: int,
    ) -> list[SearchResult]:
        results: list[SearchResult] = []
        for url in _URL_RE.findall(text):
            citation = citations.get(url, {})
            results.append(
                SearchResult(
                    url=url,
                    title=(citation.get("title") or "").strip(),
                    snippet=(citation.get("snippet") or "").strip(),
                )
            )
            if len(results) >= max_results:
                break
        return results

    def _to_plain(self, value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, dict):
            return {key: self._to_plain(val) for key, val in value.items()}
        if isinstance(value, list):
            return [self._to_plain(item) for item in value]
        if hasattr(value, "model_dump"):
            return self._to_plain(value.model_dump())
        if isinstance(value, tuple):
            return [self._to_plain(item) for item in value]
        return value

    def _looks_like_api_key_error(self, detail: str) -> bool:
        lowered = detail.lower()
        return any(
            token in lowered
            for token in (
                "api key",
                "x-api-key",
                "authentication",
                "unauthorized",
                "permission",
                "forbidden",
            )
        )

    def _is_retryable_status_error(
        self,
        exc: anthropic.APIStatusError,
        detail: str,
    ) -> bool:
        status_code = getattr(exc, "status_code", None)
        if status_code in (408, 409, 429, 500, 502, 503, 504):
            return True
        lowered = detail.lower()
        return any(
            token in lowered
            for token in (
                "rate limit",
                "too many requests",
                "overloaded",
                "unavailable",
                "timeout",
                "temporarily",
                "try again later",
            )
        )

    def _is_retryable_tool_error(self, error_code: str) -> bool:
        return error_code in {"too_many_requests", "unavailable"}
