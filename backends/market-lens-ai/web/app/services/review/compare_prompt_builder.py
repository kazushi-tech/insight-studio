"""Prompt builder for competitor compare review (M5.3)."""

from __future__ import annotations

from ...schemas.competitor_compare import CompetitorData
from .review_prompt_builder import EVIDENCE_TYPES

# Rubric IDs for competitor comparison
COMPARE_RUBRIC_IDS = [
    "positioning_clarity",
    "visual_differentiation",
    "cta_effectiveness",
    "value_proposition",
    "trust_signal_strength",
    "brand_consistency",
    "audience_alignment",
    "competitive_advantage",
]

_COMPARE_OUTPUT_FORMAT = """\
以下の JSON 形式で出力してください。JSON 以外のテキストは含めないでください。

{{
  "review_type": "competitor_compare",
  "summary": "比較レビュー全体の要約（1-3文）",
  "good_points": [
    {{"point": "自社クリエイティブの強み", "reason": "競合比較での根拠"}}
  ],
  "keep_as_is": [
    {{"point": "競合比較でも変えない方がよい要素", "reason": "根拠"}}
  ],
  "improvements": [
    {{"point": "改善点", "reason": "競合比較からの理由", "action": "具体的な行動ステップ"}}
  ],
  "test_ideas": [
    {{"hypothesis": "テスト仮説", "variable": "変更する変数", "expected_impact": "期待される効果"}}
  ],
  "evidence": [
    {{"evidence_type": "<{evidence_types}>のいずれか", "evidence_source": "出典元", "evidence_text": "引用テキスト"}}
  ],
  "target_hypothesis": "想定ターゲットの仮説",
  "message_angle": "訴求軸の要約",
  "rubric_scores": [
    {{"rubric_id": "<rubric項目ID>", "score": 1-5, "comment": "スコアの根拠コメント"}}
  ],
  "positioning_insights": [
    {{
      "dimension": "比較軸（例: 価格訴求, CTA明確性）",
      "our_position": "自社のポジション",
      "competitor_position": "競合のポジション",
      "gap_analysis": "ギャップ分析",
      "recommendation": "推奨アクション"
    }}
  ]
}}"""

_COMPARE_STYLE_RULES = """\
## 比較レビュースタイルルール（必ず守ること）

1. 良い点を必ず先に出すこと。改善点より前に good_points を提示する
2. 既存クリエイティブを全否定しない。変えない方がよい要素を keep_as_is で明示する
3. improvements の各 action は具体的で実行可能な内容にする
4. positioning_insights は最低 2 件出力し、異なる比較軸をカバーすること
5. 各 positioning_insight の recommendation は具体的で実行可能にする
6. evidence には必ず具体的なソースを記載する。「一般的に」等の曖昧表現は禁止
7. rubric_scores の各 comment は具体的な観察事実に基づくこと
8. good_points は最低 2 件（minItems: 2）出力すること
9. 競合の具体的な要素（色、CTA文言、レイアウト等）を引用して比較すること"""


def build_compare_review_prompt(
    *,
    asset_file_name: str,
    asset_width: int | None = None,
    asset_height: int | None = None,
    competitors: list[CompetitorData],
    brand_info: str = "",
    operator_memo: str = "",
) -> str:
    """Build a structured prompt for competitor comparison review."""
    size_str = ""
    if asset_width and asset_height:
        size_str = f"サイズ: {asset_width}x{asset_height}px"

    rubric_list = "\n".join(f"- {rid}" for rid in COMPARE_RUBRIC_IDS)

    comp_sections = []
    for i, comp in enumerate(competitors, 1):
        section = f"### 競合{i}: {comp.domain}"
        section += f"\n- URL: {comp.url}"
        if comp.title:
            section += f"\n- タイトル: {comp.title}"
        if comp.description:
            section += f"\n- 説明: {comp.description}"
        comp_sections.append(section)

    competitors_text = "\n\n".join(comp_sections)

    return f"""\
あなたは広告クリエイティブの競合比較レビューの専門家です。
自社バナーと競合の情報をもとに、ポジショニングの差異と改善点を structured JSON で講評してください。

## 自社バナー情報
- ファイル名: {asset_file_name}
{f"- {size_str}" if size_str else ""}\
{f"- ブランド情報: {brand_info}" if brand_info else ""}\
{f"- 運用者メモ: {operator_memo}" if operator_memo else ""}

## 競合情報

{competitors_text}

## 評価基準（rubric_scores で全項目を 1-5 で採点）
{rubric_list}

## 重要な評価ポイント
- 自社クリエイティブが競合と比較してどのような強み・弱みを持つか
- ポジショニングの差異を複数の軸で分析すること
- 具体的な改善アクションを提示すること

{_COMPARE_STYLE_RULES}

{_COMPARE_OUTPUT_FORMAT.format(
    evidence_types=" / ".join(EVIDENCE_TYPES),
)}"""
