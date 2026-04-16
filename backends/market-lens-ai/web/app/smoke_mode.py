"""Deterministic smoke mode for browser automation testing.

When SMOKE_MODE=1 is set, backend routes return fixture-based responses
instead of calling Gemini / external fetch / allowlist.

This allows browser UI smoke tests to run deterministically without
external dependencies.

IMPORTANT: Production paths are not modified. SMOKE_MODE off = current behavior.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

from .schemas.review_result import ReviewResult
from .services.review.review_prompt_builder import BANNER_RUBRIC_IDS, LP_RUBRIC_IDS


def is_smoke_mode() -> bool:
    """Return True if SMOKE_MODE env flag is set."""
    return os.getenv("SMOKE_MODE", "").strip() in ("1", "true", "yes")


def smoke_scan_result(urls: list[str], run_id: str) -> dict:
    """Return a deterministic scan result for smoke testing."""
    extracted = []
    for url in urls:
        extracted.append({
            "url": url,
            "title": f"[SMOKE] Sample Page — {url}",
            "meta_description": "This is a deterministic smoke test result.",
            "h1": "Welcome to Sample Page",
            "hero_copy": "The best products at the best prices.",
            "main_cta": "Shop Now",
            "pricing_snippet": "From $9.99/month",
            "feature_bullets": [
                "Feature A: Fast delivery",
                "Feature B: Quality guarantee",
                "Feature C: 24/7 support",
            ],
            "screenshot_path": None,
            "error": None,
        })

    report_md = _SMOKE_REPORT_MD.format(
        urls="\n".join(f"- {u}" for u in urls),
    )

    return {
        "run_id": run_id,
        "status": "completed",
        "report_md": report_md,
        "total_time_sec": 1.23,
        "error": None,
        "_extracted": extracted,
    }


def smoke_banner_review() -> ReviewResult:
    """Return a deterministic golden banner review for smoke testing."""
    return ReviewResult(**{
        "review_type": "banner_review",
        "summary": "[SMOKE] ECセールバナーとして基本的な訴求力を備えている。50%OFFの数字訴求が目立ち、ブランドカラーの統一感がある。",
        "product_identification": "[SMOKE] ECセールバナー — 50%OFFキャンペーン",
        "good_points": [
            {"point": "50%OFFの数字訴求が目立つ", "reason": "赤背景に白文字で視認しやすい"},
            {"point": "ブランドカラーの統一感", "reason": "ガイドラインに沿った赤×白の配色"},
        ],
        "keep_as_is": [],
        "improvements": [
            {"point": "CTAボタンが小さい", "reason": "300x250に対してCTAが目立たない", "action": "CTAを20%拡大しコントラストを上げる"},
        ],
        "test_ideas": [],
        "evidence": [
            {"evidence_type": "client_material", "evidence_source": "ブランドガイドライン v2.1", "evidence_text": "メインカラーは赤 #E53E3E"},
        ],
        "target_hypothesis": "20-40代女性で、セール情報に敏感なオンラインショッピング利用者",
        "message_angle": "期間限定の大幅値引きによるお得感訴求",
        "rubric_scores": [
            {"rubric_id": rid, "score": 4, "comment": f"[SMOKE] {rid}の評価は良好"}
            for rid in BANNER_RUBRIC_IDS
        ],
    })


def smoke_ad_lp_review() -> ReviewResult:
    """Return a deterministic golden ad-LP review for smoke testing."""
    return ReviewResult(**{
        "review_type": "ad_lp_review",
        "summary": "[SMOKE] 広告とLPのメッセージは概ね一致している。セール訴求の一貫性が保たれている。",
        "product_identification": "[SMOKE] ECセール広告とLP",
        "good_points": [
            {"point": "50%OFFの訴求が一致", "reason": "広告のメッセージがLPで確認できる"},
        ],
        "keep_as_is": [],
        "improvements": [
            {"point": "CTAの文言差異", "reason": "広告とLPでCTA文言が違う", "action": "文言を統一する"},
        ],
        "test_ideas": [
            {"hypothesis": "CTA統一で遷移率向上の可能性がある", "variable": "CTA文言", "expected_impact": "直帰率低減が期待できる（仮説）"},
        ],
        "evidence": [
            {"evidence_type": "client_material", "evidence_source": "広告バナー banner.png", "evidence_text": "50%OFF訴求"},
            {"evidence_type": "competitor_public", "evidence_source": "LP ファーストビュー", "evidence_text": "ファーストビューに50%OFF"},
        ],
        "target_hypothesis": "セール情報に敏感な20-40代女性",
        "message_angle": "セール訴求一貫性",
        "rubric_scores": [
            {"rubric_id": rid, "score": 4, "comment": f"[SMOKE] {rid}の評価は良好"}
            for rid in LP_RUBRIC_IDS
        ],
    })


_SMOKE_REPORT_MD = """# [SMOKE] 競合比較分析レポート

## 分析対象
{urls}

## 概要
これは SMOKE_MODE で生成された deterministic テストレポートです。
実際の Gemini 分析は行われていません。

## 主要な発見
1. **共通点**: すべてのサイトが明確な価値提案を持っている
2. **差別化ポイント**: 価格戦略とCTA配置に違いがある
3. **改善機会**: モバイル最適化の余地がある

## 推奨事項
- CTA ボタンの視認性を向上させる
- モバイルファーストのレイアウトを検討する
- A/B テストで価格表示を最適化する
"""
