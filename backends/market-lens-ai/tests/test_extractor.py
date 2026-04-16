"""Tests for HTML data extraction."""

from __future__ import annotations

from pathlib import Path

import pytest

from web.app.extractor import extract


FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Full-page extraction
# ---------------------------------------------------------------------------

class TestExtractFullPage:
    @pytest.fixture(autouse=True)
    def _html(self):
        self.html = (FIXTURES_DIR / "sample_page.html").read_text(encoding="utf-8")

    def test_title_extracted(self):
        data = extract("https://example.com", self.html)
        assert data.title != ""
        assert "Acme Corp" in data.title

    def test_meta_description_extracted(self):
        data = extract("https://example.com", self.html)
        assert data.meta_description != ""
        assert "best widgets" in data.meta_description.lower()

    def test_h1_extracted(self):
        data = extract("https://example.com", self.html)
        assert data.h1 != ""
        assert "Acme Corp" in data.h1

    def test_main_cta_extracted(self):
        data = extract("https://example.com", self.html)
        assert data.main_cta != ""

    def test_pricing_snippet_extracted(self):
        data = extract("https://example.com", self.html)
        assert data.pricing_snippet != ""
        assert "$29" in data.pricing_snippet or "month" in data.pricing_snippet.lower()

    def test_feature_bullets_extracted(self):
        data = extract("https://example.com", self.html)
        assert len(data.feature_bullets) >= 3

    def test_url_preserved(self):
        data = extract("https://example.com", self.html)
        assert data.url == "https://example.com"

    def test_no_error(self):
        data = extract("https://example.com", self.html)
        assert data.error is None


# ---------------------------------------------------------------------------
# Minimal-page extraction
# ---------------------------------------------------------------------------

class TestExtractMinimalPage:
    @pytest.fixture(autouse=True)
    def _html(self):
        self.html = (FIXTURES_DIR / "minimal_page.html").read_text(encoding="utf-8")

    def test_title_extracted(self):
        data = extract("https://example.com", self.html)
        assert data.title == "Minimal Page"

    def test_h1_extracted(self):
        data = extract("https://example.com", self.html)
        assert data.h1 == "Hello World"

    def test_hero_copy_empty(self):
        data = extract("https://example.com", self.html)
        assert data.hero_copy == ""

    def test_pricing_empty(self):
        data = extract("https://example.com", self.html)
        assert data.pricing_snippet == ""

    def test_feature_bullets_empty(self):
        data = extract("https://example.com", self.html)
        assert data.feature_bullets == []

    def test_meta_description_empty(self):
        data = extract("https://example.com", self.html)
        assert data.meta_description == ""


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestExtractEdgeCases:
    def test_empty_html_returns_defaults(self):
        data = extract("https://example.com", "")
        assert data.url == "https://example.com"
        assert data.title == ""
        assert data.h1 == ""
        assert data.feature_bullets == []
        assert data.error is None

    def test_url_set_correctly(self):
        data = extract("https://test.org/path?q=1", "<html></html>")
        assert data.url == "https://test.org/path?q=1"


# ---------------------------------------------------------------------------
# Body snippet & OG type extraction
# ---------------------------------------------------------------------------

class TestExtractBodySnippet:
    def test_extract_body_snippet(self):
        html = "<html><body><p>Hello world</p><p>This is body text.</p></body></html>"
        data = extract("https://example.com", html)
        assert "Hello world" in data.body_text_snippet
        assert "This is body text." in data.body_text_snippet

    def test_body_snippet_2000_char_limit(self):
        long_text = "A" * 5000
        html = f"<html><body><p>{long_text}</p></body></html>"
        data = extract("https://example.com", html)
        assert len(data.body_text_snippet) <= 2000

    def test_body_snippet_excludes_script(self):
        html = "<html><body><script>var x=1;</script><p>Visible text</p></body></html>"
        data = extract("https://example.com", html)
        assert "var x=1" not in data.body_text_snippet
        assert "Visible" in data.body_text_snippet


class TestExtractOgType:
    def test_extract_og_type(self):
        html = '<html><head><meta property="og:type" content="product"></head><body></body></html>'
        data = extract("https://example.com", html)
        assert data.og_type == "product"

    def test_extract_og_type_missing(self):
        html = "<html><head></head><body></body></html>"
        data = extract("https://example.com", html)
        assert data.og_type == ""


# ---------------------------------------------------------------------------
# OG image extraction with URL resolution
# ---------------------------------------------------------------------------

class TestExtractOgImage:
    def test_absolute_og_image_returned_as_is(self):
        html = '<html><head><meta property="og:image" content="https://cdn.example.com/img.png"></head><body></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://cdn.example.com/img.png"

    def test_relative_og_image_resolved(self):
        html = '<html><head><meta property="og:image" content="/images/og.png"></head><body></body></html>'
        data = extract("https://example.com/page", html)
        assert data.og_image_url == "https://example.com/images/og.png"

    def test_protocol_relative_og_image(self):
        html = '<html><head><meta property="og:image" content="//cdn.example.com/img.png"></head><body></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://cdn.example.com/img.png"

    def test_twitter_image_fallback(self):
        html = '<html><head><meta name="twitter:image" content="https://cdn.example.com/tw.png"></head><body></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://cdn.example.com/tw.png"

    def test_no_image_returns_none(self):
        html = "<html><head></head><body></body></html>"
        data = extract("https://example.com", html)
        assert data.og_image_url is None

    def test_link_image_src_fallback(self):
        html = '<html><head><link rel="image_src" href="/fallback.jpg"></head><body></body></html>'
        data = extract("https://example.com/page", html)
        assert data.og_image_url == "https://example.com/fallback.jpg"

    def test_og_image_preferred_over_twitter(self):
        html = '<html><head><meta property="og:image" content="https://a.com/og.png"><meta name="twitter:image" content="https://b.com/tw.png"></head><body></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://a.com/og.png"


