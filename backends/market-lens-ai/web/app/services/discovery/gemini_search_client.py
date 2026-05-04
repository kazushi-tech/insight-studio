"""Gemini Search Client — grounded Google Search for competitor discovery."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re

from .search_client import SearchClient, SearchClientError, SearchResult

logger = logging.getLogger("market-lens.discovery")

_DEFAULT_SEARCH_MODEL = os.getenv(
    "GEMINI_DISCOVERY_SEARCH_MODEL",
    os.getenv("GEMINI_ANALYSIS_MODEL", "gemini-2.0-flash"),
)
_URL_RE = re.compile(r'https?://[^\s<>"\'\)\]\}]+')


def _call_grounded_search_sync(
    prompt: str,
    *,
    model: str,
    api_key: str,
) -> tuple[str, list[dict]]:
    """Sync Gemini grounded search. Returns (text, grounding_chunks).

    grounding_chunks is a list of {"url": ..., "title": ...} from Google Search.
    """
    last_err: Exception | None = None

    # 1) google.genai (newer SDK — Gemini 2.0+)
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore

        client = genai.Client(api_key=api_key)
        try:
            google_search_tool = types.Tool(google_search=types.GoogleSearch())
        except Exception:
            google_search_tool = types.Tool(google_search={})  # type: ignore

        cfg = types.GenerateContentConfig(tools=[google_search_tool], temperature=0)
        resp = client.models.generate_content(model=model, contents=prompt, config=cfg)
        text = getattr(resp, "text", None) or ""
        chunks: list[dict] = []
        for candidate in getattr(resp, "candidates", None) or []:
            gm = getattr(candidate, "grounding_metadata", None)
            if not gm:
                continue
            for chunk in getattr(gm, "grounding_chunks", None) or []:
                web = getattr(chunk, "web", None)
                if not web:
                    continue
                url = getattr(web, "uri", "") or ""
                title = getattr(web, "title", "") or ""
                if url:
                    chunks.append({"url": url, "title": title})
        return text, chunks
    except Exception as e:
        last_err = e

    # 2) google.generativeai (older SDK — Gemini 1.5)
    try:
        import google.generativeai as genai_old  # type: ignore

        genai_old.configure(api_key=api_key)
        tools = [genai_old.types.Tool(
            google_search_retrieval=genai_old.types.GoogleSearchRetrieval()
        )]
        gm = genai_old.GenerativeModel(model_name=model, tools=tools)
        resp = gm.generate_content(prompt, generation_config={"temperature": 0})
        text = getattr(resp, "text", None) or ""
        chunks = []
        for candidate in getattr(resp, "candidates", None) or []:
            meta = getattr(candidate, "grounding_metadata", None)
            if not meta:
                continue
            for chunk in getattr(meta, "grounding_chunks", None) or []:
                web = getattr(chunk, "web", None)
                if not web:
                    continue
                url = getattr(web, "uri", "") or ""
                title = getattr(web, "title", "") or ""
                if url:
                    chunks.append({"url": url, "title": title})
        return text, chunks
    except Exception as e:
        raise SearchClientError(
            f"Gemini grounded search failed: {last_err} / {e}"
        ) from e


def _parse_json_results(text: str) -> list[dict]:
    """Try to parse {"results": [...]} JSON from Gemini response text."""
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
            text, grounding_chunks = await asyncio.to_thread(
                _call_grounded_search_sync,
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
