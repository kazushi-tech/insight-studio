# Plan: Discovery Hub brand_fetch タイムアウト修正

## Context

Creative Review（バナーレビュー）は修正済みで正常動作。Discovery Hub は `brand_fetch` ステージでタイムアウトし、ジョブが失敗する。

**バックエンドエラー詳細**:
```
status: failed
error.detail: "ブランドURLの取得に失敗 (stage=brand_fetch): https://www.muji.com: Timeout / https://muji.com: Timeout / 他2件"
error.retryable: true
error.status_code: 502
```

**原因**: `isAutoResubmitEligible()` が `brand_fetch` タイムアウトをキャッチしない。analyze ステージのタイムアウトのみ条件に含まれており、brand_fetch や search などの他ステージのタイムアウトがスルーされている。

---

## 修正内容

### 1. `isAutoResubmitEligible` の条件拡張
**ファイル**: [src/pages/Discovery.jsx](src/pages/Discovery.jsx) L153-171

現在の条件（4つ）に追加:
- **「任意ステージのタイムアウト + retryable=true」** をキャッチする条件を追加
- `normalizedDetail.includes('timeout') || normalizedDetail.includes('タイムアウト')` をチェック

```javascript
function isAutoResubmitEligible(detail, retryable, stage, errorInfo) {
  if (!retryable) return false
  const normalizedDetail = String(detail || '').toLowerCase()
  const normalizedStage = String(stage || '').toLowerCase()

  // Any retryable timeout error at any stage (broadest catch)
  if (normalizedDetail.includes('timeout') || normalizedDetail.includes('タイムアウト')) return true

  // Timeout in analyze stage (kept for specificity)
  if (isAnalyzeTimeoutFailure(detail, retryable, stage)) return true

  // Server unresponsive / stale
  if (errorInfo?.category === 'stale' || normalizedDetail.includes('応答しなくなりました')) return true

  // Stage stall
  if (errorInfo?.category === 'timeout' && normalizedDetail.includes('停止しています')) return true

  // Generic server unresponsive / 503
  if (normalizedDetail.includes('サーバー') && (normalizedDetail.includes('起動中') || normalizedDetail.includes('エラー'))) return true

  return false
}
```

### 2. `warmMarketLensBackend()` のエラーハンドリング追加
**ファイル**: [src/pages/Discovery.jsx](src/pages/Discovery.jsx)

2箇所の `warmMarketLensBackend()` 呼び出しに `.catch(() => null)` を追加:

- **handleDiscover内** (~L595): `warmMarketLensBackend().catch(() => null)`
- **自動再送信ブロック内** (~L522): `warmMarketLensBackend().catch(() => null)`

warm-up失敗でフロー全体を止めないようにする。

### 3. `DISCOVERY_AUTO_RESUBMIT_MAX` を 1→2 に増加
**ファイル**: [src/pages/Discovery.jsx](src/pages/Discovery.jsx) L98

```javascript
const DISCOVERY_AUTO_RESUBMIT_MAX = 2
```

brand_fetch が一時的なネットワーク問題の場合、2回の再試行で成功する可能性が高まる。

---

## 変更ファイル一覧

| ファイル | 修正内容 |
|---------|---------|
| [src/pages/Discovery.jsx](src/pages/Discovery.jsx) | isAutoResubmitEligible拡張 + warmUpエラーハンドリング + resubmit上限増加 |

## 検証方法

1. `npm run build` — フロントエンドビルド成功確認
2. ブラウザでDiscovery Hub → タイムアウト時に自動リトライが発動することを確認
3. コンソールエラーがないことを確認
