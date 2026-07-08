# AI考察UI/UX 改善 — PeriodSelector削除 & ダークモード対応

## Context

Stitch 2.0 ベースに刷新された AI考察画面（`/ads/ai`）について、以下2点のUX/品質問題を解消する。

### 問題1: 画面右上の期間選択（PeriodSelector）が破綻している

- セットアップ画面（[SetupWizard.jsx:331-436](src/pages/SetupWizard.jsx#L331-L436)）で既に期間は選択済み（`AdsSetupContext` 経由で localStorage に永続化、`reportBundle` 生成に使用）。
- AI考察画面の [PeriodSelector.jsx:75-209](src/components/ai-explorer/v2/PeriodSelector.jsx#L75-L209) は `onApply` コールバックが未接続のスタブ実装。「この期間で適用」を押しても何も起こらない。
- セットアップ側の状態とも非連動。ユーザーに「何の意味があるのか分からない」という違和感を与えている。

ユーザー判断: **完全削除**（実装コストゼロで一貫性が最も高い）。

### 問題2: AI考察画面がダークモード非対応

ダークモード ON 時、考察サマリー／TL;DR／ターンカードの背景色・文字色が浮き、読めない／文字が白背景に白で消える状態。

- [AiExplorerV2.module.css](src/components/ai-explorer/v2/AiExplorerV2.module.css): ハードコード色（`#ffffff`, `#f4f4ef`, `#003925`, `#1a1c19` 等）が46カ所。
- [InsightTimeline.jsx](src/components/ai-explorer/v2/InsightTimeline.jsx): インラインスタイルで同様のハードコード色が11カ所（ContextトグルボタンとSizeトグル、チャット消去・コンテキスト更新ボタンなど）。
- [MarkdownRenderer.jsx:13-23](src/components/MarkdownRenderer.jsx#L13-L23): badge（`bg-emerald-100 text-emerald-700` 等）に `dark:` 修飾なし。

プロジェクトは既に `:root[data-theme='dark']` + CSS カスタムプロパティ方式で完全対応済み（[index.css:62-115](src/index.css#L62-L115)）。AI考察画面だけが例外。

### Goal

1. PeriodSelector を完全削除して UI 一貫性を取り戻す
2. AI考察画面全体のハードコード色を CSS カスタムプロパティへ移行しダークモードで崩れないようにする

## 変更方針

### 方針A: PeriodSelector 削除（最小差分）

1. [InsightTimeline.jsx:6](src/components/ai-explorer/v2/InsightTimeline.jsx#L6) から `import PeriodSelector` 行を削除
2. [InsightTimeline.jsx:274](src/components/ai-explorer/v2/InsightTimeline.jsx#L274) の `<PeriodSelector analysisRun={currentRun} />` を削除
3. [PeriodSelector.jsx](src/components/ai-explorer/v2/PeriodSelector.jsx) ファイル自体を削除
4. [AiExplorerV2.module.css:323-484](src/components/ai-explorer/v2/AiExplorerV2.module.css#L323-L484) の `.periodTrigger` / `.periodSelector` / `.periodSelectorInner` / `.periodPresetList` / `.periodPresetButton` / `.periodPresetButtonActive` / `.periodCalendar` / `.periodCalendarHeader` / `.periodCalendarGrid` / `.periodCalendarDay` / `.periodCalendarCell` / `.periodCalendarCellMuted` / `.periodFooter` / `.periodFooterLabel` / `.periodApplyButton` セクションごと削除（約160行）
5. [InsightTimeline.jsx:104](src/components/ai-explorer/v2/InsightTimeline.jsx#L104) の `currentRun` prop は他で使っていないなら削除し、呼び出し元 [AiExplorer.jsx](src/pages/AiExplorer.jsx) 側も調整（要確認）

### 方針B: ダークモード対応（色を CSS カスタムプロパティへ移行）

既存の CSS カスタムプロパティ（[index.css:3-115](src/index.css#L3-L115)）を使うだけで、`data-theme='dark'` 時に自動的に正しい色に切り替わる。置換マッピング:

| ハードコード | → CSS 変数 |
|---|---|
| `#ffffff` | `var(--color-surface-container-lowest)` |
| `#f4f4ef` | `var(--color-surface-container-low)` |
| `#e8e8e3` | `var(--color-surface-container-high)` |
| `#eeeee9` | `var(--color-surface-container)` |
| `#003925` | `var(--color-primary)` |
| `#0f5238` | `var(--color-primary-container)` |
| `#ffffff` (on primary) | `var(--color-on-primary)` |
| `#404943` | `var(--color-on-surface-variant)` |
| `#1a1c19` | `var(--color-on-surface)` |
| `#707973` | `var(--color-outline)` |
| `#bfc9c1` | `var(--color-outline-variant)` |
| `#ba1a1a` | `var(--color-error)` |
| `#ffdad6` | `var(--color-error-container)` |
| `#909994` | `var(--color-outline)` |
| `rgba(0, 57, 37, X)` | `color-mix(in srgb, var(--color-primary) Y%, transparent)` |
| `rgba(191, 201, 193, X)` | `color-mix(in srgb, var(--color-outline-variant) Y%, transparent)` |

**対象ファイル:**

**B-1. [AiExplorerV2.module.css](src/components/ai-explorer/v2/AiExplorerV2.module.css)** — PeriodSelector削除後に残る約40カ所のハードコード色を一括置換。
- カード背景（`.turnCard`, `.quickPromptCard`, `.skeletonRoot`）、ボタン系（`.composerSend`, `.composerChip`）、入力（`.composerInput`, `.composerField`）、ステータス（`.bannerWarning`, `.bannerInfo`）など。
- エラー系（`.turnCardError` の `#ffdad6` / `#ba1a1a`）は `var(--color-error-container)` / `var(--color-error)` に。ダークモード用の値もindex.cssに定義済み（`#5a2020` / `#ff8f8f`）。
- warning banner（`#fff7ec`, `#ffd8a8`, `#93580f`）はダーク用 CSS 変数が無いので、`@media (prefers-color-scheme)` ではなく [index.css](src/index.css) にダーク時用の色を追加定義する。もしくは `color-mix` で代替。

**B-2. [InsightTimeline.jsx](src/components/ai-explorer/v2/InsightTimeline.jsx)** — インラインスタイルのハードコード色を CSS変数に置換する。
- 11カ所のハードコード色。特に [行193-237（Context トグル）](src/components/ai-explorer/v2/InsightTimeline.jsx#L193-L237)、[行242-269（Size トグル）](src/components/ai-explorer/v2/InsightTimeline.jsx#L242-L269)、[行280-328（チャット消去・コンテキスト更新）](src/components/ai-explorer/v2/InsightTimeline.jsx#L280-L328)。
- パターン: `color: '#003925'` → `color: 'var(--color-primary)'` のようにインラインスタイルのまま CSS変数文字列に置き換える。
- 行333/338/343 の `color: '#93580f'` / `'#0369a1'` / `'#ba1a1a'` は状態色（warning/info/error）。`#ba1a1a` は `var(--color-error)` に置換可能、他は ダーク用の CSS 変数を index.css に追加する。

**B-3. [MarkdownRenderer.jsx:13-23](src/components/MarkdownRenderer.jsx#L13-L23)** — Tailwind `dark:` 修飾を追加。
- 例: `bg-emerald-100 text-emerald-700` → `bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300`
- ただし本プロジェクトのダークモードは `data-theme='dark'` 属性方式で、Tailwind 標準の `dark:` 修飾は `class` or `media` セレクタが既定。Tailwind v4 の `@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *))` を index.css に1行追加することで `dark:` 修飾が使えるようになる。もし既に定義されていないなら追加する。

### 重要な確認事項（実装時に対応）

- [AiExplorer.jsx](src/pages/AiExplorer.jsx) で `currentRun` が `InsightTimeline` 以外でも使われているか確認し、不要なら削除。
- Tailwind v4 の `@custom-variant dark` がプロジェクトに定義済みか [index.css](src/index.css) を grep 確認。未定義なら追加（1行）。
- warning/info 状態色（`#93580f`, `#0369a1`, `#fff7ec`, `#ffd8a8`）のダーク対応は、index.css に `--color-warning-container` / `--color-on-warning-container` / `--color-info` / `--color-info-container` を追加するのが筋（`--color-warning` は既に存在）。または `color-mix(in srgb, var(--color-warning) 20%, var(--color-surface))` のような合成で対応。

## 変更対象ファイル

| ファイル | 種別 | 概要 |
|---|---|---|
| [src/components/ai-explorer/v2/PeriodSelector.jsx](src/components/ai-explorer/v2/PeriodSelector.jsx) | **削除** | ファイルごと削除 |
| [src/components/ai-explorer/v2/InsightTimeline.jsx](src/components/ai-explorer/v2/InsightTimeline.jsx) | 編集 | import削除 + 使用箇所削除 + インラインスタイル色をCSS変数化 |
| [src/components/ai-explorer/v2/AiExplorerV2.module.css](src/components/ai-explorer/v2/AiExplorerV2.module.css) | 編集 | PeriodSelector関連CSS削除 + ハードコード色をCSS変数化 |
| [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) | 編集 | badge/rank クラスに dark: 修飾追加 |
| [src/index.css](src/index.css) | 編集（小） | Tailwind dark variant定義（未定義の場合）、warning/info ダーク色追加 |
| [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx) | 編集（軽微） | `currentRun` prop が InsightTimeline以外で使われていなければ削除 |

## 検証方法

1. **ビルド確認**
   ```bash
   npm run build
   ```
   型/Lint エラーがないこと。

2. **Playwright 検証（webapp-testing skill 使用）**
   - `npm run dev`（port 3002）を起動
   - `/ads/ai` を開き、以下を確認:
     - 画面右上に「過去7日」ドロップダウンが存在しないこと
     - ライトモードで既存のデザイン（背景色・文字色・ボタン）が視覚的に変化していないこと
     - ヘッダー右端のダークモードトグルを押してダーク化 → ターンカード/考察サマリー/TL;DR/クイックプロンプトカード/コンポーザー/Context・Sizeトグルがダークモードで読めること
     - MarkdownRenderer で確認済み／【市場推定】／1位 などの badge がダーク時にも識別できること
   - リグレッション確認のため隣接画面（`/ads/setup`, `/ads/analysis`, `/dashboard`）もダーク/ライト両方で開き、レイアウト崩れや色崩れがないこと
   - `page.on('console', ...)` と `page.on('pageerror', ...)` で console error/warning を拾い、なければ OK

3. **機能確認**
   - AI考察で1つプロンプトを送信 → 応答が正常に表示されること（PeriodSelector削除によるロジック影響がないこと）
   - Context トグル（広告データのみ / +Market Lens）、Size トグル（小/中/大）、チャット消去、コンテキスト更新ボタンが機能すること
