"""Deterministic ``### 5-1 LP改善施策`` stub (Phase Q1-1).

Generates a placeholder block when the LLM omits Section 5-1.
Uses the same deterministic axis verdicts as the priority_action_synthesizer
to surface weak LP axes as evidence-backed recommendations.
"""

from __future__ import annotations

from typing import Iterable

from ..deterministic_evaluator import VERDICT_WEAK, evaluate_all
from ..models import ExtractedData

_STUB_HEADER = "### 5-1 LP改善施策"

_AUTO_NOTE = (
    "> 【自動補完】このブロックはLLM本文で欠損していたため、"
    "決定論評価から自動生成しています（Appendix A 参照）。"
    "本分析では詳細エビデンスが不足したため一部詳細案を割愛しています。"
)

_LP_AXIS_PLAYBOOK: dict[str, tuple[str, str]] = {
    "fv_appeal": (
        "FVコピーを購買意図軸でリライト",
        "CTR・初速改善",
    ),
    "search_intent_match": (
        "見出し・導入文を検索意図に整合させる",
        "CTR +10〜20% 見込み",
    ),
    "cta_clarity": (
        "CTA文言と配置を最適化（主ボタン1点集中）",
        "LP-CVR +5〜15%",
    ),
    "trust_building": (
        "信頼要素（実績・保証・第三者証明）を上部に配置",
        "離脱率低下",
    ),
    "purchase_flow": (
        "フォーム入力ステップを削減しモバイル最適化",
        "フォーム完了率 +10〜20%",
    ),
    "price_offer": (
        "価格訴求とキャンペーン情報をFVに集約",
        "価格検討離脱の抑制",
    ),
}

_PRIORITY_ORDER = (
    "fv_appeal",
    "search_intent_match",
    "cta_clarity",
    "purchase_flow",
    "trust_building",
    "price_offer",
)


def synthesize_lp_improvement_block(
    extracted_list: Iterable[ExtractedData],
    *,
    max_items: int = 3,
) -> str | None:
    """Build the ``### 5-1 LP改善施策`` placeholder block.

    Returns ``None`` if no weak LP axes are found.
    """
    evaluations = evaluate_all(extracted_list)
    if not evaluations:
        return None

    seen: set[tuple[str, str]] = set()
    rows: list[str] = []
    for axis_key in _PRIORITY_ORDER:
        if len(rows) >= max_items:
            break
        for ev in evaluations:
            v = ev.verdict_for(axis_key)
            if v is None or v.verdict != VERDICT_WEAK:
                continue
            key = (ev.brand_label, axis_key)
            if key in seen:
                continue
            seen.add(key)
            headline, effect = _LP_AXIS_PLAYBOOK.get(axis_key, ("LP改善施策", "要詳細調査"))
            rows.append(
                f"| {ev.brand_label} | {headline} | {effect} | A |"
            )
            if len(rows) >= max_items:
                break

    if not rows:
        return None

    header_row = "| ブランド | 施策 | 期待効果 | 優先度 |"
    sep_row = "| --- | --- | --- | --- |"
    lines = [_STUB_HEADER, "", _AUTO_NOTE, "", header_row, sep_row]
    lines.extend(rows)
    lines.append("")
    return "\n".join(lines)
