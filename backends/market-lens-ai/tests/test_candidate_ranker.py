"""Tests for candidate ranker (M5.2)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from web.app.services.discovery.candidate_ranker import (
    RankedCandidate,
    classify_competitive_tiers,
    rank_candidates,
    validate_candidates_with_llm,
)
from web.app.services.discovery.search_client import SearchResult


def _sr(url: str, title: str = "", snippet: str = "") -> SearchResult:
    return SearchResult(url=url, title=title, snippet=snippet)


class TestRankCandidates:
    """Tests for rank_candidates()."""

    def test_brand_domain_excluded(self):
        results = [
            _sr("https://mybrand.com/page", "My Brand", "Our site"),
            _sr("https://competitor.com", "Comp", "A competitor"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        assert len(ranked) == 1
        assert ranked[0].domain == "competitor.com"

    def test_basic_scoring(self):
        results = [
            _sr("https://comp.com", "Title", "Some snippet"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        assert len(ranked) == 1
        # base(50) + title(10) + snippet(10) = 70
        assert ranked[0].score == 70

    def test_competitor_keyword_bonus(self):
        results = [
            _sr("https://comp.com", "Title", "A great alternative to Brand"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        # base(50) + title(10) + snippet(10) + keyword(15) = 85
        assert ranked[0].score == 85

    def test_no_title_no_snippet(self):
        results = [
            _sr("https://comp.com"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        # base(50) only
        assert ranked[0].score == 50

    def test_sorted_by_score_desc(self):
        results = [
            _sr("https://low.com", "", ""),  # score=50
            _sr("https://high.com", "Title", "alternative comparison"),  # score=85
            _sr("https://mid.com", "Title", "snippet"),  # score=70
        ]
        ranked = rank_candidates(results, "mybrand.com")
        scores = [r.score for r in ranked]
        assert scores == sorted(scores, reverse=True)
        assert ranked[0].domain == "high.com"

    def test_empty_results(self):
        ranked = rank_candidates([], "mybrand.com")
        assert ranked == []

    def test_all_brand_results_excluded(self):
        results = [
            _sr("https://mybrand.com/page1"),
            _sr("https://mybrand.com/page2"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        assert ranked == []

    def test_score_capped_at_100(self):
        """Score should never exceed 100."""
        results = [
            _sr(
                "https://comp.co.uk",
                "Great Title",
                "The best alternative vs competitor compare rival",
            ),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        assert ranked[0].score <= 100

    def test_industry_keyword_bonus(self):
        """Industry keyword match adds +20 score."""
        results = [
            _sr("https://comp.com", "水回り設備の通販", "バスルーム商品"),
        ]
        ranked = rank_candidates(results, "mybrand.com", industry_keywords=["水回り", "設備"])
        # base(50) + title(10) + snippet(10) + lp_signal(10, '通販') + industry(20) = 100 (capped)
        assert ranked[0].score == 100

    def test_industry_keyword_no_match(self):
        """No industry keyword match applies -15 mismatch penalty."""
        results = [
            _sr("https://comp.com", "Trading Cards Store", "Buy cards online"),
        ]
        ranked = rank_candidates(results, "mybrand.com", industry_keywords=["水回り", "設備"])
        # base(50) + title(10) + snippet(10) + lp_signal(10, 'store') - mismatch(15) = 65
        assert ranked[0].score == 65

    def test_industry_keywords_none(self):
        """Passing None for industry_keywords has no effect (backward compat)."""
        results = [
            _sr("https://comp.com", "Title", "Snippet"),
        ]
        ranked = rank_candidates(results, "mybrand.com", industry_keywords=None)
        assert ranked[0].score == 70

    def test_industry_keywords_reranks(self):
        """Industry keywords change ranking order."""
        results = [
            _sr("https://unrelated.com", "Card Games", "Trading card marketplace"),
            _sr("https://relevant.com", "水回り設備EC", "バスルーム通販"),
        ]
        ranked = rank_candidates(results, "mybrand.com", industry_keywords=["水回り"])
        assert ranked[0].domain == "relevant.com"

    def test_industry_short_keywords_ignored(self):
        """Single-char keywords are ignored to avoid false matches."""
        results = [
            _sr("https://comp.com", "Title", "Snippet"),
        ]
        ranked = rank_candidates(results, "mybrand.com", industry_keywords=["a", "x"])
        # No bonus since single-char keywords are filtered out (no penalty either)
        assert ranked[0].score == 70

    def test_japanese_competitor_keyword_bonus(self):
        """Japanese competitor keywords ('競合', '比較' etc.) trigger +15 bonus."""
        results = [
            _sr("https://comp.com", "サービス比較", "競合他社との比較サイト"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        # base(50) + title(10) + snippet(10) + keyword(15) = 85
        assert ranked[0].score == 85

    def test_industry_mismatch_penalty(self):
        """Industry mismatch applies -15 penalty to push unrelated sites down."""
        results = [
            _sr("https://match.com", "高級水回り設備", "バスルーム通販"),
            _sr("https://nomatch.com", "中古カードショップ", "トレカ販売"),
        ]
        ranked = rank_candidates(
            results, "mybrand.com", industry_keywords=["水回り設備"]
        )
        # match: base(50) + title(10) + snippet(10) + lp_signal(10, '通販') + industry(20) = 100 (capped)
        # nomatch: base(50) + title(10) + snippet(10) + lp_signal(10, 'ショップ') - mismatch(15) = 65
        assert ranked[0].domain == "match.com"
        assert ranked[0].score == 100
        assert ranked[1].domain == "nomatch.com"
        assert ranked[1].score == 65

    def test_score_floor_at_zero(self):
        """Score should never go below 0."""
        results = [
            _sr("https://comp.com"),  # no title, no snippet → base 50
        ]
        # Give many industry keywords to trigger penalty on empty content
        ranked = rank_candidates(results, "mybrand.com", industry_keywords=["niche_keyword"])
        # base(50) - mismatch(15) = 35 (above 0, but verify floor works)
        assert ranked[0].score >= 0

    def test_domain_deduplication(self):
        """Same domain from multiple pages should be deduped to highest-scoring."""
        results = [
            _sr("https://comp.com/page1", "Title", "snippet"),    # 70
            _sr("https://comp.com/page2", "Another", "different"), # 70
            _sr("https://other.com", "Other", "snippet"),          # 70
        ]
        ranked = rank_candidates(results, "mybrand.com")
        domains = [r.domain for r in ranked]
        assert domains.count("comp.com") == 1
        assert "other.com" in domains

    def test_marketplace_domain_penalty(self):
        """Amazon and similar marketplace domains should rank lower."""
        results = [
            _sr("https://amazon.co.jp/dp/B001", "Product", "Buy this"),
            _sr("https://directcomp.com", "Direct Competitor", "Official store"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        # directcomp should rank higher than amazon
        assert ranked[0].domain == "directcomp.com"

    def test_lp_keyword_bonus(self):
        """LP signal keywords like '公式' and 'official' boost score."""
        results = [
            _sr("https://official.com", "公式オンラインショップ", "公式通販サイト"),
            _sr("https://generic.com", "Generic Site", "Some content"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        official = next(r for r in ranked if r.domain == "official.com")
        generic = next(r for r in ranked if r.domain == "generic.com")
        assert official.score > generic.score

    # --- B-1: Extended blocklist tests ---

    def test_monotaro_blocked(self):
        """B-1: MonotaRO (総合EC) should be penalized as non-competitor."""
        results = [
            _sr("https://monotaro.com/g/サプリメント/", "サプリメント通販", "工業用品の通販"),
            _sr("https://directcomp.com", "サプリ公式", "専門サプリ通販"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        assert ranked[0].domain == "directcomp.com"

    def test_prtimes_blocked(self):
        """B-1: PR Times (メディア) should be penalized."""
        results = [
            _sr("https://prtimes.jp/main/html/rd/p/000000001.html", "プレスリリース", "新製品発表"),
            _sr("https://directcomp.com", "Title", "snippet"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        assert ranked[0].domain == "directcomp.com"

    # --- B-2: Non-competitor signal keyword tests ---

    def test_consulting_penalty(self):
        """B-2: Consulting sites should be penalized."""
        results = [
            _sr("https://consulting.com", "海外進出コンサルティング", "市場調査レポート"),
            _sr("https://directcomp.com", "Title", "snippet"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        assert ranked[0].domain == "directcomp.com"

    def test_media_report_penalty(self):
        """B-2: Market research/media sites should be penalized."""
        results = [
            _sr("https://research.com", "市場規模レポート", "調査結果まとめ"),
            _sr("https://directcomp.com", "Title", "snippet"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        assert ranked[0].domain == "directcomp.com"

    # --- B-3: Industry keyword match refinement ---

    def test_industry_title_match_stronger_than_snippet(self):
        """B-3: Title match gives +20, snippet-only gives +8."""
        results = [
            _sr("https://title-match.com", "スポーツサプリメント公式", "プロテイン販売"),
            _sr("https://snippet-match.com", "健康食品ストア", "スポーツサプリメントも取扱い"),
        ]
        ranked = rank_candidates(
            results, "mybrand.com", industry_keywords=["スポーツサプリメント"]
        )
        title_site = next(r for r in ranked if r.domain == "title-match.com")
        snippet_site = next(r for r in ranked if r.domain == "snippet-match.com")
        assert title_site.score > snippet_site.score

    def test_general_ec_pattern_penalty(self):
        """B-3: General EC patterns like '法人向け', '万点' should be penalized."""
        results = [
            _sr("https://general-ec.com", "法人向け業務用サイト", "75万点の品揃え"),
            _sr("https://directcomp.com", "Title", "snippet"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        general = next(r for r in ranked if r.domain == "general-ec.com")
        direct = next(r for r in ranked if r.domain == "directcomp.com")
        assert direct.score > general.score

    # --- B-5: Article path penalty tests ---

    def test_blog_path_penalty(self):
        """B-5: URLs with /blog/ path should be penalized."""
        results = [
            _sr("https://comp.com/blog/supplements-review", "Title", "snippet"),
            _sr("https://comp2.com/", "Title", "snippet"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        blog_site = next(r for r in ranked if r.domain == "comp.com")
        root_site = next(r for r in ranked if r.domain == "comp2.com")
        assert root_site.score > blog_site.score

    def test_news_path_penalty(self):
        """B-5: URLs with /news/ path should be penalized."""
        results = [
            _sr("https://comp.com/news/article123", "Title", "snippet"),
            _sr("https://comp2.com/", "Title", "snippet"),
        ]
        ranked = rank_candidates(results, "mybrand.com")
        assert ranked[0].domain == "comp2.com"


# --- D-1: LLM candidate validation tests ---

class TestValidateCandidatesWithLlm:
    """Tests for validate_candidates_with_llm()."""

    @pytest.mark.asyncio
    async def test_filters_non_competitors(self):
        """D-1: LLM validation should filter out non-competitors."""
        candidates = [
            RankedCandidate("https://comp1.com", "comp1.com", "Real Competitor", "snippet", 90),
            RankedCandidate("https://fake.com", "fake.com", "Not A Competitor", "snippet", 85),
        ]
        mock_response = "comp1.com: YES\nfake.com: NO"
        with patch(
            "web.app.llm_client.call_text_model",
            new_callable=AsyncMock,
            return_value=(mock_response, None),
        ):
            result = await validate_candidates_with_llm(
                candidates, "mybrand.com", "サプリメント", "test-key"
            )
            domains = [c.domain for c in result]
            assert "comp1.com" in domains
            assert "fake.com" not in domains

    @pytest.mark.asyncio
    async def test_returns_all_on_api_failure(self):
        """D-1: Returns unfiltered candidates when LLM call fails."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "Title", "snippet", 90),
        ]
        with patch(
            "web.app.llm_client.call_text_model",
            new_callable=AsyncMock,
            side_effect=Exception("API Error"),
        ):
            result = await validate_candidates_with_llm(
                candidates, "mybrand.com", "サプリメント", "test-key"
            )
            assert len(result) == 1

    @pytest.mark.asyncio
    async def test_returns_all_when_no_industry(self):
        """D-1: Returns unfiltered candidates when no industry is provided."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "Title", "snippet", 90),
        ]
        result = await validate_candidates_with_llm(
            candidates, "mybrand.com", "", "test-key"
        )
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_returns_all_on_unparseable_response(self):
        """D-1: Returns unfiltered candidates when response can't be parsed."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "Title", "snippet", 90),
        ]
        with patch(
            "web.app.llm_client.call_text_model",
            new_callable=AsyncMock,
            return_value=("some random text without YES/NO format", None),
        ):
            result = await validate_candidates_with_llm(
                candidates, "mybrand.com", "サプリメント", "test-key"
            )
            assert len(result) == 1


