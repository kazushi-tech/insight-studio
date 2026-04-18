"""Deterministic evaluation engine.

Consumes a list of ``ExtractedData`` objects and evaluates the six
shared evaluation axes deterministically before any LLM call. The
resulting judgment block is injected into both the Compare and Discovery
prompts so the same extracted data always yields the same verdicts.

Verdicts per axis:
    強 / 同等 / 弱 / 評価保留
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

from .models import ExtractedData
from .shared_specs import (
    EvaluationAxis,
    TrustTier,
    load_evaluation_axes,
    load_trust_hierarchy,
)

VERDICT_STRONG = "強"
VERDICT_EQUAL = "同等"
VERDICT_WEAK = "弱"
VERDICT_DEFER = "評価保留"


@dataclass(frozen=True)
class AxisVerdict:
    axis_key: str
    axis_label: str
    verdict: str
    evidence_fields: tuple[str, ...]
    notes: tuple[str, ...]


@dataclass(frozen=True)
class BrandEvaluation:
    url: str
    brand_label: str
    trust_tier: str
    trust_tier_label: str
    axis_verdicts: tuple[AxisVerdict, ...]

    def verdict_for(self, axis_key: str) -> AxisVerdict | None:
        for v in self.axis_verdicts:
            if v.axis_key == axis_key:
                return v
        return None


def _get_field(data: ExtractedData, field_name: str) -> Any:
    return getattr(data, field_name, None)


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return len(value.strip()) == 0
    if isinstance(value, (list, tuple, set)):
        return len(value) == 0
    return False


def _non_empty(value: Any) -> bool:
    return not _is_empty(value)


def _predicate_passes(pred: dict, data: ExtractedData) -> bool:
    """Evaluate a single predicate dict against the extracted data."""
    if not isinstance(pred, dict):
        return False
    # Each predicate dict has exactly one top-level key.
    for op, arg in pred.items():
        if op == "non_empty":
            return _non_empty(_get_field(data, arg))
        if op == "is_empty":
            return _is_empty(_get_field(data, arg))
        if op == "min_items":
            target = arg.get("field")
            need = int(arg.get("value", 0))
            value = _get_field(data, target)
            return isinstance(value, (list, tuple)) and len(value) >= need
        if op == "min_length":
            target = arg.get("field")
            need = int(arg.get("value", 0))
            value = _get_field(data, target)
            return isinstance(value, str) and len(value.strip()) >= need
        if op == "contains_any":
            target = arg.get("field")
            subs = [s.lower() for s in arg.get("values", [])]
            value = _get_field(data, target)
            if isinstance(value, str):
                v = value.lower()
                return any(s in v for s in subs)
            if isinstance(value, (list, tuple)):
                joined = " ".join(str(x).lower() for x in value)
                return any(s in joined for s in subs)
            return False
        if op == "field_equals_any":
            target = arg.get("field")
            allowed = arg.get("values", [])
            value = _get_field(data, target)
            if isinstance(value, str):
                return value.strip() in allowed
            return False
        if op == "any_non_empty":
            fields = arg.get("fields", [])
            return any(_non_empty(_get_field(data, f)) for f in fields)
        if op == "all_empty":
            fields = arg.get("fields", [])
            return all(_is_empty(_get_field(data, f)) for f in fields)
    return False


def _all_pass(preds: Sequence[dict], data: ExtractedData) -> bool:
    if not preds:
        return False
    return all(_predicate_passes(p, data) for p in preds)


def _any_pass(preds: Sequence[dict], data: ExtractedData) -> bool:
    if not preds:
        return False
    return any(_predicate_passes(p, data) for p in preds)


def _evaluate_axis(axis: EvaluationAxis, data: ExtractedData) -> AxisVerdict:
    # 1. defer checks have highest priority
    defer_any_hit = _any_pass(axis.defer_any, data)
    defer_all_hit = bool(axis.defer_all) and _all_pass(axis.defer_all, data)
    primary_all_empty = all(_is_empty(_get_field(data, f)) for f in axis.primary_sources)

    if defer_any_hit or defer_all_hit or primary_all_empty:
        return AxisVerdict(
            axis_key=axis.key,
            axis_label=axis.label,
            verdict=VERDICT_DEFER,
            evidence_fields=axis.primary_sources,
            notes=("primary sources empty or defer condition matched",),
        )

    # 2. weak checks (before strong) — fatal-empty flags
    weak_any_hit = _any_pass(axis.weak_any, data)
    weak_all_hit = bool(axis.weak_all) and _all_pass(axis.weak_all, data)
    if weak_any_hit or weak_all_hit:
        return AxisVerdict(
            axis_key=axis.key,
            axis_label=axis.label,
            verdict=VERDICT_WEAK,
            evidence_fields=axis.primary_sources,
            notes=("weak condition matched",),
        )

    # 3. strong when required + boost
    required_ok = _all_pass(axis.strong_required, data) if axis.strong_required else True
    boost_ok = _any_pass(axis.strong_boost, data) if axis.strong_boost else False
    if required_ok and boost_ok:
        return AxisVerdict(
            axis_key=axis.key,
            axis_label=axis.label,
            verdict=VERDICT_STRONG,
            evidence_fields=axis.primary_sources,
            notes=("required + boost satisfied",),
        )

    # 4. default to equal when required_ok but no boost
    if required_ok:
        return AxisVerdict(
            axis_key=axis.key,
            axis_label=axis.label,
            verdict=VERDICT_EQUAL,
            evidence_fields=axis.primary_sources,
            notes=("required satisfied; no boost",),
        )

    # 5. fallback when required unmet but not explicitly weak
    return AxisVerdict(
        axis_key=axis.key,
        axis_label=axis.label,
        verdict=VERDICT_EQUAL,
        evidence_fields=axis.primary_sources,
        notes=("required unmet; inconclusive",),
    )


def _evaluate_trust_tier(data: ExtractedData, tiers: Sequence[TrustTier]) -> TrustTier:
    """Return the strongest trust tier whose signal fields contain content.

    Tiers are expected to be ordered from highest trust (L1) to lowest (L5).
    Returns the L5 tier as a baseline when no signals are found.
    """
    for tier in tiers:
        for fname in tier.signal_fields:
            value = _get_field(data, fname)
            if _non_empty(value):
                return tier
    return tiers[-1]


def _brand_label_from_url(url: str) -> str:
    if not url:
        return "(unknown)"
    # Use host without scheme/www./path as display label.
    try:
        from urllib.parse import urlparse

        host = urlparse(url).hostname or url
        return host.replace("www.", "")
    except Exception:
        return url


def evaluate_all(extracted_list: Iterable[ExtractedData]) -> tuple[BrandEvaluation, ...]:
    """Evaluate every brand against the six axes deterministically."""
    axes = load_evaluation_axes()
    tiers = load_trust_hierarchy()
    out: list[BrandEvaluation] = []
    for data in extracted_list:
        verdicts = tuple(_evaluate_axis(axis, data) for axis in axes)
        tier = _evaluate_trust_tier(data, tiers)
        out.append(
            BrandEvaluation(
                url=getattr(data, "url", "") or "",
                brand_label=_brand_label_from_url(getattr(data, "url", "")),
                trust_tier=tier.level,
                trust_tier_label=tier.label,
                axis_verdicts=verdicts,
            )
        )
    return tuple(out)


def format_judgment_block(evaluations: Sequence[BrandEvaluation]) -> str:
    """Format evaluations as a deterministic ``## 事前判定結果（参照必須）`` block.

    Injected into both Compare and Discovery prompts so LLMs anchor verdicts
    to the same pre-computed results.
    """
    if not evaluations:
        return ""
    axes = load_evaluation_axes()
    lines: list[str] = []
    lines.append("## 事前判定結果（参照必須）")
    lines.append("")
    lines.append(
        "以下はコード側で抽出データから事前判定した**共通の評価結果**です。"
        "判定を覆す場合は「覆し理由」を明記してください。覆す根拠がない場合は"
        "この判定をそのまま採用してください。"
    )
    lines.append("")

    header = ["ブランド", "信頼階層"] + [a.label for a in axes]
    sep = ["---"] * len(header)
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(sep) + " |")

    axis_keys = [a.key for a in axes]
    for ev in evaluations:
        row = [ev.brand_label, f"{ev.trust_tier}: {ev.trust_tier_label}"]
        for key in axis_keys:
            v = ev.verdict_for(key)
            row.append(v.verdict if v else VERDICT_DEFER)
        lines.append("| " + " | ".join(row) + " |")

    lines.append("")
    return "\n".join(lines)
