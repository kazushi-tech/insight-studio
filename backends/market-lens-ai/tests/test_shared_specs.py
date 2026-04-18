"""Unit tests for shared_specs YAML loading."""

from __future__ import annotations

import pytest

from web.app.shared_specs import (
    EvaluationAxis,
    EvidenceRule,
    KeywordIntent,
    TrustTier,
    clear_cache,
    load_evaluation_axes,
    load_evidence_labels,
    load_keyword_intent,
    load_trust_hierarchy,
)


@pytest.fixture(autouse=True)
def _clear_spec_cache():
    clear_cache()
    yield
    clear_cache()


def test_load_evaluation_axes_has_six_axes():
    axes = load_evaluation_axes()
    assert len(axes) == 6
    keys = [a.key for a in axes]
    assert keys == [
        "search_intent_match",
        "fv_appeal",
        "cta_clarity",
        "trust_building",
        "price_offer",
        "purchase_flow",
    ]


def test_evaluation_axes_fields_shape():
    axes = load_evaluation_axes()
    fv = next(a for a in axes if a.key == "fv_appeal")
    assert isinstance(fv, EvaluationAxis)
    assert fv.label == "FV訴求"
    assert "hero_copy" in fv.primary_sources
    assert fv.strong_required, "strong_required should be populated"
    assert fv.weak_any, "fv_appeal should have weak_any conditions"


def test_trust_hierarchy_has_five_tiers_ordered_by_weight():
    tiers = load_trust_hierarchy()
    assert len(tiers) == 5
    assert [t.level for t in tiers] == ["L1", "L2", "L3", "L4", "L5"]
    weights = [t.weight for t in tiers]
    assert weights == sorted(weights, reverse=True)
    assert all(isinstance(t, TrustTier) for t in tiers)


def test_keyword_intent_has_five_categories():
    intents = load_keyword_intent()
    assert len(intents) == 5
    labels = [i.label for i in intents]
    assert set(labels) == {"指名", "ブランド非指名", "カテゴリ指名", "カテゴリ非指名", "比較検討"}
    assert all(isinstance(i, KeywordIntent) for i in intents)


def test_evidence_labels_contains_three_tiers():
    rules = load_evidence_labels()
    keys = {r.key for r in rules}
    assert {"confirmed", "estimated", "deferred"} <= keys
    assert all(isinstance(r, EvidenceRule) for r in rules)
    confirmed = next(r for r in rules if r.key == "confirmed")
    assert confirmed.display == "確認済み"
    assert "requires_any_non_empty" in confirmed.raw


def test_loaders_are_cached():
    first = load_evaluation_axes()
    second = load_evaluation_axes()
    assert first is second


def test_clear_cache_reloads():
    first = load_evaluation_axes()
    clear_cache()
    second = load_evaluation_axes()
    assert first is not second
    assert [a.key for a in first] == [a.key for a in second]
