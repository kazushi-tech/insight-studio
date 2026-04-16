"""Prompt builder for creative review — builds structured prompts for Gemini."""

from __future__ import annotations

from ...schemas.review_request import LandingPageInput

# Banner rubric IDs — consolidated 5-item rubric
BANNER_RUBRIC_IDS = [
    "visual_impact",       # hook_strength + visual_flow
    "message_clarity",     # target_clarity + offer_clarity
    "cta_effectiveness",   # cta_clarity
    "brand_consistency",   # unchanged
    "information_balance", # credibility + information_density
]

# LP rubric IDs (from lp-rubric.yaml)
LP_RUBRIC_IDS = [
    "first_view_clarity",
    "ad_to_lp_message_match",
    "benefit_clarity",
    "trust_elements",
    "cta_placement",
    "drop_off_risk",
    "input_friction",
    "story_consistency",
]

# LP-dependent rubric IDs — score: null when LP data is insufficient
LP_DEPENDENT_RUBRIC_IDS = [
    "ad_to_lp_message_match",
    "input_friction",
    "story_consistency",
]

# Allowed evidence types
EVIDENCE_TYPES = [
    "client_material",
    "approved_proposal",
    "winning_creative",
    "competitor_public",
    "platform_guideline",
]

_OUTPUT_FORMAT_INSTRUCTIONS = """\
以下の JSON 形式で出力してください。JSON 以外のテキストは含めないでください。

{{
  "review_type": "{review_type}",
  "summary": "レビュー全体の要約（1-3文）",
  "product_identification": "画像から特定された製品・ブランド・キャンペーン名",
  "good_points": [
    {{"point": "良い点", "reason": "根拠"}}
  ],
  "keep_as_is": [
    {{"point": "変えない方がよい要素", "reason": "理由"}}
  ],
  "improvements": [
    {{"point": "改善点", "reason": "理由", "action": "具体的な行動ステップ"}}
  ],
  "test_ideas": [
    {{"hypothesis": "テスト仮説", "variable": "変更する変数", "expected_impact": "期待される効果（仮説として表現）"}}
  ],
  "evidence": [
    {{"evidence_type": "<{evidence_types}>のいずれか", "evidence_source": "出典元", "evidence_text": "引用テキスト"}}
  ],
  "target_hypothesis": "想定ターゲットの仮説",
  "message_angle": "訴求軸の要約",
  "rubric_scores": [
    {{"rubric_id": "<rubric項目ID>", "score": "1-5 または null（評価不能時）", "comment": "スコアの根拠コメント"}}
  ],
  "visible_text_elements": [
    {{"role": "headline/sub_copy/cta/price/note/brand_name", "text": "画像に表示されている正確なテキスト", "approximate_position": "top-left/center/bottom-right等"}}
  ],
  "category_context": {{
    "inferred_category": "業界カテゴリ名（例: インテリアEC、化粧品、金融）",
    "observations": ["業界の広告傾向における位置づけを1-2文で記述"]
  }},
  "value_proposition_analysis": {{
    "purchase_threshold": "購入条件（価格情報がある場合のみ）",
    "incentive": "インセンティブ内容",
    "perceived_value_assessment": "知覚価値の評価",
    "communication_clarity": "伝達の明確さ"
  }}
}}"""

_SCORING_SCALE = """\
## スコアリング基準（1-5 の定義）
- 5: 業界トップクラス。即座に運用可能。改善の余地がほとんどない（例: Apple/Nike水準のビジュアルとCTA設計）
- 4: 良好。標準以上の品質。軽微な調整で優秀になる（例: 配色・タイポグラフィが整い、CTAも明確だが、1箇所改善の余地がある）
- 3: 標準的。プロフェッショナルなベースライン。大きな欠陥はないが際立つ強みもない（例: 情報は正しく伝わるが、差別化要素が弱い）
- 2: 改善が必要。重要な問題があるが基本的な方向性は正しい（例: CTAが埋もれている、視線誘導が不明瞭）
- 1: 根本的な見直しが必要。致命的な問題がある（例: メッセージが読めない、ブランド毀損レベルの品質）

重要: ベースラインは 3（標準）です。プロフェッショナルなバナーは通常 2-4 のレンジに収まります。
- 明確な強みが1つでもあれば 3 以上を検討してください
- 1 は「致命的欠陥」、5 は「業界最高水準」を意味します
- 全項目が 2 以下に集中する場合、採点が厳しすぎる可能性が高いです — 再評価してください
- 各項目を独立して評価し、強い点には 3-4 を、弱い点には 2 を付けてください
- score を null にできるのは、LPデータ不足で評価不能な場合のみです"""

