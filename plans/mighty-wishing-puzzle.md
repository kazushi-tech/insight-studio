# Insight Studio 総合デバッグ計画

## Context

ユーザーはこの1ヶ月間エラーが続いていると報告。Chrome DevToolsのゲストモードで localhost:3002 を実際に操作し、エラーがゼロになるまでテスト・修正を繰り返す。

**根本原因の仮説:** 4/7のコミット `45d66e2` で「warmup完全待機化」を導入した際、`warmMarketLensBackend()` が localhost で `false` を返す仕様を考慮せず、Compare と Discovery の両方が warmup 結果を厳密にチェックするようになった。結果、**localhost では Compare と Discovery が100%即時失敗する**回帰バグが発生。

---

## 修正対象一覧

### Tier 1: CRITICAL（コア機能がブロックされる）

| # | 問題 | ファイル | 行 |
|---|------|---------|-----|
| 1 | `warmMarketLensBackend()` が localhost で `false` を返し、Compare/Discovery が即時失敗 | `src/api/marketLens.js` | L613 |
| 2 | BackendReadiness が localhost で永久に `{ ready: false, warming: false }` → UI表示が「サーバー状態確認中」のまま | `src/api/marketLens.js` | L77-78 |

### Tier 2: ESLint Errors（17件）

| # | 問題 | ファイル | 行 |
|---|------|---------|-----|
| 3 | `lastError` 未使用 | `src/pages/AiExplorer.jsx` | L299 |
| 4 | `pct` 未使用 | `src/pages/CreativeReview.jsx` | L369 |
| 5 | `loading` 未使用 | `src/pages/Settings.jsx` | L70 |
| 6 | `handleAdsLogin` 未使用 | `src/pages/Settings.jsx` | L176 |
| 7 | `kpis`, `warnings` 未使用 | `src/utils/excelSummary.js` | L45 |
| 8 | `monthly` 未使用 | `src/utils/excelSummary.js` | L247 |
| 9 | `chartGroups` 未使用 | `src/utils/executiveSummaryExtractor.js` | L65 |
| 10 | 空の catch ブロック ×2 | `src/pages/Discovery.jsx` | L342, L345 |
| 11 | 空の catch ブロック | `src/contexts/AnalysisRunsContext.jsx` | L36 |
| 12 | setState-in-effect ×3 | `src/contexts/AdsSetupContext.jsx` | L140, L153, L164 |
| 13 | setState-in-effect | `src/components/CaseSelector.jsx` | L20 |
| 14 | Fast refresh mixed exports | `src/components/PerformanceRadar.jsx` | L9 |
| 15 | Fast refresh mixed exports | `src/contexts/BackendReadinessContext.jsx` | L9 |

### Tier 3: Warning

| # | 問題 | ファイル | 行 |
|---|------|---------|-----|
| 16 | useCallback 不要な依存: `clearRun` | `src/pages/CreativeReview.jsx` | L667 |

---

## 修正方針

### Fix 1: warmup gate（CRITICAL）

**ファイル:** `src/api/marketLens.js` L613

```javascript
// Before:
export function warmMarketLensBackend() {
  if (SHOULD_FORCE_PROXY) return Promise.resolve(false)
  return ensureDirectBackend()
}

// After:
export function warmMarketLensBackend() {
  if (SHOULD_FORCE_PROXY) return Promise.resolve(true) // proxy IS the warm path
  return ensureDirectBackend()
}
```

**理由:** localhost では Vite dev proxy が同一オリジンでリクエストを中継する。プロキシ自体がwarmなパスであり、direct backend への接続確認は不要。`false` を返すと Compare.jsx:352 と Discovery.jsx:705 の warmup gate で即時失敗する。

### Fix 2: BackendReadiness on localhost

**ファイル:** `src/api/marketLens.js` L77-78

```javascript
// Before:
export function startBackendKeepAlive() {
  if (SHOULD_FORCE_PROXY) return
  ...
}

// After:
export function startBackendKeepAlive() {
  if (SHOULD_FORCE_PROXY) {
    _directBackendReady = true
    _notifyReadiness()
    return
  }
  ...
}
```

**理由:** localhost では proxy が常に有効なので、backend は「ready」として扱う。Discovery Hub の UI インジケータが「サーバー状態確認中」から「サーバー準備完了」に正しく更新される。

### Fix 3-15: ESLint Errors

各ファイルで未使用変数の除去、空 catch への `/* intentionally empty */` コメント追加、setState-in-effect の修正、mixed exports の分離を行う。

### Fix 16: useCallback 依存

`clearRun` を依存配列から除去。

---

## テスト手順

### Phase 1: 環境準備

1. `npm run dev` で開発サーバー起動（port 3002）
2. Chrome をゲストモード（`--guest`）で起動（既存ブラウザは閉じない）
3. DevTools → Console（Errors + Warnings）、Network（Preserve log）を開く
4. `http://localhost:3002` にアクセス

### Phase 2: 認証設定

1. Settings ページで Claude API キー入力（`.env` の `ANTHROPIC_API_KEY` 値）
2. Login でパスワード入力（`.env` の パスワード値）

### Phase 3: 全ページテスト

| ページ | テスト内容 |
|--------|-----------|
| `/login` | ログイン成功・失敗、エラー表示 |
| `/` (Dashboard) | 表示、統計カード、グラフ |
| `/compare` | URL入力 → 分析開始 → レポート表示（完走確認） |
| `/discovery` | URL入力 → ジョブ開始 → ポーリング → レポート表示 |
| `/creative-review` | 画像アップロード → レビュー表示 |
| `/ads/wizard` | セットアップフロー |
| `/ads/graphs` | グラフ表示 |
| `/ads/ai` | AI質問 → 回答表示 |
| `/settings` | キー保存、テーマ切替 |

### Phase 4: 確認ポイント

- Console にエラー・警告がゼロであること
- Network タブで失敗リクエスト（赤）がないこと
- `npm run lint` がエラーゼロであること
- `npm run build` が成功すること

---

## 修正対象ファイル

- `src/api/marketLens.js` — warmup gate + keepAlive readiness
- `src/pages/AiExplorer.jsx` — 未使用変数
- `src/pages/CreativeReview.jsx` — 未使用変数 + useCallback deps
- `src/pages/Settings.jsx` — 未使用変数・関数
- `src/pages/Discovery.jsx` — 空 catch
- `src/contexts/AdsSetupContext.jsx` — setState-in-effect
- `src/contexts/AnalysisRunsContext.jsx` — 空 catch
- `src/components/CaseSelector.jsx` — setState-in-effect
- `src/components/PerformanceRadar.jsx` — mixed exports
- `src/contexts/BackendReadinessContext.jsx` — mixed exports
- `src/utils/excelSummary.js` — 未使用変数
- `src/utils/executiveSummaryExtractor.js` — 未使用変数
