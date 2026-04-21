"""Extract structured data from HTML."""

from __future__ import annotations

import json
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from .models import ExtractedData


def extract(url: str, html: str) -> ExtractedData:
    soup = BeautifulSoup(html, "html.parser")

    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()

    meta_desc = ""
    meta_tag = soup.find("meta", attrs={"name": "description"})
    if meta_tag and meta_tag.get("content"):
        meta_desc = meta_tag["content"].strip()

    h1 = ""
    h1_tag = soup.find("h1")
    if h1_tag:
        h1 = h1_tag.get_text(strip=True)
    if not h1:
        og_title = soup.find("meta", attrs={"property": "og:title"})
        if og_title and og_title.get("content"):
            h1 = og_title["content"].strip()
    if not h1 and title:
        h1 = title

    hero_copy = _extract_hero_copy(soup)
    main_cta = _extract_main_cta(soup)
    pricing_snippet, pricing_status = _extract_pricing(soup)
    feature_bullets = _extract_features(soup)
    body_text_snippet = _extract_body_snippet(soup)
    og_type = _extract_og_type(soup)
    og_image_url = _extract_og_image(soup, url)
    secondary_ctas = _extract_secondary_ctas(soup, main_cta)
    faq_items = _extract_faq_items(soup)
    testimonials = _extract_testimonials(soup)
    urgency_elements = _extract_urgency_elements(soup)
    trust_badges = _extract_trust_badges(soup)
    guarantees = _extract_guarantees(soup)
    # Phase 4: 水回りCRO品質改善
    image_alts = _extract_image_alts(soup)
    banner_texts = _extract_banner_texts(soup)
    contact_paths = _extract_contact_paths(soup)
    promo_claims = _extract_promo_claims(soup)
    corporate_elements = _extract_corporate_elements(soup)
    # Agency-grade expansion
    offer_terms = _extract_offer_terms(soup)
    review_signals = _extract_review_signals(soup)
    shipping_signals = _extract_shipping_signals(soup)

    return ExtractedData(
        url=url,
        title=title,
        meta_description=meta_desc,
        h1=h1,
        hero_copy=hero_copy,
        main_cta=main_cta,
        pricing_snippet=pricing_snippet,
        pricing_status=pricing_status,
        feature_bullets=feature_bullets,
        body_text_snippet=body_text_snippet,
        og_type=og_type,
        og_image_url=og_image_url,
        secondary_ctas=secondary_ctas,
        faq_items=faq_items,
        testimonials=testimonials,
        urgency_elements=urgency_elements,
        trust_badges=trust_badges,
        guarantees=guarantees,
        image_alts=image_alts,
        banner_texts=banner_texts,
        contact_paths=contact_paths,
        promo_claims=promo_claims,
        corporate_elements=corporate_elements,
        offer_terms=offer_terms,
        review_signals=review_signals,
        shipping_signals=shipping_signals,
    )


_HERO_GARBAGE = re.compile(
    r"ようこそ|ゲスト|ログイン|ログアウト|カート|cookie|"
    r"toggle|menu|search|検索|閉じる|開く|マイページ|"
    r"トップページ|ホーム|home|top|戻る|back|en|ja|english|日本語|"
    r"について$",
    re.IGNORECASE,
)

_HERO_NAV_LABELS = re.compile(
    r"^(?:BRAND|CATEGORY|RANKING|SHOP|COLLECTION|MENU|NEWS|ABOUT|"
    r"ブランド|カテゴリ|ランキング|新着|特集|お知らせ|"
    r"インスピレーション|コレクション|ショップ|"
    r"TOP SEARCHES|人気検索|検索数の多い)"
    r"(?:[／/\s　]*(?:BRAND|CATEGORY|RANKING|SHOP|COLLECTION|MENU|NEWS|ABOUT|"
    r"ブランド|カテゴリ|ランキング|新着|特集|お知らせ|"
    r"インスピレーション|コレクション|ショップ))*$",
    re.IGNORECASE,
)

_HERO_CONTAINERS = [
    "[class*='hero']", "[class*='Hero']", "[id*='hero']",
    "[class*='mv']", "[class*='mainvisual']", "[class*='kv']",
    "[class^='visual']", "[class*='-visual']", "[class*='_visual']",
    "[class*='banner']", "[class*='intro']", "[role='banner']",
    "header", "main > section:first-child", "section:first-of-type",
]

_HERO_TEXT_TAGS = ["p", "h2", "h3", "span", "div"]


