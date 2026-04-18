"""Deterministic ``### 最優先3施策`` synthesizer (Phase P1-D).

When the LLM omits the top action block for Section 5, this module falls back
on the deterministic axis verdicts (see ``deterministic_evaluator``) to
generate up to three weak-axis remediation actions. Each action carries an
auto-generated marker so the client can tell LLM content apart from stub
content (audit trail lives in Appendix A).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from .deterministic_evaluator import (
    BrandEvaluation,
    VERDICT_WEAK,
    evaluate_all,
)
from .models import ExtractedData


# Remediation playbook: axis_key → (headline, expected_effect)
_AXIS_PLAYBOOK: dict[str, tuple[str, str]] = {
    "search_intent_match": (
        "検索意図に沿ったFV/見出しへリライト",
        "CTR +10〜20% 見込み",
    ),
    "fv_appeal": (
        "FV訴求を購買意図ベースのコピーへ差し替え",
        "CTR +10〜20% / 初速改善",
    ),
    "cta_clarity": (
        "主要CTAを明確化（ボタン文言と配置最適化）",
        "LP-CVR +5〜15% 見込み",
    ),
    "trust_building": (
        "信頼要素（L1-L3）の可視化（実績・保証・証明）",
        "離脱率低下 / CVR底上げ",
    ),
    "price_offer": (
        "価格・オファー条件のフルファネル訴求",
        "価格検討離脱の抑制",
    ),
    "purchase_flow": (
        "購買導線の短縮（入力欄・フォーム削減）",
        "フォーム完了率 +10〜20%",
    ),
}

_PRIORITY_ORDER = (
    "search_intent_match",
    "fv_appeal",
    "cta_clarity",
    "purchase_flow",
    "trust_building",
    "price_offer",
)

_STUB_HEADER = "### 最優先3施策"
_AUTO_GENERATED_NOTE = (
    "> 【自動生成】このブロックは LLM 本文で欠損していたため、"
    "決定論評価結果から自動で補完しています（根拠: deterministic_evaluator の弱判定軸）。"
)


@dataclass(frozen=True)
class _WeakCandidate:
    brand: BrandEvaluation
    axis_key: str
    axis_label: str


def _collect_weak_candidates(
    evaluations: Sequence[BrandEvaluation],
) -> list[_WeakCandidate]:
    """Collect weak-verdict axes ordered by priority."""
    candidates: list[_WeakCandidate] = []
    for axis_key in _PRIORITY_ORDER:
        for ev in evaluations:
            v = ev.verdict_for(axis_key)
            if v is None or v.verdict != VERDICT_WEAK:
                continue
            candidates.append(
                _WeakCandidate(brand=ev, axis_key=axis_key, axis_label=v.axis_label),
            )
    return candidates


def synthesize_priority_action_block(
    extracted_list: Iterable[ExtractedData],
    *,
    max_items: int = 3,
) -> str | None:
    """Build the ``### 最優先3施策`` markdown block from extracted data.

    Returns ``None`` when there is not enough evidence to emit at least one
    action (e.g. the deterministic evaluator found no weak axes).
    """
    evaluations = evaluate_all(extracted_list)
    if not evaluations:
        return None

    candidates = _collect_weak_candidates(evaluations)
    if not candidates:
        return None

    seen: set[tuple[str, str]] = set()
    actions: list[str] = []
    priority_labels = ("S", "S", "A")
    for cand in candidates:
        if len(actions) >= max_items:
            break
        key = (cand.brand.brand_label, cand.axis_key)
        if key in seen:
            continue
        seen.add(key)
        headline, effect = _AXIS_PLAYBOOK.get(
            cand.axis_key,
            ("弱判定軸の改善", "方向性のみ（確定値なし）"),
        )
        priority = priority_labels[min(len(actions), len(priority_labels) - 1)]
        actions.append(
            f"- **{headline}**"
            f" / 対象: {cand.brand.brand_label}"
            f" / 軸: {cand.axis_label}"
            f" / 期待効果: {effect}"
            f" / 優先度: {priority}"
        )

    if not actions:
        return None

    lines = [_STUB_HEADER, "", _AUTO_GENERATED_NOTE, ""]
    lines.extend(actions)
    lines.append("")
    return "\n".join(lines)
