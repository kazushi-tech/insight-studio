"""ReportEnvelope v0 — lightweight structured side-channel for Discovery/Compare reports.

This schema exists alongside the existing markdown (`report_md`) field. It surfaces
the already-deterministic portions of the report (market estimate, 6-axis brand
evaluation, priority actions) so that the frontend can render charts and tables
without re-parsing markdown.

Feature-flagged by REPORT_ENVELOPE_V0. When disabled, endpoints return 404 so
existing MD-only flows are unchanged.
"""

from __future__ import annotations

import os
import re
from typing import Literal, Optional

from pydantic import BaseModel, Field

Verdict = Literal["強", "同等", "弱", "評価保留"]

AXIS_KEYS = [
    "検索意図一致",
    "FV訴求",
    "CTA明確性",
    "信頼構築",
    "価格・オファー",
    "購買導線",
]


def report_envelope_enabled() -> bool:
    """True when REPORT_ENVELOPE_V0 feature flag is on."""
    return os.getenv("REPORT_ENVELOPE_V0", "").lower() in ("1", "true", "yes", "on")


class AxisEvaluation(BaseModel):
    """One row of a per-brand evaluation table: axis × verdict × evidence."""

    axis: str
    verdict: Optional[Verdict] = None
    reason: str = ""
    evidence: str = ""


class BrandEvaluation(BaseModel):
    """Per-brand evaluation across the 6 canonical axes."""

    brand: str
    axes: list[AxisEvaluation] = Field(default_factory=list)


class MarketRange(BaseModel):
    """One metric from the deterministic market estimate block."""

    label: str
    min: float
    max: float
    unit: str = ""


class MarketEstimate(BaseModel):
    """Deterministic market estimate block (size / search volume / CPC / CVR / ad spend)."""

    confidence: Optional[str] = None
    ranges: list[MarketRange] = Field(default_factory=list)


class PriorityAction(BaseModel):
    """One of the top priority actions surfaced by the report."""

    title: str
    detail: str = ""


class ReportEnvelope(BaseModel):
    """v0 envelope. Any block may be empty when source report lacks that section."""

    version: Literal["v0"] = "v0"
    report_id: str
    kind: Literal["scan", "discovery"]
    priority_actions: list[PriorityAction] = Field(default_factory=list)
    market_estimate: Optional[MarketEstimate] = None
    brand_evaluations: list[BrandEvaluation] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Parsing helpers: MD → ReportEnvelope
# ---------------------------------------------------------------------------

_PRIORITY_HEADING = re.compile(
    r"##\s*(?:\d+[.．]?\s*)?(最優先施策|優先施策|実行プラン|推奨事項)[^\n]*",
)
_BRAND_HEADING = re.compile(r"##\s*(?:\d+[.．]?\s*)?ブランド別評価[^\n]*")
_MARKET_HEADING = re.compile(r"##\s*(?:\d+[.．]?\s*)?市場推定データ[^\n]*")
_VERDICT_PATTERN = re.compile(r"強|同等|弱|評価保留")


def _extract_section(md: str, heading_re: re.Pattern) -> Optional[str]:
    match = heading_re.search(md)
    if not match:
        return None
    start = match.end()
    rest = md[start:]
    end_match = re.search(r"\n##\s", rest)
    end = end_match.start() if end_match else len(rest)
    return rest[:end]


def _parse_priority_actions(md: str, limit: int = 3) -> list[PriorityAction]:
    section = _extract_section(md, _PRIORITY_HEADING)
    if not section:
        return []
    actions: list[PriorityAction] = []
    for line in section.splitlines():
        bullet = re.match(r"^\s*(?:[-*]|\d+[.．)])\s+(.+)$", line)
        if not bullet:
            continue
        text = bullet.group(1).strip().strip("*").strip("`").strip()
        if not text:
            continue
        kv = re.match(r"^(.+?)\s*[:：]\s*(.+)$", text)
        if kv:
            actions.append(PriorityAction(title=kv.group(1).strip(), detail=kv.group(2).strip()))
        else:
            actions.append(PriorityAction(title=text, detail=""))
        if len(actions) >= limit:
            break
    return actions


def _parse_range(raw: str) -> Optional[tuple[float, float]]:
    cleaned = re.sub(r"[,，\s]", "", raw)
    m = re.search(r"(-?\d+(?:\.\d+)?)[〜～~\-−–—]+(-?\d+(?:\.\d+)?)", cleaned)
    if m:
        lo, hi = float(m.group(1)), float(m.group(2))
        return (min(lo, hi), max(lo, hi))
    single = re.search(r"(-?\d+(?:\.\d+)?)", cleaned)
    if single:
        v = float(single.group(1))
        return (v, v)
    return None


