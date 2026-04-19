"""Confidence tier validator — detects over-reach claims in LLM report markdown.

Complements the prompt-side deterministic judgment block (see
``deterministic_evaluator.format_judgment_block``) by adding a post-hoc
check over the generated markdown: when a brand's extracted data only
supports low-tier (L5) self-claims, strong third-party-style language
like "アンチドーピング対応" is detected, rewritten to safer phrasing,
and surfaced in a "根拠強度に関する注記" appendix.

Warning-mode only: no hard fail, no regeneration loop. Feature-flagged
via ``ENABLE_CONFIDENCE_TIER_VALIDATOR`` env var (default ON).
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Literal, Sequence
from urllib.parse import urlparse

import yaml

from .deterministic_evaluator import BrandEvaluation

logger = logging.getLogger("market-lens.confidence_tier_validator")

_SPEC_PATH = Path(__file__).parent / "shared_specs" / "overreach_patterns.yaml"
_FEATURE_FLAG_ENV = "ENABLE_CONFIDENCE_TIER_VALIDATOR"
NOTES_HEADING = "## 📋 根拠強度に関する注記"
_BRAND_HEADING_RE = re.compile(r"^###\s+", re.MULTILINE)

Context = Literal["discovery", "compare"]


@dataclass(frozen=True)
class Violation:
    rule_id: str
    brand: str
    trust_tier: str
    original_claim: str
    suggested_rewrite: str
    context: str


@dataclass(frozen=True)
class ValidationOutcome:
    rewritten_markdown: str
    violations: tuple[Violation, ...]
    notes: tuple[str, ...]
    is_clean: bool


def _flag_enabled() -> bool:
    return os.getenv(_FEATURE_FLAG_ENV, "1").strip().lower() in ("1", "true", "yes", "on")


@lru_cache(maxsize=1)
def _load_rules() -> tuple[dict[str, Any], ...]:
    if not _SPEC_PATH.exists():
        logger.warning("overreach_patterns.yaml not found at %s", _SPEC_PATH)
        return ()
    try:
        with _SPEC_PATH.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
    except Exception as exc:
        logger.warning("Failed to load overreach_patterns.yaml: %s", exc)
        return ()
    rules = data.get("rules") or []
    if not isinstance(rules, list):
        return ()
    return tuple(rules)


def clear_cache() -> None:
    """Reset rule cache (used by tests that mutate spec files)."""
    _load_rules.cache_clear()


def _brand_labels_for(ev: BrandEvaluation) -> set[str]:
    labels: set[str] = set()
    if ev.brand_label:
        labels.add(ev.brand_label)
        root = ev.brand_label.split(".")[0]
        if root:
            labels.add(root)
    if ev.url:
        host = urlparse(ev.url).hostname or ""
        if host:
            labels.add(host)
            root = host.split(".")[0]
            if root:
                labels.add(root)
    return {lbl for lbl in labels if lbl}


def _find_brand_section(md: str, labels: set[str]) -> tuple[int, int] | None:
    """Return (start, end) slice for the ``### <brand>`` subsection whose
    heading matches one of the brand labels, else None."""
    positions = [m.start() for m in _BRAND_HEADING_RE.finditer(md)]
    if not positions:
        return None
    positions.append(len(md))
    for i in range(len(positions) - 1):
        start = positions[i]
        end = positions[i + 1]
        heading_end = md.find("\n", start)
        if heading_end == -1:
            heading_end = end
        heading = md[start:heading_end]
        if any(lbl and lbl in heading for lbl in labels):
            return (start, end)
    return None


def _rule_applies(rule: dict[str, Any], ev: BrandEvaluation) -> bool:
    trigger = rule.get("trigger") or {}
    tiers = trigger.get("when_trust_tier_in") or []
    if tiers and ev.trust_tier not in tiers:
        return False
    verdicts_wanted = trigger.get("when_axis_verdict_in") or []
    if verdicts_wanted:
        if not any(v.verdict in verdicts_wanted for v in ev.axis_verdicts):
            return False
    return True


def _iter_patterns(rule: dict[str, Any]) -> Iterable[tuple[re.Pattern[str], str]]:
    for item in rule.get("forbidden_patterns") or []:
        pat = item.get("pattern")
        rewrite = item.get("rewrite") or ""
        if not pat:
            continue
        try:
            yield re.compile(pat), rewrite
        except re.error as exc:
            logger.warning("Invalid overreach pattern %r: %s", pat, exc)


def _format_note(v: Violation) -> str:
    return (
        f"- **ブランド {v.brand}（{v.trust_tier}）**: "
        f"本文中の「{v.original_claim}」を「{v.suggested_rewrite}」に書き換えました"
        f"（検出ルール: {v.rule_id}）。"
    )


def _build_notes_section(violations: Sequence[Violation]) -> str:
    lines = [
        "",
        "---",
        "",
        NOTES_HEADING,
        "",
        "以下の項目は LP から得られたエビデンスが限定的なため、"
        "本文中の強い表現を安全側に書き換えました。",
        "",
    ]
    for v in violations:
        lines.append(_format_note(v))
    lines.append("")
    return "\n".join(lines)


def validate_and_annotate(
    *,
    report_markdown: str,
    brand_evaluations: Sequence[BrandEvaluation] = (),
    context: Context = "discovery",
) -> ValidationOutcome:
    """Scan report markdown for over-reach claims and rewrite them.

    Returns a ``ValidationOutcome`` whose ``rewritten_markdown`` contains
    the (possibly unchanged) report and any notes section appended. When
    the feature flag is disabled or there are no rules / evaluations, the
    markdown is returned unchanged with ``is_clean=True``.
    """
    empty = ValidationOutcome(
        rewritten_markdown=report_markdown or "",
        violations=(),
        notes=(),
        is_clean=True,
    )

    if not report_markdown:
        return empty
    if not _flag_enabled():
        logger.debug("confidence_tier_validator disabled via %s", _FEATURE_FLAG_ENV)
        return empty

    rules = _load_rules()
    if not rules or not brand_evaluations:
        return empty

    md = report_markdown
    collected: list[Violation] = []

    for ev in brand_evaluations:
        applicable = [r for r in rules if _rule_applies(r, ev)]
        if not applicable:
            continue

        labels = _brand_labels_for(ev)
        span = _find_brand_section(md, labels)

        for rule in applicable:
            rule_id = rule.get("id", "unknown")
            for regex, rewrite in _iter_patterns(rule):
                if span is not None:
                    start, end = span
                    section = md[start:end]
                    matches = list(regex.finditer(section))
                    if not matches:
                        continue
                    new_section = regex.sub(rewrite, section)
                    md = md[:start] + new_section + md[end:]
                    shift = len(new_section) - len(section)
                    span = (start, end + shift)
                else:
                    # Whole-document fallback (missing ### brand heading).
                    matches = list(regex.finditer(md))
                    if not matches:
                        continue
                    md = regex.sub(rewrite, md)

                for m in matches:
                    collected.append(
                        Violation(
                            rule_id=rule_id,
                            brand=ev.brand_label or ev.url,
                            trust_tier=ev.trust_tier,
                            original_claim=m.group(0),
                            suggested_rewrite=rewrite,
                            context=context,
                        )
                    )

    if not collected:
        return ValidationOutcome(
            rewritten_markdown=md,
            violations=(),
            notes=(),
            is_clean=True,
        )

    notes = tuple(_format_note(v) for v in collected)
    md = md.rstrip() + "\n" + _build_notes_section(collected)

    logger.info(
        "confidence_tier_validator context=%s violations=%d brands=%d",
        context,
        len(collected),
        len(brand_evaluations),
    )

    return ValidationOutcome(
        rewritten_markdown=md,
        violations=tuple(collected),
        notes=notes,
        is_clean=False,
    )


def extract_notes_from_markdown(report_markdown: str) -> list[str]:
    """Parse the appended notes section back out of rewritten markdown.

    Used by the envelope builder so the frontend can surface the notes
    without re-running the validator. Returns an empty list when no notes
    section is present.
    """
    if not report_markdown or NOTES_HEADING not in report_markdown:
        return []
    idx = report_markdown.find(NOTES_HEADING)
    rest = report_markdown[idx + len(NOTES_HEADING):]
    # Section ends at next H2 or EOF.
    end_match = re.search(r"\n##\s", rest)
    body = rest[: end_match.start()] if end_match else rest
    notes: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            notes.append(stripped[2:].strip())
    return notes
