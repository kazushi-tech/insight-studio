# Compare/Scan 分析レポート品質改善 Phase 3

## Context

Phase 2（hero nav filter + body widget cleanup + prompt quality guard）デプロイ後、本番環境で hits-online.jp vs cera.co.jp の Compare 分析レポートを実行した結果、以下の品質問題が残存。

**デプロイ後に確認された問題（スクリーンショットレビュー）:**

| # | 問題 | 影響度 | 根本原因 |
|---|------|--------|---------|
| 1 | Hero Copy hits: 「タオルバータオルリング」（カテゴリリンク内テキスト） | CRITICAL | `<a>` タグ内の `<p>` を除外していない |
| 2 | Hero Copy cera: 「セラトレーディングについて」（Aboutリンクテキスト） | CRITICAL | `<a>` タグ内の `<span>` を除外していない + 「〜について」パターン未対応 |
| 3 | 本文抜粋 hits: 「TOP SEARCHES 検索数の多いワード フック タオルバー...」 | HIGH | `<section class="tp-section __keywords">` が class フィルターに未該当 + `<main>` タグなし |
| 4 | 本文抜粋 cera: 「GALLERY ギャラリー...MORE SPACE...SEARCH BATHROOM」 | HIGH | セクション見出し(h2)がそのまま混入 + `<main>` タグなし |
| 5 | Completion Tokens = 4096（上限ぴったり到達） | HIGH | 出力フォーマットが冗長で4096トークンに収まらない |

**Phase 2 で正常に機能しているもの:**
- LP種別識別（EC基準/コーポレート基準）✓
- スコアリング基準タグ付与 ✓
- データ制限・本文推定タグ ✓
- 異種サイト間スコア直接比較回避 ✓

---

## HTML構造分析（curl で確認済み）

### hits-online.jp — Hero Copy 根本原因
```html
<section class="tp-section __keywords">
  <h2 class="tp-section_ttl"><span>TOP SEARCHES</span>検索数の多いワード</h2>
  <a href="/category/towel" class="tp-keywords">
    <div class="tp-keywords_main">
      <p class="tp-keywords_name">タオルバー<br>タオルリング</p>  ← これが pick される
    </div>
  </a>
</section>
```
- `section:first-of-type` コンテナセレクターがマッチ
- `<p>` が `_HERO_TEXT_TAGS` 先頭なので最優先で pick
- **`<a>` タグ内にある** → リンクテキスト除外で解決可能

### cera.co.jp — Hero Copy 根本原因
```html
<a href="/about/" class="gnav_btn gnav_aboutBtn g05">
  <span><span>セラトレーディングについて</span></span>  ← これが pick される
</a>
```
- `header` コンテナセレクターがマッチ
- `<nav>` タグ内ではない（`<div>` 内のリンク列）→ nav祖先チェックが効かない
- **`<a>` タグ内にある** → リンクテキスト除外で解決可能

### 本文抜粋 — 共通の根本原因
- 両サイトとも `<main>` / `<article>` タグなし → body fallback 使用
- hits: `class="tp-section __keywords"` は `sidebar|widget|breadcrumb|search-box|search-form` のどれにもマッチしない
- cera: セクション見出し (`<h2>GALLERY ギャラリー</h2>`) が `get_text()` でそのまま混入

---

## 変更対象ファイル（market-lens-ai リポ）

| ファイル | 変更内容 |
|---------|---------|
| `web/app/extractor.py` | Hero Copy `<a>` 祖先除外 + `について$` フィルタ + body snippet `<p>` 優先フェーズ |
| `web/app/analyzer.py` | Compare プロンプト出力フォーマット圧縮 |
| `tests/test_extractor.py` | Hero Copy リンク除外テスト + body snippet `<p>` フェーズテスト |
| `tests/test_analyzer.py` | プロンプト変更に伴うアサーション更新 + 新規テスト |

---

## 変更 1: Hero Copy `<a>` 祖先除外 + 「について」フィルタ（CRITICAL）

### 1A. `_extract_hero_copy()` に `<a>` 祖先チェック追加

**ファイル**: `web/app/extractor.py` line 98-100

```python
def _extract_hero_copy(soup: BeautifulSoup) -> str:
    for container_sel in _HERO_CONTAINERS:
        for tag_name in _HERO_TEXT_TAGS:
            sel = f"{container_sel} {tag_name}"
            for tag in soup.select(sel):
                if tag.find_parent("nav"):
                    continue
                if tag.find_parent("a"):       # ← NEW
                    continue
                text = tag.get_text(strip=True)
                if text and len(text) >= 8 and not _HERO_GARBAGE.search(text):
                    if _HERO_NAV_LABELS.match(text):
                        continue
                    return text
    return ""
```