def _parse_market_estimate(md: str) -> Optional[MarketEstimate]:
    idx = md.find("市場推定データ")
    if idx == -1:
        return None
    slice_ = md[idx : idx + 3000]
    conf_match = re.search(r"\*\*信頼度\*\*[:：]\s*([^\n]+)", slice_)
    confidence = conf_match.group(1).strip() if conf_match else None
    lines = [l.strip() for l in slice_.splitlines() if l.strip().startswith("|")]
    if len(lines) < 3:
        return None
    ranges: list[MarketRange] = []
    for line in lines[2:]:
        cells = [c.strip() for c in line.split("|")]
        # leading empty cell → real cells start at index 1
        if len(cells) < 4:
            continue
        label = cells[1]
        range_raw = cells[2]
        unit = cells[3] if len(cells) > 3 else ""
        if not label or not range_raw or label.startswith("-"):
            continue
        parsed = _parse_range(range_raw)
        if not parsed:
            continue
        lo, hi = parsed
        ranges.append(MarketRange(label=label, min=lo, max=hi, unit=unit))
    if not ranges:
        return None
    return MarketEstimate(confidence=confidence, ranges=ranges)


def _normalize_axis(axis_label: str) -> Optional[str]:
    compact = re.sub(r"[・\sの]", "", axis_label)
    for key in AXIS_KEYS:
        key_compact = re.sub(r"[・\sの]", "", key)
        if key in axis_label or key_compact == compact or key_compact in compact or compact in key_compact:
            return key
    return None


def _parse_brand_table(body: str) -> list[AxisEvaluation]:
    lines = [l.strip() for l in body.splitlines() if l.strip().startswith("|")]
    if len(lines) < 3:
        return []
    header_cells = [c.strip() for c in lines[0].split("|") if c.strip()]
    axis_idx = next((i for i, h in enumerate(header_cells) if "評価軸" in h), -1)
    verdict_idx = next((i for i, h in enumerate(header_cells) if "判定" in h), -1)
    reason_idx = next((i for i, h in enumerate(header_cells) if "根拠" in h), -1)
    evidence_idx = next((i for i, h in enumerate(header_cells) if "証拠強度" in h), -1)
    if axis_idx == -1 or verdict_idx == -1:
        return []

    out: list[AxisEvaluation] = []
    for line in lines[2:]:
        cells = [c.strip() for c in line.split("|")]
        offset = 1  # leading empty cell
        try:
            axis_raw = cells[axis_idx + offset]
            verdict_raw = cells[verdict_idx + offset] if verdict_idx != -1 else ""
            reason = cells[reason_idx + offset] if reason_idx != -1 else ""
            evidence = cells[evidence_idx + offset] if evidence_idx != -1 else ""
        except IndexError:
            continue
        if not axis_raw:
            continue
        axis = _normalize_axis(axis_raw)
        if not axis:
            continue
        verdict_match = _VERDICT_PATTERN.search(verdict_raw)
        verdict_val: Optional[str] = verdict_match.group(0) if verdict_match else None
        out.append(AxisEvaluation(axis=axis, verdict=verdict_val, reason=reason, evidence=evidence))
    return out


def _parse_brand_evaluations(md: str) -> list[BrandEvaluation]:
    section = _extract_section(md, _BRAND_HEADING)
    if not section:
        return []
    chunks = re.split(r"\n###\s+", section)
    out: list[BrandEvaluation] = []
    for chunk in chunks[1:]:
        split = chunk.split("\n", 1)
        title = split[0].strip()
        body = split[1] if len(split) > 1 else ""
        axes = _parse_brand_table(body)
        if not axes:
            continue
        out.append(BrandEvaluation(brand=title, axes=axes))
    return out


def build_envelope_from_md(report_id: str, kind: str, report_md: str) -> ReportEnvelope:
    """Build a v0 envelope by parsing the deterministic sections of a report MD.

    Sections that aren't present return empty / None — the envelope is always
    safe to serialize, callers decide whether empty sections are a problem.
    """
    md = report_md or ""
    return ReportEnvelope(
        report_id=report_id,
        kind=kind,  # type: ignore[arg-type]
        priority_actions=_parse_priority_actions(md),
        market_estimate=_parse_market_estimate(md),
        brand_evaluations=_parse_brand_evaluations(md),
    )
