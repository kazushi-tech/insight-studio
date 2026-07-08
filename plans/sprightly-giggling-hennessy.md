# Plan: Stitch2 "Digital Arboretum" デザイン反映

## Context

Stitch2 で作成した広告分析画面のデザイン（`stitch_ad_insights_data_integration (28)`）を、現在の `AnalysisGraphs.jsx` に反映する。
ユーザーが何度か依頼しても反映されなかった経緯があり、**具体的なファイル・行番号・変更内容**を明記して実装者の判断余地を最小化する。

### 主な差分（Stitch2 vs 現状）
1. **Route 分離** — `ads/pack` と `ads/graphs` が別画面 → **統合して1画面**
2. **Sidebar** — 「要点パック」「グラフ」2項目 → **「分析」1項目**
3. **セクション順** — グラフが先、サマリーが後 → **サマリーが先、グラフが後**
4. **カラー** — `--color-primary: #0f5238` → **`#003925`（より深い botanical green）**
5. **Sidebar背景** — `#14291e` 単色 → **グラデーション `#0f5238 → #002114`**
6. **Evidence Drawer** — `AnalysisGraphs` にはない → **固定ボトムバーを追加**
7. **フォント** — Inter がロードされていない → **Google Fonts に追加**
8. **ボタン形状** — `button-primary` border-radius 12px → **pill (9999px)**

---

## Phase 1: Route 統合 & ナビゲーション

### 1-A: `src/App.jsx` (L110)

```diff
- <Route path="ads/pack" element={<SetupGuard><EssentialPack /></SetupGuard>} />
+ <Route path="ads/pack" element={<Navigate to="/ads/graphs" replace />} />
```

- `EssentialPack` の import は残す（参照用、削除しない）
- SetupGuard は不要（リダイレクト先で guard される）

### 1-B: `src/pages/SetupWizard.jsx` (L218)

```diff
- navigate('/ads/pack')
+ navigate('/ads/graphs')
```

### 1-C: `src/pages/Dashboard.jsx` (L293-312)

3列ボタングリッドを2列に統合:

```diff
- <div className="grid grid-cols-3 gap-2 mt-4">
-   <button onClick={() => onNavigate('/ads/pack')} ...>要点パック</button>
-   <button onClick={() => onNavigate('/ads/graphs')} ...>グラフ</button>
-   <button onClick={() => onNavigate('/ads/ai')} ...>AIエクスプローラー</button>
+ <div className="grid grid-cols-2 gap-2 mt-4">
+   <button onClick={() => onNavigate('/ads/graphs')} ...>分析</button>
+   <button onClick={() => onNavigate('/ads/ai')} ...>AIエクスプローラー</button>
```

L524 (`navigate('/ads/graphs')`) はそのまま。

---

## Phase 2: Sidebar 簡素化

### 対象: `src/components/Layout.jsx`

### 2-A: SETUP_GATED_PATHS (L20)

```diff
- const SETUP_GATED_PATHS = ['/ads/pack', '/ads/graphs', '/ads/ai']
+ const SETUP_GATED_PATHS = ['/ads/graphs', '/ads/ai']
```

### 2-B: NAV_ITEMS (L36-41)

```diff
  children: [
    { to: '/ads/wizard', label: 'セットアップ' },
-   { to: '/ads/pack', label: '要点パック', requiresSetup: true },
-   { to: '/ads/graphs', label: 'グラフ', requiresSetup: true },
+   { to: '/ads/graphs', label: '分析', requiresSetup: true },
    { to: '/ads/ai', label: 'AIエクスプローラー', requiresSetup: true },
  ],
```

### 2-C: Sidebar 背景グラデーション (L451)

```diff
- style={{ width: sidebarWidth, backgroundColor: '#14291e' }}
+ style={{ width: sidebarWidth, background: 'linear-gradient(135deg, #0f5238 0%, #002114 100%)' }}
```

### 2-D: 「新しいセットアップ」ボタンの刷新 (L534-543)

- ラベル: 「新しいセットアップ」→「新規レポート」
- アイコン: `replay` → `add`
- スタイル: 透明 → `bg-white/10 text-white rounded-full font-bold hover:bg-white/20`

---

## Phase 3: AnalysisGraphs セクション順変更

### 対象: `src/pages/AnalysisGraphs.jsx`

### 3-A: SECTIONS 定数 (L32-37)

```diff
  const SECTIONS = [
-   { id: 'graphs', label: 'グラフ分析', icon: 'bar_chart' },
    { id: 'summary', label: 'サマリー', icon: 'stars' },
+   { id: 'graphs', label: 'グラフ分析', icon: 'bar_chart' },
    { id: 'creative', label: 'クリエイティブ', icon: 'palette' },
    { id: 'detail-report', label: '詳細レポート', icon: 'description' },
  ]
```

