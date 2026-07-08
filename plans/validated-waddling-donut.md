# 実装レビュー & 追加改善プラン: LP比較分析 — URL状態保持 & 分析精度向上

## 実装レビュー結果

### Workstream A: URL Draft Persistence（Frontend）— 評価: A

実装は計画通り、かつ品質も高いのじゃ♡

| 項目 | 評価 | 詳細 |
|------|------|------|
| AnalysisRunsContext draft機能 | ✅ 完璧 | sessionStorage + try/catch + notify()パターン |
| Compare.jsx draft連携 | ✅ 完璧 | 3段階フォールバック（draft → run.input → defaults） |
| Discovery.jsx draft連携 | ✅ 完璧 | 同上パターン |
| handleRetry でドラフト保持 | ✅ 正しい | clearRunのみ、clearDraftなし |
| handleClear 追加 | ✅ 正しい | clearRun + clearDraft + state reset |
| ビルド通過 | ✅ | commit 4975ba3 |

**軽微な指摘（修正不要）:**
- `getDraft`がnotify()を呼ばないのは正しい（読み取りのみなので再レンダリング不要）
- DRAFT_PREFIX `'is-draft-'` は insight-studio の略で命名規則が明確

### Workstream B: LP分析精度向上（Backend）— 評価: A-

実装の品質は高いが、**さらに精度を上げられるポイント**が複数発見されたのじゃ♡

| 項目 | 評価 | 詳細 |
|------|------|------|
| body snippet nav除去 | ✅ 正しい | soupコピーで安全に操作 |
| 条件付きheader除去 | ✅ 正しい | nav含む or リンク4つ以上のheaderのみ除去 |
| 3000文字制限 | ✅ | 1000→3000 |
| プロンプト2000文字 | ✅ | 500→2000 |
| Hero Copy日本語セレクタ | ✅ | mv/mainvisual/kv/visual/banner/intro/role=banner |
| CTA拡張 | ✅ | mv/kv + href pattern + submit button |
| H1フォールバック | ✅ | og:title → title の順 |
| テスト更新 | ✅ | 1件修正 + 10件追加、全46テスト通過 |

**発見された問題点:**

#### 問題1: `[class*='visual'] p` セレクタが広すぎる（リスク: 中）

[extractor.py:69](../../market-lens-ai/web/app/extractor.py) の `[class*='visual'] p` は `visual` を含む全クラスにマッチする。
例: `class="visual-hidden"`, `class="invisible"`, `class="audiovisual-player"` など意図しない要素にヒットする可能性。

**推奨:** 現状でエラーにはならないが、誤ったhero copyが返るケースがあり得る。
後述の改善案で対応。

#### 問題2: `button[type='submit']` がフォーム送信ボタンを拾う（リスク: 低）

[extractor.py:97](../../market-lens-ai/web/app/extractor.py) — 「ログイン」「検索」などのsubmitボタンが
main CTAとして誤検出される可能性。セレクタ順序が低いため影響は限定的。

#### 問題3: H1フォールバックで `title` が既にローカル変数で定義されている

[extractor.py:33-36](../../market-lens-ai/web/app/extractor.py) — `title_tag` で新たにfindしているが、
line 16-18で既に`title`変数に値が入っている。二重取得は無害だが冗長。

```python
# 現状（line 33-36）
if not h1:
    title_tag = soup.find("title")      # 2回目のfind
    if title_tag and title_tag.string:
        h1 = title_tag.string.strip()

# 最適化版
if not h1 and title:
    h1 = title                          # 既存変数を再利用
```

---

## 追加改善提案: 分析精度をさらに上げるために

以下は**レポート生成を壊さず**、**エラーリスクを最小限に**しつつ精度を上げる提案じゃ♡

### 優先度: 高（即効性あり、リスク低）

#### 改善A: プロンプトに「部分データ活用」指示を追加

**問題:** 現在のプロンプトは `「取得不可」のデータは分析から除外` と指示している（[analyzer.py:122](../../market-lens-ai/web/app/analyzer.py), [analyzer.py:173](../../market-lens-ai/web/app/analyzer.py)）。
これだと、body_textだけ取れてhero_copyが取れないサイトで、body_textの中にあるヒーロー的な内容も無視される。