_STYLE_RULES = """\
## レビュースタイルルール（必ず守ること）

1. 良い点を必ず先に出すこと。改善点より前に good_points を提示する
2. 既存クリエイティブを全否定しない。変えない方がよい要素を keep_as_is で明示する
3. improvements の各 action は具体的で実行可能な内容にする
4. test_ideas の expected_impact は「〜が期待できる」「〜の可能性がある」等の仮説表現を使う。「必ず効果が出る」等の断定は禁止
5. evidence_source には具体的なソース名を記載する。以下の語句を含む表現は禁止:
   「一般的に」「通常」「普通は」「業界では」「ベストプラクティス」「研究によると」「データで証明」「専門家によれば」
   NG例: "Google Ads ディスプレイ広告ベストプラクティス"
   OK例: "Google Ads ヘルプ - ディスプレイ広告の要件と推奨事項", "当バナー画像内の視覚要素の観察"
6. rubric_scores の各 comment は具体的な観察事実に基づくこと
7. good_points, improvements, evidence はそれぞれ最低 1 件（test_ideas は 0 件でも可）
8. good_points は最低 2 件（minItems: 2）出力し、2軸をカバーすること: 1つは視覚・デザイン面（レイアウト、配色、フォント、画像等）、もう1つは戦略・ビジネス面（ターゲティング、訴求軸、競合差別化、CTA設計等）
9. evidence_text には具体的なデータポイントまたは具体的な観察事実を含めること。「ベストプラクティスに沿っている」「一般的に効果的」等の曖昧な記述は禁止。色コード、フォントサイズ、具体的なコピー文言、数値データ等を引用すること"""

_CONCISE_OUTPUT_RULES = """\
## 出力長の制約（速度優先）
- summary は 1-2 文に収める
- good_points は 2 件ちょうど
- keep_as_is は 0-1 件
- improvements は 1-2 件
- test_ideas は 0-1 件
- evidence は 1-2 件
- rubric_scores.comment は各 1 文で簡潔に書く
- target_hypothesis / message_angle は各 1 文で短く書く

## rubric_scores 完全性ルール（最重要）
- rubric_scores には評価基準に列挙された全項目を必ず含めること。1項目も欠落させてはいけません。
- LP データが不足している項目のみ score: null とし、他の項目は必ず 1-5 のスコアを付けること。
- null スコアの項目にも comment は必須です。「LPデータ取得制限により評価不能」と記載してください。
- 欠落があるとバリデーションエラーとなりレビューが失敗するため、必ず全項目を出力してください。"""


_SIZE_GUIDANCE = {
    "micro": "このバナーは極小サイズ（面積50,000px²未満）です。情報量は最小限で良く、1メッセージ+CTAで十分です。情報密度の低さで減点しないでください。",
    "small": "このバナーは小型サイズ（面積100,000px²未満）です。主要メッセージ1-2点+CTAに絞るのが適切です。詳細情報の不足で減点しないでください。",
    "medium": "このバナーは中型サイズです。ビジュアルとテキストのバランスが重要です。",
    "large": "このバナーは大型サイズです。詳細情報やビジュアルストーリーが期待されます。",
}


def _get_size_guidance(width: int | None, height: int | None) -> str:
    """Return size-aware guidance string based on banner dimensions."""
    if not width or not height:
        return ""
    area = width * height
    if area < 50_000:
        category = "micro"
    elif area < 100_000:
        category = "small"
    elif area < 250_000:
        category = "medium"
    else:
        category = "large"
    return f"\n## バナーサイズに応じた評価ガイダンス\n{_SIZE_GUIDANCE[category]}\n"


