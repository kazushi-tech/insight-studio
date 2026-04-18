"""Phase A-7 Golden tests: Discovery and Compare produce the same verdicts.

These tests assert that, given identical ExtractedData + industry inputs,
the deterministic judgment block and market estimate block injected into
both the Compare (deep) and Discovery (wide) prompts are identical.

If these fail, the cross-report inconsistency described in
``plans/parallel-marinating-nygaard.md`` section 1-A has regressed.
"""

from __future__ import annotations

import re

import pytest

from web.app.analyzer import (
    build_deep_comparison_prompt,
    build_wide_comparison_prompt,
)
from web.app.deterministic_evaluator import evaluate_all, format_judgment_block
from web.app.market_estimator import estimate, format_market_estimate_block, load_industry_priors
from web.app.models import ExtractedData
from web.app.shared_specs import clear_cache


@pytest.fixture(autouse=True)
def _reset_cache():
    clear_cache()
    load_industry_priors.cache_clear()
    yield
    clear_cache()
    load_industry_priors.cache_clear()


# ── Fixtures: three industries mentioned in the plan ─────────────────


def _camera_fixture() -> tuple[list[ExtractedData], dict]:
    brands = [
        ExtractedData(
            url="https://camera-obayashi.example/",
            title="カメラの大林",
            h1="中古カメラ販売",
            hero_copy="中古カメラを高く売るなら大林",
            main_cta="無料査定を申し込む",
            pricing_snippet="査定料無料",
            secondary_ctas=["店舗を探す"],
            testimonials=["顧客A", "顧客B"],
            trust_badges=["JCAA認定店"],
            corporate_elements=["運営会社: 株式会社大林"],
            contact_paths=["/contact"],
            review_signals=["口コミ4.7"],
            guarantees=["査定キャンセル無料"],
            offer_terms=["送料無料"],
            promo_claims=["最大30%アップ"],
        ),
        ExtractedData(
            url="https://akasaka-camera.example/",
            hero_copy="中古レンズ専門店アカサカ",
            main_cta="査定する",
            testimonials=["顧客"],
            trust_badges=["認定"],
            contact_paths=["/form"],
        ),
        ExtractedData(
            url="https://nisshindo-camera.example/",
            hero_copy="ONLINE MAGAZINE",
            # Intentionally sparse — this is the "評価保留 vs 実競合" case.
        ),
    ]
    meta = {"industry": "中古カメラ 買取", "market_keywords": ["カメラ", "一眼レフ"]}
    return brands, meta


def _sports_fixture() -> tuple[list[ExtractedData], dict]:
    brands = [
        ExtractedData(
            url="https://saurus.example/",
            hero_copy="ランナー向けプロテイン",
            main_cta="購入する",
            pricing_snippet="¥5,980",
            testimonials=["選手A"],
            trust_badges=["第三者認証"],
        ),
        ExtractedData(
            url="https://zentplus.example/",
            hero_copy="スポーツサプリの定番",
            main_cta="定期購入",
            pricing_snippet="¥4,500",
            testimonials=["アスリート"],
        ),
        ExtractedData(
            url="https://runteam.example/",
            hero_copy="EAA プロテイン",
            main_cta="公式",
        ),
    ]
    meta = {"industry": "スポーツサプリメント", "market_keywords": ["プロテイン", "BCAA"]}
    return brands, meta


def _waterworks_fixture() -> tuple[list[ExtractedData], dict]:
    brands = [
        ExtractedData(
            url="https://hits-online.example/",
            hero_copy="水漏れ修理なら即日対応",
            main_cta="24時間無料見積り",
            testimonials=["A様", "B様"],
            guarantees=["修理保証1年"],
            contact_paths=["/contact"],
        ),
        ExtractedData(
            url="https://waterworkscro.example/",
            hero_copy="水回りリフォームのプロ",
            main_cta="相談する",
            trust_badges=["指定工事店"],
            contact_paths=["/form"],
        ),
        ExtractedData(
            url="https://toiretc.example/",
            hero_copy="トイレ交換 最短当日",
            main_cta="見積もり",
            pricing_snippet="¥20,000〜",
        ),
    ]
    meta = {"industry": "水回り 修理", "market_keywords": ["水漏れ", "トイレ"]}
    return brands, meta


_FIXTURES = {
    "camera": _camera_fixture,
    "sports_supplement": _sports_fixture,
    "waterworks": _waterworks_fixture,
}