**修正案:**
```
## 出力ルール
- 「取得不可」のフィールドは独立した評価項目としては除外するが、
  他の取得済みフィールド（特に本文抜粋）から推測可能な場合は【推定】ラベル付きで言及する
- 本文抜粋が利用可能な場合、そこからCTA文言・訴求メッセージ・価格情報を補完的に読み取る
- 推測には必ず根拠を付ける
```

**リスク:** なし。プロンプト変更のみ。LLMの出力品質が上がるだけ。
**期待効果:** 「取得不可」だらけのサイトでも、body_textから情報を拾って分析品質が向上。

#### 改善B: データ取得状況サマリをプロンプトに追加

**問題:** LLMは各フィールドの「取得不可」を個別に見ているが、全体的な取得品質を把握できない。

**修正案:** `_format_site_data()` に取得率サマリを追加:
```python
def _format_site_data(data: ExtractedData) -> str:
    fields = {
        'タイトル': data.title, 'Meta Description': data.meta_description,
        'H1': data.h1, 'Hero Copy': data.hero_copy, 'Main CTA': data.main_cta,
        'Pricing': data.pricing_snippet, 'Features': bool(data.feature_bullets),
        'Body Text': data.body_text_snippet,
    }
    available = sum(1 for v in fields.values() if v)
    total = len(fields)
    # ... 既存のフォーマット ...
    return f"""### {data.url}
- **データ取得率**: {available}/{total} フィールド取得成功
- **タイトル**: {data.title or '取得不可'}
...
"""
```

**リスク:** 極めて低い。フォーマット文字列の追加のみ。
**期待効果:** LLMが取得品質を把握し、推定の信頼度を適切に調整。

#### 改善C: `_extract_body_snippet`でメインコンテンツ優先抽出

**問題:** nav/footer除去後も、サイドバーやウィジェット等の非コンテンツ要素が混入する。
`<main>` や `<article>` タグがあれば、そこだけ抽出する方が精度が高い。

**修正案:**
```python
def _extract_body_snippet(soup: BeautifulSoup) -> str:
    body = soup.find("body")
    if not body:
        return ""
    
    # Phase 1: <main> or <article> があればそこを優先
    main_content = body.find("main") or body.find("article")
    if main_content:
        text = main_content.get_text(" ", strip=False)
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) >= 200:  # 十分なコンテンツがあれば採用
            return text[:3000]
    
    # Phase 2: フォールバック（既存ロジック）
    body_copy = BeautifulSoup(str(body), "html.parser").find("body")
    for tag in body_copy.find_all(["script", "style", "noscript", "nav", "footer"]):
        tag.decompose()
    for tag in body_copy.find_all(attrs={"role": "navigation"}):
        tag.decompose()
    for header in body_copy.find_all("header"):
        if header.find("nav") or len(header.find_all("a")) > 3:
            header.decompose()
    text = body_copy.get_text(" ", strip=False)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:3000]
```

**リスク:** 低い。`<main>` タグが存在しないサイトは既存ロジックにフォールバック。
200文字の閾値で、空の`<main>`タグに騙されるのも防止。
**期待効果:** セマンティックHTML対応サイトで大幅な品質向上。サイドバー混入が消える。

### 優先度: 中（効果大だが若干の実装コスト）

#### 改善D: スクリーンショットを活用した分析プロンプト強化

**発見:** Scan pipelineは既にPlaywrightでスクリーンショットを撮影し、
マルチモーダル分析に使っている（[scan_service.py:82-84](../../market-lens-ai/web/app/services/scan_service.py)）。
しかし、プロンプトにスクリーンショットの活用方法が明示されていない。

**修正案:** `build_competitive_lp_prompt()` の末尾に追加:
```
## スクリーンショット分析（画像が添付されている場合）
- ファーストビューの視覚的階層（何が最も目立つか）を評価
- テキスト抽出結果と視覚的な配置の一致度を確認
- 抽出データが「取得不可」でも、スクリーンショットから読み取れる情報は分析に活用
- デザインの洗練度、ブランド一貫性、CTA視認性を視覚的に評価
```

**リスク:** なし。スクリーンショットがない場合、LLMはこのセクションを無視するだけ。
**期待効果:** テキスト抽出が貧弱なサイトでも、視覚情報から分析品質を補完。

#### 改善E: 複数CTA・FAQ・テスティモニアル抽出