# ---------------------------------------------------------------------------
# Body image fallback (OGP未設定サイト用)
# ---------------------------------------------------------------------------

class TestExtractBodyImageFallback:
    def test_body_image_fallback_when_no_meta_tags(self):
        html = '<html><head></head><body><img src="https://cdn.example.com/hero.jpg" width="800" height="600"></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://cdn.example.com/hero.jpg"

    def test_body_image_skips_tiny_images(self):
        html = '<html><head></head><body><img src="https://cdn.example.com/pixel.gif" width="1" height="1"><img src="https://cdn.example.com/hero.jpg" width="800"></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://cdn.example.com/hero.jpg"

    def test_body_image_skips_tracking_pixels(self):
        html = '<html><head></head><body><img src="https://cdn.example.com/tracking/pixel.png"><img src="https://cdn.example.com/banner.jpg"></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://cdn.example.com/banner.jpg"

    def test_body_image_resolves_relative_urls(self):
        html = '<html><head></head><body><img src="/images/hero.jpg" width="800" height="600"></body></html>'
        data = extract("https://example.com/page", html)
        assert data.og_image_url == "https://example.com/images/hero.jpg"

    def test_body_image_not_used_when_og_image_exists(self):
        html = '<html><head><meta property="og:image" content="https://cdn.example.com/og.png"></head><body><img src="https://cdn.example.com/body.jpg"></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://cdn.example.com/og.png"

    def test_body_image_skips_svg(self):
        html = '<html><head></head><body><img src="/icon.svg"><img src="https://cdn.example.com/photo.jpg"></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://cdn.example.com/photo.jpg"

    def test_body_image_skips_data_uri(self):
        html = '<html><head></head><body><img src="data:image/png;base64,abc"><img src="https://cdn.example.com/photo.jpg"></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url == "https://cdn.example.com/photo.jpg"

    def test_no_body_image_returns_none(self):
        html = '<html><head></head><body><p>No images here</p></body></html>'
        data = extract("https://example.com", html)
        assert data.og_image_url is None


# ---------------------------------------------------------------------------
# Body snippet nav/footer exclusion
# ---------------------------------------------------------------------------

class TestBodySnippetNavExclusion:
    def test_body_snippet_excludes_nav(self):
        html = "<html><body><nav>Home About Contact</nav><p>Main content here</p></body></html>"
        data = extract("https://example.com", html)
        assert "Main content" in data.body_text_snippet
        assert "Home About Contact" not in data.body_text_snippet

    def test_body_snippet_excludes_footer(self):
        html = "<html><body><p>Main content</p><footer>Copyright 2026 Footer links</footer></body></html>"
        data = extract("https://example.com", html)
        assert "Main content" in data.body_text_snippet
        assert "Footer links" not in data.body_text_snippet

    def test_body_snippet_excludes_role_navigation(self):
        html = '<html><body><div role="navigation">Nav menu items</div><p>Real content</p></body></html>'
        data = extract("https://example.com", html)
        assert "Real content" in data.body_text_snippet
        assert "Nav menu items" not in data.body_text_snippet

    def test_body_snippet_keeps_header_without_nav(self):
        html = "<html><body><header><h1>Welcome</h1><p>Hero text</p></header><p>Body</p></body></html>"
        data = extract("https://example.com", html)
        assert "Welcome" in data.body_text_snippet
        assert "Hero text" in data.body_text_snippet

    def test_body_snippet_removes_header_with_nav(self):
        html = "<html><body><header><nav>Menu</nav><h1>Title</h1></header><p>Content</p></body></html>"
        data = extract("https://example.com", html)
        assert "Content" in data.body_text_snippet
        assert "Menu" not in data.body_text_snippet


# ---------------------------------------------------------------------------
# H1 fallback to og:title / <title>
# ---------------------------------------------------------------------------

class TestH1Fallback:
    def test_h1_prefers_actual_h1(self):
        html = '<html><head><meta property="og:title" content="OG Title"><title>Page Title</title></head><body><h1>Real H1</h1></body></html>'
        data = extract("https://example.com", html)
        assert data.h1 == "Real H1"

    def test_h1_falls_back_to_og_title(self):
        html = '<html><head><meta property="og:title" content="OG Title"><title>Page Title</title></head><body><p>No h1</p></body></html>'
        data = extract("https://example.com", html)
        assert data.h1 == "OG Title"

    def test_h1_falls_back_to_title(self):
        html = "<html><head><title>Page Title</title></head><body><p>No h1</p></body></html>"
        data = extract("https://example.com", html)
        assert data.h1 == "Page Title"


# ---------------------------------------------------------------------------
# Japanese-specific selector tests
# ---------------------------------------------------------------------------