def _extract_hero_copy(soup: BeautifulSoup) -> str:
    for container_sel in _HERO_CONTAINERS:
        for tag_name in _HERO_TEXT_TAGS:
            sel = f"{container_sel} {tag_name}"
            for tag in soup.select(sel):
                if tag.find_parent("nav"):
                    continue
                if tag.find_parent("a"):
                    continue
                text = tag.get_text(strip=True)
                if text and len(text) >= 8 and not _HERO_GARBAGE.search(text):
                    if _HERO_NAV_LABELS.match(text):
                        continue
                    return text
    return ""


_CTA_KEYWORDS = [
    "カートに入れる", "今すぐ購入", "お問い合わせ", "資料請求",
    "無料で始める", "申し込む", "見積もり", "予約する", "お客様窓口",
    "今すぐ申し込む", "無料体験", "無料トライアル", "お試し",
    "資料ダウンロード", "無料で見る", "購入する", "定期便を始める",
    "初回限定", "会員登録", "無料登録", "見積もりを取る",
    "相談する", "話を聞く",
    # Section C-1: BtoB CTA 拡張
    "お問合せ", "お問い合せ", "問い合わせ", "無料相談", "無料診断",
    "資料DL", "資料を見る", "事例を見る", "導入事例を見る",
    "見積依頼", "見積もり依頼", "お見積", "お見積り", "個別相談",
    "オンライン相談", "オンライン面談", "ウェビナー申込", "セミナー申込",
    "無料ウェビナー", "ホワイトペーパー",
    # English
    "Add to Cart", "Buy Now", "Get Started", "Contact Us",
    "Start Free Trial", "Try Free", "Get Your Quote", "Book a Call",
    "Schedule Demo", "See Plans", "Claim Offer",
    "Request Demo", "Book a Demo", "Get a Quote", "Request a Quote",
    "Download Whitepaper", "Download Report",
]

_CTA_LEGAL_REJECT = re.compile(
    r"特定商取引|プライバシー|利用規約|個人情報|cookie|"
    r"ログインできないお客様|会社概要|サイトマップ|"
    r"terms\s*of\s*service|privacy\s*policy|legal|"
    r"cookie\s*policy|sitemap",
    re.IGNORECASE,
)

_CTA_PURCHASE_BOOST = re.compile(
    r"shop|cart|buy|定期|購入|カート|注文|申込|申し込|"
    r"初回|お試し|始める|登録",
    re.IGNORECASE,
)

_CTA_CONSULT_BOOST = re.compile(
    r"資料請求|資料ダウンロード|資料DL|資料を見る|無料体験|無料トライアル|"
    r"見積|相談|話を聞く|問い?合わ?せ|お問合せ|無料診断|無料相談|"
    r"導入事例|事例を見る|ウェビナー|セミナー|ホワイトペーパー|個別相談|"
    r"Get Started|Free Trial|Quote|Demo|Book a Call|Book a Demo|"
    r"Request Demo|Contact",
    re.IGNORECASE,
)


def _cta_priority(text: str) -> int:
    """Return priority score for CTA text. Higher = more purchase-oriented."""
    if _CTA_PURCHASE_BOOST.search(text):
        return 3
    if _CTA_CONSULT_BOOST.search(text):
        return 2
    return 1


def _is_legal_cta(text: str) -> bool:
    """Return True if text looks like a legal/footer link, not a real CTA."""
    return bool(_CTA_LEGAL_REJECT.search(text))


def _extract_main_cta(soup: BeautifulSoup) -> str:
    # Phase 1: CSS セレクター（全候補収集→スコアリング）
    candidates: list[tuple[int, str]] = []
    seen_texts: set[str] = set()
    for selector in [
        "[class*='hero'] a[class*='btn']",
        "[class*='hero'] button",
        "[class*='cta'] a",
        "header a[class*='btn']",
        "a[class*='btn-primary']",
        "a[class*='cta']",
        "button[class*='cta']",
        "[class*='mv'] a[class*='btn']",
        "[class*='kv'] a[class*='btn']",
        "a[class*='btn'][href*='contact']",
        "a[class*='btn'][href*='inquiry']",
        "a[class*='btn'][href*='reserve']",
        "button[type='submit']",
        "a[href*='cart']", "a[href*='basket']",
        "a[href*='contact']", "a[href*='inquiry']", "a[href*='toiawase']",
        "a[href*='order']", "a[href*='request']",
        "a[href*='download']", "a[href*='trial']", "a[href*='demo']",
        # Section C-1: BtoB セレクタ拡張
        "a[href*='consultation']", "a[href*='whitepaper']",
        "a[href*='document']", "a[href*='shiryou']", "a[href*='shiryo']",
        "a[href*='soudan']", "a[href*='mitsumori']",
        "a[href*='seminar']", "a[href*='webinar']",
        "a[href*='quote']", "a[href*='pricing']",
        "[class*='contact'] a", "[class*='Contact'] a",
        "[class*='inquiry'] a", "[class*='Inquiry'] a",
        "[class*='request'] a[class*='btn']",
        "[class*='downloadBtn']", "[class*='DownloadBtn']",
    ]:
        tag = soup.select_one(selector)
        if tag and tag.get_text(strip=True):
            text = tag.get_text(strip=True)
            if _is_legal_cta(text):
                continue
            if text.lower() not in seen_texts:
                seen_texts.add(text.lower())
                # Tiebreaker: prefer text that matches an earlier keyword in _CTA_KEYWORDS
                kw_rank = len(_CTA_KEYWORDS)
                for i, kw in enumerate(_CTA_KEYWORDS):
                    if kw in text:
                        kw_rank = i
                        break
                candidates.append((_cta_priority(text), -kw_rank, text))
    if candidates:
        candidates.sort(key=lambda x: (-x[0], x[1]))
        return candidates[0][2]

    # Phase 2: キーワードベースフォールバック（購入系>資料系>お問い合わせの優先度）
    best_candidate = ""
    best_priority = 0
    for el in soup.find_all(["a", "button"], limit=100):
        text = el.get_text(strip=True)
        if _is_legal_cta(text):
            continue
        if any(kw in text for kw in _CTA_KEYWORDS):
            priority = _cta_priority(text)
            if priority > best_priority:
                best_priority = priority
                best_candidate = text
    return best_candidate or ""


