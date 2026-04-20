"""Numeric sanity validator — detects magnitude errors and unusable
confidence-vs-width ranges in LLM-generated report markdown.

Complements ``confidence_tier_validator`` (which handles linguistic
over-reach) by adding a post-hoc numeric check:

* Market size figures larger than a realistic category-EC ceiling are
  flagged (e.g. ``200,000〜250,000 億円`` = 20〜25兆円, larger than the
  entire Japanese BtoC EC market).
* Ad-spend estimate ranges whose ``max / min`` spread exceeds the
  confidence-tier-specific cap are flagged; when confidence is ``low``
  and the range is unusable, the numeric values are masked with
  ``推定根拠不足`` phrasing.

Feature-flagged via ``ENABLE_NUMERIC_SANITY_VALIDATOR`` (default ON).
Warning-mode only: never blocks the report, never triggers regeneration.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml

logger = logging.getLogger("market-lens.numeric_sanity_validator")

_SPEC_PATH = Path(__file__).parent / "shared_specs" / "numeric_sanity.yaml"
_FEATURE_FLAG_ENV = "ENABLE_NUMERIC_SANITY_VALIDATOR"
NOTES_HEADING = "## 📏 数値サニティに関する注記"

Context = Literal["discovery", "compare"]


@dataclass(frozen=True)
class NumericIssue:
    rule_id: str
    label: str
    original: str
    note: str


@dataclass(frozen=True)
class NumericOutcome:
    rewritten_markdown: str
    issues: tuple[NumericIssue, ...]
    is_clean: bool


def _flag_enabled() -> bool:
    return os.getenv(_FEATURE_FLAG_ENV, "1").strip().lower() in ("1", "true", "yes", "on")


@lru_cache(maxsize=1)
def _load_config() -> dict[str, Any]:
    if not _SPEC_PATH.exists():
        logger.warning("numeric_sanity.yaml not found at %s", _SPEC_PATH)
        return {}
    try:
        with _SPEC_PATH.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
    except Exception as exc:
        logger.warning("Failed to load numeric_sanity.yaml: %s", exc)
        return {}
    return data if isinstance(data, dict) else {}


def clear_cache() -> None:
    _load_config.cache_clear()


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

_NUM_RE = r"-?\d{1,3}(?:[,，]\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?"
_RANGE_SEP = r"[〜～~\-−–—]"


def _to_float(raw: str) -> float | None:
    cleaned = re.sub(r"[,，\s]", "", raw)
    try:
        return float(cleaned)
    except ValueError:
        return None


def _unit_to_oku(unit: str) -> float | None:
    """Normalize monetary units to 億円 (1億 = 100M JPY).

    Returns the multiplier to apply to a value expressed in ``unit``
    so that the result is expressed in 億円. Returns ``None`` for
    unrecognized units.
    """
    u = unit.strip()
    if "兆円" in u:
        return 10000.0
    if "億円" in u:
        return 1.0
    if "万円" in u:
        return 1.0 / 10000.0
    if u == "円":
        return 1.0 / 1e8
    return None


def _extract_section(md: str, heading_pattern: re.Pattern[str]) -> tuple[int, int] | None:
    m = heading_pattern.search(md)
    if not m:
        return None
    start = m.start()
    rest = md[m.end():]
    end_match = re.search(r"\n##\s", rest)
    end = m.end() + (end_match.start() if end_match else len(rest))
    return (start, end)


_MARKET_HEADING = re.compile(r"##\s*(?:\d+[.．]?\s*)?市場推定データ[^\n]*")


# ---------------------------------------------------------------------------
# Market-size magnitude check
# ---------------------------------------------------------------------------


def _check_market_size(md: str, cfg: dict[str, Any]) -> tuple[str, list[NumericIssue]]:
    """Detect magnitude errors in the ``市場推定データ`` table.

    Rewrites the offending table row by appending a ⚠ marker on the
    range cell and returns issues describing each detected row.
    """
    section = _extract_section(md, _MARKET_HEADING)
    if not section:
        return md, []

    start, end = section
    body = md[start:end]

    soft = float(cfg.get("soft_warn_above_oku", 10000))
    hard = float(cfg.get("hard_warn_above_oku", 50000))

    issues: list[NumericIssue] = []
    lines = body.splitlines()
    updated: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("|"):
            updated.append(line)
            continue
        cells = [c.strip() for c in stripped.split("|")]
        # leading/trailing empty due to pipes
        real = [c for c in cells if c != ""]
        if len(real) < 2:
            updated.append(line)
            continue
        label = real[0]
        if "市場規模" not in label:
            updated.append(line)
            continue
        range_cell = real[1] if len(real) >= 2 else ""
        unit_cell = real[2] if len(real) >= 3 else ""
        mult = _unit_to_oku(unit_cell)
        if mult is None:
            updated.append(line)
            continue
        m = re.search(rf"({_NUM_RE})\s*{_RANGE_SEP}\s*({_NUM_RE})", range_cell)
        if m:
            lo = _to_float(m.group(1))
            hi = _to_float(m.group(2))
        else:
            single = re.search(rf"({_NUM_RE})", range_cell)
            if not single:
                updated.append(line)
                continue
            lo = hi = _to_float(single.group(1))
        if lo is None or hi is None:
            updated.append(line)
            continue
        hi_oku = hi * mult
        lo_oku = lo * mult
        if hi_oku >= hard:
            note = (
                f"市場規模「{range_cell} {unit_cell}」は日本のBtoC EC全体規模"
                f"（約19兆円 / 190,000億円）を大きく超えており、桁違いの推定値です。"
                f"カテゴリ特化EC市場の実勢値に照らして要再検証。"
            )
            issues.append(
                NumericIssue(
                    rule_id="market_size_hard_warn",
                    label=label,
                    original=f"{range_cell} {unit_cell}".strip(),
                    note=note,
                )
            )
            # Annotate row with warning marker
            updated.append(line.replace(range_cell, f"⚠ {range_cell}", 1))
            continue
        if hi_oku >= soft:
            note = (
                f"市場規模「{range_cell} {unit_cell}」は1兆円超の大規模推定です。"
                f"カテゴリ特化市場としては上位帯のため、出典根拠の再確認を推奨します。"
            )
            issues.append(
                NumericIssue(
                    rule_id="market_size_soft_warn",
                    label=label,
                    original=f"{range_cell} {unit_cell}".strip(),
                    note=note,
                )
            )
            updated.append(line)
            continue
        updated.append(line)

    new_body = "\n".join(updated)
    if new_body == body:
        return md, issues
    return md[:start] + new_body + md[end:], issues


# ---------------------------------------------------------------------------
# Ad-spend range-width check
# ---------------------------------------------------------------------------


_AD_SPEND_LINE = re.compile(
    r"(?P<prefix>[\-\*\d\.\)）]*\s*(?:[^|\n]*?(?:広告(?:投資|費|予算)|月間広告|ad\s*spend)[^|\n]*?))"
    rf"(?P<open>[:：]\s*)(?P<lo>{_NUM_RE})\s*(?P<sep>{_RANGE_SEP})\s*(?P<hi>{_NUM_RE})\s*(?P<unit>万円|億円|円)?",
    re.IGNORECASE,
)

_CONFIDENCE_INLINE = re.compile(
    r"(?:信頼度|confidence)\s*[:：]?\s*(高|中|低|high|medium|low|unknown)",
    re.IGNORECASE,
)


def _normalize_confidence(raw: str | None) -> str:
    if not raw:
        return "unknown"
    v = raw.strip().lower()
    mapping = {
        "高": "high",
        "中": "medium",
        "低": "low",
        "high": "high",
        "medium": "medium",
        "low": "low",
    }
    return mapping.get(v, "unknown")


def _confidence_near(md: str, pos: int, window: int = 300) -> str:
    start = max(0, pos - window)
    end = min(len(md), pos + window)
    snippet = md[start:end]
    matches = list(_CONFIDENCE_INLINE.finditer(snippet))
    if not matches:
        return "unknown"
    # Pick the match closest to pos
    offset = pos - start
    best = min(matches, key=lambda m: abs(m.start() - offset))
    return _normalize_confidence(best.group(1))


def _check_ad_spend_ranges(
    md: str, cfg: dict[str, Any]
) -> tuple[str, list[NumericIssue]]:
    ratio_cfg = cfg.get("ratio_cap_by_confidence", {}) or {}
    mask_when_low = bool(cfg.get("mask_when_low", True))

    issues: list[NumericIssue] = []

    def _replace(match: re.Match[str]) -> str:
        lo_raw = match.group("lo")
        hi_raw = match.group("hi")
        lo = _to_float(lo_raw) or 0.0
        hi = _to_float(hi_raw) or 0.0
        if lo <= 0 or hi <= 0:
            return match.group(0)
        ratio = hi / lo if lo > 0 else 0.0

        confidence = _confidence_near(md, match.start())
        cap = float(ratio_cfg.get(confidence, ratio_cfg.get("unknown", 10.0)))
        if ratio <= cap:
            return match.group(0)

        unit = match.group("unit") or ""
        label = match.group("prefix").strip().rstrip(":：").strip(" -*0123456789.)）") or "広告投資推定"
        original = f"{lo_raw}{match.group('sep')}{hi_raw}{unit}"

        if confidence == "low" and mask_when_low:
            note = (
                f"『{original}』はレンジ幅 {ratio:.1f}× かつ信頼度low のため、"
                f"意思決定値として使えません。推定値を伏せ、根拠不足を明示しました。"
            )
            issues.append(
                NumericIssue(
                    rule_id="ad_spend_range_masked",
                    label=label,
                    original=original,
                    note=note,
                )
            )
            return f"{match.group('prefix')}{match.group('open')}推定根拠不足（low信頼・幅{ratio:.1f}×）"

        note = (
            f"『{original}』はレンジ幅 {ratio:.1f}× で信頼度{confidence}の上限({cap:.1f}×)を超過。"
            f"意思決定に使う際は前提の再検証を推奨します。"
        )
        issues.append(
            NumericIssue(
                rule_id="ad_spend_range_wide",
                label=label,
                original=original,
                note=note,
            )
        )
        return f"{match.group(0)} ⚠幅{ratio:.1f}×"

    new_md = _AD_SPEND_LINE.sub(_replace, md)
    return new_md, issues


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _format_note(issue: NumericIssue) -> str:
    return f"- **{issue.label}**: {issue.note}（検出ルール: {issue.rule_id}）"


def _build_notes_section(issues: list[NumericIssue]) -> str:
    lines = [
        "",
        "---",
        "",
        NOTES_HEADING,
        "",
        "以下の数値は桁違いまたはレンジ幅が広すぎるため、意思決定利用前に根拠の再確認が必要です。",
        "",
    ]
    lines.extend(_format_note(i) for i in issues)
    lines.append("")
    return "\n".join(lines)


def validate_and_annotate(
    *,
    report_markdown: str,
    context: Context = "discovery",
) -> NumericOutcome:
    """Scan markdown for market-size and ad-spend range issues."""
    empty = NumericOutcome(
        rewritten_markdown=report_markdown or "",
        issues=(),
        is_clean=True,
    )

    if not report_markdown:
        return empty
    if not _flag_enabled():
        logger.debug("numeric_sanity_validator disabled via %s", _FEATURE_FLAG_ENV)
        return empty

    cfg = _load_config()
    if not cfg:
        return empty

    md = report_markdown
    collected: list[NumericIssue] = []

    md, issues = _check_market_size(md, cfg.get("market_size", {}) or {})
    collected.extend(issues)

    md, issues = _check_ad_spend_ranges(md, cfg.get("ad_spend_range", {}) or {})
    collected.extend(issues)

    if not collected:
        return NumericOutcome(rewritten_markdown=md, issues=(), is_clean=True)

    md = md.rstrip() + "\n" + _build_notes_section(collected)

    logger.info(
        "numeric_sanity_validator context=%s issues=%d", context, len(collected)
    )

    return NumericOutcome(
        rewritten_markdown=md,
        issues=tuple(collected),
        is_clean=False,
    )


def extract_notes_from_markdown(report_markdown: str) -> list[str]:
    """Parse the appended numeric-sanity notes section back out of markdown."""
    if not report_markdown or NOTES_HEADING not in report_markdown:
        return []
    idx = report_markdown.find(NOTES_HEADING)
    rest = report_markdown[idx + len(NOTES_HEADING):]
    end_match = re.search(r"\n##\s", rest)
    body = rest[: end_match.start()] if end_match else rest
    notes: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            notes.append(stripped[2:].strip())
    return notes