**設計判断**: `<a>` 内のテキストはナビゲーションリンク・カテゴリリンクであり、マーケティングコピーではない。真のヒーローコピー（キャッチコピー、バリュープロポジション）はリンクに包まれない。

### 1B. `_HERO_GARBAGE` に「について$」追加

**ファイル**: `web/app/extractor.py` line 66-70

```python
_HERO_GARBAGE = re.compile(
    r"ようこそ|ゲスト|ログイン|ログアウト|カート|cookie|"
    r"toggle|menu|search|検索|閉じる|開く|マイページ|"
    r"について$",
    re.IGNORECASE,
)
```

**設計判断**: `$` アンカーにより「〜について」で終わるテキスト（About系リンク）のみ除外。「について」を文中に含む正当なコピー（例: 「最新製品についてご紹介」）は弾かない。`<a>` 祖先チェックの二重防御として機能。

### テスト

`tests/test_extractor.py` に `TestHeroCopyLinkExclusion` クラスを追加:

| テスト名 | 入力 HTML | 期待結果 |
|---------|----------|---------|
| `test_hero_skips_p_inside_link` | hits構造: `<section><a><p>タオルバータオルリング</p></a></section><section><p>高品質な住宅設備をお届けします</p></section>` | hero = 「高品質な住宅設備をお届けします」 |
| `test_hero_skips_span_inside_nav_link` | cera構造: `<header><a class="gnav_btn"><span>セラトレーディングについて</span></a><div class="hero"><p>上質な空間をデザインする</p></div></header>` | hero = 「上質な空間をデザインする」 |
| `test_hero_accepts_p_not_inside_link` | `<div class="hero"><p>革新的なソリューションを提供</p></div>` | hero = 「革新的なソリューションを提供」 |
| `test_hero_accepts_h2_next_to_link` | `<div class="hero"><a href="/promo"><img></a><h2>この春、新しいバスルームを</h2></div>` | hero に「バスルーム」を含む |

---

## 変更 2: 本文抜粋 `<p>` タグ優先フェーズ追加（HIGH）

### 2A. Phase 1.5 を Phase 1 と Phase 2 の間に挿入

**ファイル**: `web/app/extractor.py` `_extract_body_snippet()` 内

`<main>`/`<article>` が存在しないか200文字未満の場合、**`<p>` タグのみからテキストを収集する中間フェーズ**を挿入。ナビ/ウィジェットのテキストは `<h2>`, `<div>`, `<span>` に入っていることが多く、`<p>` タグは散文コンテンツの最も信頼性の高いシグナル。

```python
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
```

### 2B. Phase 2 フォールバックのクラスフィルター拡張

既存パターンに追加:
```python
class_=re.compile(r"sidebar|widget|breadcrumb|search-box|search-form|keyword|tag-cloud|popular|ranking")
```

`keyword` 追加で hits-online.jp の `class="tp-section __keywords"` をカバー。

### テスト

`tests/test_extractor.py` に `TestBodySnippetParagraphPhase` クラスを追加:

| テスト名 | 入力 HTML | 期待結果 |
|---------|----------|---------|
| `test_p_phase_skips_keyword_section` | hits構造: keyword `<section>` + `<a>` 内 `<p>` + 本文 `<p>` | "TOP SEARCHES" を含まない、本文を含む |
| `test_p_phase_skips_gallery_headings` | cera構造: gallery `<h2>` + 本文 `<p>` | "GALLERY" を含まない、本文を含む |
| `test_p_phase_falls_back_when_too_short` | 短い `<p>` + 長い `<div>` | Phase 2 フォールバックで `<div>` テキストを含む |
| `test_p_phase_skips_footer_paragraphs` | 本文 `<p>` + footer 内 `<p>` | "Copyright" を含まない |

### 既存テスト互換性

| テスト | 影響 | 理由 |
|--------|------|------|
| `test_main_tag_prioritized` | なし | Phase 1 で処理済み |
| `test_short_main_falls_back` | なし | `<main>` 短い→Phase 1.5→`<p>` も短い→Phase 2 |
| `test_body_excludes_aside` | なし | Phase 1.5 で `<aside>` 内スキップ→200文字未満→Phase 2 |
| `TestBodySnippetWidgetExclusion` | なし | Phase 1.5 の `<a>` 内/ancestor スキップでカバー |

