# Hotfix Plan: LP分析品質レビュー後の修正

## Context

commit `621a6d8`（LP分析品質向上）の実装レビューで6件の問題を発見。
うち修正1（main/article内のscript混入）はレポート品質に直接影響、
修正6（「取得不可」のUI表示）はユーザー体験に直接影響するため、hotfixとして修正する。
他4件も同時に修正してまとめてデプロイする。

**対象リポジトリ:**
- Backend: `c:\Users\PEM N-266\work\market-lens-ai`（修正1-5）
- Frontend: `c:\Users\PEM N-266\work\insight-studio`（修正6）

**前提:** market-lens-ai は commit `621a6d8`、insight-studio は commit `4975ba3` が最新の状態

---

## 修正一覧

| # | 重要度 | リポ | ファイル | 問題 |
|---|--------|------|---------|------|
| 1 | **高** | backend | `web/app/extractor.py:145-151` | main/article優先抽出でscript/styleが除去されない |
| 2 | 中 | backend | `web/app/analyzer.py:141,146` | 「推測には必ず根拠を付ける」がプロンプト内で重複 |
| 3 | 中 | backend | `web/app/analyzer.py:201,206` | 同上（deep_comparison_prompt側） |
| 4 | 低 | backend | `web/app/extractor.py:258` | `import json` がforループ内（トップレベルに移動） |
| 5 | 低 | backend | `web/app/routers/discovery_routes.py:711-712` | tempfile import をループ外 + cleanup追加 |
| 6 | **高** | **frontend** | `src/pages/Compare.jsx:385-389` | 「取得不可」フィールドがUIに表示されユーザーにノイズ |

---

## 修正1: main/article内のscript/style除去（最重要）

**ファイル:** `web/app/extractor.py`
**行:** 145-151

**現状コード:**
```python
    # Phase 1: <main> or <article> があればそこを優先
    main_content = body.find("main") or body.find("article")
    if main_content:
        text = main_content.get_text(" ", strip=False)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= 200:  # 十分なコンテンツがあれば採用
            return text[:3000]
```

**修正後コード:**
```python
    # Phase 1: <main> or <article> があればそこを優先
    main_content = body.find("main") or body.find("article")
    if main_content:
        mc_copy = BeautifulSoup(str(main_content), "html.parser")
        for tag in mc_copy.find_all(["script", "style", "noscript"]):
            tag.decompose()
        text = mc_copy.get_text(" ", strip=False)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= 200:
            return text[:3000]
```

**理由:** `<main>`内にインラインJS（Google Analytics等）を含むサイトが多い。
Phase 2は既にscript/style除去しているが、Phase 1にはなかった。
BeautifulSoupコピーで作業し、元のsoupを破壊しない。

---

## 修正2: プロンプト重複行削除（build_competitive_lp_prompt）

**ファイル:** `web/app/analyzer.py`
**行:** 140-147

**現状コード:**
```
## 出力ルール
- 推測には必ず根拠を付ける
- 競合名が推定に基づく場合は「【推定】」を明記する
- 「取得不可」のフィールドは独立した評価項目としては除外するが、
  他の取得済みフィールド（特に本文抜粋）から推測可能な場合は【推定】ラベル付きで言及する
- 本文抜粋が利用可能な場合、そこからCTA文言・訴求メッセージ・価格情報を補完的に読み取る
- 推測には必ず根拠を付ける
- 具体的・実用的な提案を心がける（「CTAを改善しましょう」ではなく具体的なコピー例を提示）
```

**修正後コード（line 146の重複行を削除）:**
```
## 出力ルール
- 推測には必ず根拠を付ける
- 競合名が推定に基づく場合は「【推定】」を明記する
- 「取得不可」のフィールドは独立した評価項目としては除外するが、
  他の取得済みフィールド（特に本文抜粋）から推測可能な場合は【推定】ラベル付きで言及する
- 本文抜粋が利用可能な場合、そこからCTA文言・訴求メッセージ・価格情報を補完的に読み取る
- 具体的・実用的な提案を心がける（「CTAを改善しましょう」ではなく具体的なコピー例を提示）
```

---

## 修正3: プロンプト重複行削除（build_deep_comparison_prompt）

**ファイル:** `web/app/analyzer.py`
**行:** 200-207

**現状コード（修正2と同じパターン）:**
```
## 出力ルール
- 推測には必ず根拠を付ける
- 競合名が推定に基づく場合は「【推定】」を明記する
- 「取得不可」のフィールドは独立した評価項目としては除外するが、
  他の取得済みフィールド（特に本文抜粋）から推測可能な場合は【推定】ラベル付きで言及する
- 本文抜粋が利用可能な場合、そこからCTA文言・訴求メッセージ・価格情報を補完的に読み取る
- 推測には必ず根拠を付ける
- 具体的・実用的な提案を心がける（「CTAを改善しましょう」ではなく具体的なコピー例を提示）
```

