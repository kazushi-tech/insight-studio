"""Deterministic market estimator.

``estimate(industry, brands)`` returns a ``MarketEstimate`` by looking up an
industry prior table and combining the brand count into a deterministic ad
spend range. Both Compare and Discovery call this once per report so the
same industry always produces the same numbers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Sequence

import yaml

_PRIORS_PATH = Path(__file__).parent / "industry_priors.yaml"


@dataclass(frozen=True)
class NumericRange:
    min: float
    max: float
    unit: str = ""

    def formatted(self, scale: float = 1.0, suffix: str = "") -> str:
        lo = self.min / scale
        hi = self.max / scale
        if lo == int(lo) and hi == int(hi):
            return f"{int(lo):,}〜{int(hi):,}{suffix}"
        return f"{lo:,.1f}〜{hi:,.1f}{suffix}"


@dataclass(frozen=True)
class IndustryPrior:
    key: str
    label: str
    match_keywords: tuple[str, ...]
    market_size_jpy: NumericRange
    annual_growth_pct: NumericRange
    monthly_search_volume: NumericRange
    cpc_jpy: NumericRange
    avg_cvr_pct: NumericRange
    confidence: str
    source_note: str
    buying_behavior_template: str = ""


@dataclass(frozen=True)
class MarketEstimate:
    industry_key: str
    industry_label: str
    confidence: str
    source_note: str
    market_size_jpy: NumericRange
    annual_growth_pct: NumericRange
    monthly_search_volume: NumericRange
    cpc_jpy: NumericRange
    avg_cvr_pct: NumericRange
    # Per-brand ad spend derived from search volume × CPC × assumed impression share
    ad_spend_monthly_jpy: NumericRange
    brand_count: int
    buying_behavior_template: str = ""


def _range(entry: dict, unit: str = "") -> NumericRange:
    return NumericRange(min=float(entry["min"]), max=float(entry["max"]), unit=unit)


@lru_cache(maxsize=1)
def load_industry_priors() -> tuple[IndustryPrior, ...]:
    with _PRIORS_PATH.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    priors = []
    for entry in data.get("priors", []):
        priors.append(
            IndustryPrior(
                key=entry["key"],
                label=entry["label"],
                match_keywords=tuple(entry.get("match_keywords", [])),
                market_size_jpy=_range(entry["market_size_jpy"], "円"),
                annual_growth_pct=_range(entry["annual_growth_pct"], "%"),
                monthly_search_volume=_range(entry["monthly_search_volume"], "/月"),
                cpc_jpy=_range(entry["cpc_jpy"], "円"),
                avg_cvr_pct=_range(entry["avg_cvr_pct"], "%"),
                confidence=entry.get("confidence", "low"),
                source_note=entry.get("source_note", ""),
                buying_behavior_template=entry.get("buying_behavior_template", "") or "",
            )
        )
    if not priors:
        raise ValueError("industry_priors.yaml has no priors")
    return tuple(priors)


def classify_industry(industry_hint: str | None, keywords: Sequence[str] | None = None) -> IndustryPrior:
    """Pick the best-matching industry prior.

    Preference order:
      1. Explicit match on industry_hint equal to a prior key.
      2. Substring match of industry_hint against any match_keyword.
      3. Substring match of any input keyword against any match_keyword.
      4. Fallback to ``fallback_general``.
    """
    priors = load_industry_priors()
    hint = (industry_hint or "").strip().lower()
    if hint:
        for p in priors:
            if p.key == hint:
                return p
        for p in priors:
            for kw in p.match_keywords:
                if kw.lower() in hint:
                    return p
    if keywords:
        flat = " ".join(k for k in keywords if k).lower()
        for p in priors:
            for kw in p.match_keywords:
                if kw.lower() in flat:
                    return p
    for p in priors:
        if p.key == "fallback_general":
            return p
    return priors[-1]


def _estimate_ad_spend(prior: IndustryPrior, brand_count: int) -> NumericRange:
    """Deterministic per-brand monthly ad spend range.

    Formula (intentionally simple so it is reproducible and auditable):
        monthly_budget = search_volume × CPC × assumed_impression_share / brand_count
    Assumed impression share is 0.3 on the low end and 0.6 on the high end.
    Falls back to a per-brand share of 1/max(brand_count, 1).
    """
    share_lo, share_hi = 0.3, 0.6
    divisor = max(1, brand_count)
    lo = prior.monthly_search_volume.min * prior.cpc_jpy.min * share_lo / divisor
    hi = prior.monthly_search_volume.max * prior.cpc_jpy.max * share_hi / divisor
    return NumericRange(min=lo, max=hi, unit="円/月")


def estimate(
    industry_hint: str | None,
    brands: Iterable | None = None,
    *,
    keywords: Sequence[str] | None = None,
) -> MarketEstimate:
    """Return a ``MarketEstimate`` for the given industry.

    ``brands`` may be any iterable; its length is used only to divide the
    ad-spend estimate. ``keywords`` optionally biases industry classification
    when ``industry_hint`` is absent.
    """
    brand_list = list(brands) if brands is not None else []
    prior = classify_industry(industry_hint, keywords)
    ad_spend = _estimate_ad_spend(prior, len(brand_list))
    return MarketEstimate(
        industry_key=prior.key,
        industry_label=prior.label,
        confidence=prior.confidence,
        source_note=prior.source_note,
        market_size_jpy=prior.market_size_jpy,
        annual_growth_pct=prior.annual_growth_pct,
        monthly_search_volume=prior.monthly_search_volume,
        cpc_jpy=prior.cpc_jpy,
        avg_cvr_pct=prior.avg_cvr_pct,
        ad_spend_monthly_jpy=ad_spend,
        brand_count=len(brand_list),
        buying_behavior_template=prior.buying_behavior_template,
    )


def format_market_estimate_block(est: MarketEstimate) -> str:
    """Render a deterministic ``## 市場推定データ（参照必須）`` block.

    Both Compare and Discovery prompts concatenate this verbatim so
    identical inputs cannot generate divergent market numbers.
    """
    # Market size in 億 (1e8) units
    ms_oku = NumericRange(
        min=est.market_size_jpy.min / 1e8,
        max=est.market_size_jpy.max / 1e8,
        unit="億円",
    )
    vol_man = NumericRange(
        min=est.monthly_search_volume.min / 1e4,
        max=est.monthly_search_volume.max / 1e4,
        unit="万/月",
    )
    ad_man = NumericRange(
        min=est.ad_spend_monthly_jpy.min / 1e4,
        max=est.ad_spend_monthly_jpy.max / 1e4,
        unit="万円/月/ブランド",
    )
    lines = [
        "## 市場推定データ（参照必須）",
        "",
        (
            "以下はコード側で業界プライアから決定論的に計算した**共通の市場推定値**です。"
            "Compare / Discovery / 他セクションでは、この表の値を**そのまま転記**してください。"
            "独自に別の数値を生成してはいけません。"
        ),
        "",
        f"**業界分類**: {est.industry_label} (`{est.industry_key}`)",
        f"**信頼度**: {est.confidence}",
        f"**出所メモ**: {est.source_note}",
        "",
        "| 指標 | レンジ | 単位 |",
        "| --- | --- | --- |",
        f"| 市場規模 | {ms_oku.formatted(suffix='')} | 億円 |",
        f"| 年率成長 | {est.annual_growth_pct.formatted(suffix='')} | % |",
        f"| 月間検索Vol | {vol_man.formatted(suffix='')} | 万/月 |",
        f"| CPC帯 | {est.cpc_jpy.formatted(suffix='')} | 円 |",
        f"| 平均CVR | {est.avg_cvr_pct.formatted(suffix='')} | % |",
        f"| 推定月間広告費 (1ブランドあたり) | {ad_man.formatted(suffix='')} | 万円/月 |",
        "",
        "※ 上記はすべて **【市場推定】** ラベル対象。値を改変せず引用すること。",
        "",
    ]
    return "\n".join(lines)
