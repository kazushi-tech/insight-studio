"""LLM-based candidate validation for discovery pipeline.

Uses Haiku to filter out candidates that are from a different industry than
the input brand, reducing noise in the competitor list.
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass

from ...anthropic_client import call_anthropic

logger = logging.getLogger("market-lens.candidate_validator")

_VALIDATE_TIMEOUT_SEC = float(os.getenv("DISCOVERY_VALIDATE_CANDIDATES_TIMEOUT_SEC", "10"))
_VALIDATE_MODEL = os.getenv("DISCOVERY_VALIDATE_CANDIDATES_MODEL", "claude-haiku-4-5-20251001")
_VALIDATE_ENABLED = os.getenv("DISCOVERY_LLM_CANDIDATE_VALIDATION", "true").lower() == "true"


@dataclass
class CandidateValidation:
    url: str
    is_same_industry: bool
    confidence: str  # "high" | "medium" | "low"
    reason: str


async def _validate_single(
    candidate_url: str,
    candidate_title: str,
    brand_url: str,
    brand_industry: str,
    api_key: str | None = None,
) -> CandidateValidation:
    """Ask Haiku if a candidate is from the same industry as the input brand."""
    prompt = f"""あなたは業界分類の専門家です。以下の2サイトが同じ業界・業種かどうかを判定してください。

入力ブランド:
- URL: {brand_url}
- 業界ヒント: {brand_industry or "不明"}

候補サイト:
- URL: {candidate_url}
- タイトル: {candidate_title or "不明"}

判定基準:
- 同じ業界・業種であれば「yes」
- 明らかに異なる業界（例: ITコンサルなのに金融、食品なのに不動産）であれば「no」
- 不明な場合は「yes」（保守的に扱う）

回答は以下のJSON形式のみで返してください（説明不要）:
{{"same_industry": "yes" or "no", "confidence": "high" or "medium" or "low", "reason": "1行の根拠"}}"""

    try:
        text, _ = await call_anthropic(
            prompt,
            model=_VALIDATE_MODEL,
            max_output_tokens=128,
            api_key=api_key,
        )
        import json, re  # noqa: E401
        json_match = re.search(r'\{[^}]+\}', text, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group())
            return CandidateValidation(
                url=candidate_url,
                is_same_industry=data.get("same_industry", "yes") == "yes",
                confidence=data.get("confidence", "medium"),
                reason=data.get("reason", ""),
            )
    except Exception as exc:
        logger.warning("candidate_validator single validation failed url=%s: %s", candidate_url, exc)

    return CandidateValidation(url=candidate_url, is_same_industry=True, confidence="low", reason="validation_failed")


async def validate_candidates(
    candidates: list[dict],
    brand_url: str,
    brand_industry: str,
    api_key: str | None = None,
) -> list[dict]:
    """Filter candidate list using parallel LLM industry validation.

    Returns candidates sorted by relevance with clearly-off-industry
    candidates removed or demoted.
    """
    if not _VALIDATE_ENABLED:
        return candidates

    if not candidates:
        return candidates

    tasks = [
        _validate_single(
            candidate_url=c.get("url", ""),
            candidate_title=c.get("title", "") or c.get("domain", ""),
            brand_url=brand_url,
            brand_industry=brand_industry,
            api_key=api_key,
        )
        for c in candidates
    ]

    try:
        results: list[CandidateValidation] = await asyncio.wait_for(
            asyncio.gather(*tasks, return_exceptions=True),
            timeout=_VALIDATE_TIMEOUT_SEC,
        )
    except asyncio.TimeoutError:
        logger.warning("candidate_validator timed out after %.1fs — returning original ranking", _VALIDATE_TIMEOUT_SEC)
        return candidates

    valid_candidates = []
    demoted_candidates = []
    for candidate, result in zip(candidates, results):
        if isinstance(result, Exception):
            valid_candidates.append(candidate)
            continue
        if result.is_same_industry or result.confidence == "low":
            valid_candidates.append(candidate)
        else:
            logger.info(
                "candidate_validator demoted url=%s confidence=%s reason=%s",
                result.url, result.confidence, result.reason,
            )
            demoted_candidates.append(candidate)

    logger.info(
        "candidate_validator result: %d valid, %d demoted of %d total",
        len(valid_candidates), len(demoted_candidates), len(candidates),
    )
    return valid_candidates + demoted_candidates