### 3-B: デフォルト activeSection (L465)

```diff
- const [activeSection, setActiveSection] = useState('graphs')
+ const [activeSection, setActiveSection] = useState('summary')
```

### 3-C: JSX セクション順の入れ替え

現在の順:
```
L781  Local Section Nav
L806  section-graphs     ← (4)
L882  section-summary    ← (5)
L904  section-creative   ← (6)
L946  section-detail-report ← (7)
```

変更後:
```
L781  Local Section Nav
      Data Quality Alert  ← (質アラートをセクションnavの直後に移動)
      section-summary     ← (先に移動)
      section-graphs      ← (後に移動)
      section-creative
      section-detail-report
```

具体的には:
1. `qualityAlerts` バナー（現L749-753）を section nav の直後に移動
2. `<section id="section-summary">` ブロック（現L882-902）を `<section id="section-graphs">` ブロック（現L806-880）の**前**に移動

### 3-D: Excel Import バナー位置

Excel取込バナー群（ExcelImportBanner / ExcelImportPreview / ExcelImportStatusStrip）は header と section nav の間に残す。Design にはないが実用上必要な機能なので、目立ちすぎない位置にとどめる。

---

## Phase 4: Evidence Drawer 追加

### 対象: `src/pages/AnalysisGraphs.jsx`

### 4-A: EvidenceDrawer コンポーネントをコピー

`src/pages/EssentialPack.jsx` の L342-399 にある `EvidenceDrawer` 関数と、L57-62 にある `TYPE_STYLES` 定数を `AnalysisGraphs.jsx` にコピーする。

AnalysisGraphs の既存 `EVIDENCE_STYLES`（L40-45）は名前が異なるが構造は類似。`TYPE_STYLES` をコピーして `EvidenceDrawer` が参照できるようにする。

### 4-B: JSX に追加 (L1035 付近、最後の `</div>` の直前)

```jsx
{/* ═══ EVIDENCE DRAWER ═══ */}
{currentReport && executiveCards.length > 0 && (
  <EvidenceDrawer cards={executiveCards} reportBundle={reportBundle} />
)}
```

### 4-C: bottom padding 追加 (L647)

```diff
- <div className="px-8 py-8 max-w-[1680px] space-y-10">
+ <div className="px-8 py-8 pb-20 max-w-[1680px] space-y-10">
```

固定 bottom バーにコンテンツが隠れないようにする。

---

## Phase 5: カラー & デザインシステム更新

### 5-A: `index.html` (L8) — Inter フォントの追加

```diff
- family=Manrope:wght@300;400;500;600;700;800&family=Literata:...
+ family=Inter:wght@300;400;500;600;700&family=Manrope:wght@300;400;500;600;700;800&family=Literata:...
```

### 5-B: `src/index.css` — テーマカラー変更

| Token | 現在 | 変更後 | 行 |
|-------|------|--------|-----|
| `--color-primary` | `#0f5238` | `#003925` | L16 |
| `--color-primary-container` | `#2d6a4f` | `#0f5238` | L17 |
| `--color-surface-bright` | `#f8f8f5` | `#fafaf5` | L4 |
| `--color-surface` | `#f8f8f5` | `#fafaf5` | L13 |
| `--color-background` | `#f8f8f5` | `#fafaf5` | L14 |

**注意:** `--color-primary` の変更は**アプリ全体**に影響する（Compare, Discovery, Creative Review 等）。全画面の確認が必要。

### 5-C: `src/index.css` — button-primary を pill 化 (L183)

```diff
- border-radius: 0.75rem;
+ border-radius: 9999px;
```

`button-secondary` (L204) は `0.75rem` のまま。

### 5-D: CLAUDE.md デザインシステム説明更新 (L47)

```diff
- - **配色:** Deep Navy (#1A1A2E) + Muted Gold (#D4A843) アクセント、白背景ベース
+ - **配色:** Botanical Green (#003925) + 植物系グリーンパレット、warm off-white (#fafaf5) 背景ベース
```

---

## Phase 6: コンポーネント微調整

### 対象: `src/pages/AnalysisGraphs.jsx`

### 6-A: SummaryCard — border-l-4 をトーナル方式に (L55)

```diff
- <div className={`bg-surface-container-lowest p-6 rounded-xl ghost-border border-l-4 ${borderColor} ...`}>
+ <div className={`bg-surface-container-lowest p-8 rounded-xl ghost-border hover:shadow-xl transition-shadow duration-300 ...`}>
```