def build_banner_review_prompt(
    *,
    asset_file_name: str,
    asset_width: int | None = None,
    asset_height: int | None = None,
    brand_info: str = "",
    operator_memo: str = "",
) -> str:
    """Build a structured prompt for banner review."""
    size_str = ""
    if asset_width and asset_height:
        size_str = f"サイズ: {asset_width}x{asset_height}px"

    rubric_list = "\n".join(f"- {rid}" for rid in BANNER_RUBRIC_IDS)
    size_guidance = _get_size_guidance(asset_width, asset_height)

    return f"""\
あなたは広告クリエイティブレビューの専門家です。
以下のバナー画像を評価し、structured JSON で講評を返してください。

## 重要: 製品認識
まず画像に含まれる製品・ブランド・キャンペーンを正確に特定してください。
ファイル名や推測ではなく、画像内のテキストやビジュアル要素から判断してください。
特定結果を product_identification フィールドに記載してください。

## バナー情報
- ファイル名: {asset_file_name}
{f"- {size_str}" if size_str else ""}
{f"- ブランド情報: {brand_info}" if brand_info else ""}
{f"- 運用者メモ: {operator_memo}" if operator_memo else ""}
{size_guidance}
## 重要: テキスト要素の正確な抽出
バナー画像に含まれるすべてのテキスト要素を visible_text_elements に正確に記録してください:
- role は headline, sub_copy, cta, price, note, brand_name のいずれか
- text は画像に表示されている通りの文字列を1文字も変更せずに記載（OCR的に正確に）
- approximate_position は要素のおおよその位置（top-left, top-center, center, bottom-right 等）
- 画像内のすべてのテキスト要素を漏れなく抽出すること

## 評価基準（rubric_scores で全項目を 1-5 で採点）
{rubric_list}

{_SCORING_SCALE}

{_STYLE_RULES}

{_CONCISE_OUTPUT_RULES}

## カテゴリコンテキスト
画像から業界カテゴリを推定し、category_context に記載してください:
- inferred_category: 業界名（例: インテリアEC、化粧品、金融、不動産）
- observations: その業界の広告傾向における本バナーの位置づけを1-2文で記述

## 価値提案分析（条件付き）
価格・購入条件・インセンティブ（特典、割引、プレゼント等）がバナーに含まれている場合のみ、value_proposition_analysis を出力してください:
- purchase_threshold: 購入条件（例: 「20万円以上の購入」）
- incentive: インセンティブ内容（例: 「Lucanoスツールプレゼント」）
- perceived_value_assessment: 購入条件に対するインセンティブの知覚価値は十分か
- communication_clarity: 価値提案の伝達は明確か
価格・インセンティブ情報がバナーに含まれていない場合は、value_proposition_analysis を出力しないでください。

{_OUTPUT_FORMAT_INSTRUCTIONS.format(
    review_type="banner_review",
    evidence_types=" / ".join(EVIDENCE_TYPES),
)}"""


