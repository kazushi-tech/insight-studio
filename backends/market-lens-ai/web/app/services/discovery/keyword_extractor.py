"""Extract search queries from a brand URL for competitor discovery."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import TYPE_CHECKING
from urllib.parse import urlparse

from ...llm_client import PROVIDER_ANTHROPIC, call_text_model

if TYPE_CHECKING:
    from ...models import ExtractedData

logger = logging.getLogger("market-lens.discovery")

_CLASSIFY_DEFAULT_MODEL = "claude-sonnet-4-6"


def _extract_brand_name(brand_url: str) -> str:
    """Extract brand name from a URL's hostname."""
    parsed = urlparse(brand_url)
    hostname = parsed.hostname or ""

    if hostname.startswith("www."):
        hostname = hostname[4:]

    parts = hostname.split(".")
    _tld_like = {"com", "org", "net", "co", "ac", "gov", "edu", "io", "dev", "app"}
    while len(parts) > 1 and (len(parts[-1]) <= 2 or parts[-1] in _tld_like):
        parts.pop()

    return parts[-1] if parts else ""


def extract_search_queries(
    brand_url: str,
    extracted: ExtractedData | None = None,
    industry: str = "",
) -> list[str]:
    """Generate search queries from a brand URL.

    When extracted data and/or industry are provided, generates
    content-aware queries for better competitor relevance.

    Args:
        brand_url: The brand's URL.
        extracted: Optional extracted data from the brand's landing page.
        industry: Optional industry classification string.

    Returns:
        List of query strings (typically 2-3 variations).
    """
    brand_name = _extract_brand_name(brand_url)
    if not brand_name:
        return []

    # Content-aware queries when extracted data or industry is available
    if extracted or industry:
        return _content_aware_queries(brand_name, extracted, industry)

    # Fallback: domain-only queries (legacy behaviour)
    return [
        f"{brand_name} competitors",
        f"{brand_name} alternatives",
        f"sites like {brand_name}",
    ]


def _content_aware_queries(
    brand_name: str,
    extracted: ExtractedData | None,
    industry: str,
) -> list[str]:
    """Build queries using page content and industry context."""
    queries: list[str] = []

    # Primary: industry-aware query
    if industry:
        queries.append(f"{industry} ブランド 公式サイト")
        queries.append(f"{industry} 専門 通販")

    # Secondary: title/h1 keywords
    if extracted:
        keywords = _extract_keywords_from_content(extracted)
        if keywords:
            kw_str = " ".join(keywords[:3])
            queries.append(f"{kw_str} competitors")
            queries.append(f"{kw_str} 比較 口コミ")

    # Always include brand-name fallback
    queries.append(f"{brand_name} competitors")

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for q in queries:
        q_lower = q.lower()
        if q_lower not in seen:
            seen.add(q_lower)
            unique.append(q)

    return unique[:5]


def _extract_keywords_from_content(extracted: ExtractedData) -> list[str]:
    """Extract meaningful keywords from page content."""
    parts: list[str] = []
    if extracted.title:
        parts.append(extracted.title)
    if extracted.h1 and extracted.h1 != extracted.title:
        parts.append(extracted.h1)
    if extracted.meta_description:
        parts.append(extracted.meta_description)

    # Split into words, remove very short and very common words
    _stopwords = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "and", "or", "of", "to", "in", "for", "on", "with", "at",
        "by", "from", "this", "that", "it", "as", "not", "but",
        "no", "do", "if", "so", "up", "out", "all", "has", "had",
        "its", "our", "your", "we", "you", "they", "|", "-", "–",
    }
    words: list[str] = []
    for part in parts:
        for w in part.split():
            w_clean = w.strip(".,;:!?()[]{}\"'|–-/\\")
            if len(w_clean) > 2 and w_clean.lower() not in _stopwords:
                words.append(w_clean)

    # Deduplicate preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for w in words:
        w_lower = w.lower()
        if w_lower not in seen:
            seen.add(w_lower)
            unique.append(w)

    return unique[:5]


async def classify_industry(
    extracted: ExtractedData,
    api_key: str,
    model: str | None = None,
) -> str:
    """Classify the industry of a brand from its landing page content.

    Uses Claude for a short classification pass.

    Args:
        extracted: Extracted data from the brand's landing page.
        api_key: Claude API key.
        model: Optional model override.

    Returns:
        Industry string (e.g. "高級水回り設備EC") or "" on failure.
    """
    resolved_model = (
        model
        or os.getenv("ANTHROPIC_DISCOVERY_CLASSIFY_MODEL")
        or os.getenv("ANTHROPIC_DISCOVERY_SEARCH_MODEL")
        or os.getenv("ANTHROPIC_ANALYSIS_MODEL")
        or os.getenv("ANTHROPIC_MODEL")
        or _CLASSIFY_DEFAULT_MODEL
    )

    # Build minimal context from extracted data
    parts: list[str] = []
    if extracted.title:
        parts.append(f"タイトル: {extracted.title}")
    if extracted.meta_description:
        parts.append(f"説明: {extracted.meta_description}")
    if extracted.h1:
        parts.append(f"見出し: {extracted.h1}")
    if extracted.feature_bullets:
        bullets = ", ".join(extracted.feature_bullets[:3])
        parts.append(f"特徴: {bullets}")

    if not parts:
        return ""

    context = "\n".join(parts)
    prompt = (
        "以下のウェブサイトの業種を、日本語で10語以内の短いラベル1つだけで答えてください。"
        "説明文や前置きは不要です。\n"
        f"{context}\n業種:"
    )

    try:
        response_text, _usage = await asyncio.wait_for(
            call_text_model(
                prompt,
                provider=PROVIDER_ANTHROPIC,
                model=resolved_model,
                api_key=api_key,
            ),
            timeout=float(os.getenv("DISCOVERY_CLASSIFY_TIMEOUT_SEC", "8")),
        )
        result = (response_text or "").strip().strip('"').strip("'")
        if result.startswith("業種:"):
            result = result.split(":", 1)[1].strip()
        if "\n" in result:
            result = result.splitlines()[0].strip()
        # Sanity check: too long means something went wrong
        if len(result) > 100:
            logger.warning("classify_industry returned unexpectedly long result")
            return ""
        logger.info("classify_industry result: %s", result)
        return result
    except Exception:
        logger.warning("classify_industry failed", exc_info=True)
        return ""


def extract_domain(url: str) -> str:
    """Extract the domain (without www.) from a URL."""
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    if hostname.startswith("www."):
        hostname = hostname[4:]
    return hostname