**修正後コード（line 206の重複行を削除）:**
```
## 出力ルール
- 推測には必ず根拠を付ける
- 競合名が推定に基づく場合は「【推定】」を明記する
- 「取得不可」のフィールドは独立した評価項目としては除外するが、
  他の取得済みフィールド（特に本文抜粋）から推測可能な場合は【推定】ラベル付きで言及する
- 本文抜粋が利用可能な場合、そこからCTA文言・訴求メッセージ・価格情報を補完的に読み取る
- 具体的・実用的な提案を心がける（「CTAを改善しましょう」ではなく具体的なコピー例を提示）
```

---

## 修正4: import json をトップレベルに移動

**ファイル:** `web/app/extractor.py`

**変更1:** ファイル先頭（line 5付近）のimportブロックに`json`を追加

現状:
```python
import re
from urllib.parse import urljoin
```

修正後:
```python
import json
import re
from urllib.parse import urljoin
```

**変更2:** line 258 の `import json` を削除

現状（line 256-259）:
```python
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        if script.string and '"FAQPage"' in script.string:
            import json
            try:
```

修正後:
```python
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        if script.string and '"FAQPage"' in script.string:
            try:
```

---

## 修正5: Discovery screenshot の tempfile import整理

**ファイル:** `web/app/routers/discovery_routes.py`
**行:** 709-716

**現状コード:**
```python
                data = extract(candidate_url, html)
                # スクリーンショット撮影（改善F: オプトイン）
                if os.environ.get("DISCOVERY_SCREENSHOT", "").lower() in ("1", "true"):
                    import tempfile
                    ss_dir = tempfile.mkdtemp(prefix="discovery_ss_")
                    ss_path = os.path.join(ss_dir, f"ss_{uuid.uuid4().hex[:8]}.png")
                    ss_err = await take_screenshot(candidate_url, ss_path)
                    if not ss_err:
                        data.screenshot_path = ss_path
```

**修正後コード:**
```python
                data = extract(candidate_url, html)
                # スクリーンショット撮影（改善F: オプトイン）
                if os.environ.get("DISCOVERY_SCREENSHOT", "").lower() in ("1", "true"):
                    ss_dir = tempfile.mkdtemp(prefix="discovery_ss_")
                    ss_path = os.path.join(ss_dir, f"ss_{uuid.uuid4().hex[:8]}.png")
                    ss_err = await take_screenshot(candidate_url, ss_path)
                    if not ss_err:
                        data.screenshot_path = ss_path
                    else:
                        shutil.rmtree(ss_dir, ignore_errors=True)
```

**追加:** ファイル先頭のimportブロックに以下を追加（既にtempfileが他で使われていないか確認の上）:
```python
import tempfile
import shutil
```

ファイル先頭にimportがなければ追加、既にあればスキップ。
`import tempfile` のインライン記述（line 712）は削除。

---

## テスト追加

**ファイル:** `tests/test_extractor.py`

`TestMainArticlePriority` クラスに以下のテストを追加:

```python
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
```

---

## 実行手順

```bash
cd c:\Users\PEM N-266\work\market-lens-ai

# 1. 修正を実施（上記5件）

# 2. テスト実行
pytest tests/ -v

# 3. 全88+2テストが通過することを確認

# 4. コミット
git add web/app/extractor.py web/app/analyzer.py web/app/routers/discovery_routes.py tests/test_extractor.py
git commit -m "fix: strip script/style from main/article extraction, clean up prompt duplication and imports"

# 5. デプロイ
git push origin main
```

---

## 修正6: 抽出詳細UIから「取得不可」フィールドを非表示（Frontend）

**リポジトリ:** `c:\Users\PEM N-266\work\insight-studio`
**ファイル:** `src/pages/Compare.jsx`
**行:** 385-389

### 問題

分析結果の「抽出詳細」セクションが `JSON.stringify(extracted, null, 2)` で生JSONを表示している。
「取得不可」相当の空フィールド（`""`, `[]`, `null`）が大量に並び、ユーザーにとってノイズ。

スクリーンショット参照: Main CTA: 取得不可、Pricing: 取得不可 等が繰り返し表示されている。

**重要:** LLMプロンプト内の「取得不可」は**そのまま維持**する（analyzer.pyは変更しない）。
LLMがデータ欠損を把握して推定判断するために必要。変更するのはフロントエンドの表示のみ。

### 現状コード (Compare.jsx:385-389)

```jsx
{extracted && (
  <div className="mb-6 p-4 bg-surface-container rounded-[0.75rem] text-sm space-y-2">
    <p className="text-xs font-bold text-on-surface-variant uppercase tracking-widest mb-2">抽出データ</p>
    <pre className="text-xs text-on-surface-variant whitespace-pre-wrap overflow-x-auto">{typeof extracted === 'string' ? extracted : JSON.stringify(extracted, null, 2)}</pre>
  </div>
)}
```

