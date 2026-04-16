"""Sample gallery — demo review data for onboarding (Phase 9)."""

from __future__ import annotations


SAMPLE_REVIEWS = [
    {
        "id": "sample_001",
        "title": "ECサイト バナー比較レビュー",
        "industry": "ec",
        "summary": "自社ECサイトと競合3社のバナーデザインを比較。CTAの配置と色彩効果を分析。",
        "thumbnail": "/static/samples/ec_banner.png",
        "tags": ["EC", "バナー", "CTA分析"],
    },
    {
        "id": "sample_002",
        "title": "不動産 LP 訴求軸分析",
        "industry": "real_estate",
        "summary": "大手不動産3社のLP構成を比較。ファーストビューの訴求軸とフォーム導線を評価。",
        "thumbnail": "/static/samples/realestate_lp.png",
        "tags": ["不動産", "LP", "ファーストビュー"],
    },
    {
        "id": "sample_003",
        "title": "SaaS プロダクト ページ比較",
        "industry": "saas",
        "summary": "BtoB SaaS 3社のプロダクトページを分析。機能訴求 vs 課題解決型の構成比較。",
        "thumbnail": "/static/samples/saas_product.png",
        "tags": ["SaaS", "BtoB", "プロダクトページ"],
    },
]


class SampleGalleryService:
    """Provides sample review data for demos and onboarding."""

    def list_samples(self, industry: str | None = None) -> list[dict]:
        if industry:
            return [s for s in SAMPLE_REVIEWS if s["industry"] == industry]
        return list(SAMPLE_REVIEWS)

    def get_sample(self, sample_id: str) -> dict | None:
        for s in SAMPLE_REVIEWS:
            if s["id"] == sample_id:
                return s
        return None