- `border-l-4` を削除（Stitch2 の "no-line rule"）
- `p-6` → `p-8`（Design の 32px 内部パディング）
- `hover:shadow-xl transition-shadow duration-300` を追加

### 6-B: グラフ insight ボックス — border-l-4 を除去 (L839)

```diff
- <div className="p-3 bg-surface rounded-lg border-l-4 border-primary">
+ <div className="p-4 bg-primary/[0.04] rounded-xl">
```

### 6-C: PriorityActionCard — デザイン整合

現在 L92 の `bg-primary` はDesignと一致。`shadow-lg` もOK。変更不要。

### 6-D: セクション間スペーシング

主要セクション境界（サマリー↔グラフ、グラフ↔クリエイティブ）の間隔を広げる:
- 各 `<section>` の先頭に `mt-16`（64px）を追加して Design の「40-64px whitespace」ルールに合わせる
- または外側コンテナの `space-y-10` を `space-y-14` に変更

---

## 実装順序

```
Phase 1 (Route統合)    → 安全なリダイレクト追加、後方互換
Phase 2 (Sidebar)      → Phase 1 のルート変更に依存
Phase 5 (カラー/CSS)    → 独立して並行可能
Phase 3 (セクション順)  → メインレイアウト変更
Phase 4 (Evidence)     → 追加機能、非破壊
Phase 6 (微調整)       → 最終ポリッシュ
```

---

## 検証手順

### ビルド確認
```bash
npx eslint src/App.jsx src/components/Layout.jsx src/pages/SetupWizard.jsx src/pages/Dashboard.jsx src/pages/AnalysisGraphs.jsx
npm run build
```

### ブラウザ確認（`npm run dev` → localhost:3002）

1. **Route 統合**
   - `/ads/pack` にアクセス → `/ads/graphs` にリダイレクトされること
   - Setup Wizard 完了後 → `/ads/graphs` に遷移すること
   - Dashboard の「分析」ボタン → `/ads/graphs` に遷移すること

2. **Sidebar**
   - 広告分析配下に「セットアップ」「分析」「AIエクスプローラー」の3項目のみ
   - 「要点パック」「グラフ」の2項目が表示されないこと
   - Sidebarの背景がグラデーションであること

3. **AnalysisGraphs 画面**
   - セクション順: サマリーカード → グラフ分析 → クリエイティブ → 詳細レポート
   - Section Nav タブ: サマリーが最初、グラフ分析が2番目
   - Summary Cards がスクロール前に見えること
   - Evidence Drawer が画面下部に固定表示されること

4. **デザイン**
   - primaryカラーが `#003925` の深い botanical green であること
   - Surface背景が `#fafaf5` の warm off-white であること
   - button-primary が pill 形状であること
   - カード内パディングが 32px (p-8) であること

5. **他画面への影響確認**
   - Dashboard, Compare, Discovery, Creative Review のカラーが壊れていないこと
   - ダークモード切替が正常に動作すること

---

## 変更対象ファイル一覧

| ファイル | 変更内容 |
|----------|----------|
| `src/App.jsx` | `/ads/pack` をリダイレクトに変更 |
| `src/pages/SetupWizard.jsx` | 完了時遷移先を `/ads/graphs` に |
| `src/pages/Dashboard.jsx` | ボタングリッドを2列に、ラベル変更 |
| `src/components/Layout.jsx` | NAV_ITEMS, GATED_PATHS, sidebar gradient, ボタン |
| `src/pages/AnalysisGraphs.jsx` | セクション順変更, Evidence Drawer追加, コンポーネント微調整 |
| `src/index.css` | カラートークン, button-primary radius |
| `index.html` | Inter フォント追加 |
| `CLAUDE.md` | デザインシステム説明更新 |

---

## 再利用する既存関数・コンポーネント

| 名前 | ファイル | 用途 |
|------|----------|------|
| `extractExecutiveCards()` | `src/utils/executiveSummaryExtractor.js` | SummaryCards データ |
| `extractRefinedInsights()` | `src/utils/executiveSummaryExtractor.js` | Detail Report データ |
| `extractRecommendedAction()` | `src/utils/executiveSummaryExtractor.js` | Priority Action |
| `groupChartsByTheme()` | `src/utils/chartThemeClassifier.js` | テーマ別グラフ分類 |
| `extractTopInsights()` | `src/utils/chartThemeClassifier.js` | Key Insights |
| `ChartGroupCard` | `src/components/ads/ChartGroupCard.jsx` | グラフ描画 |
| `EvidenceDrawer` | `src/pages/EssentialPack.jsx` L342-399 | ボトムバー（コピー元） |
| `TYPE_STYLES` | `src/pages/EssentialPack.jsx` L57-62 | Evidence カラーマップ |
