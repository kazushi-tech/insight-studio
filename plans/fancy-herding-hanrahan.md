# ダークモード時の明色残存を潰す（ライトモードは一切変更しない）

## Context

ユーザー体感「何回言ってもオールダークモードにならない」。調査したところ、ThemeContext（`data-theme` 属性方式）とトークン定義（`src/index.css` の `@theme` + `:root[data-theme='dark']` override）自体は正常。問題は、**30ファイル・約131箇所で Tailwind の生の明色クラス（`bg-white` `bg-amber-50` `text-amber-800` 等）が `dark:` バリアント無しで書かれており、ダーク時に白く浮く**こと。

**確定方針**：
- **デフォルトはライトモード継続**（既存の挙動を完全維持）
- **ライトモードの見た目は一切変更しない**（色バイト単位で同一）
- **ダークモード時の明色残存のみを `dark:` バリアント追加で潰す**

## アプローチ（トークン化ではなく dark: 追加のみ）

`src/index.css:3` で `@custom-variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));` が既に定義されておるため、Tailwind v4 の `dark:` 接頭辞がそのまま使える。`MarkdownRenderer.jsx:21` が実例（既に `dark:` で実装済み）。

**基本パターン**：
```jsx
// Before
<div className="bg-amber-50 border-amber-200 text-amber-800">

// After（ライトの3クラスはそのまま残し、dark: を追記のみ）
<div className="bg-amber-50 dark:bg-warning-container border-amber-200 dark:border-warning/30 text-amber-800 dark:text-on-warning-container">
```

ライトモード：`dark:` は `:where([data-theme='dark'], ...)` のため特異度0相当で `data-theme='light'` 時は**発火しない** → 既存クラスのまま。ダークモード：override 適用。

## 根本原因（ダーク時のみ発動）

| # | 症状 | 原因 | 対処 |
|---|---|---|---|
| 1 | バナー・カード・チップが薄黄/薄赤/白のまま | 30ファイル131箇所に `dark:` 無しの生 Tailwind 明色 | **各クラスに `dark:` バリアントを追記** |
| 2 | 初回ロード時に一瞬白くなる | `ThemeContext` は `useEffect` で theme 適用、first paint に間に合わない | `index.html` にマウント前インライン script（ライト時の挙動は不変） |
| 3 | テーマ切替してもチャート軸/凡例が前のテーマのまま | `Chart.defaults` が idempotent ガードで再適用されない | theme change 時に restore→apply サイクル（作業ツリー差分の完成） |

## 既存資産

- `src/index.css:5-67` `@theme`（light トークン） — **触らない**
- `src/index.css:69-127` `:root[data-theme='dark']` dark override — ほぼ完備、success-container のみ追加
- `src/index.css:3` `@custom-variant dark` — 使用準備完了
- `src/contexts/ThemeContext.jsx` — デフォルト `'light'` 維持、改修なし
- `src/components/ui.jsx:53-101` — `ErrorBanner`（共通、9カテゴリの既存ライト色に `dark:` 追記）
- `src/components/MarkdownRenderer.jsx:21` — `dark:` の実装先例

## 実装手順

### A. `dark:` バリアント追加マッピング表

各生クラスの**右隣に**以下の `dark:` クラスを追記する（既存クラスは削除・変更しない）。

| 生クラス（ライト時有効、そのまま残す） | 追記する dark: |
|---|---|
| `bg-white` | `dark:bg-surface-container-lowest` |
| `bg-white/90`, `bg-white/80` 等 | `dark:bg-surface-container-lowest/90` 等（同じ透明度） |
| `bg-gray-50` / `bg-slate-50` | `dark:bg-surface-container` |
| `bg-gray-100` / `bg-slate-100` | `dark:bg-surface-container-high` |
| `bg-amber-50` / `bg-yellow-50` / `bg-orange-50` | `dark:bg-warning-container` |
| `bg-amber-100` | `dark:bg-warning-container/70` |
| `bg-red-50` / `bg-rose-50` | `dark:bg-error-container` |
| `bg-emerald-50` / `bg-green-50` | `dark:bg-success-container` ← **要 B 追加** |
| `bg-sky-50` / `bg-blue-50` | `dark:bg-info-container` |
| `bg-violet-50` / `bg-indigo-50` | `dark:bg-primary-container/30` |
| `text-amber-800` / `text-amber-900` | `dark:text-on-warning-container` |
| `text-amber-600` / `text-amber-700` | `dark:text-warning` |
| `text-red-700` / `text-red-800` | `dark:text-on-error-container` |
| `text-red-500` / `text-red-600` | `dark:text-error` |
| `text-emerald-700` / `text-green-700` | `dark:text-on-success-container` ← **要 B 追加** |
| `text-emerald-500` / `text-emerald-600` | `dark:text-success` |
| `text-sky-700` / `text-sky-800` / `text-blue-700` | `dark:text-on-info-container` |
| `text-slate-700` / `text-gray-700` | `dark:text-on-surface-variant` |
| `text-black` | `dark:text-on-surface` |
| `border-amber-200` | `dark:border-warning/30` |
| `border-red-200` / `border-rose-200` | `dark:border-error/30` |
| `border-emerald-200` / `border-green-200` | `dark:border-success/30` |
| `border-sky-200` / `border-blue-200` | `dark:border-info/30` |
| `border-gray-200` / `border-slate-200` | `dark:border-outline-variant` |