def _shared_block(prompt: str) -> str:
    start = prompt.index("## 事前判定結果（参照必須）")
    end = prompt.index("## 分析対象サイト", start)
    return prompt[start:end]


def _market_block(prompt: str) -> str:
    start = prompt.index("## 市場推定データ（参照必須）")
    end = prompt.index("## 分析対象サイト", start)
    return prompt[start:end]


@pytest.mark.parametrize("fixture_key", list(_FIXTURES))
def test_deep_and_wide_emit_same_judgment_block(fixture_key):
    brands, meta = _FIXTURES[fixture_key]()
    deep = build_deep_comparison_prompt(brands, discovery_metadata=meta)
    wide = build_wide_comparison_prompt(brands, discovery_metadata=meta)
    assert _shared_block(deep) == _shared_block(wide)


@pytest.mark.parametrize("fixture_key", list(_FIXTURES))
def test_deep_and_wide_emit_same_market_block(fixture_key):
    brands, meta = _FIXTURES[fixture_key]()
    deep = build_deep_comparison_prompt(brands, discovery_metadata=meta)
    wide = build_wide_comparison_prompt(brands, discovery_metadata=meta)
    assert _market_block(deep) == _market_block(wide)


@pytest.mark.parametrize("fixture_key", list(_FIXTURES))
def test_standalone_evaluate_all_matches_injected_block(fixture_key):
    brands, meta = _FIXTURES[fixture_key]()
    deep = build_deep_comparison_prompt(brands, discovery_metadata=meta)
    evaluations = evaluate_all(brands)
    expected = format_judgment_block(evaluations)
    assert expected in deep


@pytest.mark.parametrize("fixture_key", list(_FIXTURES))
def test_standalone_market_estimate_matches_injected_block(fixture_key):
    brands, meta = _FIXTURES[fixture_key]()
    deep = build_deep_comparison_prompt(brands, discovery_metadata=meta)
    est = estimate(
        meta.get("industry"),
        brands=brands,
        keywords=meta.get("market_keywords"),
    )
    expected = format_market_estimate_block(est)
    assert expected in deep


def test_camera_fixture_ships_low_quality_brand_as_defer():
    brands, _ = _camera_fixture()
    evaluations = evaluate_all(brands)
    # nisshindo — the ONLINE MAGAZINE brand — should be 弱 on fv_appeal,
    # which prevents it being silently promoted to 実競合 in either report.
    nisshindo = next(e for e in evaluations if "nisshindo" in e.url)
    fv = nisshindo.verdict_for("fv_appeal")
    assert fv is not None
    assert fv.verdict == "弱"


def test_market_numbers_do_not_vary_with_retry():
    brands, meta = _camera_fixture()
    a = estimate(meta["industry"], brands=brands, keywords=meta.get("market_keywords"))
    b = estimate(meta["industry"], brands=brands, keywords=meta.get("market_keywords"))
    assert a == b
    # Key numeric invariants
    assert a.market_size_jpy.min == b.market_size_jpy.min
    assert a.monthly_search_volume.max == b.monthly_search_volume.max
    assert a.ad_spend_monthly_jpy.min == b.ad_spend_monthly_jpy.min


def test_judgment_block_has_six_axes_and_one_row_per_brand():
    brands, meta = _camera_fixture()
    prompt = build_deep_comparison_prompt(brands, discovery_metadata=meta)
    block = _shared_block(prompt)
    axis_header = "| ブランド | 信頼階層 | 検索意図一致 | FV訴求 | CTA明確性 | 信頼構築 | 価格・オファー | 購買導線 |"
    assert axis_header in block
    # Scope to the judgment table only: from axis_header to the next blank line or next ## heading
    header_idx = block.index(axis_header)
    after_header = block[header_idx:]
    lines = after_header.split("\n")
    table_rows = []
    for line in lines:
        if line.startswith("| "):
            table_rows.append(line)
        elif table_rows and not line.startswith("|"):
            break
    # header + separator + 3 brands = 5
    assert len(table_rows) == 2 + len(brands)


def test_shared_blocks_always_emitted_post_A8():
    """After A-8 the shared evaluation path is unconditional — both blocks must
    appear with no feature-flag branching."""
    brands, meta = _camera_fixture()
    prompt = build_deep_comparison_prompt(brands, discovery_metadata=meta)
    assert "## 事前判定結果（参照必須）" in prompt
    assert "## 市場推定データ（参照必須）" in prompt
