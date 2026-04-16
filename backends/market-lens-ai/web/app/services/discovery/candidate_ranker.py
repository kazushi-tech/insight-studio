"""Score and rank discovery candidates."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import urlparse

from .keyword_extractor import extract_domain
from .search_client import SearchResult

logger = logging.getLogger("market-lens.discovery.ranker")

# ── Garbled-text detection (Task A) ──────────────────────────
# Character sequences that strongly indicate encoding corruption.
_GARBLED_CHARS = "\ufffd\uffef\ufffe\uffff"

# Repeated question-mark / boxed patterns indicating undecodable runs
_REPEATED_UNKNOWN = re.compile(r"(?:\ufffd|\?){3,}")

# CJK ranges that are normal
_NORMAL_CJK = re.compile(
    r"[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff"
    r"\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]"
)


def detect_garbled_ratio(text: str) -> float:
    """Return 0.0–1.0 ratio of garbled / undecodable characters in *text*.

    A ratio above ~0.15 typically means encoding corruption.
    """
    if not text:
        return 0.0

    # Count replacement characters and obvious garbage
    garbage = sum(1 for ch in text if ch in _GARBLED_CHARS)
    garbage += len(_REPEATED_UNKNOWN.findall(text)) * 3  # weight runs higher

    # Count total meaningful characters (exclude whitespace)
    total = sum(1 for ch in text if not ch.isspace())
    if total == 0:
        return 0.0

    return min(garbage / total, 1.0)


def compute_extraction_quality(data) -> float:
    """Return 0.0–1.0 extraction quality score based on ExtractedData.

    Considers field fill rate, body text length, and garbled-text ratio.
    """
    if data is None:
        return 0.0

    fields = {
        'title': bool(data.title),
        'meta_description': bool(data.meta_description),
        'h1': bool(data.h1),
        'hero_copy': bool(data.hero_copy),
        'main_cta': bool(data.main_cta),
        'pricing_snippet': bool(data.pricing_snippet),
        'feature_bullets': bool(data.feature_bullets),
        'body_text_snippet': bool(data.body_text_snippet),
        'faq_items': bool(data.faq_items),
        'testimonials': bool(data.testimonials),
    }

    fill_rate = sum(1 for v in fields.values() if v) / len(fields)

    # Body text length bonus (0–0.2)
    body_len = len(data.body_text_snippet or "")
    body_bonus = min(body_len / 500, 1.0) * 0.2

    # Garbled-text penalty (0–0.5)
    garbled = detect_garbled_ratio(
        f"{data.title or ''} {data.body_text_snippet or ''} {data.hero_copy or ''}"
    )
    garbled_penalty = garbled * 0.5

    return min(max(fill_rate * 0.8 + body_bonus - garbled_penalty, 0.0), 1.0)


# Quality thresholds
_EXTRACTION_QUALITY_LOW = 0.15   # Below this → auto-exclude from comparison
_EXTRACTION_QUALITY_WARN = 0.30  # Below this → flag as "評価保留"


_NON_COMPETITOR_DOMAINS = {
    "amazon.co.jp", "amazon.com", "rakuten.co.jp", "yahoo.co.jp",
    "kakaku.com", "cosme.net", "mybest.com", "wikipedia.org",
    "youtube.com", "twitter.com", "instagram.com", "facebook.com",
    "note.com", "ameblo.jp", "lohaco.yahoo.co.jp",
    # B-1: 総合EC・メディア・コンサル系
    "monotaro.com", "askul.co.jp", "yodobashi.com", "biccamera.com",
    "prtimes.jp", "nikkei.com", "toyokeizai.net", "diamond.jp",
    "itmedia.co.jp", "mynavi.jp", "recruit.co.jp",
    "mercari.com", "zozotown.com",
}

_LP_SIGNAL_KEYWORDS = [
    "公式", "official", "通販", "ショップ", "shop", "store",
    "定期", "初回", "お試し", "送料無料",
]

# B-2: 非競合シグナルキーワード（コンサル・メディア・調査系）
_NON_COMPETITOR_SIGNAL_KEYWORDS = [
    "コンサルティング", "市場調査", "レポート", "まとめ",
    "ニュース", "プレスリリース", "調査結果", "市場規模",
    "海外進出", "支援", "代行",
]

# B-3: 総合EC特有パターン
_GENERAL_EC_PATTERNS = [
    "総合通販", "法人向け", "業務用", "工業用品", "オフィス用品",
    "万点", "万商品", "品揃え",
]

# B-5: 記事ページパスパターン
_ARTICLE_PATH_PATTERNS = [
    "/blog/", "/news/", "/column/", "/article/",
    "/magazine/", "/media/", "/journal/",
]


@dataclass
class RankedCandidate:
    """A search result with computed relevance score."""

    url: str
    domain: str
    title: str
    snippet: str
    score: int
    competitive_tier: str = "benchmark"  # direct / indirect / benchmark


def rank_candidates(
    results: list[SearchResult],
    brand_domain: str,
    industry_keywords: list[str] | None = None,
) -> list[RankedCandidate]:
    """Score and rank search results, filtering out the brand's own domain.

    Scoring heuristics (0-100):
    - Base score: 50
    - Has title: +10
    - Has snippet: +10
    - Different TLD from brand: +5
    - Snippet mentions 'competitor', 'alternative', 'vs', 'compare': +15
    - Industry keyword match in title/snippet: +20
    - Same domain as brand: excluded

    Args:
        results: Search results to rank.
        brand_domain: Domain of the brand (excluded from results).
        industry_keywords: Optional list of industry keywords for relevance boost.

    Returns:
        Sorted list of RankedCandidate (highest score first), brand domain excluded.
    """
    candidates: list[RankedCandidate] = []

    brand_domain_lower = brand_domain.lower()
    kw_lower = [kw.lower() for kw in (industry_keywords or []) if len(kw) > 1]

    for result in results:
        domain = extract_domain(result.url)
        if not domain:
            continue

        # Skip the brand's own domain
        if domain.lower() == brand_domain_lower:
            continue

        score = 50

        if result.title.strip():
            score += 10
        if result.snippet.strip():
            score += 10

        # Different TLD bonus
        brand_tld = brand_domain_lower.rsplit(".", 1)[-1] if "." in brand_domain_lower else ""
        result_tld = domain.lower().rsplit(".", 1)[-1] if "." in domain else ""
        if brand_tld and result_tld and brand_tld != result_tld:
            score += 5

        # Marketplace / media site penalty
        if domain.lower() in _NON_COMPETITOR_DOMAINS:
            score -= 30

        # D2C / official site signal bonus
        text_lower = f"{result.title} {result.snippet}".lower()
        title_lower = result.title.lower()
        snippet_lower = result.snippet.lower()
        if any(kw in text_lower for kw in _LP_SIGNAL_KEYWORDS):
            score += 10

        # B-2: Non-competitor signal penalty (consulting/media/research)
        if any(kw in text_lower for kw in _NON_COMPETITOR_SIGNAL_KEYWORDS):
            score -= 15

        # B-3: General EC pattern penalty
        if any(kw in text_lower for kw in _GENERAL_EC_PATTERNS):
            score -= 10

        # B-5: Article page path penalty
        url_path = urlparse(result.url).path.lower()
        if any(pattern in url_path for pattern in _ARTICLE_PATH_PATTERNS):
            score -= 10

        # Competitor-related keywords in snippet
        comp_keywords = [
            "competitor", "alternative", "vs ", "compare", "versus", "rival",
            "競合", "代替", "比較", "ライバル", "類似", "乗り換え",
        ]
        if any(kw in snippet_lower for kw in comp_keywords):
            score += 15

        # B-3: Industry keyword match — title match +20, snippet-only +8, no match -15
        if kw_lower:
            if any(kw in title_lower for kw in kw_lower):
                score += 20
            elif any(kw in snippet_lower for kw in kw_lower):
                score += 8
            else:
                score -= 15

        candidates.append(
            RankedCandidate(
                url=result.url,
                domain=domain,
                title=result.title,
                snippet=result.snippet,
                score=max(min(score, 100), 0),
            )
        )

    # Sort by score descending
    candidates.sort(key=lambda c: c.score, reverse=True)

    # Deduplicate by domain — keep highest-scoring URL per domain
    seen_domains: set[str] = set()
    deduped: list[RankedCandidate] = []
    for c in candidates:
        d = c.domain.lower()
        if d not in seen_domains:
            seen_domains.add(d)
            deduped.append(c)

    # Classify competitive tiers
    classify_competitive_tiers(deduped, industry_keywords)
    return deduped


def classify_competitive_tiers(
    candidates: list[RankedCandidate],
    industry_keywords: list[str] | None = None,
) -> None:
    """Classify candidates into competitive tiers in-place.

    - direct (直競合): High score + industry keyword match (LP signal alone is insufficient)
    - indirect (準競合): Moderate score, or LP/industry signals present
    - benchmark (ベンチマーク): Lower score, reference only
    """
    kw_lower = [kw.lower() for kw in (industry_keywords or []) if len(kw) > 1]

    for c in candidates:
        text_lower = f"{c.title} {c.snippet}".lower()
        has_industry_match = any(kw in text_lower for kw in kw_lower) if kw_lower else False
        has_lp_signal = any(kw in text_lower for kw in _LP_SIGNAL_KEYWORDS)

        if c.score >= 60 and has_industry_match:
            c.competitive_tier = "direct"
        elif c.score >= 40 or has_lp_signal or has_industry_match:
            c.competitive_tier = "indirect"
        else:
            c.competitive_tier = "benchmark"


# D-1: LLM-based candidate validation
_VALIDATE_DEFAULT_MODEL = "claude-haiku-4-5-20251001"
_VALIDATE_TIMEOUT_SEC = 10.0


async def validate_candidates_with_llm(
    candidates: list[RankedCandidate],
    brand_domain: str,
    industry: str,
    api_key: str,
    *,
    max_candidates: int = 8,
) -> list[RankedCandidate]:
    """Use Claude Haiku to filter out non-competitor candidates.

    Args:
        candidates: Pre-ranked candidates from heuristic scoring.
        brand_domain: The brand's domain.
        industry: Industry classification string.
        api_key: Claude API key.
        max_candidates: Max candidates to validate (to limit API calls).

    Returns:
        Filtered list of candidates that are likely true competitors.
    """
    if not candidates or not industry or not api_key:
        return candidates

    from ...llm_client import PROVIDER_ANTHROPIC, call_text_model

    model = (
        os.getenv("ANTHROPIC_DISCOVERY_VALIDATE_MODEL")
        or os.getenv("ANTHROPIC_DISCOVERY_CLASSIFY_MODEL")
        or _VALIDATE_DEFAULT_MODEL
    )

    to_validate = candidates[:max_candidates]
    candidate_lines = "\n".join(
        f"- {c.domain}: {c.title} | {c.snippet[:100]}"
        for c in to_validate
    )

    prompt = (
        f"ブランド: {brand_domain}\n"
        f"業種: {industry}\n\n"
        f"以下の候補サイトが「{industry}」の直接競合（同じ業種で同じ顧客層を奪い合う存在）かどうか判定してください。\n"
        f"総合ECサイト、コンサルティング会社、メディア/ニュースサイト、市場調査サイトは競合ではありません。\n\n"
        f"{candidate_lines}\n\n"
        f"各候補について YES または NO のみを1行ずつ回答してください。\n"
        f"フォーマット: ドメイン: YES/NO\n"
    )

    try:
        response_text, _usage = await asyncio.wait_for(
            call_text_model(
                prompt,
                provider=PROVIDER_ANTHROPIC,
                model=model,
                api_key=api_key,
            ),
            timeout=float(os.getenv("DISCOVERY_VALIDATE_TIMEOUT_SEC", str(_VALIDATE_TIMEOUT_SEC))),
        )
    except Exception:
        logger.warning("LLM candidate validation failed, returning unfiltered candidates", exc_info=True)
        return candidates

    # Parse YES/NO responses
    validated_domains: set[str] = set()
    rejected_domains: set[str] = set()
    for line in (response_text or "").strip().splitlines():
        line = line.strip().lstrip("- ")
        if ":" not in line:
            continue
        domain_part, answer = line.rsplit(":", 1)
        domain_part = domain_part.strip().lower()
        answer = answer.strip().upper()
        if "YES" in answer:
            validated_domains.add(domain_part)
        elif "NO" in answer:
            rejected_domains.add(domain_part)

    if not validated_domains and not rejected_domains:
        logger.warning("LLM validation returned unparseable response, returning unfiltered")
        return candidates

    # Keep candidates that are validated or not explicitly rejected
    filtered = [
        c for c in candidates
        if c.domain.lower() in validated_domains
        or c.domain.lower() not in rejected_domains
    ]

    logger.info(
        "llm_validation validated=%d rejected=%d kept=%d",
        len(validated_domains), len(rejected_domains), len(filtered),
    )
    return filtered
