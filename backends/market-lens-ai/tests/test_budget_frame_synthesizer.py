"""Tests for budget_frame_synthesizer (Phase P1-D)."""

from __future__ import annotations

from web.app.budget_frame_synthesizer import synthesize_budget_frame_block
from web.app.models import ExtractedData


def _brand(url: str) -> ExtractedData:
    return ExtractedData(
        url=url,
        title="sample",
        h1="sample",
        hero_copy="サンプル" * 5,
        main_cta="購入",
        body_text_snippet="本文" * 30,
    )


def test_synthesize_budget_frame_block_returns_table():
    block = synthesize_budget_frame_block(
        [_brand("https://a.example"), _brand("https://b.example")],
        industry_hint="スポーツサプリメント",
    )
    assert block is not None
    assert "### 5-0 予算フレーム" in block
    assert "【自動生成】" in block
    # Markdown table headers and required rows
    assert "| 項目 | 初期フェーズ | 拡張フェーズ | 備考 |" in block
    assert "月額予算帯" in block
    assert "CPA ガイドライン" in block
    assert "想定CV数" in block


def test_synthesize_budget_frame_block_uses_industry_prior_source():
    block = synthesize_budget_frame_block(
        [_brand("https://a.example")],
        industry_hint="スポーツサプリメント",
    )
    assert block is not None
    # Derivation source footer names the industry prior
    assert "業界プライア" in block
    assert "CPC=" in block and "CVR=" in block


def test_synthesize_budget_frame_block_is_deterministic():
    brands = [_brand("https://a.example"), _brand("https://b.example")]
    first = synthesize_budget_frame_block(brands, industry_hint="スポーツサプリメント")
    second = synthesize_budget_frame_block(brands, industry_hint="スポーツサプリメント")
    assert first == second
