"""Deterministic market-size / ad-spend estimator.

Both Compare and Discovery flows must share the same market estimate for a
given industry so the same data set cannot produce 5–10x divergent market
numbers across reports (plan 2026-04-18 section 1-A).
"""

from .estimator import (
    BudgetTier,
    IndustryPrior,
    MarketEstimate,
    NumericRange,
    classify_industry,
    estimate,
    format_market_estimate_block,
    load_industry_priors,
)

__all__ = [
    "BudgetTier",
    "IndustryPrior",
    "MarketEstimate",
    "NumericRange",
    "classify_industry",
    "estimate",
    "format_market_estimate_block",
    "load_industry_priors",
]