_PRICE_PATTERN = re.compile(
    r'(?:¥|￥)\s*[\d,]+|[\d,]+\s*円|税込[\d,]+|'
    r'\$[\d,.]+|[\d,]+\s*/\s*(?:月|年|month)',
    re.IGNORECASE,
)

# Section C-2: BtoB 価格ページ導線の検出
_BTOB_PRICING_PAGE_SELECTORS = [
    "a[href*='price']", "a[href*='pricing']", "a[href*='plan']",
    "a[href*='fee']", "a[href*='ryoukin']", "a[href*='ryokin']",
    "a[href*='kakaku']", "a[href*='service']",
]

_BTOB_INQUIRY_SELECTORS = [
    "a[href*='contact']", "a[href*='inquiry']", "a[href*='toiawase']",
    "a[href*='quote']", "a[href*='mitsumori']", "a[href*='consultation']",
    "a[href*='soudan']", "a[href*='request']",
]

# 「要問い合わせ」「個別見積」等のBtoB標準表現を本文から拾う
_BTOB_INQUIRY_TEXT_PATTERN = re.compile(
    r"要お?問(?:い|合)わ?せ|個別お?見積|別途お?見積|"
    r"お見積(?:り)?(?:を)?(?:ご)?連絡|"
    r"料金(?:は|に(?:つ|ついて))(?:お|ご)?(?:問|相談)|"
    r"価格(?:は|に(?:つ|ついて))(?:お|ご)?(?:問|相談)",
)


def _extract_pricing(soup: BeautifulSoup) -> tuple[str, str]:
    """Return (pricing_snippet, pricing_status).

    pricing_status:
      - "available"    — 通常の価格表記を抽出できた
      - "inquiry_only" — BtoB標準の「要問い合わせ」導線のみ検出
      - "not_found"    — いずれも検出できない
    """
    # Phase 1: CSS セレクター（拡張版）
    for selector in [
        "[class*='pricing']",
        "[class*='Pricing']",
        "[id*='pricing']",
        "[class*='price']",
        "[class*='Price']",
        "[id*='price']",
        "[class*='kakaku']",
        "[class*='nedan']",
        "[class*='plan']",
        "[class*='Plan']",
        "[id*='plan']",
    ]:
        tag = soup.select_one(selector)
        if tag:
            text = tag.get_text(" ", strip=True)
            if text:
                snippet = text[:500] if len(text) > 500 else text
                return snippet, "available"

    # Phase 2: 正規表現ベースの価格検出フォールバック
    body = soup.find("body")
    body_text = body.get_text(" ", strip=True) if body else ""
    match = _PRICE_PATTERN.search(body_text) if body_text else None
    if match:
        start = max(0, match.start() - 30)
        end = min(len(body_text), match.end() + 70)
        return body_text[start:end].strip(), "available"

    # Section C-2: BtoB フォールバック — 価格ページリンク
    for selector in _BTOB_PRICING_PAGE_SELECTORS:
        link = soup.select_one(selector)
        if link and link.get("href"):
            href = link["href"].strip()
            label = link.get_text(" ", strip=True) or "価格ページ"
            return f"【価格ページあり】{label} ({href})", "inquiry_only"

    # Section C-2: BtoB フォールバック — 見積・問い合わせ導線
    for selector in _BTOB_INQUIRY_SELECTORS:
        link = soup.select_one(selector)
        if link:
            label = link.get_text(" ", strip=True) or "お問い合わせ"
            return f"【要問い合わせ】個別見積（BtoB標準導線: {label}）", "inquiry_only"

    # Section C-2: 本文に「要問い合わせ」系の文字列があれば inquiry_only
    if body_text and _BTOB_INQUIRY_TEXT_PATTERN.search(body_text):
        return "【要問い合わせ】本文に個別見積の案内あり（BtoB標準）", "inquiry_only"

    return "", "not_found"


