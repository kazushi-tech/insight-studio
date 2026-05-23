"""Gemini Search Client — grounded Google Search for competitor discovery.

Uses the Gemini REST API directly (httpx) to avoid SDK version dependency.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re

import httpx

from .search_client import SearchClient, SearchClientError, SearchResult

logger = logging.getLogger("market-lens.discovery")

_DEFAULT_SEARCH_MODEL = os.getenv(
    "GEMINI_DISCOVERY_SEARCH_MODEL",
    os.getenv("GEMINI_ANALYSIS_MODEL", "gemini-3.1-flash-lite"),
)
_URL_RE = re.compile(r'https?://[^\s<>"\'\)\]\}]+')
_GEMINI_REST_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


_RATE_LIMIT_RETRY_DELAYS = (5.0, 15.0)  # seconds between retries on 429


async def _call_grounded_search_async(
    prompt: str,
    *,
    model: str,
    api_key: str,
    timeout: float = 60.0,
) -> tuple[str, list[dict]]:
    """Call Gemini REST API with google_search tool. Returns (text, grounding_chunks).

    grounding_chunks is a list of {"url": ..., "title": ...}.
    Retries on 429 rate-limit with exponential backoff (5s, 15s).
    """
    url = f"{_GEMINI_REST_BASE}/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {"temperature": 0},
    }

    last_error: str | None = None
    attempts = len(_RATE_LIMIT_RETRY_DELAYS) + 1
    for attempt in range(attempts):
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload)

        if resp.status_code == 200:
            break

        error_msg = f"Gemini REST API error {resp.status_code}: {resp.text[:300]}"

        if resp.status_code == 429 and attempt < len(_RATE_LIMIT_RETRY_DELAYS):
            wait = _RATE_LIMIT_RETRY_DELAYS[attempt]
            logger.warning(
                "Gemini rate limit (attempt %d/%d), retrying in %.0fs",
                attempt + 1, attempts, wait,
            )
            await asyncio.sleep(wait)
            last_error = error_msg
            continue

        raise SearchClientError(error_msg)
    else:
        raise SearchClientError(last_error or "Gemini REST API failed after retries")

    data = resp.json()
    candidates = data.get("candidates") or []
    text = ""
    chunks: list[dict] = []

    for candidate in candidates:
        # Extract text
        for part in (candidate.get("content") or {}).get("parts") or []:
            text += part.get("text") or ""

        # Extract grounding chunks
        gm = candidate.get("groundingMetadata") or {}
        for chunk in gm.get("groundingChunks") or []:
            web = chunk.get("web") or {}
            uri = web.get("uri") or ""
            title = web.get("title") or ""
            if uri:
                chunks.append({"url": uri, "title": title})

    return text, chunks


def _parse_json_results(text: str) -> list[dict]:
    """Try to parse JSON array / {"results": [...]} from Gemini response text."""
    if not text:
        return []
    normalized = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", normalized, re.IGNORECASE | re.DOTALL)
    if fence:
        normalized = fence.group(1).strip()
    try:
        payload = json.loads(normalized)
        if isinstance(payload, dict):
            raw = payload.get("results") or payload.get("urls") or []
        else:
            raw = payload if isinstance(payload, list) else []
        results = []
        for entry in raw:
            if isinstance(entry, str):
                url = entry.strip()
                if url:
                    results.append({"url": url, "title": "", "snippet": ""})
            elif isinstance(entry, dict):
                url = str(entry.get("url") or "").strip()
                title = str(entry.get("title") or "").strip()
                snippet = str(entry.get("snippet") or "").strip()
                if url:
                    results.append({"url": url, "title": title, "snippet": snippet})
        return results
    except (json.JSONDecodeError, ValueError):
        return []


def _extract_urls_from_text(text: str) -> list[str]:
    return [u for u in _URL_RE.findall(text) if u.startswith(("http://", "https://"))]


class GeminiSearchClient(SearchClient):
    """Search competitor URLs using Gemini's grounded Google Search."""

    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self._api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        self._model = model or _DEFAULT_SEARCH_MODEL

    def _build_prompt(self, query: str, brand_context: str, num: int) -> str:
        context_line = f"Brand context: {brand_context}\n" if brand_context else ""
        return (
            f"Search Google for direct competitor homepages for the following brand.\n\n"
            f"Search query: {query}\n"
            f"{context_line}\n"
            f"Return ONLY a JSON object in this exact format:\n"
            f'[{{"url":"https://example.com","title":"Example","snippet":"short reason"}}]\n\n'
            f"Rules:\n"
            f"- Use Google Search grounding to find real, current competitor websites\n"
            f"- Return at most {num} results\n"
            f"- Only include direct competitors in the same industry\n"
            f"- Prefer official company or service homepages\n"
            f"- Exclude the brand itself, directories, marketplaces, social profiles, news, and review sites\n"
            f"- snippet must be short and factual\n"
        )

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
                "Gemini API key is required for competitor search."
            )

        num = min(num, 15)
        logger.info(
            "GeminiSearch request start model=%s request_id=%s",
            self._model, request_id,
        )
        prompt = self._build_prompt(query, brand_context, num)

        try:
            text, grounding_chunks = await _call_grounded_search_async(
                prompt,
                model=self._model,
                api_key=self._api_key,
            )
        except SearchClientError:
            raise
        except Exception as e:
            raise SearchClientError(f"Gemini search unexpected error: {e}") from e

        # Build URL→title map from grounding chunks (authoritative source of URLs)
        chunk_map: dict[str, str] = {}
        for chunk in grounding_chunks:
            url = chunk.get("url", "")
            title = chunk.get("title", "")
            if url and url not in chunk_map:
                chunk_map[url] = title

        results: list[SearchResult] = []
        seen: set[str] = set()

        def _add(url: str, title: str = "", snippet: str = "") -> bool:
            url = url.rstrip(".,;)")
            if not url.startswith(("http://", "https://")):
                return False
            if url in seen:
                return False
            seen.add(url)
            results.append(SearchResult(
                url=url,
                title=title or chunk_map.get(url, ""),
                snippet=snippet,
            ))
            return True

        # Primary: structured JSON parse
        for entry in _parse_json_results(text):
            _add(entry["url"], entry.get("title", ""), entry.get("snippet", ""))
            if len(results) >= num:
                return results

        # Secondary: grounding chunks not yet included
        for url, title in chunk_map.items():
            _add(url, title)
            if len(results) >= num:
                return results

        # Tertiary: raw URL extraction from text
        if not results:
            for url in _extract_urls_from_text(text):
                _add(url)
                if len(results) >= num:
                    break

        logger.info(
            "GeminiSearch results model=%s request_id=%s count=%d chunks=%d",
            self._model, request_id, len(results), len(grounding_chunks),
        )
        return results