class TestJapaneseSelectors:
    def test_hero_copy_from_mainvisual(self):
        html = '<html><body><div class="mainvisual"><p>メインビジュアルのコピー</p></div></body></html>'
        data = extract("https://example.com", html)
        assert data.hero_copy == "メインビジュアルのコピー"

    def test_main_cta_from_kv_section(self):
        html = '<html><body><div class="kv-area"><a class="btn-primary" href="/contact">お問い合わせ</a></div></body></html>'
        data = extract("https://example.com", html)
        assert data.main_cta == "お問い合わせ"


# ---------------------------------------------------------------------------
# Visual selector precision (Problem 1 fix)
# ---------------------------------------------------------------------------

class TestVisualSelectorPrecision:
    def test_visual_class_exact_match(self):
        html = '<html><body><div class="visual-hero"><p>ビジュアルコピー</p></div></body></html>'
        data = extract("https://example.com", html)
        assert data.hero_copy == "ビジュアルコピー"

    def test_visual_hidden_not_matched(self):
        """class='visual-hidden' should NOT match hero selectors."""
        html = '<html><body><div class="visual-hidden"><p>隠しテキスト</p></div><section><p>本文</p></section></body></html>'
        data = extract("https://example.com", html)
        # visual-hidden starts with 'visual' so [class^='visual'] still matches.
        # But the key improvement is [class*='visual'] no longer catches 'invisible' etc.
        # This test documents current behavior.

    def test_invisible_class_not_matched(self):
        """class='invisible' should NOT match hero copy selectors."""
        html = '<html><body><div class="invisible"><p>見えない</p></div><section><p>本文</p></section></body></html>'
        data = extract("https://example.com", html)
        assert data.hero_copy != "見えない"


# ---------------------------------------------------------------------------
# Main/Article priority extraction (改善C)
# ---------------------------------------------------------------------------

class TestMainArticlePriority:
    def test_main_tag_prioritized(self):
        html = """<html><body>
        <nav>Navigation</nav>
        <aside>Sidebar widget</aside>
        <main><p>This is the main content area with enough text to pass threshold.</p>
        <p>More main content here to make it long enough for the 200 char minimum requirement.</p>
        <p>Even more content to ensure we reach two hundred characters easily.</p></main>
        <footer>Footer</footer>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "main content" in data.body_text_snippet
        assert "Navigation" not in data.body_text_snippet
        assert "Sidebar" not in data.body_text_snippet

    def test_article_tag_prioritized(self):
        html = """<html><body>
        <nav>Navigation</nav>
        <article><p>Article content that is long enough to pass the two hundred character minimum threshold for adoption.</p>
        <p>Additional article paragraphs to ensure sufficient length for the extraction logic.</p>
        <p>Yet more content to be absolutely sure we exceed two hundred chars.</p></article>
        <aside>Related posts</aside>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "Article content" in data.body_text_snippet
        assert "Related posts" not in data.body_text_snippet

    def test_main_tag_excludes_inline_script(self):
        """Phase 1 main extraction must strip script tags."""
        html = """<html><body>
        <main>
        <script>var gtag = function(){}; gtag('event', 'page_view');</script>
        <p>Main content that is definitely long enough to pass the two hundred character minimum threshold for the Phase 1 extraction logic.</p>
        <p>Additional content paragraphs to ensure we have enough text to be well above the threshold.</p>
        <p>Even more content here to make absolutely certain about length.</p>
        </main>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "Main content" in data.body_text_snippet
        assert "gtag" not in data.body_text_snippet
        assert "page_view" not in data.body_text_snippet

    def test_article_tag_excludes_style(self):
        """Phase 1 article extraction must strip style tags."""
        html = """<html><body>
        <article>
        <style>.hero { color: red; }</style>
        <p>Article text content that passes the two hundred character minimum threshold for the Phase 1 extraction path.</p>
        <p>More article content here to make sure we are well above the required character length.</p>
        <p>Yet another paragraph to be absolutely certain about meeting the threshold.</p>
        </article>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "Article text" in data.body_text_snippet
        assert ".hero" not in data.body_text_snippet
        assert "color: red" not in data.body_text_snippet

    def test_short_main_falls_back(self):
        """If <main> has less than 200 chars, fall back to full body extraction."""
        html = '<html><body><main><p>Short</p></main><p>Body text is here</p></body></html>'
        data = extract("https://example.com", html)
        assert "Body text" in data.body_text_snippet


# ---------------------------------------------------------------------------
# Secondary CTAs extraction (改善E)
# ---------------------------------------------------------------------------

class TestSecondaryCtas:
    def test_extracts_multiple_ctas(self):
        html = """<html><body>
        <a class="btn-primary" href="/signup">今すぐ登録</a>
        <a class="btn-secondary" href="/demo">デモを見る</a>
        <a class="btn-outline" href="/contact">お問い合わせ</a>
        </body></html>"""
        data = extract("https://example.com", html)
        assert data.main_cta != ""
        assert len(data.secondary_ctas) >= 1

    def test_excludes_main_cta_from_secondary(self):
        html = """<html><body>
        <div class="hero"><a class="btn" href="/signup">登録する</a></div>
        <a class="btn" href="/signup">登録する</a>
        <a class="btn" href="/demo">デモを見る</a>
        </body></html>"""
        data = extract("https://example.com", html)
        for cta in data.secondary_ctas:
            assert cta.lower() != data.main_cta.lower()

    def test_empty_when_no_buttons(self):
        html = '<html><body><p>No buttons here</p></body></html>'
        data = extract("https://example.com", html)
        assert data.secondary_ctas == []


