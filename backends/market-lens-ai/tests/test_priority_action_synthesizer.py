"""Tests for priority_action_synthesizer (Phase P1-D)."""

from __future__ import annotations

from web.app.models import ExtractedData
from web.app.priority_action_synthesizer import synthesize_priority_action_block


def _weak_brand(url: str) -> ExtractedData:
    """Brand with content that reliably triggers WEAK verdicts on multiple axes.

    - trust_building → WEAK: four trust sources empty but corporate_elements
      non-empty (avoids DEFER on the all-empty rule).
    - price_offer → WEAK: pricing/offer/promo empty but shipping_signals
      non-empty (avoids DEFER).
    - fv_appeal → WEAK: hero_copy set to a placeholder-style phrase
      (``"MAGAZINE"``) that matches the weak-condition allow-list.
    """
    return ExtractedData(
        url=url,
        title="sample title",
        h1="sample h1",
        hero_copy="MAGAZINE",
        main_cta="買う",
        body_text_snippet="本文" * 20,
        corporate_elements=["実績"],
        shipping_signals=["送料無料"],
        contact_paths=["購入"],
    )


def test_synthesize_priority_action_block_returns_none_without_evidence():
    result = synthesize_priority_action_block([])
    assert result is None


def test_synthesize_priority_action_block_emits_weak_axis_actions():
    block = synthesize_priority_action_block([_weak_brand("https://weak.example")])

    assert block is not None
    assert "### 最優先3施策" in block
    assert "【自動生成】" in block
    bullets = [l for l in block.splitlines() if l.startswith("- ")]
    assert 1 <= len(bullets) <= 3
    for line in bullets:
        assert "対象:" in line
        assert "軸:" in line
        assert "期待効果:" in line
        assert "優先度:" in line


def test_synthesize_priority_action_block_is_deterministic():
    brands = [_weak_brand("https://one.example"), _weak_brand("https://two.example")]
    first = synthesize_priority_action_block(brands)
    second = synthesize_priority_action_block(brands)
    assert first == second


def test_synthesize_priority_action_block_respects_max_items():
    brands = [_weak_brand(f"https://brand{i}.example") for i in range(5)]
    block = synthesize_priority_action_block(brands, max_items=2)
    assert block is not None
    bullets = [l for l in block.splitlines() if l.startswith("- ")]
    assert len(bullets) <= 2