def _extract_features(soup: BeautifulSoup) -> list[str]:
    features: list[str] = []
    for selector in [
        "[class*='feature'] li",
        "[class*='Feature'] li",
        "[id*='feature'] li",
        "[class*='benefit'] li",
    ]:
        items = soup.select(selector)
        for item in items[:10]:
            text = item.get_text(strip=True)
            if text:
                features.append(text)
        if features:
            return features
    return features


def _extract_body_snippet(soup: BeautifulSoup) -> str:
    body = soup.find("body")
    if not body:
        return ""

    # Phase 1: <main> or <article> があればそこを優先
    main_content = body.find("main") or body.find("article")
    if main_content:
        mc_copy = BeautifulSoup(str(main_content), "html.parser")
        for tag in mc_copy.find_all(["script", "style", "noscript", "aside", "nav"]):
            tag.decompose()
        for tag in mc_copy.find_all(attrs={"role": re.compile(r"^(search|complementary)$")}):
            tag.decompose()
        for tag in mc_copy.find_all(class_=re.compile(r"sidebar|widget|breadcrumb|search-box|search-form")):
            tag.decompose()
        text = mc_copy.get_text(" ", strip=False)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= 200:
            return text[:2000]

    # Phase 1.5: <p> タグのみ抽出（<main>/<article> なし or 不足時）
    _SKIP_ANCESTORS = {"nav", "footer", "aside", "noscript", "script", "style"}
    paragraphs = []
    for p in body.find_all("p"):
        if any(p.find_parent(a) for a in _SKIP_ANCESTORS):
            continue
        header_parent = p.find_parent("header")
        if header_parent and (header_parent.find("nav") or len(header_parent.find_all("a")) > 3):
            continue
        if p.find_parent("a"):
            continue
        text = p.get_text(strip=True)
        if text and len(text) >= 15:
            paragraphs.append(text)
    p_text = " ".join(paragraphs)
    if len(p_text) >= 200:
        return p_text[:800]

    # Phase 2: フォールバック（従来ロジック）
    body_copy = BeautifulSoup(str(body), "html.parser").find("body")
    for tag in body_copy.find_all(["script", "style", "noscript", "nav", "footer", "aside"]):
        tag.decompose()
    for tag in body_copy.find_all(attrs={"role": re.compile(r"^(navigation|search|complementary)$")}):
        tag.decompose()
    for tag in body_copy.find_all(class_=re.compile(r"sidebar|widget|breadcrumb|search-box|search-form|keyword|tag-cloud|popular|ranking")):
        tag.decompose()
    # navを含むheaderのみ除去（ヒーロー内headerは保持）
    for header in body_copy.find_all("header"):
        if header.find("nav") or len(header.find_all("a")) > 3:
            header.decompose()
    text = body_copy.get_text(" ", strip=False)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:2000]


def _extract_body_image(soup: BeautifulSoup, base_url: str = "") -> str | None:
    """HTMLのbodyから最初の目立つ画像を取得する（OGP未設定サイト用）."""
    _SKIP_PATTERNS = re.compile(
        r"logo|icon|favicon|pixel|tracking|spacer|badge|button|spinner|loading|sprite|1x1|blank|arrow|cart|search",
        re.IGNORECASE,
    )
    for img in soup.find_all("img", src=True, limit=30):
        src = img["src"].strip()
        if not src or src.startswith("data:") or src.endswith(".svg"):
            continue
        # 小さい画像をスキップ
        w = img.get("width", "")
        h = img.get("height", "")
        try:
            if (w and int(w) < 100) or (h and int(h) < 100):
                continue
        except ValueError:
            pass
        if _SKIP_PATTERNS.search(src):
            continue
        # URL解決
        if src.startswith("//"):
            return "https:" + src
        if base_url and not src.startswith(("http://", "https://")):
            return urljoin(base_url, src)
        return src
    return None