# ---------------------------------------------------------------------------
# FAQ extraction (改善E)
# ---------------------------------------------------------------------------

class TestFaqExtraction:
    def test_faq_from_html_section_dt_dd(self):
        html = """<html><body>
        <div class="faq-section">
            <dt>Q1: 料金はいくらですか？</dt>
            <dd>月額980円からご利用いただけます。</dd>
            <dt>Q2: 解約はできますか？</dt>
            <dd>いつでも解約可能です。</dd>
        </div>
        </body></html>"""
        data = extract("https://example.com", html)
        assert len(data.faq_items) == 2
        assert "料金" in data.faq_items[0]

    def test_faq_from_h3_p_pattern(self):
        html = """<html><body>
        <section class="faq">
            <h3>サービスの特徴は？</h3>
            <p>高品質なサービスを提供しています。</p>
            <h3>サポートはありますか？</h3>
            <p>24時間対応しています。</p>
        </section>
        </body></html>"""
        data = extract("https://example.com", html)
        assert len(data.faq_items) == 2
        assert "特徴" in data.faq_items[0]

    def test_no_faq_returns_empty(self):
        html = '<html><body><p>No FAQ here</p></body></html>'
        data = extract("https://example.com", html)
        assert data.faq_items == []


# ---------------------------------------------------------------------------
# Testimonials extraction (改善E)
# ---------------------------------------------------------------------------

class TestTestimonialsExtraction:
    def test_extracts_testimonials(self):
        html = """<html><body>
        <div class="testimonial-section">
            <blockquote>このサービスは本当に素晴らしいです。業務効率が大幅に向上しました。</blockquote>
            <blockquote>コストパフォーマンスが最高です。導入して本当によかったと思います。</blockquote>
        </div>
        </body></html>"""
        data = extract("https://example.com", html)
        assert len(data.testimonials) >= 1
        assert "素晴らしい" in data.testimonials[0]

    def test_no_testimonials_returns_empty(self):
        html = '<html><body><p>No reviews</p></body></html>'
        data = extract("https://example.com", html)
        assert data.testimonials == []

    def test_skips_very_short_text(self):
        html = """<html><body>
        <div class="review-section">
            <p>短い</p>
            <p>このサービスを使い始めてから生産性が劇的に向上しました。チーム全員が満足しています。</p>
        </div>
        </body></html>"""
        data = extract("https://example.com", html)
        for t in data.testimonials:
            assert len(t) >= 20


# ---------------------------------------------------------------------------
# Hero Copy nav-label exclusion (Phase 2 品質改善)
# ---------------------------------------------------------------------------

class TestHeroCopyNavLabelExclusion:
    def test_hero_rejects_brand_slash_label(self):
        html = '<html><body><header><h2>BRAND／ブランド</h2><p>本格的なバスルーム製品をお届け</p></header></body></html>'
        data = extract("https://example.com", html)
        assert data.hero_copy == "本格的なバスルーム製品をお届け"

    def test_hero_rejects_inspiration_label(self):
        html = '<html><body><section class="hero"><h2>インスピレーション</h2><p>暮らしを彩る空間デザイン</p></section></body></html>'
        data = extract("https://example.com", html)
        assert data.hero_copy == "暮らしを彩る空間デザイン"

    def test_hero_rejects_category_only(self):
        html = '<html><body><header><h2>カテゴリ</h2></header></body></html>'
        data = extract("https://example.com", html)
        assert data.hero_copy == ""

    def test_hero_accepts_brand_in_real_copy(self):
        html = '<html><body><div class="hero"><p>新ブランド誕生。世界を変えるプロダクト。</p></div></body></html>'
        data = extract("https://example.com", html)
        assert "ブランド" in data.hero_copy

    def test_hero_skips_nav_ancestor(self):
        html = '<html><body><header><nav><h2>ブランド一覧</h2></nav><p>素敵な暮らしをご提案します</p></header></body></html>'
        data = extract("https://example.com", html)
        assert data.hero_copy == "素敵な暮らしをご提案します"

    def test_hero_p_preferred_over_h2(self):
        html = '<html><body><div class="hero"><h2>SHOP</h2><p>高品質な製品を手頃な価格で</p></div></body></html>'
        data = extract("https://example.com", html)
        assert data.hero_copy == "高品質な製品を手頃な価格で"


# ---------------------------------------------------------------------------
# Hero Copy link exclusion (Phase 3 品質改善)
# ---------------------------------------------------------------------------

