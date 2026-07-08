# Fix: Discovery / Compare コールドスタート タイムアウト

## Context

前回の修正（scan リトライ + 停滞検知レースコンディション修正）をデプロイ後、バックエンド（Render無料枠）がコールドスタート状態で Discovery / Compare の両方がタイムアウトした。

**原因:** `startDiscoveryJob()` にリトライがなく、30秒タイムアウト1発勝負。暖機(`warmMarketLensBackend`)はfire-and-forgetで、ユーザーがボタンを押す前に完了する保証がない。

---

## 修正内容

### 1. `requestDiscoveryJobWithRetry()` 追加 (marketLens.js)

`requestDiscoveryAnalyzeWithRetry` / `requestScanWithRetry` と同パターンで、ジョブ作成にリトライを追加:

- 初回: `directStrategy: 'optimistic'`（暖機済みなら即成功）
- リトライ: `directStrategy: 'verified'`（`ensureDirectBackend()` を待ってから再試行）
- リトライ判定: 既存の `isDiscoveryRetryableError()` を再利用（タイムアウト/502/503/ネットワークエラーを検知）
- `allowProxyFallback: true` でプロキシ経由フォールバックも有効化
- リトライ間隔: [2秒, 5秒]

`startDiscoveryJob()` 内で `requestJson` → `requestDiscoveryJobWithRetry` に差し替え。

### 2. Submit前に暖機を短時間待機 (Discovery.jsx, Compare.jsx)

`handleDiscover()` / `handleScan()` 内で API 呼び出し前に:

```javascript
await Promise.race([
  warmMarketLensBackend(),
  new Promise((resolve) => setTimeout(resolve, 3000)),
])
```

- 暖機完了済みなら即resolve（ノーコスト）
- 未完了なら最大3秒だけ待つ（UXへの影響を最小化）
- 3秒で暖機が終わらなくても、リトライ側の `'verified'` 戦略がカバー

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/api/marketLens.js` | 定数追加 + `requestDiscoveryJobWithRetry()` 追加 + `startDiscoveryJob()` で使用 |
| `src/pages/Discovery.jsx` | `handleDiscover` 内に暖機待機 3秒追加 |
| `src/pages/Compare.jsx` | `handleScan` 内に暖機待機 3秒追加 |

---

## コールドスタート時のタイムライン

```
T=0    ページマウント → warmMarketLensBackend() 発火
T=10   ユーザーが「競合を発見」クリック
T=10   Promise.race([warmup, 3s]) → 最大3秒待機
T=13   startDiscoveryJob → optimistic で直接リクエスト
T=43   30秒タイムアウト → リトライ判定(retryable=true)
T=45   2秒wait後、verified 戦略でリトライ → ensureDirectBackend()
T=45+  バックエンド起動済みなら即成功 / まだなら暖機完了を待って成功
```

修正前: T=40で即エラー、手動リトライ必要
修正後: 自動リトライで透過的に成功

---

## 検証

1. `npm run build` — ビルド成功確認
2. Vercelデプロイ後、バックエンドがコールド状態で Discovery / Compare を実行
3. 自動リトライでエラーなく完了することを確認
