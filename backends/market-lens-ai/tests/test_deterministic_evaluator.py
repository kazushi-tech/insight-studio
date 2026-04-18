"""Unit tests for deterministic_evaluator."""

from __future__ import annotations

import pytest

from web.app.deterministic_evaluator import (
    VERDICT_DEFER,
    VERDICT_EQUAL,
    VERDICT_STRONG,
    VERDICT_WEAK,
    evaluate_all,
    format_judgment_block,
)
from web.app.models import ExtractedData
from web.app.shared_specs import clear_cache


@pytest.fixture(autouse=True)
def _reset_spec_cache():
    clear_cache()
    yield
    clear_cache()


def _strong_camera_brand() -> ExtractedData:
    return ExtractedData(
        url="https://camera-obayashi.example.jp/",
        title="カメラの大林 | 中古カメラ販売・買取",
        meta_description="中古一眼レフ・ミラーレス・レンズの販売と買取。創業50年の実績。",
        h1="中古カメラ販売・買取専門",
        hero_copy="中古カメラを高く売るなら大林へ",
        main_cta="無料査定を申し込む",
        pricing_snippet="査定料無料・送料無料",
        feature_bullets=["創業50年", "全国対応", "即日査定"],
        secondary_ctas=["店舗を探す", "LINEで査定"],
        testimonials=["X様: 高く買い取ってもらえました", "Y様: 対応が早い"],
        trust_badges=["JCAA認定店"],
        guarantees=["キャンセル無料"],
        offer_terms=["査定手数料無料"],
        promo_claims=["期間限定キャンペーン"],
        shipping_signals=["送料無料"],
        urgency_elements=["本日まで"],
        banner_texts=["最大30%アップ買取"],
        contact_paths=["/contact", "/form"],
        corporate_elements=["運営会社: 株式会社大林", "代表取締役: 大林一郎"],
        review_signals=["Google口コミ 星4.7"],
    )


def _magazine_only_brand() -> ExtractedData:
    # Mimics the "ONLINE MAGAZINE" problem flagged in the plan.
    return ExtractedData(
        url="https://example-magazine.example.jp/",
        hero_copy="ONLINE MAGAZINE",
        h1="",
        main_cta="",
        pricing_snippet="",
    )


def _empty_brand() -> ExtractedData:
    return ExtractedData(url="https://empty.example.jp/")


def test_strong_brand_gets_strong_on_most_axes():
    ev, = evaluate_all([_strong_camera_brand()])
    verdicts = {v.axis_key: v.verdict for v in ev.axis_verdicts}
    # With rich extraction, at least fv_appeal / cta_clarity / trust_building
    # / price_offer / purchase_flow should reach 強 because each has a boost hit.
    strong_keys = [k for k, verdict in verdicts.items() if verdict == VERDICT_STRONG]
    assert "cta_clarity" in strong_keys
    assert "trust_building" in strong_keys
    assert "price_offer" in strong_keys
    assert "purchase_flow" in strong_keys
    # fv_appeal: hero_copy non-empty and >=12 chars with main_cta boost → 強
    assert verdicts["fv_appeal"] == VERDICT_STRONG


def test_magazine_only_hero_is_weak_on_fv():
    ev, = evaluate_all([_magazine_only_brand()])
    fv = ev.verdict_for("fv_appeal")
    assert fv is not None
    assert fv.verdict == VERDICT_WEAK


def test_empty_brand_gets_defer_across_the_board():
    ev, = evaluate_all([_empty_brand()])
    for verdict in ev.axis_verdicts:
        assert verdict.verdict == VERDICT_DEFER


def test_trust_tier_reflects_strongest_signal():
    strong = _strong_camera_brand()
    ev, = evaluate_all([strong])
    # L1 tier is 第三者独立評価 and review_signals/trust_badges fields populate it.
    assert ev.trust_tier == "L1"
    assert ev.trust_tier_label == "第三者独立評価"


def test_trust_tier_falls_back_to_lowest_when_empty():
    ev, = evaluate_all([_empty_brand()])
    assert ev.trust_tier == "L5"


def test_format_judgment_block_is_markdown_table_with_six_axes():
    evaluations = evaluate_all([_strong_camera_brand(), _magazine_only_brand()])
    block = format_judgment_block(evaluations)
    assert "## 事前判定結果（参照必須）" in block
    # Header row present
    assert "検索意図一致" in block
    assert "FV訴求" in block
    assert "購買導線" in block
    # Brand label derived from URL
    assert "camera-obayashi.example.jp" in block


def test_same_input_yields_same_verdicts_reproducibly():
    first = evaluate_all([_strong_camera_brand()])
    second = evaluate_all([_strong_camera_brand()])
    assert first == second
    assert format_judgment_block(first) == format_judgment_block(second)


def test_judgment_block_empty_when_no_evaluations():
    assert format_judgment_block(()) == ""


def test_verdict_boundary_cta_only_yields_equal_or_strong_on_cta():
    # main_cta present but minimal → 同等
    brand = ExtractedData(
        url="https://example.jp/",
        hero_copy="ブランド名のホームページへようこそ",
        main_cta="申込",  # non-empty but min_length=2 boundary
    )
    ev, = evaluate_all([brand])
    cta = ev.verdict_for("cta_clarity")
    assert cta is not None
    # main_cta length==2 satisfies min_length 2 but no boost (no secondary_ctas/contact)
    assert cta.verdict == VERDICT_EQUAL