**除外**（`dark:` 追加不要、現状で両モード正常）：
- `src/components/Layout.jsx:453-555` サイドバー `<aside>` 内 — 永久ダーク緑グラデ `#0f5238→#002114` 上、ライト/ダーク共にダーク文脈。`bg-white/5` `text-white/50` `text-emerald-400` は両モードで正しい
- `src/index.css:546-594` `@media print` — 印刷用、意図通り

### B. ダーク側トークンのみ追加（`src/index.css`、ライト `@theme` は触らない）

**ライト `@theme` ブロック（L5-67）は一切変更しない**。

**Dark `:root[data-theme='dark']`（L118付近）にのみ以下を追加**：
```css
--color-success-container: #1a3a28;
--color-on-success-container: #b5e8cc;
```

※ `dark:bg-success-container` などのクラスはダーク時にしか効かないため、ライト時の `@theme` には追加不要。ただし Tailwind v4 が `success-container` という名前のユーティリティを生成するには `@theme` 側にもシンボルが必要な可能性あり — その場合はライト用のダミー値（実際には使われない）を追加するかを実装時確認。

### C. 白フラッシュ対策（`index.html`）

`<head>` 内、マウント前に挿入。**ライトモード時の挙動は不変**（localStorage が `'dark'` でない限り light をセット、これは現行のデフォルトと同じ）：
```html
<script>
  (function() {
    try {
      var t = localStorage.getItem('insight-studio-theme') === 'dark' ? 'dark' : 'light';
      document.documentElement.dataset.theme = t;
      document.documentElement.style.colorScheme = t;
    } catch (e) {}
  })();
</script>
```

### D. 共通 `ErrorBanner` に dark: 追記（`src/components/ui.jsx:53-63`）

`ERROR_CATEGORY_STYLES` の9カテゴリに、各プロパティで `dark:` クラスを**追記**（既存ライトクラスは維持）：

```js
const ERROR_CATEGORY_STYLES = {
  timeout:       { icon: 'schedule',       bg: 'bg-amber-50 dark:bg-warning-container',   border: 'border-amber-200 dark:border-warning/30',  text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  cold_start:    { icon: 'restart_alt',    bg: 'bg-sky-50 dark:bg-info-container',        border: 'border-sky-200 dark:border-info/30',       text: 'text-sky-800 dark:text-on-info-container',       btnText: 'text-sky-700 dark:text-info' },
  network:       { icon: 'wifi_off',       bg: 'bg-orange-50 dark:bg-warning-container',  border: 'border-orange-200 dark:border-warning/30', text: 'text-orange-800 dark:text-on-warning-container', btnText: 'text-orange-700 dark:text-warning' },
  auth_error:    { icon: 'lock',           bg: 'bg-red-50 dark:bg-error-container',       border: 'border-red-200 dark:border-error/30',      text: 'text-red-800 dark:text-on-error-container',      btnText: 'text-red-700 dark:text-error' },
  invalid_input: { icon: 'edit_note',      bg: 'bg-amber-50 dark:bg-warning-container',   border: 'border-amber-200 dark:border-warning/30',  text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  upstream:      { icon: 'cloud_off',      bg: 'bg-rose-50 dark:bg-error-container',      border: 'border-rose-200 dark:border-error/30',     text: 'text-rose-800 dark:text-on-error-container',     btnText: 'text-rose-700 dark:text-error' },
  not_found:     { icon: 'search_off',     bg: 'bg-slate-50 dark:bg-surface-container-high', border: 'border-slate-200 dark:border-outline-variant', text: 'text-slate-700 dark:text-on-surface-variant',  btnText: 'text-slate-600 dark:text-on-surface' },
  rate_limit:    { icon: 'hourglass_top',  bg: 'bg-amber-50 dark:bg-warning-container',   border: 'border-amber-200 dark:border-warning/30',  text: 'text-amber-800 dark:text-on-warning-container',  btnText: 'text-amber-700 dark:text-warning' },
  overloaded:    { icon: 'cloud_queue',    bg: 'bg-violet-50 dark:bg-primary-container/30', border: 'border-violet-200 dark:border-primary/20', text: 'text-violet-800 dark:text-on-primary-container', btnText: 'text-violet-700 dark:text-primary' },
}
```