def build_ad_lp_review_prompt(
    *,
    asset_file_name: str,
    asset_width: int | None = None,
    asset_height: int | None = None,
    landing_page: LandingPageInput,
    brand_info: str = "",
    operator_memo: str = "",
) -> str:
    """Build a structured prompt for ad-to-LP fit review."""
    size_str = ""
    if asset_width and asset_height:
        size_str = f"サイズ: {asset_width}x{asset_height}px"

    rubric_list = "\n".join(f"- {rid}" for rid in LP_RUBRIC_IDS)
    size_guidance = _get_size_guidance(asset_width, asset_height)

    benefits_str = ", ".join(landing_page.extracted_benefits) if landing_page.extracted_benefits else "取得不可"
    trust_str = ", ".join(landing_page.trust_elements) if landing_page.trust_elements else "取得不可"

    # LP データ不足時の条件付き警告
    lp_fields = [landing_page.title, landing_page.meta_description,
                 landing_page.first_view_text, landing_page.cta_text]
    lp_filled = sum(1 for f in lp_fields if f)
    lp_dependent_ids = ", ".join(f'"{rid}"' for rid in LP_DEPENDENT_RUBRIC_IDS)
    lp_data_warning = ""
    if lp_filled <= 2:
        lp_data_warning = f"""
## LP データ取得状況に関する注意
LP の一部フィールドが「取得不可」です。技術的な取得制限が原因であり、LP品質の問題ではありません。

採点ルール:
- 以下のLP依存項目は score: null を出力してください: {lp_dependent_ids}
- null スコアの項目にも comment は必須です。「LPデータ取得制限により評価不能」と記載してください
- 他の項目（LP依存でない項目）は取得できた情報とバナー画像から通常通り採点してください
- LP依存でない項目に null を付けることは禁止です
"""

    return f"""\
あなたは広告と LP の整合性レビューの専門家です。
以下の広告バナーと LP の情報をもとに、メッセージの一致度と改善点を structured JSON で講評してください。

## 広告バナー情報
- ファイル名: {asset_file_name}
{f"- {size_str}" if size_str else ""}
{f"- ブランド情報: {brand_info}" if brand_info else ""}
{f"- 運用者メモ: {operator_memo}" if operator_memo else ""}
{size_guidance}

## LP 情報
- URL: {landing_page.url}
- タイトル: {landing_page.title or "取得不可"}
- メタ説明: {landing_page.meta_description or "取得不可"}
- ファーストビュー: {landing_page.first_view_text or "取得不可"}
- CTA: {landing_page.cta_text or "取得不可"}
- ベネフィット: {benefits_str}
- 信頼要素: {trust_str}
{lp_data_warning}
## 評価基準（rubric_scores で全項目を 1-5 で採点）
{rubric_list}

**重要: 上記の全8項目を必ず rubric_scores に出力してください。項目を省略するとバリデーションエラーになります。**
**特に drop_off_risk, input_friction, story_consistency は LP データが不足していても score: null で出力し、絶対に省略しないでください。**

{_SCORING_SCALE}

## 重要: バナーの視覚要素分析
提供されたバナー画像から、以下を読み取り LP との整合性を評価してください:
- 画像内のテキスト（ヘッドライン、キャッチコピー、CTA、価格表示等）
- 配色・視覚階層・デザイン要素
- 訴求軸やターゲット推測の根拠となるビジュアル情報

## 重要な評価ポイント
- 広告の promise と LP の内容が一致しているか
- メッセージの一致（match）と不一致（mismatch）を明確に区別すること
- LP 側の evidence と広告側の evidence を併記すること
- スコア 1 は「致命的欠陥がある」場合のみ使用。データ不足を理由に 1 を付けないこと
- 広告バナーの視覚情報を必ず分析に含めること（画像が提供されている場合）

{_STYLE_RULES}

{_CONCISE_OUTPUT_RULES}

## カテゴリコンテキスト
画像から業界カテゴリを推定し、category_context に記載してください:
- inferred_category: 業界名（例: インテリアEC、化粧品、金融、不動産）
- observations: その業界の広告傾向における本バナーの位置づけを1-2文で記述

## 価値提案分析（条件付き）
価格・購入条件・インセンティブ（特典、割引、プレゼント等）がバナーに含まれている場合のみ、value_proposition_analysis を出力してください:
- purchase_threshold: 購入条件（例: 「20万円以上の購入」）
- incentive: インセンティブ内容（例: 「Lucanoスツールプレゼント」）
- perceived_value_assessment: 購入条件に対するインセンティブの知覚価値は十分か
- communication_clarity: 価値提案の伝達は明確か
価格・インセンティブ情報がバナーに含まれていない場合は、value_proposition_analysis を出力しないでください。

{_OUTPUT_FORMAT_INSTRUCTIONS.format(
    review_type="ad_lp_review",
    evidence_types=" / ".join(EVIDENCE_TYPES),
)}"""
