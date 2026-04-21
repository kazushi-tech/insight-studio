"""Deterministic ``### 5-2 検索広告施策`` stub (Phase Q1-1).

Generates a placeholder block when the LLM omits Section 5-2.
Uses keyword intent classification results to surface search-ad
recommendations without hallucinating budget figures.
"""

from __future__ import annotations

from typing import Iterable

from ..deterministic_evaluator import VERDICT_WEAK, evaluate_all
from ..models import ExtractedData

_STUB_HEADER = "### 5-2 検索広告施策"

_AUTO_NOTE = (
    "> 【自動補完】このブロックはLLM本文で欠損していたため、"
    "決定論評価から自動生成しています（Appendix A 参照）。"
    "本分析対象外の詳細数値は別途調査を推奨します。"
)

_SEARCH_AD_PLAYBOOK: dict[str, tuple[str, str, str]] = {
    "search_intent_match": (
        "指名KWと比較KWへの広告出稿強化",
        "Brand/Compキャンペーン分割",
        "インプレッション確保・CPC低減",
    ),
    "cta_clarity": (
        "広告文にCTAキーワードを追加",
        "RSA見出しA/Bテスト",
        "CTR +10〜20% 見込み",
    ),
    "fv_appeal": (
        "広告→LP間の訴求一貫性を強化",
        "アセット拡張とLP内容同期",
        "品質スコア改善",
    ),
    "price_offer": (
        "価格訴求アセットの追加",
        "プロモーション表示オプション活用",
        "価格検討層へのリーチ拡大",
    ),
    "trust_building": (
        "レビュー・実績をサイトリンクで補完",
        "サイトリンク・コールアウト拡張",
        "CVR底上げ",
    ),
}

_PRIORITY_ORDER = (
    "search_intent_match",
    "cta_clarity",
    "fv_appeal",
    "price_offer",
    "trust_building",
)


def synthesize_search_ad_block(
    extracted_list: Iterable[ExtractedData],
    *,
    max_items: int = 3,
) -> str | None:
    """Build the ``### 5-2 検索広告施策`` placeholder block.

    Returns ``None`` if no weak axes relevant to search ads are found.
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
            施策, 手法, 効果 = _SEARCH_AD_PLAYBOOK.get(
                axis_key, ("検索広告施策", "詳細要調査", "要計測")
            )
            rows.append(f"| {ev.brand_label} | {施策} | {手法} | {効果} | A |")
            if len(rows) >= max_items:
                break

    if not rows:
        return None

    header = "| ブランド | 施策 | 手法 | 期待効果 | 優先度 |"
    sep = "| --- | --- | --- | --- | --- |"
    lines = [_STUB_HEADER, "", _AUTO_NOTE, "", header, sep]
    lines.extend(rows)
    lines.append("")
    return "\n".join(lines)