この1ファイル改修で Compare / Discovery / CreativeReview / EssentialPack の ErrorBanner 経由のバナーが一気に対処される。

### E. `Layout.jsx` メイン領域側の個別修正

| 行 | 現状 | 追記 |
|---|---|---|
| 263 | `text-amber-600` | `dark:text-warning` 追記 |
| 272 | `bg-emerald-50` | `dark:bg-success-container` 追記 |
| 273 | `text-emerald-700` | `dark:text-on-success-container` 追記 |
| 274 | `bg-emerald-500` | `dark:bg-success` 追記 |
| 589 | `text-emerald-600` | `dark:text-success` 追記 |

**サイドバー側（L440-441, L487-541）は現状維持**（永久ダーク緑グラデ上、両モードで正しい）。

### F. 全ページ一括 dark: 追記（30ファイル・約110箇所）

A のマッピング表で各ファイルの該当行に `dark:` を**機械的に追記**。ライトクラスは削除・変更しない。

**優先度 ★★★**:
- [src/pages/Discovery.jsx](src/pages/Discovery.jsx) — 11箇所（L256,308,852,995,1020,1173,1178 他）
- [src/pages/AiExplorer.jsx](src/pages/AiExplorer.jsx) — 8箇所（L41,431-447,465-469,516,522,627,637）
- [src/pages/Dashboard.jsx](src/pages/Dashboard.jsx) — 6箇所（L33,223,237,262,504）

**優先度 ★★**:
- [src/pages/CreativeReview.jsx](src/pages/CreativeReview.jsx) — 6箇所（L107,132,369,714）
- [src/pages/Compare.jsx](src/pages/Compare.jsx) — 6箇所（L225,517,579,586,739）
- [src/pages/SetupWizard.jsx](src/pages/SetupWizard.jsx) — 4箇所（L239,249）
- [src/pages/EssentialPack.jsx](src/pages/EssentialPack.jsx) — 4箇所（L189,192,199,524）

**優先度 ★**:
- [src/components/DataCoverageCard.jsx](src/components/DataCoverageCard.jsx) — 3箇所（L91,108）
- [src/components/CaseSelector.jsx](src/components/CaseSelector.jsx) — 3箇所（L117）
- [src/components/ProjectFormModal.jsx](src/components/ProjectFormModal.jsx) — 1箇所（L213）
- [src/components/ads/CreativeReference.jsx](src/components/ads/CreativeReference.jsx) — 1箇所（L25 `bg-white/90`）
- [src/pages/CaseManagement.jsx](src/pages/CaseManagement.jsx) — 3箇所（L237,301）
- [src/pages/AnalysisGraphs.jsx](src/pages/AnalysisGraphs.jsx) — 1箇所（L786）
- [src/components/MarkdownRenderer.jsx](src/components/MarkdownRenderer.jsx) — 3箇所（L21、既に `dark:` 付きの既存箇所を動作確認）

### G. Chart テーマ再適用（作業ツリー差分の完成）

現在 `git status` で modified になっておる5ファイルの進行中対応を仕上げる：

1. **`src/components/report/v2/reportThemeV2.js` / `src/components/report/reportTheme.js`**
   - `applyChartDefaultsV2(Chart)` 冒頭の `if (Chart.defaults.__reportThemeV2Applied) return` を「現在テーマと snapshot 時テーマが同じなら return」に変更
   - snapshot に `theme` プロパティを追加（`isDarkMode() ? 'dark' : 'light'`）
   - テーマが変わっていれば restore→apply サイクルを許可

2. **`src/components/report/v2/BrandRadarV2.jsx` / JudgmentBadge.jsx**
   - `useTheme()` を import して `const { isDark } = useTheme()` で購読
   - チャート構築 `useEffect` の deps に `isDark` を追加（または新規 useEffect で `restoreChartDefaultsV2(Chart); applyChartDefaultsV2(Chart)` を `[isDark]` 監視）