### 修正後コード

```jsx
{extracted && (
  <ExtractedDataPanel extracted={extracted} />
)}
```

### 新規コンポーネント: ExtractedDataPanel

Compare.jsx内（`export default function Compare()` の前）に以下を追加:

```jsx
// 抽出データの「取得不可」フィールドを除いて表示
const EXTRACTED_LABELS = {
  title: 'タイトル',
  meta_description: 'Meta Description',
  og_type: 'OG Type',
  h1: 'H1',
  hero_copy: 'Hero Copy',
  main_cta: 'Main CTA',
  secondary_ctas: 'Secondary CTAs',
  pricing_snippet: 'Pricing',
  feature_bullets: 'Features',
  faq_items: 'FAQ',
  testimonials: '顧客の声',
  body_text_snippet: '本文抜粋',
}

function hasValue(v) {
  if (v == null || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

function formatValue(v) {
  if (Array.isArray(v)) return v.join(' / ')
  if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '…'
  return String(v)
}

function ExtractedDataPanel({ extracted }) {
  // extracted は ExtractedData のリスト（URLごと）または単一オブジェクト
  const items = Array.isArray(extracted) ? extracted : [extracted]
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-bold text-on-surface-variant uppercase tracking-widest hover:text-on-surface transition-colors"
      >
        <span className={`material-symbols-outlined text-sm transition-transform ${open ? 'rotate-90' : ''}`}>
          chevron_right
        </span>
        抽出データ ({items.length} サイト)
      </button>
      {open && (
        <div className="mt-3 space-y-4">
          {items.map((site, i) => {
            const available = Object.entries(EXTRACTED_LABELS).filter(([key]) => hasValue(site[key]))
            const total = Object.keys(EXTRACTED_LABELS).length
            return (
              <div key={site.url || i} className="p-4 bg-surface-container rounded-[0.75rem] text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-on-surface truncate max-w-[70%]">{site.url}</p>
                  <span className="text-xs text-on-surface-variant">{available.length}/{total} 取得成功</span>
                </div>
                {site.error && (
                  <p className="text-xs text-red-500">エラー: {site.error}</p>
                )}
                <div className="grid grid-cols-1 gap-1.5">
                  {available.map(([key, label]) => (
                    <div key={key} className="flex gap-2 text-xs">
                      <span className="font-bold text-on-surface-variant shrink-0 w-32">{label}</span>
                      <span className="text-on-surface break-all">{formatValue(site[key])}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

### 設計ポイント

1. **デフォルト折りたたみ** — レポート本文を邪魔しない。興味あるユーザーだけ開く
2. **空フィールド非表示** — `hasValue()` で `""`, `[]`, `null` をフィルタ。「取得不可」は表示しない
3. **取得率表示** — `{available.length}/{total} 取得成功` でデータ品質を一目で把握可能
4. **URLごとにカード分割** — 複数URL比較時に見やすい
5. **本文抜粋は200文字で切り詰め** — UI崩れ防止
6. **useStateは既にimport済み** — Compare.jsx:1 に `import { useState, useCallback } from 'react'`

### ビルド検証

```bash
cd c:\Users\PEM N-266\work\insight-studio
npm run build
```

---

## 実行手順

### Backend（market-lens-ai）修正1-5

```bash
cd c:\Users\PEM N-266\work\market-lens-ai

# 1. 修正1-5を実施
# 2. テスト実行
pytest tests/ -v
# 3. 全88+2テスト（90件）通過を確認
# 4. コミット
git add web/app/extractor.py web/app/analyzer.py web/app/routers/discovery_routes.py tests/test_extractor.py
git commit -m "fix: strip script/style from main/article extraction, clean up prompt duplication and imports"
# 5. デプロイ
git push origin main
```

### Frontend（insight-studio）修正6

```bash
cd c:\Users\PEM N-266\work\insight-studio

# 1. 修正6を実施
# 2. ビルド検証
npm run build
# 3. コミット
git add src/pages/Compare.jsx
git commit -m "fix: replace raw JSON extraction display with filtered collapsible panel"
# 4. デプロイ
git push origin main
```

**デプロイ順序:** 独立。どちらが先でも問題ない。

---

## 注意事項

- **レポート生成は壊さない:** 全ての変更は既存の出力フォーマットを維持する
- **LLMプロンプト内の「取得不可」は維持:** analyzer.py の `_format_site_data()` は変更しない
- **analyzer.pyのプロンプト変更** は1行削除のみ。LLMの出力形式に影響しない
- **修正1が最も重要:** `<main>`内のインラインJSが body_text_snippet に混入する現行バグを修正
- **修正6のUX改善:** 「取得不可」の羅列が消え、取得できたデータのみ表示される
- **テスト:** backend 90件通過 + frontend `npm run build` 成功
- 修正5のshutil.rmtreeは `ignore_errors=True` で安全にフェイルする（ファイルロック等）