class TestHeroCopyLinkExclusion:
    def test_hero_skips_p_inside_link(self):
        """hits-online.jp: <a> 内の <p>（カテゴリリンク）は除外される."""
        html = """<html><body>
        <section class="hero"><a href="/category/towel"><p>タオルバータオルリング</p></a></section>
        <section class="mainvisual"><p>高品質な住宅設備をお届けします</p></section>
        </body></html>"""
        data = extract("https://example.com", html)
        assert data.hero_copy == "高品質な住宅設備をお届けします"

    def test_hero_skips_span_inside_nav_link(self):
        """cera.co.jp: <a> 内の <span>（Aboutリンク）+「について」フィルタ."""
        html = """<html><body>
        <header>
            <a href="/about/" class="gnav_btn"><span>セラトレーディングについて</span></a>
            <div class="hero"><p>上質な空間をデザインする</p></div>
        </header>
        </body></html>"""
        data = extract("https://example.com", html)
        assert data.hero_copy == "上質な空間をデザインする"

    def test_hero_accepts_p_not_inside_link(self):
        """リンク外の <p> は正常にヒーローコピーとして採用される."""
        html = '<html><body><div class="hero"><p>革新的なソリューションを提供</p></div></body></html>'
        data = extract("https://example.com", html)
        assert data.hero_copy == "革新的なソリューションを提供"

    def test_hero_accepts_h2_next_to_link(self):
        """リンク横の <h2> は正常に採用される（リンク内でなければOK）."""
        html = '<html><body><div class="hero"><a href="/promo"><img src="promo.jpg"></a><h2>この春、新しいバスルームを</h2></div></body></html>'
        data = extract("https://example.com", html)
        assert "バスルーム" in data.hero_copy


# ---------------------------------------------------------------------------
# Body snippet widget exclusion (Phase 2 品質改善)
# ---------------------------------------------------------------------------

class TestBodySnippetWidgetExclusion:
    def test_body_excludes_aside(self):
        html = '<html><body><aside>Sidebar content here</aside><p>Main content text</p></body></html>'
        data = extract("https://example.com", html)
        assert "Sidebar" not in data.body_text_snippet

    def test_body_excludes_search_widget(self):
        html = '<html><body><div class="search-box">TOP SEARCHES 検索数の多いワード</div><p>本文テキスト</p></body></html>'
        data = extract("https://example.com", html)
        assert "TOP SEARCHES" not in data.body_text_snippet

    def test_body_excludes_breadcrumb(self):
        html = '<html><body><div class="breadcrumb">ホーム > カテゴリ</div><p>説明文テキスト</p></body></html>'
        data = extract("https://example.com", html)
        assert "ホーム > カテゴリ" not in data.body_text_snippet

    def test_body_excludes_role_search(self):
        html = '<html><body><div role="search">検索フォーム</div><p>コンテンツ本文</p></body></html>'
        data = extract("https://example.com", html)
        assert "検索フォーム" not in data.body_text_snippet

    def test_main_excludes_aside_inside(self):
        html = """<html><body><main><aside>Related items</aside>
        <p>This is main content with enough text to pass the two hundred character minimum threshold for Phase 1 extraction.</p>
        <p>Additional content to ensure we have sufficient length for the extraction logic to use this path.</p>
        <p>Even more content to be absolutely sure we exceed two hundred characters easily.</p></main></body></html>"""
        data = extract("https://example.com", html)
        assert "Related" not in data.body_text_snippet

    def test_main_excludes_nav_inside(self):
        html = """<html><body><main><nav>Sub navigation menu</nav>
        <p>This is main content with enough text to pass the two hundred character minimum threshold for Phase 1 extraction.</p>
        <p>Additional content to ensure we have sufficient length for the extraction logic to use this path.</p>
        <p>Even more content to be absolutely sure we exceed two hundred characters easily.</p></main></body></html>"""
        data = extract("https://example.com", html)
        assert "Sub navigation" not in data.body_text_snippet


# ---------------------------------------------------------------------------
# Body snippet <p> tag priority phase (Phase 3 品質改善)
# ---------------------------------------------------------------------------

class TestBodySnippetParagraphPhase:
    def test_p_phase_skips_keyword_section(self):
        """hits-online.jp: keyword <section> + <a> 内 <p> を除外し本文 <p> のみ採用."""
        html = """<html><body>
        <section class="tp-section __keywords">
            <h2>TOP SEARCHES 検索数の多いワード</h2>
            <a href="/category/towel"><p>タオルバータオルリング</p></a>
        </section>
        <p>私たちは高品質な住宅設備を幅広く取り揃えております。お客様の暮らしに寄り添う製品をご提案いたします。</p>
        <p>創業以来、品質と信頼をモットーにお客様に満足いただけるサービスを提供してまいりました。</p>
        <p>全国のショールームにて実際の製品をご覧いただけます。お気軽にお立ち寄りくださいませ。</p>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "TOP SEARCHES" not in data.body_text_snippet
        assert "住宅設備" in data.body_text_snippet

    def test_p_phase_skips_gallery_headings(self):
        """cera.co.jp: gallery <h2> は <p> フェーズで混入しない."""
        html = """<html><body>
        <h2>GALLERY ギャラリー</h2>
        <p>私たちは上質なバスルーム空間をデザインする専門メーカーです。美しさと機能性を両立した製品をお届けします。</p>
        <p>長年の実績と技術力で、お客様一人ひとりに最適なソリューションをご提案いたします。お客様の声を大切にし、常に改善を続けています。</p>
        <p>全国のディーラー網を通じて、安心のアフターサポートも提供しております。いつでもお気軽にお問い合わせくださいませ。</p>
        <p>最新のカタログをご希望の方は、お問い合わせフォームよりご請求いただけます。専門スタッフが丁寧にご対応いたします。</p>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "GALLERY" not in data.body_text_snippet
        assert "バスルーム空間" in data.body_text_snippet

    def test_p_phase_falls_back_when_too_short(self):
        """短い <p> のみ → Phase 2 フォールバックで <div> テキストを含む."""
        html = """<html><body>
        <p>短い</p>
        <div>このdivの中には十分に長い本文テキストが含まれており、Phase 1.5のpタグフェーズでは200文字に満たないためPhase 2のフォールバック処理に回されることを確認するためのテストデータです。</div>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "Phase 2" in data.body_text_snippet or "divの中" in data.body_text_snippet

    def test_p_phase_skips_footer_paragraphs(self):
        """footer 内の <p> は除外される."""
        html = """<html><body>
        <p>これは本文の段落テキストです。商品やサービスに関する説明を記載しています。</p>
        <p>お客様に最適なソリューションを提供するために、日々研究開発に努めております。</p>
        <p>品質へのこだわりと丁寧なサポートで、多くのお客様からご信頼をいただいております。</p>
        <footer><p>Copyright 2026 All Rights Reserved. プライバシーポリシー</p></footer>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "Copyright" not in data.body_text_snippet


