# Plan: LP比較分析 — URL状態保持 & 分析精度向上

## Context

LP比較分析ページでURLを入力後、競合発見ページに遷移して戻ると入力内容が消失する。
React Routerがコンポーネントをアンマウントし、useStateのローカル状態が破棄されるため。

また、LP比較分析の精度について徹底レビューを実施。主な品質問題：
- HTML抽出のCSSセレクタが狭すぎて多くの要素が「取得不可」になる
- body_text_snippetが1000文字抽出→プロンプトでさらに500文字に切り詰め
- JS未実行のためSPA/動的サイトの内容が取れない
- 抽出失敗時のフォールバックが不十分

---

## Part 1: URL入力状態の保持（Frontend — insight-studio）

### 問題
- `Compare.jsx:138` — `useState(() => run?.input?.urls || { target: '', compA: '', compB: '' })`
- `run.input.urls`は`startRun()`実行時（分析開始時）のみセットされる
- 入力途中でページ遷移するとローカルstateが消滅

### 実装方針
AnalysisRunsContextに**ドラフト保存機能**を追加する。

#### Step 1: AnalysisRunsContextにdraft機能追加
- `src/contexts/AnalysisRunsContext.jsx`
- `drafts` Mapを追加（runs Mapと同様）
- `setDraft(kind, data)` / `getDraft(kind)` / `clearDraft(kind)` を追加
- ドラフトはメモリ内保持（sessionStorageは不要 — Contextはアプリ全体で生存）

#### Step 2: Compare.jsxでドラフト活用
- `src/pages/Compare.jsx`
- 初期値: `getDraft('compare')?.urls || run?.input?.urls || { target: '', compA: '', compB: '' }`
- URL変更時に`setDraft('compare', { urls })` で即座に保存
- 分析開始時は既存通り`startRun()`、ドラフトはクリアしない
- `clearRun`呼び出し時にドラフトもクリア

#### Step 3: Discovery.jsxにも同様適用（同じ問題あり）
- `src/pages/Discovery.jsx`
- 入力URLのドラフト保存を追加

---

## Part 2: LP分析精度レビュー結果

### 現状の問題点（実際のレポートから）

| 項目 | HDC大阪 | 住宅博 | 問題 |
|------|---------|--------|------|
| H1 | 取得不可 | 正常取得 | セレクタで見つからない |
| Hero Copy | 「本文へスキップ」（ナビ文） | 取得不可 | 間違った要素を取得 |
| Main CTA | 取得不可 | 取得不可 | ボタンセレクタが合わない |
| Pricing | 取得不可 | 取得不可 | 情報提供サイトなので妥当 |
| Body Text | ナビメニュー文字列 | ナビメニュー文字列 | 500文字では本文に到達しない |

### 根本原因分析

1. **CSSセレクタが狭い** — `[class*='hero']`等、特定のクラス名パターンのみ
2. **Body textが短すぎる** — 抽出1000字→プロンプト500字。日本語サイトのナビ・ヘッダーだけで消費
3. **ナビゲーション文字列の混入** — `<nav>`, `<header>`内のリンクテキストが本文に入る
4. **JS未実行** — BeautifulSoup静的解析のみ、SPAコンテンツ取得不可
5. **分析プロンプトの「取得不可」処理** — 「除外」指示だがClaudeが推測で補完

### 改善提案（Backend — market-lens-ai）

#### 優先度: 高（即効性あり）

**A. Body text snippet拡張 & ナビ除去**
- `extractor.py`: `<nav>`, `<header>`, `<footer>`, `[role="navigation"]`タグを除去してからbody text抽出
- 抽出上限: 1000→3000文字
- `analyzer.py` `_format_site_data`: プロンプト内表示を500→2000文字
- これだけで分析に使える情報量が劇的に改善

**B. Hero Copyセレクタ拡張**
- 追加候補: `[class*='mv'] p`, `[class*='mainvisual'] p`, `[class*='kv'] p`, `[class*='banner'] p`, `[class*='intro'] p`, `[class*='top'] > p`, `[role='banner'] p`, `section:first-of-type p`
- 日本語サイトで頻出のクラス名パターンを網羅

**C. Main CTAセレクタ拡張**
- 追加: `a[class*='btn']`（heroセクション外も）, `button[type="submit"]`, `[class*='action'] a`, `a[href*='contact']`, `a[href*='inquiry']`, `a[href*='reserve']`

**D. H1フォールバック**
- H1が見つからない場合、`<title>`タグやOG titleから推定

#### 優先度: 中（構造的改善）

**E. 抽出品質スコア追加**
- 各フィールドにconfidenceを付与
- プロンプトで「confidence低のフィールドは推測であることを明記」指示

**F. セクション構造解析の強化**
- `<main>`タグ内のみを対象にした抽出パス追加
- `<article>`セクションの活用

#### 優先度: 低（大規模改修）

**G. Playwright/JS実行による動的コンテンツ取得**
- 既にスクリーンショット用にPlaywrightがある
- fetch_html後に抽出結果が貧弱な場合、Playwrightで再取得

---

## 対象ファイル

### Frontend (insight-studio)
- `src/contexts/AnalysisRunsContext.jsx` — draft機能追加
- `src/pages/Compare.jsx` — ドラフト活用
- `src/pages/Discovery.jsx` — ドラフト活用

### Backend (market-lens-ai)
- `web/app/extractor.py` — セレクタ拡張、body text改善
- `web/app/analyzer.py` — プロンプト内body text表示量拡大

---

## 検証方法

### Part 1 (URL保持)
1. LP比較分析でURL入力 → 競合発見へ遷移 → 戻る → URLが残っていること
2. 分析実行後もURLが残ること
3. 「クリア」操作でURLが消えること
4. `npm run build` が成功すること

### Part 2 (分析精度)
1. HDC大阪 + 住宅博で再分析 → 「取得不可」が減少していること
2. Body textにナビではなく本文が含まれること
3. 既存テスト58件がパスすること
4. 改善前後の抽出結果を比較