# --- Competitive tier classification tests ---

class TestClassifyCompetitiveTiers:
    """Tests for classify_competitive_tiers()."""

    def test_direct_tier_high_score_industry_match(self):
        """High score + industry keyword → direct competitor."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "プロテイン公式通販", "サプリメント", 75),
        ]
        classify_competitive_tiers(candidates, industry_keywords=["プロテイン"])
        assert candidates[0].competitive_tier == "direct"

    def test_indirect_tier_moderate_score(self):
        """Moderate score → indirect."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "Health Store", "vitamins", 50),
        ]
        classify_competitive_tiers(candidates, industry_keywords=["プロテイン"])
        assert candidates[0].competitive_tier == "indirect"

    def test_benchmark_tier_low_score(self):
        """Low score without LP signals → benchmark."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "Random Blog", "content", 25),
        ]
        classify_competitive_tiers(candidates, industry_keywords=["プロテイン"])
        assert candidates[0].competitive_tier == "benchmark"

    def test_lp_signal_promotes_to_indirect(self):
        """LP signals (公式, 送料無料 etc.) should promote to at least indirect."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "公式サイト", "送料無料", 35),
        ]
        classify_competitive_tiers(candidates, industry_keywords=[])
        assert candidates[0].competitive_tier == "indirect"

    def test_tiers_set_during_ranking(self):
        """rank_candidates should set competitive_tier on all results."""
        results = [
            _sr("https://comp1.com/shop", "サプリ公式", "プロテイン 送料無料"),
            _sr("https://comp2.com/", "Blog", "random article"),
        ]
        ranked = rank_candidates(results, "mybrand.com", industry_keywords=["プロテイン"])
        for c in ranked:
            assert c.competitive_tier in ("direct", "indirect", "benchmark")

    def test_no_industry_keywords_graceful(self):
        """Works with empty industry keywords."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "Title", "snippet", 60),
        ]
        classify_competitive_tiers(candidates, industry_keywords=None)
        assert candidates[0].competitive_tier in ("direct", "indirect", "benchmark")

    # ---------- Regression: Fix 3 — LP signal alone must not produce direct ----------

    def test_lp_signal_alone_not_direct(self):
        """LP signal (公式, 送料無料) + high score but NO industry match → indirect, not direct."""
        candidates = [
            RankedCandidate("https://shop.com", "shop.com", "公式ストア", "送料無料 全品", 75),
        ]
        classify_competitive_tiers(candidates, industry_keywords=["プロテイン"])
        assert candidates[0].competitive_tier == "indirect"

    def test_industry_match_required_for_direct(self):
        """Industry keyword match is required for direct tier."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "プロテイン公式", "通販", 65),
        ]
        classify_competitive_tiers(candidates, industry_keywords=["プロテイン"])
        assert candidates[0].competitive_tier == "direct"

    def test_high_score_without_any_signal_is_indirect(self):
        """High score without industry or LP signal → indirect (score >= 40)."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "Generic Site", "random text", 65),
        ]
        classify_competitive_tiers(candidates, industry_keywords=["プロテイン"])
        assert candidates[0].competitive_tier == "indirect"

    def test_industry_match_low_score_promotes_to_indirect(self):
        """Industry match with low score → indirect, not benchmark."""
        candidates = [
            RankedCandidate("https://comp.com", "comp.com", "プロテイン情報", "プロテイン比較", 30),
        ]
        classify_competitive_tiers(candidates, industry_keywords=["プロテイン"])
        assert candidates[0].competitive_tier == "indirect"
