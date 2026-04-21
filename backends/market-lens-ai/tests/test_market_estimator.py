"""Unit tests for the market estimator."""

from __future__ import annotations

import pytest

from web.app.market_estimator import (
    MarketEstimate,
    classify_industry,
    estimate,
    format_market_estimate_block,
    load_industry_priors,
)


@pytest.fixture(autouse=True)
def _reset_cache():
    load_industry_priors.cache_clear()
    yield
    load_industry_priors.cache_clear()


def test_classify_by_explicit_key():
    prior = classify_industry("camera_resale")
    assert prior.key == "camera_resale"
    assert "カメラ" in prior.label


def test_classify_by_keyword_in_hint():
    prior = classify_industry("中古カメラの専門店")
    assert prior.key == "camera_resale"


def test_classify_by_keywords_list():
    prior = classify_industry(None, keywords=["プロテイン おすすめ", "BCAA"])
    assert prior.key == "sports_supplement"


def test_classify_falls_back_when_no_match():
    prior = classify_industry("zzz-xyz-no-match-123")
    assert prior.key == "fallback_general"


def test_estimate_returns_full_dataclass_for_cameras():
    est = estimate("camera_resale", brands=["A", "B", "C"])
    assert isinstance(est, MarketEstimate)
    assert est.industry_key == "camera_resale"
    assert est.brand_count == 3
    # Market size range should be positive and ordered
    assert 0 < est.market_size_jpy.min < est.market_size_jpy.max
    # Ad spend should scale with search volume and CPC
    assert est.ad_spend_monthly_jpy.min > 0
    assert est.ad_spend_monthly_jpy.max > est.ad_spend_monthly_jpy.min


def test_estimate_is_deterministic_for_same_input():
    a = estimate("camera_resale", brands=["A", "B", "C"])
    b = estimate("camera_resale", brands=["A", "B", "C"])
    assert a == b
    assert format_market_estimate_block(a) == format_market_estimate_block(b)


def test_compare_and_discovery_paths_agree_on_same_industry():
    # Simulate Compare and Discovery calling with slightly different hints
    # but the same underlying industry → must produce identical estimate.
    via_hint = estimate("中古カメラ 買取", brands=list(range(3)))
    via_key = estimate("camera_resale", brands=list(range(3)))
    assert via_hint.industry_key == via_key.industry_key
    assert via_hint.market_size_jpy == via_key.market_size_jpy
    assert via_hint.monthly_search_volume == via_key.monthly_search_volume


def test_format_block_contains_required_headings():
    est = estimate("camera_resale", brands=["A", "B", "C"])
    block = format_market_estimate_block(est)
    assert "## 市場推定データ（参照必須）" in block
    assert "【市場推定】" in block
    assert "市場規模" in block
    assert "年率成長" in block
    assert "月間検索Vol" in block
    assert "CPC帯" in block
    assert "平均CVR" in block
    assert "推定月間広告費" in block


def test_ad_spend_shrinks_with_more_brands():
    one = estimate("camera_resale", brands=["A"])
    many = estimate("camera_resale", brands=list(range(10)))
    # With more brands the per-brand ad spend estimate falls.
    assert many.ad_spend_monthly_jpy.min < one.ad_spend_monthly_jpy.min
    assert many.ad_spend_monthly_jpy.max < one.ad_spend_monthly_jpy.max


def test_waterworks_maps_correctly():
    est = estimate(None, brands=["A"], keywords=["水漏れ", "トイレ"])
    assert est.industry_key == "waterworks_repair"


def test_it_consulting_maps_correctly():
    est = estimate("ITコンサルティング", brands=["A"])
    assert est.industry_key == "it_consulting"
    assert est.confidence == "medium"
    assert est.market_size_jpy.min >= 600_000_000_000
    assert est.cpc_jpy.min >= 300
    assert est.buying_behavior_template  # template must be non-empty


def test_btob_marketing_consulting_via_keywords():
    est = estimate(None, brands=["A"], keywords=["BtoBマーケティング", "リード獲得"])
    assert est.industry_key == "btob_marketing_consulting"
    assert est.buying_behavior_template


def test_strategy_consulting_maps_correctly():
    est = estimate("経営コンサル", brands=["A"])
    assert est.industry_key == "strategy_consulting"
