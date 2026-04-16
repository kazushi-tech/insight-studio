"""Industry-specific review templates for Market Lens AI."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class IndustryTemplate:
    """Review template tailored to a specific industry."""
    id: str
    name_ja: str
    name_en: str
    description: str
    rubric_weights: dict[str, float]
    focus_areas: list[str]
    prompt_augmentation: str
    example_cta_patterns: list[str]


# Default rubric weights (equal)
_DEFAULT_WEIGHTS = {
    "visual_impact": 0.2,
    "message_clarity": 0.2,
    "cta_effectiveness": 0.2,
    "brand_consistency": 0.2,
    "competitive_edge": 0.2,
}

INDUSTRY_TEMPLATES: dict[str, IndustryTemplate] = {
    "real_estate": IndustryTemplate(
        id="real_estate",
        name_ja="不動産",
        name_en="Real Estate",
        description="不動産・住宅業界向けレビューテンプレート。物件写真の訴求力、信頼性、エリア情報の明確さを重視。",
        rubric_weights={
            "visual_impact": 0.25,
            "message_clarity": 0.20,
            "cta_effectiveness": 0.20,
            "brand_consistency": 0.15,
            "competitive_edge": 0.20,
        },
        focus_areas=[
            "物件写真の品質と訴求力",
            "価格・間取り情報の視認性",
            "エリア・立地情報の明確さ",
            "信頼性・実績の訴求",
            "問い合わせ導線の最適化",
        ],
        prompt_augmentation=(
            "不動産業界のレビュー観点: 物件写真のクオリティ、価格帯の明示、"
            "間取り図の有無、駅距離・周辺施設情報、内覧予約CTAの設計、"
            "顧客の信頼を得るための実績・免許番号表示を評価してください。"
        ),
        example_cta_patterns=["無料査定", "内覧予約", "資料請求", "来店予約"],
    ),
    "ecommerce": IndustryTemplate(
        id="ecommerce",
        name_ja="EC・通販",
        name_en="E-Commerce",
        description="EC・通販業界向けレビューテンプレート。商品訴求、購買導線、セール表現を重視。",
        rubric_weights={
            "visual_impact": 0.25,
            "message_clarity": 0.15,
            "cta_effectiveness": 0.30,
            "brand_consistency": 0.10,
            "competitive_edge": 0.20,
        },
        focus_areas=[
            "商品画像の魅力と品質",
            "価格・割引表示の効果",
            "購入ボタンの視認性と配置",
            "レビュー・社会的証明の活用",
            "緊急性・限定感の演出",
        ],
        prompt_augmentation=(
            "EC業界のレビュー観点: 商品写真の魅力、価格表示の分かりやすさ、"
            "送料・配送情報の明示、カート追加CTAの目立ち具合、"
            "レビュー数・星評価の活用、セール・限定表現の適切さを評価してください。"
        ),
        example_cta_patterns=["カートに入れる", "今すぐ購入", "お気に入り登録", "定期購入"],
    ),
    "beauty": IndustryTemplate(
        id="beauty",
        name_ja="美容・コスメ",
        name_en="Beauty & Cosmetics",
        description="美容・コスメ業界向けレビューテンプレート。ビジュアルの世界観、成分訴求、ビフォーアフターを重視。",
        rubric_weights={
            "visual_impact": 0.30,
            "message_clarity": 0.15,
            "cta_effectiveness": 0.20,
            "brand_consistency": 0.25,
            "competitive_edge": 0.10,
        },
        focus_areas=[
            "ビジュアルの世界観・ブランド感",
            "成分・効能の訴求方法",
            "ビフォーアフター・使用感の伝達",
            "ターゲット層への共感ポイント",
            "薬機法・景表法の遵守",
        ],
        prompt_augmentation=(
            "美容・コスメ業界のレビュー観点: ブランドの世界観表現、"
            "成分・効能の訴求（薬機法を意識した表現か）、モデル写真・テクスチャ画像の品質、"
            "口コミ・インフルエンサー活用、トライアル・初回限定CTAの設計を評価してください。"
        ),
        example_cta_patterns=["初回限定", "トライアルセット", "定期便申込", "無料サンプル"],
    ),
    "b2b": IndustryTemplate(
        id="b2b",
        name_ja="BtoB・法人向け",
        name_en="B2B",
        description="BtoB業界向けレビューテンプレート。信頼性、導入実績、ROI訴求を重視。",
        rubric_weights={
            "visual_impact": 0.10,
            "message_clarity": 0.25,
            "cta_effectiveness": 0.25,
            "brand_consistency": 0.15,
            "competitive_edge": 0.25,
        },
        focus_areas=[
            "課題提起の明確さ",
            "導入実績・事例の説得力",
            "ROI・効果の定量訴求",
            "セキュリティ・信頼性の担保",
            "資料請求・商談導線の最適化",
        ],
        prompt_augmentation=(
            "BtoB業界のレビュー観点: 課題→解決策の論理構成、"
            "導入企業ロゴ・事例数の提示、ROI・コスト削減の数値訴求、"
            "セキュリティ認証・実績の表示、資料請求フォームの最適化、"
            "意思決定者向けの情報設計を評価してください。"
        ),
        example_cta_patterns=["資料請求", "無料トライアル", "デモ予約", "お問い合わせ"],
    ),
    "sports_supplement": IndustryTemplate(
        id="sports_supplement",
        name_ja="スポーツサプリメント",
        name_en="Sports Supplements",
        description="スポーツサプリメント・プロテイン・健康食品業界向けテンプレート。認証・品質・ターゲット層別訴求を重視。",
        rubric_weights={
            "visual_impact": 0.15,
            "message_clarity": 0.20,
            "cta_effectiveness": 0.25,
            "brand_consistency": 0.15,
            "competitive_edge": 0.25,
        },
        focus_areas=[
            "アンチドーピング・第三者認証の明示",
            "製造品質（GMP・国産・製薬会社）の訴求",
            "味・飲みやすさ・継続しやすさの伝達",
            "価格帯・定期便・送料の明確さ",
            "レビュー件数・アスリート実績の活用",
            "ターゲット層の明確化（競技者/一般/ボディメイク/持久系）",
        ],
        prompt_augmentation=(
            "スポーツサプリメント業界のレビュー観点: "
            "アンチドーピング認証（インフォームドチョイス・WADA準拠）の有無と明示、"
            "製造品質（GMP・国産・製薬会社品質）の訴求、"
            "味・フレーバー数・溶けやすさの情報量、"
            "価格帯・1回単価・定期便割引・送料条件の比較しやすさ、"
            "レビュー件数・アスリート使用実績・競技レベル、"
            "ターゲット層セグメンテーション: "
            "競技者向け（認証・成分配合・純度重視）、"
            "一般運動層向け（味・手軽さ・価格重視）、"
            "ボディメイク向け（タンパク質量・カロリー・HMB）、"
            "マラソン/持久系向け（アミノ酸・エネルギー補給・携帯性）、"
            "安全性訴求（アレルゲン・添加物フリー・原材料透明性）を評価してください。"
        ),
        example_cta_patterns=["定期便申込", "初回限定", "まとめ買い割引", "お試しサイズ"],
    ),
}


def get_template(industry_id: str) -> IndustryTemplate | None:
    """Get industry template by ID."""
    return INDUSTRY_TEMPLATES.get(industry_id)


def list_templates() -> list[dict]:
    """List all available templates as dicts for API response."""
    return [
        {
            "id": t.id,
            "name_ja": t.name_ja,
            "name_en": t.name_en,
            "description": t.description,
            "rubric_weights": t.rubric_weights,
            "focus_areas": t.focus_areas,
            "example_cta_patterns": t.example_cta_patterns,
        }
        for t in INDUSTRY_TEMPLATES.values()
    ]


def get_prompt_augmentation(industry_id: str) -> str:
    """Get the prompt augmentation text for an industry, or empty string if not found."""
    t = INDUSTRY_TEMPLATES.get(industry_id)
    return t.prompt_augmentation if t else ""
