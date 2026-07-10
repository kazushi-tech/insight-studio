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


# Remediation playbook:
# axis_key → (headline, expected_effect, expected_kpi, effort, first_validation)
_AXIS_PLAYBOOK: dict[str, tuple[str, str, str, str, str]] = {
    "search_intent_match": (
        "検索意図に沿ったFV/見出しへリライト",
        "検索語と訴求の一致度改善を確認",
        "CTR / LP-CVR",
        "中",
        "7日間のA/Bテストで現状比を確認",
    ),
    "fv_appeal": (
        "FV訴求を購買意図ベースのコピーへ差し替え",
        "初回接触時の理解度改善を確認",
        "CTAクリック率 / LP-CVR",
        "中",
        "7日間のA/Bテストで現状比を確認",
    ),
    "cta_clarity": (
        "主要CTAを明確化（ボタン文言と配置最適化）",
        "次の行動への移行改善を確認",
        "CTAクリック率 / LP-CVR",
        "低",
        "変更前後を7日間ずつ測定",
    ),
    "trust_building": (
        "信頼要素（L1-L3）の可視化（実績・保証・証明）",
        "比較検討時の不安低減を確認",
        "LP-CVR / 離脱率",
        "中",
        "信頼要素追加前後を2週間比較",
    ),
    "price_offer": (
        "価格・オファー条件のフルファネル訴求",
        "価格検討時の離脱抑制を確認",
        "LP-CVR / CTAクリック率",
        "中",
        "条件表示の有無を7日間A/Bテスト",
    ),
    "purchase_flow": (
        "購買導線の短縮（入力欄・フォーム削減）",
        "入力途中の離脱抑制を確認",
        "フォーム完了率 / LP-CVR",
        "高",
        "変更前後を2週間比較",
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
        headline, effect, kpi, effort, validation = _AXIS_PLAYBOOK.get(
            cand.axis_key,
            (
                "弱判定軸の改善",
                "改善方向を確認（確定値なし）",
                "LP-CVR / CPA",
                "中",
                "7日間の変更前後比較",
            ),
        )
        priority = priority_labels[min(len(actions), len(priority_labels) - 1)]
        actions.append(
            f"- **{headline}**"
            f" / 対象: {cand.brand.brand_label}"
            f" / 軸: {cand.axis_label}"
            f" / 期待効果: {effect}"
            f" / 期待KPI: {kpi}"
            f" / 工数: {effort}"
            f" / 初回検証方法: {validation}"
            f" / 優先度: {priority}"
        )

    if not actions:
        return None

    lines = [_STUB_HEADER, "", _AUTO_GENERATED_NOTE, ""]
    lines.extend(actions)
    lines.append("")
    return "\n".join(lines)