def _extract_og_image(soup: BeautifulSoup, base_url: str = "") -> str | None:
    """og:image / twitter:image を抽出し、相対URLを解決する."""
    tag = soup.find("meta", attrs={"property": "og:image"})
    if not tag or not tag.get("content"):
        # Fallback: twitter:image
        tag = soup.find("meta", attrs={"name": "twitter:image"})
    if not tag or not tag.get("content"):
        # Fallback: link[rel=image_src]
        tag = soup.find("link", attrs={"rel": "image_src"})
        if tag and tag.get("href"):
            raw = tag["href"].strip()
            if raw.startswith("//"):
                return "https:" + raw
            if base_url and not raw.startswith(("http://", "https://")):
                return urljoin(base_url, raw)
            return raw
        # Fallback: body内の目立つ画像
        return _extract_body_image(soup, base_url)

    raw = tag["content"].strip()
    if raw.startswith("//"):
        return "https:" + raw
    if base_url and not raw.startswith(("http://", "https://")):
        return urljoin(base_url, raw)
    return raw


def _extract_og_type(soup: BeautifulSoup) -> str:
    tag = soup.find("meta", attrs={"property": "og:type"})
    if tag and tag.get("content"):
        return tag["content"].strip()
    return ""


def _extract_secondary_ctas(soup: BeautifulSoup, main_cta: str) -> list[str]:
    """main_cta以外のCTAボタン/リンクを抽出."""
    ctas: list[str] = []
    seen = {main_cta.strip().lower()} if main_cta else set()
    for selector in [
        "a[class*='btn']",
        "a[class*='cta']",
        "button[class*='btn']",
        "button[class*='cta']",
        "a[class*='button']",
    ]:
        for tag in soup.select(selector):
            text = tag.get_text(strip=True)
            if text and text.lower() not in seen and len(text) <= 100:
                seen.add(text.lower())
                ctas.append(text)
            if len(ctas) >= 5:
                return ctas
    return ctas


def _extract_faq_items(soup: BeautifulSoup) -> list[str]:
    """FAQセクションからQ&Aを抽出."""
    faqs: list[str] = []
    # JSON-LD FAQPage schema
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        if script.string and '"FAQPage"' in script.string:
            try:
                data = json.loads(script.string)
                entities = data.get("mainEntity", [])
                for ent in entities[:10]:
                    q = ent.get("name", "")
                    a = ent.get("acceptedAnswer", {}).get("text", "")
                    if q:
                        faqs.append(f"Q: {q} A: {a[:200]}" if a else f"Q: {q}")
                if faqs:
                    return faqs
            except (json.JSONDecodeError, AttributeError):
                pass
    # HTML FAQ sections
    for selector in [
        "[class*='faq']", "[class*='FAQ']", "[id*='faq']", "[id*='FAQ']",
        "[class*='qa']", "[class*='QA']",
    ]:
        section = soup.select_one(selector)
        if not section:
            continue
        # dt/dd パターン
        dts = section.find_all("dt")
        if dts:
            for dt in dts[:10]:
                q = dt.get_text(strip=True)
                dd = dt.find_next_sibling("dd")
                a = dd.get_text(strip=True)[:200] if dd else ""
                faqs.append(f"Q: {q} A: {a}" if a else f"Q: {q}")
            return faqs
        # h3/h4 + p パターン
        for heading in section.find_all(["h3", "h4"])[:10]:
            q = heading.get_text(strip=True)
            p = heading.find_next_sibling("p")
            a = p.get_text(strip=True)[:200] if p else ""
            faqs.append(f"Q: {q} A: {a}" if a else f"Q: {q}")
        if faqs:
            return faqs
    return faqs


def _extract_testimonials(soup: BeautifulSoup) -> list[str]:
    """顧客の声・レビューを抽出."""
    testimonials: list[str] = []
    for selector in [
        "[class*='testimonial']", "[class*='Testimonial']",
        "[class*='review']", "[class*='Review']",
        "[class*='voice']", "[class*='Voice']",
        "[class*='customer']",
    ]:
        section = soup.select_one(selector)
        if not section:
            continue
        for item in section.find_all(["blockquote", "p", "div", "li"])[:5]:
            text = item.get_text(strip=True)
            if text and 20 <= len(text) <= 500:
                testimonials.append(text[:300])
        if testimonials:
            return testimonials
    return testimonials


_URGENCY_PATTERNS = re.compile(
    r"残り\d+個|在庫わずか|limited|only \d+ left|"
    r"期間限定|本日限り|ends|expires|"
    r"先着\d+名|先着順|"
    r"countdown|timer",
    re.IGNORECASE,
)


def _extract_urgency_elements(soup: BeautifulSoup) -> list[str]:
    """カウントダウン・限定数量・期間限定・先着順の緊急性要素を抽出."""
    results: list[str] = []

    # CSS selector-based detection
    for selector in [
        "[class*='countdown']", "[class*='timer']",
        "[class*='Countdown']", "[class*='Timer']",
        "[class*='urgent']", "[class*='limited']",
    ]:
        for tag in soup.select(selector):
            text = tag.get_text(strip=True)
            if text and text not in results:
                results.append(text[:200])

    # Text pattern detection
    body = soup.find("body")
    if body:
        for text_node in body.find_all(string=_URGENCY_PATTERNS):
            text = text_node.strip()
            if text and text not in results:
                results.append(text[:200])

    return results[:10]


