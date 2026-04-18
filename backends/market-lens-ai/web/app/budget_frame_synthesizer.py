"""Deterministic ``### 5-0 予算フレーム`` synthesizer (Phase P1-D).

When the LLM omits the 5-0 budget framework subsection, this module derives a
market-estimate-driven placeholder table from the shared ``market_estimator``
output. The stub carries an explicit 【自動生成】 tag so readers can tell it
apart from LLM-authored content.
"""

from __future__ import annotations

from typing import Iterable

from .market_estimator import MarketEstimate, estimate as estimate_market
from .models import ExtractedData


_STUB_HEADER = "### 5-0 予算フレーム"
_AUTO_GENERATED_NOTE = (
    "> 【自動生成】このブロックは LLM 本文で欠損していたため、"
    "市場推定値（`market_estimator`）から自動で補完しています。"
    "初期・拡張フェーズの値はいずれも推定レンジです。"
)


def _format_yen_per_month(value: float) -> str:
    """Format a JPY value as human-readable ``万円/月`` text."""
    man = value / 10_000
    if man >= 100:
        return f"{man:,.0f}万円/月"
    return f"{man:,.1f}万円/月"


def _derive_rows(est: MarketEstimate) -> list[tuple[str, str, str, str]]:
    """Return table rows: (項目, 初期, 拡張, 備考)."""
    spend = est.ad_spend_monthly_jpy
    cpc = est.cpc_jpy
    cvr = est.avg_cvr_pct

    initial_budget_lo = spend.min
    initial_budget_hi = (spend.min + spend.max) / 2
    expand_budget_lo = initial_budget_hi
    expand_budget_hi = spend.max

    # CV = budget / CPC * CVR
    def _cv_range(budget_lo: float, budget_hi: float) -> str:
        cv_lo = budget_lo / max(cpc.max, 1.0) * (cvr.min / 100.0)
        cv_hi = budget_hi / max(cpc.min, 1.0) * (cvr.max / 100.0)
        return f"{cv_lo:,.0f}〜{cv_hi:,.0f}件/月"

    # CPA = CPC / CVR
    cpa_lo = cpc.min / max(cvr.max / 100.0, 1e-6)
    cpa_hi = cpc.max / max(cvr.min / 100.0, 1e-6)

    return [
        (
            "月額予算帯",
            f"{_format_yen_per_month(initial_budget_lo)} 〜 {_format_yen_per_month(initial_budget_hi)}",
            f"{_format_yen_per_month(expand_budget_lo)} 〜 {_format_yen_per_month(expand_budget_hi)}",
            "1ブランドあたり・推定レンジ",
        ),
        (
            "CPA ガイドライン",
            f"{cpa_lo:,.0f}〜{cpa_hi:,.0f}円",
            f"{cpa_lo:,.0f}〜{cpa_hi:,.0f}円（改善目標: 初期上限比 -10〜20%）",
            "CPC × 1/CVR の推定",
        ),
        (
            "想定CV数",
            _cv_range(initial_budget_lo, initial_budget_hi),
            _cv_range(expand_budget_lo, expand_budget_hi),
            "CVR レンジの単純試算",
        ),
    ]


def synthesize_budget_frame_block(
    extracted_list: Iterable[ExtractedData],
    *,
    industry_hint: str | None = None,
    keywords: list[str] | None = None,
) -> str | None:
    """Build the ``### 5-0 予算フレーム`` markdown block.

    Returns ``None`` only if the market estimator cannot produce a usable
    estimate, which for the current industry priors never happens in
    practice.
    """
    brands = list(extracted_list)
    est = estimate_market(industry_hint, brands, keywords=keywords)
    if est is None:
        return None

    rows = _derive_rows(est)

    lines = [
        _STUB_HEADER,
        "",
        _AUTO_GENERATED_NOTE,
        "",
        "| 項目 | 初期フェーズ | 拡張フェーズ | 備考 |",
        "|---|---|---|---|",
    ]
    for row in rows:
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    lines.append(
        f"根拠: 業界プライア `{est.industry_label}` の CPC={est.cpc_jpy.min:,.0f}〜{est.cpc_jpy.max:,.0f}円 / CVR={est.avg_cvr_pct.min:.1f}〜{est.avg_cvr_pct.max:.1f}% を転用。"
    )
    lines.append("")
    return "\n".join(lines)