3. ライトモード時の既存挙動は `REPORT_COLORS_V2`（ライト値）を参照するので**完全維持**。ダーク時のみ `REPORT_COLORS_V2_DARK` にスイッチ

## 変更対象ファイル一覧

**Critical（必ず触る）:**
- [src/index.css](src/index.css) — B. dark ブロックにのみ success-container 追加（`@theme` ライトブロックは不変）
- [index.html](index.html) — C. マウント前インライン script 追加
- [src/components/ui.jsx](src/components/ui.jsx) — D. ErrorBanner の9カテゴリに `dark:` 追記
- [src/components/Layout.jsx](src/components/Layout.jsx) — E. メイン領域側5行に `dark:` 追記

**F. 全ページ一括 `dark:` 追記**：30ファイル、F 参照

**G. チャート再描画**：
- [src/components/report/reportTheme.js](src/components/report/reportTheme.js)
- [src/components/report/v2/reportThemeV2.js](src/components/report/v2/reportThemeV2.js)
- [src/components/report/v2/BrandRadarV2.jsx](src/components/report/v2/BrandRadarV2.jsx)
- [src/components/report/JudgmentBadge.jsx](src/components/report/JudgmentBadge.jsx)

**絶対に触らない:**
- `src/index.css:5-67` の `@theme`（ライトトークン）
- `src/contexts/ThemeContext.jsx`（デフォルト `'light'` 維持）
- `src/components/Layout.jsx:453-555`（サイドバー、永久ダーク緑グラデ）
- `src/index.css:546-594`（`@media print` ブロック）

## 検証（`webapp-testing` skill / Playwright）

プロジェクトルール（`CLAUDE.md`）に従い、`src/` 変更後は `webapp-testing` skill で動作確認する。

### ライトモードの回帰確認（最重要）

**ライトモードで変更前後の見た目が一致することを確認する**。これが崩れたら設計失敗。

1. `git stash` で差分退避 → `npm run dev` で起動 → 各画面スクショ（baseline）
2. `git stash pop` で差分復帰 → 再度スクショ → baseline とピクセル単位で diff
3. ライトモード diff は **0ピクセル** である必要あり（許容誤差：サブピクセルレンダリングのみ）

### ダークモードの改善確認

1. `npm run build` で型・ビルド成功確認
2. `webapp-testing` skill の `scripts/with_server.py` で `npm run dev`（port 3002）起動
3. 以下の画面を **ダークモード状態でロード → 全要素のスクショ** で確認：
   - `/ads/ai`（AIエクスプローラー V1/V2）
   - `/ads/analysis`（レポート v2、チャート含む）
   - `/discovery`, `/compare`, `/creative-review`, `/ads/wizard`
4. 各画面で `getComputedStyle(el).backgroundColor` が主要領域で `rgb(255,255,255)` `rgb(250,250,245)` を返さないことをアサート
5. **初回ロードの白フラッシュ**：ダーク保存状態で開いて、`data-theme` が最初のフレームから `'dark'` であることを検証
6. **テーマ切替時のチャート再描画**：レポートでトグル → 軸・凡例が即座に更新

## リスクと対応

| リスク | 対応 |
|---|---|
| `dark:` バリアントが Tailwind v4 で発火しない | `MarkdownRenderer.jsx:21` が既に `dark:` で動いておる実例。念のため1画面で先行検証してから全面展開 |
| `dark:bg-success-container` のユーティリティが生成されない（`@theme` にシンボル無しのため） | B 実装時に `@theme` 側にもライト値としてダミー `--color-success-container`（例：`#e5f3e8`）を追加。ただしライト UI は `dark:` 側しか参照しないので見た目は変わらない — それでも user 要件との整合性を取りたいなら、CSS `color-mix()` + 既存トークンで代替 |
| 透明度サフィックス `/70` がトークン変数で効かない | Tailwind v4 + `@theme` 変数は `/NN` opacity に対応済み、動作確認で担保 |
| ダーク時のコントラスト不足 | 追記後、WCAG AA（4.5:1）を DevTools で要所確認 |
| Chart.js defaults のグローバル状態競合 | `restore → apply` の順序保証、`useRef` でマウント順管理 |

## 見積

- コード改変：35〜40ファイル、差分 300〜400 行（ほぼ `dark:` 追記のみ、ライト行は触らず）
- 所要：実装 2〜3時間、ライト回帰 + ダーク検証 1〜1.5時間、合計半日相当