_TRUST_BADGE_SELECTORS = [
    "img[class*='badge']", "img[class*='Badge']",
    "img[alt*='verified']", "img[alt*='Verified']",
    "img[alt*='secure']", "img[alt*='Secure']",
    "[class*='trust-badge']", "[class*='Trust-Badge']",
    "[class*='badge-container']", "[class*='certified']",
]

_TRUST_BADGE_TEXT = re.compile(
    r"ISO\s*\d+|SSL|個人情報保護|返金保証|満足保証|認定|認証|"
    r"verified|certified|secure|trusted|ssl|norton|mcafee|verisign",
    re.IGNORECASE,
)

_TRUST_BADGE_SRC = re.compile(
    r"badge|trust|secure|verisign|norton|mcafee",
    re.IGNORECASE,
)


def _extract_trust_badges(soup: BeautifulSoup) -> list[str]:
    """信頼バッジ・認証・セキュリティ表示を抽出."""
    results: list[str] = []

    # CSS selector-based
    for selector in _TRUST_BADGE_SELECTORS:
        for tag in soup.select(selector):
            text = tag.get("alt", tag.get_text(strip=True)).strip()
            if text and text not in results:
                results.append(text[:200])

    # img src pattern
    for img in soup.find_all("img", src=True):
        src = img["src"]
        if _TRUST_BADGE_SRC.search(src):
            alt = img.get("alt", "").strip()
            text = alt if alt else src.split("/")[-1]
            if text and text not in results:
                results.append(text[:200])

    # Text pattern detection
    body = soup.find("body")
    if body:
        for text_node in body.find_all(string=_TRUST_BADGE_TEXT):
            text = text_node.strip()
            if text and text not in results:
                results.append(text[:200])

    return results[:10]


_GUARANTEE_PATTERNS = re.compile(
    r"返金|保証|全額返金|満足度保証|返品|risk-free|money-back|guarantee",
    re.IGNORECASE,
)

_GUARANTEE_SELECTORS = [
    "[class*='guarantee']", "[class*='Guarantee']",
    "[class*='warranty']", "[class*='Warranty']",
    "[class*='refund']", "[class*='Refund']",
]


def _extract_guarantees(soup: BeautifulSoup) -> list[str]:
    """返金保証・満足保証・リスク反転要素を抽出."""
    results: list[str] = []

    # CSS selector-based
    for selector in _GUARANTEE_SELECTORS:
        for tag in soup.select(selector):
            text = tag.get_text(strip=True)
            if text and text not in results:
                results.append(text[:200])

    # Text pattern detection
    body = soup.find("body")
    if body:
        for text_node in body.find_all(string=_GUARANTEE_PATTERNS):
            text = text_node.strip()
            if text and text not in results:
                results.append(text[:200])

    return results[:10]


# ---------------------------------------------------------------------------
# Phase 4: 水回りCRO品質改善 — 画像・バナー・販促訴求抽出
# ---------------------------------------------------------------------------

_ALT_SKIP = re.compile(
    r"^(?:logo|icon|favicon|spacer|blank|arrow|bullet|dot|close|menu|hamburger|"
    r"search|cart|icon-|btn-|bg|background|overlay|gradient|shadow|star|rating|"
    r"sns|facebook|twitter|instagram|youtube|line|pagetop|arrow_|arrow-|"
    r"ロゴ|アイコン|矢印|メニュー|閉じる|戻る|トップへ)",
    re.IGNORECASE,
)

_BANNER_CONTAINERS = [
    "[class*='banner']", "[class*='Banner']", "[id*='banner']",
    "[class*='slider']", "[class*='Slider']", "[class*='carousel']",
    "[class*='Carousel']", "[class*='swiper']", "[class*='Swiper']",
    "[class*='promo']", "[class*='campaign']", "[class*='Campaign']",
    "[class*='ranking']", "[class*='Ranking']", "[id*='ranking']",
    "[class*='pickup']", "[class*='recommend']", "[class*='Recommend']",
    "[class*='feature']", "[class*='Feature']",
    "[class*='special']", "[class*='Special']",
]


def _extract_image_alts(soup: BeautifulSoup) -> list[str]:
    """画像のaltテキストから販促・商品情報を抽出."""
    results: list[str] = []
    for img in soup.find_all("img", alt=True, limit=100):
        alt = img["alt"].strip()
        if not alt or len(alt) < 4:
            continue
        if _ALT_SKIP.match(alt):
            continue
        # 小さいアイコンをスキップ
        w = img.get("width", "")
        h = img.get("height", "")
        try:
            if (w and int(w) < 50) or (h and int(h) < 50):
                continue
        except ValueError:
            pass
        if alt not in results:
            results.append(alt[:300])
    return results[:20]