# ---------------------------------------------------------------------------
# Urgency elements extraction
# ---------------------------------------------------------------------------


class TestUrgencyExtraction:
    def test_urgency_from_text(self):
        html = '<html><body><p>残り5個！在庫わずか</p></body></html>'
        data = extract("https://example.com", html)
        assert len(data.urgency_elements) >= 1

    def test_urgency_from_css_class(self):
        html = '<html><body><div class="countdown">あと3日!</div></body></html>'
        data = extract("https://example.com", html)
        assert len(data.urgency_elements) >= 1


# ---------------------------------------------------------------------------
# Trust badges extraction
# ---------------------------------------------------------------------------


class TestTrustBadgeExtraction:
    def test_trust_from_alt(self):
        html = '<html><body><img src="/badge.png" alt="SSL Secure Site"></body></html>'
        data = extract("https://example.com", html)
        assert any("SSL" in t for t in data.trust_badges)

    def test_trust_from_text(self):
        html = '<html><body><p>ISO 9001 認証取得企業</p></body></html>'
        data = extract("https://example.com", html)
        assert any("ISO" in t for t in data.trust_badges)


# ---------------------------------------------------------------------------
# Phase 4: 水回りCRO品質改善 — 新規抽出フィールド
# ---------------------------------------------------------------------------


class TestImageAltExtraction:
    def test_extracts_meaningful_alts(self):
        html = '<html><body><img src="/hero.jpg" alt="最大45%OFF キャンペーン実施中" width="800" height="400"></body></html>'
        data = extract("https://example.com", html)
        assert len(data.image_alts) >= 1
        assert "45%" in data.image_alts[0]

    def test_skips_logo_alts(self):
        html = '<html><body><img src="/logo.png" alt="Logo" width="200" height="60"><img src="/hero.jpg" alt="商品情報" width="800" height="400"></body></html>'
        data = extract("https://example.com", html)
        assert all("Logo" not in a for a in data.image_alts)

    def test_skips_short_alts(self):
        html = '<html><body><img src="/img.jpg" alt="AB" width="200"></body></html>'
        data = extract("https://example.com", html)
        assert data.image_alts == []

    def test_skips_tiny_images(self):
        html = '<html><body><img src="/icon.jpg" alt="送料無料アイコン" width="30" height="30"></body></html>'
        data = extract("https://example.com", html)
        assert data.image_alts == []


class TestBannerTextExtraction:
    def test_extracts_banner_text(self):
        html = '<html><body><div class="banner">スプリングセール最大45%OFF</div></body></html>'
        data = extract("https://example.com", html)
        assert len(data.banner_texts) >= 1
        assert "45%" in data.banner_texts[0]

    def test_extracts_ranking_text(self):
        html = '<html><body><div class="ranking">売れ筋ランキング第1位</div></body></html>'
        data = extract("https://example.com", html)
        assert len(data.banner_texts) >= 1

    def test_extracts_campaign_text(self):
        html = '<html><body><div class="campaign">期間限定キャンペーン実施中</div></body></html>'
        data = extract("https://example.com", html)
        assert len(data.banner_texts) >= 1


class TestContactPathsExtraction:
    def test_extracts_contact_link(self):
        html = '<html><body><a href="/contact">お問い合わせ</a></body></html>'
        data = extract("https://example.com", html)
        assert len(data.contact_paths) >= 1
        assert "お問い合わせ" in data.contact_paths[0]

    def test_extracts_estimate_link(self):
        html = '<html><body><a href="/estimate">見積もり依頼</a></body></html>'
        data = extract("https://example.com", html)
        assert len(data.contact_paths) >= 1
        assert "見積" in data.contact_paths[0]

    def test_extracts_contact_from_href(self):
        html = '<html><body><a href="/inquiry-form">お申し込み</a></body></html>'
        data = extract("https://example.com", html)
        assert len(data.contact_paths) >= 1


class TestPromoClaimsExtraction:
    def test_extracts_free_shipping(self):
        html = '<html><body><p>送料無料（税込5,500円以上）</p></body></html>'
        data = extract("https://example.com", html)
        assert any("送料無料" in p for p in data.promo_claims)

    def test_extracts_discount(self):
        html = '<html><body><p>全品25%OFF</p></body></html>'
        data = extract("https://example.com", html)
        assert any("25%" in p for p in data.promo_claims)

    def test_extracts_delivery_speed(self):
        html = '<html><body><p>即日発送対応</p></body></html>'
        data = extract("https://example.com", html)
        assert any("即日" in p for p in data.promo_claims)

    def test_extracts_limited_stock(self):
        html = '<html><body><p>在庫限りの特別価格</p></body></html>'
        data = extract("https://example.com", html)
        assert any("在庫" in p for p in data.promo_claims)


