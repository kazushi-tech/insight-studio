# UI/UX 改善プラン: ローディング・エラー・アクセシビリティ

## Context

Insight Studio の UI は直近の改善でかなり洗練されたが、ローディング中の表示、エラー時のリカバリ、アクセシビリティの3点に改善余地がある。スクリーンショットレビューで確認した現状を踏まえ、プロダクション品質を引き上げる。

---

## Fix 1: ローディング状態の統一とスケルトン導入

### 現状
- 全7ページで `animate-spin` + `progress_activity` アイコンを手動インライン
- 共通コンポーネントなし、コード重複
- コンテンツ領域はスピナー＋テキストのみで空白が広い

### 実装

**新規ファイル: `src/components/ui.jsx`**

```jsx
// LoadingSpinner — size: 'sm' | 'md' | 'lg', label: optional text
// SkeletonBlock — variant: 'rect' | 'text' | 'card', width/height/lines props
```

- `LoadingSpinner`: 既存の progress_activity パターンを集約。`role="status"` + sr-only ラベル付き
- `SkeletonBlock`: `animate-pulse` + `bg-surface-container rounded-xl` でプレースホルダー表示

**スケルトン適用対象:**
| ページ | 対象 | 現状 |
|--------|------|------|
| Dashboard | 分析履歴テーブル | スピナーのみ |
| EssentialPack | レポート本文エリア | スピナーのみ |
| AnalysisGraphs | チャートカード群 | スピナーのみ |

**全ページのインラインスピナー置換:**
- Dashboard.jsx, EssentialPack.jsx, AnalysisGraphs.jsx, AiExplorer.jsx, Compare.jsx, Discovery.jsx, SetupWizard.jsx, Settings.jsx

---

## Fix 2: エラー表示の共通化とリカバリ強化

### 現状
- 赤バナー（`bg-red-50 border-red-200 text-red-700`）が7ファイルで重複
- リトライボタンなし（SetupWizard のみ部分的情報）
- Error Boundary なし
- API タイムアウト検出なし

### 実装

**`src/components/ui.jsx` に追加:**
```jsx
// ErrorBanner — message, onRetry (optional), role="alert"
```

**`src/App.jsx` に ErrorBoundary 追加:**
- class component で `componentDidCatch` 実装
- フォールバック: 「予期しないエラーが発生しました」+ 再読み込みボタン
- `<Routes>` をラップ

**API タイムアウト（AbortController）:**
- `src/api/adsInsights.js` の `request()` — デフォルト 30 秒
- `src/api/marketLens.js` の `request()` — デフォルト 30 秒
- タイムアウト時: `"リクエストがタイムアウトしました。ネットワーク接続を確認してください。"`

**リトライボタン接続:**
| ページ | onRetry 接続先 |
|--------|---------------|
| Dashboard | `getScans()` 再実行 |
| EssentialPack | `handleRefresh()` |
| AnalysisGraphs | `handleRefresh()` |
| AiExplorer | レポート再取得 |
| Settings | config 再取得 |
| Compare / Discovery | ユーザー操作起点のため不要 |

---

## Fix 3: アクセシビリティ改善

### 現状
- aria 属性: テーマトグルとアコーディオンの 2 箇所のみ
- アイコンのみボタンに aria-label なし
- モーダルにフォーカストラップなし
- skip-to-content リンクなし
- 無効ナビ項目が `<span>` で非セマンティック

### 実装

**`src/index.css`:**
- `.sr-only` ユーティリティクラス追加

**`src/components/Layout.jsx`:**

| 修正 | 詳細 |
|------|------|
| skip-to-content | `<a href="#main-content" className="sr-only focus:not-sr-only ...">` を最外 div 先頭に |
| main id | `<main>` に `id="main-content"` 追加 |
| SidebarGroup | button に `aria-expanded={open}` 追加 |
| SidebarLink (disabled) | `<span>` → `<a aria-disabled="true" tabIndex={-1} onClick={e.preventDefault()}>` |
| KeySettingsModal | `role="dialog"` `aria-modal="true"` `aria-labelledby` 追加 |
| フォーカストラップ | useEffect で Tab/Shift+Tab 巡回 + Escape で閉じる |
| API キーボタン | `aria-label="API キー設定"` |
| リサイズハンドル | `role="separator"` `aria-label="サイドバーの幅を変更"` + ArrowLeft/Right キーボード対応 |

**各ページの icon-only ボタン:**
- AiExplorer: 送信ボタン → `aria-label="送信"`
- Settings: トグル → `role="switch"` `aria-checked`

**aria-live リージョン:**
- LoadingSpinner に `aria-live="polite"` 内蔵（sr-only テキスト）
- ErrorBanner に `role="alert"` 内蔵（暗黙の aria-live="assertive"）
- AiExplorer チャット領域に `aria-live="polite"`

---

## 実装順序

| Step | 内容 | ファイル |
|------|------|---------|
| 1 | `sr-only` クラス追加 | `index.css` |
| 2 | `ui.jsx` 作成（LoadingSpinner, SkeletonBlock, ErrorBanner） | `src/components/ui.jsx` (new) |
| 3 | API タイムアウト追加 | `adsInsights.js`, `marketLens.js` |
| 4 | ErrorBoundary 追加 | `App.jsx` |
| 5 | Layout a11y 改善 | `Layout.jsx` |
| 6 | 各ページ更新（スピナー→LoadingSpinner, エラー→ErrorBanner, スケルトン追加, aria-label） | 全ページファイル |
| 7 | ESLint + ビルド検証 | — |

## 対象ファイル一覧

- **新規 (1):** `src/components/ui.jsx`
- **修正 (12):** `index.css`, `App.jsx`, `Layout.jsx`, `adsInsights.js`, `marketLens.js`, `Dashboard.jsx`, `EssentialPack.jsx`, `AnalysisGraphs.jsx`, `AiExplorer.jsx`, `Compare.jsx`, `Discovery.jsx`, `SetupWizard.jsx`, `Settings.jsx`

## 検証手順

1. `npm run build` — プロダクションビルド成功確認
2. `npx eslint src/` — lint パス確認
3. `npm run dev` で各ページを手動確認:
   - ローディング中にスケルトン表示されること（Dashboard, EssentialPack, AnalysisGraphs）
   - ネットワーク切断時にエラーバナー＋リトライボタン表示
   - Tab キーで全インタラクティブ要素にフォーカス到達
   - モーダル内でフォーカスがトラップされること
   - skip-to-content リンクが Tab で出現し、Enter でメインコンテンツにジャンプ