def _extract_banner_texts(soup: BeautifulSoup) -> list[str]:
    """バナー・スライダー・ランキング・キャンペーンセクションのテキストを抽出."""
    results: list[str] = []
    for sel in _BANNER_CONTAINERS:
        for container in soup.select(sel):
            text = container.get_text(" ", strip=True)
            if text and 4 <= len(text) <= 500 and text not in results:
                results.append(text[:300])
    return results[:15]


_CONTACT_PATTERNS = re.compile(
    r"お問い合わせ|お問合せ|問い合わせ|問合せ|"
    r"見積もり|見積り|見積|御見積|"
    r"inquiry|contact|quote|estimate",
    re.IGNORECASE,
)

_CONTACT_HREF_PATTERNS = re.compile(
    r"(?:contact|inquiry|toiawase|estimate|quote|mitsumori|form)",
    re.IGNORECASE,
)


def _extract_contact_paths(soup: BeautifulSoup) -> list[str]:
    """お問い合わせ・見積り導線のリンクとテキストを抽出."""
    results: list[str] = []
    seen_hrefs: set[str] = set()

    # hrefパターンベース
    for a in soup.find_all("a", href=True, limit=200):
        href = a["href"]
        if _CONTACT_HREF_PATTERNS.search(href):
            text = a.get_text(strip=True)
            label = f"{text} → {href}" if text else href
            if href not in seen_hrefs:
                seen_hrefs.add(href)
                results.append(label[:300])

    # テキストパターンベース
    for a in soup.find_all("a", limit=200):
        text = a.get_text(strip=True)
        if text and _CONTACT_PATTERNS.search(text):
            href = a.get("href", "")
            label = f"{text} → {href}" if href else text
            if label not in results:
                results.append(label[:300])

    # buttonタグ
    for btn in soup.find_all("button", limit=50):
        text = btn.get_text(strip=True)
        if text and _CONTACT_PATTERNS.search(text) and text not in results:
            results.append(text[:300])

    return results[:10]


_PROMO_PATTERNS = re.compile(
    r"送料無料|無料配送|"
    r"\d+\s*%\s*(?:OFF|off)|割引|半額|"
    r"即日発送|最短\d+日|発送予定|\d+日.*発送|"
    r"在庫あり|在庫限り|数量限定|先着|"
    r"会員割引|初回割引|リピート割引|"
    r"ポイント\d+倍|"
    r"free shipping|discount|\d+% off|limited|in stock",
    re.IGNORECASE,
)


def _extract_promo_claims(soup: BeautifulSoup) -> list[str]:
    """送料無料・割引・納期・在庫等の販促訴求を抽出."""
    results: list[str] = []

    # テキストパターン検出
    body = soup.find("body")
    if body:
        for text_node in body.find_all(string=_PROMO_PATTERNS):
            text = text_node.strip()
            if text and text not in results:
                results.append(text[:300])

    # 画像altからの販促テキスト（バナー画像に多い）
    for img in soup.find_all("img", alt=True, limit=100):
        alt = img["alt"].strip()
        if alt and _PROMO_PATTERNS.search(alt) and alt not in results:
            results.append(alt[:300])

    # バナーセクション内テキスト
    for sel in _BANNER_CONTAINERS:
        for container in soup.select(sel):
            text = container.get_text(" ", strip=True)
            if text and _PROMO_PATTERNS.search(text) and text not in results:
                results.append(text[:300])

    return results[:15]


_CORPORATE_PATTERNS = re.compile(
    r"法人|企業|大口|一括|卸売|卸値| wholesale|business|corporate|enterprise|"
    r"開業|新築|リフォーム|リノベーション|工事|施工|"
    r"\d+年(?:の)?実績|創業\d+年|設立\d+年|年の歴史|年の実績|"
    r"導入事例|施工事例|納入実績|"
    r"正規代理店|正規販売店|認定店|特約店|"
    r"カタログ|製品情報|技術資料|仕様書",
    re.IGNORECASE,
)

_CORPORATE_SELECTORS = [
    "a[href*='business']", "a[href*='corporate']", "a[href*='b2b']",
    "a[href*='bulk']", "a[href*='wholesale']",
    "[class*='business']", "[class*='corporate']", "[class*='b2b']",
    "[class*='catalog']", "[class*='Catalog']",
]