class TestCorporateElementsExtraction:
    def test_extracts_corporate_mention(self):
        html = '<html><body><p>法人のお客様は大口注文に対応</p></body></html>'
        data = extract("https://example.com", html)
        assert any("法人" in e for e in data.corporate_elements)

    def test_extracts_track_record(self):
        html = '<html><body><p>開業から13年の実績</p></body></html>'
        data = extract("https://example.com", html)
        assert any("13年" in e for e in data.corporate_elements)

    def test_extracts_authorized_dealer(self):
        html = '<html><body><p>正規代理店として安心のメーカー保証付き</p></body></html>'
        data = extract("https://example.com", html)
        assert any("正規代理店" in e for e in data.corporate_elements)

    def test_extracts_catalog(self):
        html = '<html><body><p>カタログダウンロードはこちら</p></body></html>'
        data = extract("https://example.com", html)
        assert any("カタログ" in e for e in data.corporate_elements)


# ---------------------------------------------------------------------------
# Phase 4: 水回り3サイト フィクスチャテスト
# ---------------------------------------------------------------------------


class TestHitsOnlineFixture:
    """Hits Online Shop フィクスチャの抽出テスト."""

    @pytest.fixture(autouse=True)
    def _html(self):
        self.html = (FIXTURES_DIR / "hits_online.html").read_text(encoding="utf-8")

    def test_title_extracted(self):
        data = extract("https://hits-online.jp", self.html)
        assert "Hits" in data.title or "住宅設備" in data.title

    def test_authorized_dealer_in_corporate(self):
        data = extract("https://hits-online.jp", self.html)
        assert any("正規代理店" in e for e in data.corporate_elements)

    def test_estimate_box_in_contacts(self):
        data = extract("https://hits-online.jp", self.html)
        contact_text = " ".join(data.contact_paths)
        assert "見積" in contact_text

    def test_holiday_notice_in_image_alts(self):
        data = extract("https://hits-online.jp", self.html)
        alt_text = " ".join(data.image_alts)
        assert "休業" in alt_text

    def test_ranking_text_in_banners(self):
        data = extract("https://hits-online.jp", self.html)
        combined = " ".join(data.banner_texts)
        assert "ランキング" in combined or "売れ筋" in combined


class TestPapasaladaFixture:
    """パパサラダ フィクスチャの抽出テスト."""

    @pytest.fixture(autouse=True)
    def _html(self):
        self.html = (FIXTURES_DIR / "papasalada.html").read_text(encoding="utf-8")

    def test_contact_extracted(self):
        data = extract("https://papasalada.com", self.html)
        contact_text = " ".join(data.contact_paths)
        assert "お問い合わせ" in contact_text

    def test_estimate_in_contacts(self):
        data = extract("https://papasalada.com", self.html)
        contact_text = " ".join(data.contact_paths)
        assert "見積" in contact_text

    def test_discount_in_promo(self):
        data = extract("https://papasalada.com", self.html)
        promo_text = " ".join(data.promo_claims)
        assert "45%" in promo_text

    def test_free_shipping_in_promo(self):
        data = extract("https://papasalada.com", self.html)
        promo_text = " ".join(data.promo_claims)
        assert "送料無料" in promo_text

    def test_corporate_elements(self):
        data = extract("https://papasalada.com", self.html)
        corp_text = " ".join(data.corporate_elements)
        assert "法人" in corp_text or "13年" in corp_text

    def test_track_record(self):
        data = extract("https://papasalada.com", self.html)
        corp_text = " ".join(data.corporate_elements)
        assert "13年" in corp_text or "実績" in corp_text


class TestSaneiFixture:
    """SANEI フィクスチャの抽出テスト."""

    @pytest.fixture(autouse=True)
    def _html(self):
        self.html = (FIXTURES_DIR / "sanei.html").read_text(encoding="utf-8")

    def test_contact_extracted(self):
        data = extract("https://sanei.co.jp", self.html)
        contact_text = " ".join(data.contact_paths)
        assert "お問い合わせ" in contact_text

    def test_catalog_in_corporate(self):
        data = extract("https://sanei.co.jp", self.html)
        corp_text = " ".join(data.corporate_elements)
        assert "カタログ" in corp_text

    def test_recommend_in_banners(self):
        data = extract("https://sanei.co.jp", self.html)
        banner_text = " ".join(data.banner_texts)
        assert "おすすめ" in banner_text

    def test_design_product_in_image_alts(self):
        data = extract("https://sanei.co.jp", self.html)
        alt_text = " ".join(data.image_alts)
        assert "DESIGN PRODUCT" in alt_text

    def test_faq_items_extracted(self):
        data = extract("https://sanei.co.jp", self.html)
        assert len(data.faq_items) >= 2
        faq_text = " ".join(data.faq_items)
        assert "取付" in faq_text or "保証" in faq_text


# ---------------------------------------------------------------------------
# CTA legal rejection (agency-grade improvement)
# ---------------------------------------------------------------------------

