"""Tests for keyword extractor (M5.2)."""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock, patch

import pytest

from web.app.models import ExtractedData
from web.app.services.discovery.keyword_extractor import (
    classify_industry,
    extract_domain,
    extract_search_queries,
)


def _make_extracted(**kwargs) -> ExtractedData:
    defaults = {
        "url": "https://example.com",
        "title": "",
        "meta_description": "",
        "h1": "",
        "feature_bullets": [],
    }
    defaults.update(kwargs)
    return ExtractedData(**defaults)


class TestExtractSearchQueries:
    """Tests for extract_search_queries()."""

    def test_basic_url(self):
        queries = extract_search_queries("https://example.com")
        assert len(queries) == 3
        assert "example competitors" in queries
        assert "example alternatives" in queries
        assert "sites like example" in queries

    def test_www_prefix_stripped(self):
        queries = extract_search_queries("https://www.mybrand.com")
        assert all("mybrand" in q for q in queries)
        assert not any("www" in q for q in queries)

    def test_subdomain(self):
        queries = extract_search_queries("https://shop.mybrand.co.jp")
        # Should extract 'mybrand' as the meaningful part
        assert any("mybrand" in q for q in queries)

    def test_path_ignored(self):
        queries = extract_search_queries("https://example.com/products/category")
        assert all("example" in q for q in queries)

    def test_empty_url_returns_empty(self):
        queries = extract_search_queries("")
        assert queries == []

    def test_no_hostname(self):
        queries = extract_search_queries("not-a-url")
        assert queries == []

    def test_content_aware_with_industry(self):
        """When industry is provided, generates industry-aware queries."""
        extracted = _make_extracted(title="HITS Online Shop")
        queries = extract_search_queries(
            "https://hits-online.jp", extracted, industry="高級水回り設備EC"
        )
        assert any("高級水回り設備EC" in q for q in queries)
        assert len(queries) <= 5

    def test_content_aware_with_extracted_only(self):
        """When extracted data is provided but no industry, uses content keywords."""
        extracted = _make_extracted(
            title="Premium Bathroom Fixtures Store",
            h1="Luxury Faucets & Showers",
        )
        queries = extract_search_queries("https://example.com", extracted)
        assert len(queries) >= 1
        # Should include brand fallback
        assert any("example" in q.lower() for q in queries)

    def test_content_aware_always_includes_brand_fallback(self):
        """Content-aware queries always include brand-name fallback."""
        extracted = _make_extracted(title="Test Site")
        queries = extract_search_queries(
            "https://mybrand.com", extracted, industry="SaaS"
        )
        assert any("mybrand" in q.lower() for q in queries)

    def test_content_aware_deduplicates(self):
        """Content-aware queries are deduplicated."""
        extracted = _make_extracted(title="Test")
        queries = extract_search_queries(
            "https://test.com", extracted, industry="test competitors"
        )
        lower_queries = [q.lower() for q in queries]
        assert len(lower_queries) == len(set(lower_queries))

    def test_fallback_when_no_extracted_no_industry(self):
        """With no extracted data and no industry, falls back to domain-only."""
        queries = extract_search_queries("https://mybrand.com", None, "")
        assert queries == [
            "mybrand competitors",
            "mybrand alternatives",
            "sites like mybrand",
        ]

    def test_generates_specialist_query(self):
        """Industry provided generates '専門 通販' pattern."""
        extracted = _make_extracted(title="Test Shop")
        queries = extract_search_queries(
            "https://test.com", extracted, industry="プロテイン"
        )
        assert any("専門 通販" in q for q in queries)

    def test_generates_review_query(self):
        """Extracted keywords generate '比較 口コミ' pattern."""
        extracted = _make_extracted(
            title="SAURUS Japan",
            h1="高品質プロテイン",
            meta_description="スポーツ栄養サプリメント",
        )
        queries = extract_search_queries(
            "https://saurus.jp", extracted, industry="プロテイン"
        )
        assert any("比較 口コミ" in q for q in queries)

    def test_max_5_queries(self):
        """Content-aware queries are capped at 5."""
        extracted = _make_extracted(
            title="Brand Product Store Online",
            h1="Welcome to our shop",
            meta_description="Best products available",
        )
        queries = extract_search_queries(
            "https://brand.com", extracted, industry="サプリメント"
        )
        assert len(queries) <= 5

    def test_deduplication_content_aware(self):
        """Content-aware queries are deduplicated."""
        extracted = _make_extracted(title="Test")
        queries = extract_search_queries(
            "https://test.com", extracted, industry="test competitors"
        )
        lower_queries = [q.lower() for q in queries]
        assert len(lower_queries) == len(set(lower_queries))


class TestExtractDomain:
    """Tests for extract_domain()."""

    def test_basic(self):
        assert extract_domain("https://example.com/page") == "example.com"

    def test_www_stripped(self):
        assert extract_domain("https://www.example.com") == "example.com"

    def test_with_port(self):
        assert extract_domain("https://example.com:8080/page") == "example.com"

    def test_empty(self):
        assert extract_domain("") == ""


class TestClassifyIndustry:
    """Tests for classify_industry()."""

    @pytest.mark.asyncio
    async def test_returns_industry_string(self):
        """classify_industry returns a short industry string."""
        extracted = _make_extracted(
            title="TOTO Online Shop",
            meta_description="高品質な水回り設備の通販",
            h1="水回りのTOTO",
        )
        with patch(
            "web.app.services.discovery.keyword_extractor.call_text_model",
            new_callable=AsyncMock,
            return_value=("水回り設備EC", Mock()),
        ):
            result = await classify_industry(extracted, "test-key")
            assert result == "水回り設備EC"

    @pytest.mark.asyncio
    async def test_returns_empty_on_api_failure(self):
        """classify_industry returns empty string on API failure."""
        extracted = _make_extracted(title="Test Site")

        with patch(
            "web.app.services.discovery.keyword_extractor.call_text_model",
            new_callable=AsyncMock,
            side_effect=Exception("API Error"),
        ):
            result = await classify_industry(extracted, "test-key")
            assert result == ""

    @pytest.mark.asyncio
    async def test_returns_empty_on_no_content(self):
        """classify_industry returns empty string when no content is available."""
        extracted = _make_extracted()  # all empty
        result = await classify_industry(extracted, "test-key")
        assert result == ""

    @pytest.mark.asyncio
    async def test_truncates_long_response(self):
        """classify_industry returns empty for excessively long responses."""
        extracted = _make_extracted(title="Test")
        with patch(
            "web.app.services.discovery.keyword_extractor.call_text_model",
            new_callable=AsyncMock,
            return_value=("x" * 200, Mock()),
        ):
            result = await classify_industry(extracted, "test-key")
            assert result == ""

    @pytest.mark.asyncio
    async def test_prefers_discovery_specific_model_over_legacy_analysis_model(self, monkeypatch):
        extracted = _make_extracted(title="Test")

        monkeypatch.setenv("ANTHROPIC_DISCOVERY_CLASSIFY_MODEL", "claude-discovery-classify")
        monkeypatch.setenv("ANTHROPIC_DISCOVERY_SEARCH_MODEL", "claude-discovery-search")
        monkeypatch.setenv("ANTHROPIC_ANALYSIS_MODEL", "claude-legacy-analysis")

        with patch(
            "web.app.services.discovery.keyword_extractor.call_text_model",
            new_callable=AsyncMock,
            return_value=("SaaS", Mock()),
        ) as mock_call:
            result = await classify_industry(extracted, "test-key")

        assert result == "SaaS"
        assert mock_call.await_args.kwargs["model"] == "claude-discovery-classify"
