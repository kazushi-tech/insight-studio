# Discovery Hub: フェッチ改善 + 画像フォールバック + 補完分析廃止

## Context

Discovery Hub の再実行で2つの問題が発生:
1. **画像が全滅**: 発見された5サイト全てに og:image / twitter:image メタタグが存在しない → `og_image_url=None` は正しい動作だが、ユーザー体験が悪い
2. **補完分析（不要）**: advan.co.jp が 404 → search_result_fallback で補完分析されたが、ユーザーは補完分析を不要と明言

根本原因:
- **フェッチャー**: User-Agent `MarketLensAI/0.1` はボット検知で弾かれやすい。タイムアウト15秒は短い。リトライなし
- **画像抽出**: メタタグのみ対応。日本の中小ECサイトはOGP未設定が多い
- **補完分析**: fetch失敗時に検索スニペットで分析するが、品質が低くユーザーが不要と判断

## 変更対象 (market-lens-ai リポのみ)

| # | ファイル | 変更内容 |
|---|---------|---------|
| 1 | `web/app/fetcher.py` | ブラウザ偽装ヘッダー + リトライ + タイムアウト増 |
| 2 | `web/app/extractor.py` | HTML body からの画像フォールバック抽出 |
| 3 | `web/app/routers/discovery_routes.py` | 補完分析を廃止、タイムアウトデフォルト25秒に |
| 4 | `tests/test_extractor.py` | body画像フォールバックのテスト追加 |
| 5 | `tests/test_discovery_analyze.py` | fallback→failed に変更されたアサーション更新 |

---

## Task 1: フェッチャー改善 (`web/app/fetcher.py`)

`fetch_html()` を以下のように強化:

- **User-Agent**: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
- **ヘッダー追加**: `Accept: text/html,...`, `Accept-Language: ja,en;q=0.9`
- **リトライ**: 最大3回（初回 + 2リトライ）、待機1秒→3秒
  - リトライ対象: `httpx.ConnectError`, `httpx.TimeoutException`, HTTP 5xx
  - リトライ非対象: HTTP 4xx（確定的な失敗）
- **タイムアウトデフォルト**: 15s → 25s
- `httpx.AsyncClient` はリトライループの外で1回だけ作成（コネクションプール再利用）

```python
_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en;q=0.9",
}

async def fetch_html(url: str, timeout: float = 25.0) -> tuple[str, Optional[str]]:
    max_retries = 2
    last_error = ""
    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        for attempt in range(max_retries + 1):
            try:
                resp = await client.get(url, headers=_BROWSER_HEADERS)
                resp.raise_for_status()
                return resp.text, None
            except httpx.HTTPStatusError as e:
                if e.response.status_code >= 500 and attempt < max_retries:
                    await asyncio.sleep(1 + 2 * attempt)
                    continue
                return "", f"HTTP {e.response.status_code}"
            except (httpx.ConnectError, httpx.TimeoutException) as e:
                last_error = str(e)
                if attempt < max_retries:
                    await asyncio.sleep(1 + 2 * attempt)
                    continue
            except Exception as e:
                return "", str(e)
    return "", last_error
```

---

## Task 2: Body画像フォールバック (`web/app/extractor.py`)

`_extract_og_image()` の末尾（`return None` の前）で `_extract_body_image()` を呼ぶ:

```python
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
```

`_extract_og_image` の末尾を変更:
```python
    # 既存のメタタグチェック後...
    # Fallback: body内の目立つ画像
    return _extract_body_image(soup, base_url)
```

---

## Task 3: 補完分析廃止 (`web/app/routers/discovery_routes.py`)

### 3-A: タイムアウトデフォルト変更 (L527)
```python
_competitor_fetch_timeout = float(os.getenv("DISCOVERY_COMPETITOR_FETCH_TIMEOUT_SEC", "25"))
```

### 3-B: 補完分析ブランチを失敗に変更 (L751-762)

変更前:
```python
if _can_use_search_result_fallback(validation_errors, fetch_errors):
    data = _build_search_result_fallback(cand, fallback_url, error_summary)
    return FetchedSite(..., analysis_source=_SEARCH_RESULT_ANALYSIS_SOURCE, error=None), data
```

変更後:
```python
return FetchedSite(
    url=fallback_url,
    domain=extract_domain(fallback_url) or cand.domain,
    title=cand.title or cand.domain,
    description=cand.snippet or "",
    analysis_source=_FAILED_ANALYSIS_SOURCE,
    error=f"取得失敗: {error_summary}",
), None
```

`_can_use_search_result_fallback()` と `_build_search_result_fallback()` は削除。

---

## Task 4: テスト更新

### test_extractor.py — body画像フォールバックテスト追加
- `test_body_image_fallback_when_no_meta_tags`: OGPなし + body `<img>` あり → URL取得
- `test_body_image_skips_tiny_images`: width=1 の画像はスキップ
- `test_body_image_skips_tracking_pixels`: パス名に `tracking`/`pixel` → スキップ
- `test_body_image_resolves_relative_urls`: 相対パス → urljoin で解決

### test_discovery_analyze.py — fallback→failed アサーション更新
- `search_result_fallback` を `failed` に変更する箇所を特定して修正

---

## 検証

1. `python -m pytest tests/test_extractor.py tests/test_discovery_analyze.py -v` — 全テスト通過
2. `python -m pytest tests/ -v` — 全体回帰テスト通過
3. git commit & push → Render デプロイ
4. Discovery Hub で `https://hits-online.jp/` を再実行:
   - LP カードに body 画像が表示される
   - 補完分析が表示されない（失敗は「取得失敗」として表示）
   - フェッチ成功率が向上