**問題:** 現在はmain_ctaが1つだけ。モダンLPは複数のCTAやFAQセクションを持つ。

**修正案（ExtractedData拡張）:**
```python
class ExtractedData(BaseModel):
    # ... 既存フィールド ...
    secondary_ctas: list[str] = Field(default_factory=list)  # 追加CTA
    faq_items: list[str] = Field(default_factory=list)       # FAQ Q&A
    testimonials: list[str] = Field(default_factory=list)     # 顧客の声
```

**リスク:** 中。モデル変更は既存APIレスポンスに影響しないが（追加フィールドは`[]`デフォルト）、
テスト更新が必要。
**期待効果:** LP分析の網羅性が大幅に向上。特にFAQは顧客の懸念事項を示す重要データ。

#### 改善F: Discovery pipelineにもスクリーンショット撮影を追加

**発見:** Discovery pipelineは競合URLをフェッチするが、スクリーンショットを撮らない。
[discovery_routes.py:682-728](../../market-lens-ai/web/app/routers/discovery_routes.py)

Scan pipelineは撮影している（[scan_service.py:82](../../market-lens-ai/web/app/services/scan_service.py)）。

**修正案:** `_fetch_one()` 内で `take_screenshot()` を並列実行。

**リスク:** 中。Render無料プランのメモリ制限でPlaywright起動がOOMの可能性。
**期待効果:** Discovery Hubの分析品質が飛躍的に向上（テキスト+視覚の二軸分析）。

### 優先度: 低（大規模改修）

#### 改善G: Playwright HTMLレンダリング（SPA対応）

fetchがhttpxの静的取得のため、SPA/JSレンダリングサイトのコンテンツが取れない。
Playwrightで`page.content()`を使えばJSレンダリング後のHTMLが取れるが、
パフォーマンスコストが大きい。

**推奨:** 当面は見送り。改善A-Cで「取得済みデータの活用度」を上げる方が費用対効果が高い。

---

## 実装戦略（Agent Team構成）

タスク量が多いため、以下のAgent Team構成を推奨:

### Phase 1: 即時改善（プロンプト＆抽出強化）

| Agent | 担当リポ | タスク | 推定時間 |
|-------|---------|--------|---------|
| **Agent A** | market-lens-ai | 改善A + B: プロンプト修正（`_format_site_data`, 出力ルール変更） | 15分 |
| **Agent B** | market-lens-ai | 改善C: `_extract_body_snippet` に main/article 優先抽出 | 15分 |
| **Agent C** | market-lens-ai | 改善D: スクリーンショット活用プロンプト + テスト更新 | 15分 |

### Phase 2: 構造的改善（Optional）

| Agent | 担当リポ | タスク | 推定時間 |
|-------|---------|--------|---------|
| **Agent D** | market-lens-ai | 改善E: ExtractedData拡張 + 抽出関数 + テスト | 30分 |
| **Agent E** | market-lens-ai | 改善F: Discovery screenshot撮影 | 20分 |

### デプロイ

- Phase 1 完了後に Render デプロイ → 即座に効果確認可能
- Phase 2 は Phase 1 の効果を見てから判断

---

## 検証方法

### 既存実装の動作確認
1. Compareページ: URL3件入力 → Discovery遷移 → 戻る → URL残存 ✓
2. F5リフレッシュ → URL残存 ✓  
3. エラー → リトライ → URL残存 ✓
4. クリア → URL消去 ✓

### 追加改善の効果測定
1. 改善前: HDC大阪 + 住宅博で分析 → 「取得不可」数とbody_text内容を記録
2. 改善後: 同じURLで再分析 → 比較
3. 定量指標:
   - 「取得不可」フィールド数の減少
   - body_textにナビ文字列が含まれないこと
   - 「推定」ラベル付きの補完分析が出力されること
4. `pytest tests/ -v` 全テスト通過

---

## 軽微な修正（すぐ直せる）

### H1フォールバックの冗長コード修正
[extractor.py:33-36](../../market-lens-ai/web/app/extractor.py)
```python
# Before
if not h1:
    title_tag = soup.find("title")
    if title_tag and title_tag.string:
        h1 = title_tag.string.strip()

# After（既存のtitle変数を再利用）
if not h1 and title:
    h1 = title
```