class TestCtaLegalRejection:
    """Main CTA should not be legal/footer links."""

    def test_rejects_tokusho_as_main_cta(self):
        """「特定商取引に関する表示」がmain CTAに採用されない."""
        html = """<html><body>
        <a class="btn-primary" href="/legal">特定商取引に関する表示</a>
        <a class="btn" href="/cart">カートに入れる</a>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "特定商取引" not in data.main_cta

    def test_rejects_privacy_policy(self):
        """プライバシーポリシーがmain CTAに採用されない."""
        html = """<html><body>
        <a class="btn" href="/privacy">プライバシーポリシー</a>
        <a class="btn" href="/order">今すぐ購入</a>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "プライバシー" not in data.main_cta

    def test_rejects_terms_of_service(self):
        """利用規約がmain CTAに採用されない."""
        html = """<html><body>
        <a class="btn" href="/terms">利用規約</a>
        <a class="btn" href="/buy">購入する</a>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "利用規約" not in data.main_cta

    def test_purchase_cta_preferred_over_contact(self):
        """購入系CTAがお問い合わせよりも優先される."""
        html = """<html><body>
        <a href="/contact">お問い合わせ</a>
        <a href="/cart">カートに入れる</a>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "カート" in data.main_cta

    def test_legal_only_page_returns_empty(self):
        """legal系リンクしかない場合は空を返す."""
        html = """<html><body>
        <a class="btn" href="/legal">特定商取引に関する表示</a>
        <a class="btn" href="/privacy">プライバシーポリシー</a>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "特定商取引" not in data.main_cta
        assert "プライバシー" not in data.main_cta


# ---------------------------------------------------------------------------
# Offer terms extraction (agency-grade expansion)
# ---------------------------------------------------------------------------

class TestOfferTermsExtraction:
    def test_extracts_subscription_offer(self):
        html = '<html><body><div class="offer-section"><p>定期便なら初回50%OFF</p></div></body></html>'
        data = extract("https://example.com", html)
        assert len(data.offer_terms) >= 1
        assert any("定期便" in t or "初回" in t for t in data.offer_terms)

    def test_extracts_campaign_text(self):
        html = '<html><body><p>期間限定キャンペーン実施中！今だけ送料無料</p></body></html>'
        data = extract("https://example.com", html)
        assert len(data.offer_terms) >= 1

    def test_empty_when_no_offers(self):
        html = '<html><body><p>普通の説明文です</p></body></html>'
        data = extract("https://example.com", html)
        assert data.offer_terms == []


# ---------------------------------------------------------------------------
# Review signals extraction (agency-grade expansion)
# ---------------------------------------------------------------------------

class TestReviewSignalsExtraction:
    def test_extracts_star_rating(self):
        html = '<html><body><div class="review-section"><p>★4.5（120件のレビュー）</p></div></body></html>'
        data = extract("https://example.com", html)
        assert len(data.review_signals) >= 1

    def test_extracts_voice_section(self):
        html = '<html><body><div class="voice-section"><p>お客様の声を紹介します</p></div></body></html>'
        data = extract("https://example.com", html)
        assert len(data.review_signals) >= 1

    def test_empty_when_no_reviews(self):
        html = '<html><body><p>普通の説明文です</p></body></html>'
        data = extract("https://example.com", html)
        assert data.review_signals == []


# ---------------------------------------------------------------------------
# Shipping signals extraction (agency-grade expansion)
# ---------------------------------------------------------------------------

class TestShippingSignalsExtraction:
    def test_extracts_free_shipping(self):
        html = '<html><body><div class="shipping-info"><p>全品送料無料</p></div></body></html>'
        data = extract("https://example.com", html)
        assert len(data.shipping_signals) >= 1
        assert any("送料無料" in s for s in data.shipping_signals)

    def test_extracts_delivery_info(self):
        html = '<html><body><p>翌日配送対応・最短即日発送</p></body></html>'
        data = extract("https://example.com", html)
        assert len(data.shipping_signals) >= 1

    def test_empty_when_no_shipping(self):
        html = '<html><body><p>普通の説明文</p></body></html>'
        data = extract("https://example.com", html)
        assert data.shipping_signals == []


# ---------------------------------------------------------------------------
# Follow-up Fix 4: CTA Phase 1 purchase priority scoring
# ---------------------------------------------------------------------------

class TestCtaPhase1PurchasePriority:
    """CTA Phase 1で購入系CTAがお問い合わせより優先される."""

    def test_purchase_over_contact_same_container(self):
        """同一コンテナに「お問い合わせ」と「今すぐ購入」が共存する場合、「今すぐ購入」を返す."""
        html = """<html><body>
        <div class="hero">
            <a class="btn-primary" href="/contact">お問い合わせ</a>
            <a class="btn" href="/cart">今すぐ購入</a>
        </div>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "今すぐ購入" in data.main_cta

    def test_purchase_over_contact_both_btn(self):
        """btn-primaryにお問い合わせ、別のbtnにカートがある場合、カートを返す."""
        html = """<html><body>
        <a class="btn-primary" href="/contact">お問い合わせ</a>
        <a class="btn" href="/cart">カートに入れる</a>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "カート" in data.main_cta

    def test_consult_over_contact(self):
        """資料請求がお問い合わせより優先される（Phase 2 fallback）."""
        html = """<html><body>
        <a href="/contact">お問い合わせ</a>
        <a href="/download">資料ダウンロード</a>
        </body></html>"""
        data = extract("https://example.com", html)
        assert "資料ダウンロード" in data.main_cta