def _extract_corporate_elements(soup: BeautifulSoup) -> list[str]:
    """法人向け導線・大口注文・カタログ・実績・代理店情報を抽出."""
    results: list[str] = []

    # セレクターベース
    for sel in _CORPORATE_SELECTORS:
        for tag in soup.select(sel):
            text = tag.get_text(strip=True)
            href = tag.get("href", "")
            if text and text not in results:
                label = f"{text} → {href}" if href else text
                results.append(label[:300])

    # テキストパターン検出
    body = soup.find("body")
    if body:
        for text_node in body.find_all(string=_CORPORATE_PATTERNS):
            text = text_node.strip()
            if text and text not in results:
                results.append(text[:300])

    # 画像altからの法人・実績情報
    for img in soup.find_all("img", alt=True, limit=100):
        alt = img["alt"].strip()
        if alt and _CORPORATE_PATTERNS.search(alt) and alt not in results:
            results.append(alt[:300])

    return results[:15]


# ---------------------------------------------------------------------------
# Offer terms extraction (agency-grade)
# ---------------------------------------------------------------------------

_OFFER_PATTERNS = re.compile(
    r"定期便|定期購入|初回|お試し|トライアル|初回限定|"
    r"割引|OFF|off|クーポン|キャンペーン|特別価格|"
    r"セット|まとめ買い|subscription|trial|discount",
    re.IGNORECASE,
)

_OFFER_SELECTORS = [
    "[class*='offer']", "[class*='Offer']",
    "[class*='campaign']", "[class*='Campaign']",
    "[class*='discount']", "[class*='Discount']",
    "[class*='trial']", "[class*='Trial']",
    "[class*='teiki']", "[class*='subscription']",
]


def _extract_offer_terms(soup: BeautifulSoup) -> list[str]:
    """定期便・初回割引・キャンペーン等のオファー条件を抽出."""
    results: list[str] = []

    for selector in _OFFER_SELECTORS:
        for tag in soup.select(selector):
            text = tag.get_text(strip=True)
            if text and len(text) >= 5 and text not in results:
                results.append(text[:200])

    body = soup.find("body")
    if body:
        for text_node in body.find_all(string=_OFFER_PATTERNS):
            text = text_node.strip()
            if text and len(text) >= 5 and text not in results:
                results.append(text[:200])

    return results[:10]


# ---------------------------------------------------------------------------
# Review signals extraction (agency-grade)
# ---------------------------------------------------------------------------

_REVIEW_SIGNAL_PATTERNS = re.compile(
    r"レビュー|口コミ|評価|★|☆|件の|お客様の声|"
    r"満足度\d|star|rating|review|testimonial",
    re.IGNORECASE,
)

_REVIEW_SIGNAL_SELECTORS = [
    "[class*='review']", "[class*='Review']",
    "[class*='rating']", "[class*='Rating']",
    "[class*='star']", "[class*='Star']",
    "[class*='voice']", "[class*='Voice']",
    "[class*='kuchikomi']",
]


def _extract_review_signals(soup: BeautifulSoup) -> list[str]:
    """レビュー件数・星評価・お客様の声の信号を抽出."""
    results: list[str] = []

    for selector in _REVIEW_SIGNAL_SELECTORS:
        for tag in soup.select(selector):
            text = tag.get_text(strip=True)
            if text and len(text) >= 3 and text not in results:
                results.append(text[:200])
            if len(results) >= 5:
                return results

    body = soup.find("body")
    if body:
        for text_node in body.find_all(string=_REVIEW_SIGNAL_PATTERNS):
            text = text_node.strip()
            if text and len(text) >= 3 and text not in results:
                results.append(text[:200])
            if len(results) >= 10:
                break

    return results[:10]


# ---------------------------------------------------------------------------
# Shipping signals extraction (agency-grade)
# ---------------------------------------------------------------------------

_SHIPPING_PATTERNS = re.compile(
    r"送料無料|送料|配送|翌日配送|即日|最短|"
    r"配達|お届け|発送|free\s*shipping|"
    r"next.day|same.day|delivery",
    re.IGNORECASE,
)

_SHIPPING_SELECTORS = [
    "[class*='shipping']", "[class*='Shipping']",
    "[class*='delivery']", "[class*='Delivery']",
    "[class*='haisou']",
    "[class*='souryo']",
]


def _extract_shipping_signals(soup: BeautifulSoup) -> list[str]:
    """送料・配送条件の信号を抽出."""
    results: list[str] = []

    for selector in _SHIPPING_SELECTORS:
        for tag in soup.select(selector):
            text = tag.get_text(strip=True)
            if text and len(text) >= 3 and text not in results:
                results.append(text[:200])

    body = soup.find("body")
    if body:
        for text_node in body.find_all(string=_SHIPPING_PATTERNS):
            text = text_node.strip()
            if text and len(text) >= 3 and text not in results:
                results.append(text[:200])

    return results[:10]
