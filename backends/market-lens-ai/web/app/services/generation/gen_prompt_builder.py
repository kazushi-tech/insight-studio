"""Prompt builder for AI banner generation (M5.7)."""

from __future__ import annotations

from ...schemas.review_result import ReviewResult


def build_banner_gen_prompt(
    *,
    review_result: ReviewResult,
    style_guidance: str = "",
    original_width: int | None = None,
    original_height: int | None = None,
) -> str:
    """Build image generation prompt from review improvements.

    Extracts key improvements and constructs a prompt for Gemini Vision
    to generate an improved banner concept.
    """
    # rubric_scoresの低スコア軸名を取得（優先度の参考情報）
    weak_axes = sorted(review_result.rubric_scores, key=lambda rs: rs.score)
    weak_axis_names = [rs.rubric_id for rs in weak_axes]

    # improvements はLLM出力順のまま、優先度番号を付与
    improvements_text = "\n".join(
        f"- 【優先度{i+1}】{imp.point}: {imp.action}"
        for i, imp in enumerate(review_result.improvements)
    )

    # 弱い軸を明示してGeminiに優先度を伝える
    weak_axes_text = "、".join(
        f"{rs.rubric_id}({rs.score}/5)" for rs in weak_axes[:3]
    )

    # visible_text_elements からテキスト一覧を構築
    text_elements = review_result.visible_text_elements
    if text_elements:
        text_block = "\n".join(
            f"- 【{e.role}】「{e.text}」{f'（{e.approximate_position}）' if e.approximate_position else ''}"
            for e in text_elements
        )
    else:
        # visible_text_elements が空の場合はテキスト一覧なし（汎用保持指示のみ）
        text_block = ""

    good_points_text = "\n".join(
        f"- {gp.point}" for gp in review_result.good_points
    )

    product_info = review_result.product_identification or review_result.summary

    size_instruction = ""
    if original_width and original_height:
        size_instruction = f"""\

## 出力サイズ
生成画像は {original_width}x{original_height}px にしてください。元バナーと同じサイズ・アスペクト比を厳守すること。
"""

    text_preservation_section = ""
    if text_block:
        text_preservation_section = f"""
## 最重要: テキスト要素の完全保持
以下は元バナーから正確に抽出されたテキストです。生成バナーではこれらを1文字も変えずにそのまま使用してください。
テキストを自分で生成・推測・翻訳しないこと。下記の指定文字列のみを使用すること。

{text_block}
"""
    else:
        text_preservation_section = """
## テキスト要素について
元バナーに含まれるテキスト（見出し、コピー、CTA、価格等）は元画像から正確に読み取り、1文字も変更せずにそのまま使用してください。
テキストを自分で生成・推測・翻訳しないこと。
"""

    prompt = f"""\
元のバナー画像を参照し、以下の改善を適用した新しいバナーを生成してください。
{text_preservation_section}
## 最重要ルール: 元画像の写真素材を一切変更しない
- 元バナーに含まれる商品写真・人物写真・ロゴは絶対に再生成しないこと
- 改善対象はテキスト要素（コピー・CTA）、背景色、レイアウト構成のみ
- 製品の形状・色・角度・照明を元画像と完全に一致させること

## デザイン原則（必ず遵守）
1. 視覚ヒエラルキー: メインコピー > サブコピー > CTA > 補足テキスト
2. コントラスト: テキスト背景比 4.5:1以上、CTAは最目立ち配色
3. 余白: テキスト周囲に十分な余白、要素密集を回避
4. フォントサイズ: メインコピー=画像高さ8-12%、CTA=5-8%
5. CTA配置: 視線終点（右下/中央下）に十分サイズのボタン形状
6. 色数制限: 3-4色以内、アクセント=CTAのみ

## 製品・ブランド情報
製品/ブランド: {product_info}
{size_instruction}
## 維持すべき良い点
{good_points_text}

## 特に弱い評価軸（優先的に改善）
{weak_axes_text}

## 改善すべき点とアクション（優先度順）
{improvements_text}

## 訴求軸
{review_result.message_angle}

## ターゲット
{review_result.target_hypothesis}"""

    if style_guidance:
        prompt += f"\n\n## スタイルガイダンス\n{style_guidance}"

    prompt += """

## 生成前チェックリスト
- メインコピーが3秒以内に読み取れる大きさか
- CTAが明確に視認でき、クリックしたくなるデザインか
- 情報整理され、視線の流れが自然か
- 元画像の商品写真・ロゴが完全維持されているか
- テキスト可読性（コントラスト・サイズ・フォント）十分か
- プロフェッショナル感があるか
- すべてのテキストが元バナーと完全に一致しているか（文字化け・ハルシネーションなし）

元の広告バナーのレイアウト・色調・製品写真を完全に維持しつつ、テキスト要素とレイアウト構成の改善点のみを反映したプロフェッショナルなデザインを生成してください。"""

    return prompt