---

## 変更 3: Compare プロンプト出力フォーマット圧縮（HIGH）

### 3A. `build_deep_comparison_prompt()` の出力構成圧縮

**ファイル**: `web/app/analyzer.py` `build_deep_comparison_prompt()`

**現状の問題**: 4セクション（総合サマリー + 個別プロファイリング×2 + 競合比較テーブル + アクション提案×3/site）= 4096トークンを確実に超過

**圧縮方針**:
1. **4セクション → 3セクション**: 個別プロファイリングと競合比較テーブルを統合
2. **7スコア軸 → 5スコア軸**: モバイル最適化（常に推定）と価格戦略（独立軸には不要）を統合
3. **アクション3つ/site → 2つ/site**: 高インパクト施策に集中
4. **「合計1500文字以内」制約を明示**: LLMに簡潔さを強制

```python
## 出力構成（簡潔に）

### 1. 総合サマリー
| ブランド | LP種別 | 評価 | 一言要約 | 最優先改善 |

### 2. 比較分析
各サイトのLP種別・ターゲット仮説（根拠つき）を述べた後:
| 観点 | サイトA | サイトB |
FV訴求力 / CTA設計 / ベネフィット訴求 / 信頼要素 / 情報設計
各セルに スコア(1-5) + 一言根拠。

### 3. アクション提案
各サイト2つずつ:
| サイト | 優先度 | 提案 | 具体的コピー/施策例 |
優先度: S（即実行）/ A（1週間以内）。抽象表現禁止。

## 出力ルール
- 合計1500文字以内で簡潔に
```

**トークン見積り**: サマリー~80 + 比較分析~400 + アクション~300 + 遷移~100 ≒ 880トークン（4096の余裕内）

### 3B. テスト更新

プロンプト変更に伴い以下のテストを更新:

| テスト | 変更 |
|--------|------|
| `test_deep_comparison_has_lp_scoring` | "LP効果スコア" → "スコア(1-5)" に変更 |
| `test_deep_comparison_has_mobile_evaluation` | "モバイル最適化" 個別軸は削除 → "情報設計" に変更 |
| `test_deep_comparison_has_pricing_analysis` | "価格戦略" "定期購入" → 削除 or "ベネフィット" 確認に変更 |
| `test_deep_comparison_has_scoring_calibration` | "LP評価の基準" → "LP評価基準" に変更 |
| `test_deep_comparison_has_score_basis_tags` | "(D2C基準)" → "(EC基準)" に変更 |
| `test_contains_comparison_table_header` | "CROコンサルタント" → "CRO分析" に変更 |
| `test_prompt_has_nav_label_rule` | "ナビゲーションラベル" → "【注意】" 確認に変更 |
| `test_prompt_has_data_quality_guard` | "データ制限" → "推定ベース" 確認に変更 |

---

## 実装順序

```
テスト先行: 変更1テスト → 変更1実装 → 変更2テスト → 変更2実装 → 変更3テスト更新 → 変更3実装
```

---

## 検証手順

### 1. ユニットテスト
```bash
cd "c:/Users/PEM N-266/work/market-lens-ai"
.venv/Scripts/python.exe -m pytest tests/test_extractor.py tests/test_analyzer.py -v
```

### 2. 既存テストリグレッション確認
```bash
.venv/Scripts/python.exe -m pytest -v
```

### 3. コミット & デプロイ
```bash
git add web/app/extractor.py web/app/analyzer.py tests/test_extractor.py tests/test_analyzer.py
git commit -m "fix: Compare report quality Phase 3 — hero link exclusion + p-tag body extraction + prompt compression"
git push origin main
```

### 4. 本番 E2E 確認（デプロイ後）
hits-online.jp + cera.co.jp で Compare 再実行し以下を確認:
- Hero Copy が「タオルバータオルリング」「セラトレーディングについて」ではないこと
- 本文抜粋が「TOP SEARCHES」「GALLERY ギャラリー」で始まらないこと
- Completion Tokens が 4096 未満で完結していること（レポート途中切断なし）

---

## 明示的な非目標

- **token_budget 変更**: 4096 のまま変更しない
- **timeout 増加**: ユーザーフィードバックで禁止
- **外部 NLP ライブラリ追加**: 形態素解析等は使わない
- **ExtractedData モデル変更**: 新フィールド追加しない
- **Playwright ベース抽出**: 静的 HTML 抽出の範囲内で対処
