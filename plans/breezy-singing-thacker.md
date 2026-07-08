# Discovery Hub 根本的コールドスタート対策

## Context

Discovery HubはRender無料枠のバックエンド(`market-lens-ai.onrender.com`)に依存している。
Render無料枠は15分間アクセスがないとインスタンスがスリープし、次のリクエストで30-60秒のコールドスタートが発生する。

**現状の問題:**
- Layout/Discovery mountで`void warmMarketLensBackend()`を呼んでいるが、fire-and-forgetでUI状態に反映されない
- `handleDiscover`は warm-up を3秒しか待たない → コールドスタート時は無意味
- コールドスタート時、`requestDiscoveryJobWithRetry`のリトライだけで2分以上消費される場合があり、その間UIに進捗表示がない
- ユーザーは「何分経っても競合発見してくれない」状態になる
- keep-alive仕組みがなく、夜間にバックエンドが確実にスリープする

**目標:** バックエンドが常にウォーム状態を維持し、分析が2分以内に完了すること。タイムアウト値は変更しない。

---

## 修正方針（3層の対策）

### 1. Keep-Alive Ping System（`src/api/marketLens.js`）

**モジュールレベルに追加する状態:**
```
_warmingUp = false      // ensureDirectBackend実行中フラグ
_lastPingAt = null       // 最後に成功したpingのtimestamp
_readinessListeners = new Set()  // useSyncExternalStore向け購読者
```

**新規export関数:**
- `startBackendKeepAlive()` — 10分間隔で`/health`をping。`visibilitychange` APIを使い:
  - タブ非表示時: intervalを停止（リソース節約）
  - タブ再表示時: 最後のpingから10分以上経過していれば即座にping、intervalを再開
- `stopBackendKeepAlive()` — クリーンアップ
- `getBackendReadinessSnapshot()` — `{ ready: boolean, warming: boolean }` を返す
- `subscribeBackendReadiness(callback)` — readiness変化時に通知

**`ensureDirectBackend()`の変更:**
- 入口で `_warmingUp = true`、購読者に通知
- 成功時: `_warmingUp = false`, `_directBackendReady = true`, `_lastPingAt = Date.now()`、通知
- 失敗時: `_warmingUp = false`, `_directBackendReady = false`、通知

**10分間隔の根拠:** Renderのコールドスタート閾値が15分。10分間隔なら5分のマージンがある。

### 2. BackendReadinessContext（新規ファイル `src/contexts/BackendReadinessContext.jsx`）

`useSyncExternalStore`パターンで`marketLens.js`のモジュールレベル状態をReactに橋渡し。

```jsx
// AnalysisRunsContextと同じuseSyncExternalStoreパターン
export function useBackendReadiness() {
  return useSyncExternalStore(subscribeBackendReadiness, getBackendReadinessSnapshot)
}
```

**Provider:**
- mount時に`startBackendKeepAlive()`
- unmount時に`stopBackendKeepAlive()`

**配置:** `src/main.jsx`の`<AnalysisRunsProvider>`の外側（依存関係なし）

### 3. Discovery Page改修（`src/pages/Discovery.jsx`）

#### 3a. バックエンド状態インジケーター

URL入力フォームの下（現在の説明テキスト位置）に動的なステータスを表示:

| 状態 | 表示 |
|------|------|
| `ready === true` | 緑ドット + "サーバー準備完了" |
| `warming === true` | 橙パルスドット + "サーバー起動中…" |
| それ以外 | 灰色ドット + "サーバー状態確認中" |

**検索ボタンは無効化しない** — ユーザーの操作を阻害しない。クリック時にwarm-up gateで対処。

#### 3b. `handleDiscover`のリライト

現在のフロー:
```
stopPolling → startRun → race(warmup, 3秒) → startDiscoveryJob → pollJob
```

新フロー:
```
stopPolling → startRun
→ updateRunMeta({ stage: 'warming' })  ← UIに起動フェーズを表示
→ await warmMarketLensBackend()         ← タイムアウトレースなし、完了を待つ
→ 失敗: failRun('サーバー起動失敗')
→ 成功: updateRunMeta({ stage: 'queued', warmEndedAt: Date.now() })
→ startDiscoveryJob → pollJob           ← ここから分析タイマー開始
```

**重要:** warm-up時間はPOLL_MAX_DURATION_MSのカウントに含まれない。`pollJob`が呼ばれた時点からカウント開始（既存動作維持）。

#### 3c. STAGE_LABELSに`warming`を追加

```javascript
const STAGE_LABELS = {
  warming: 'サーバー起動待ち…',  // NEW
  queued: 'ジョブ準備中…',
  // ...
}
```

#### 3d. MetaBandの改修

`stage === 'warming'`のとき:
- 不定進行のプログレスバー（パルスアニメーション）を表示
- 残り時間の代わりに "サーバー起動中…" を表示
- `estimateRemaining`から`warming`ステージを除外

完了時に warm-up 時間がかかった場合は分けて表示:
- `warmEndedAt`がrun.metaにある場合: "起動: Xs + 分析: Ys"

---

## 対象ファイル

| ファイル | 変更内容 |
|---------|----------|
| [marketLens.js](src/api/marketLens.js) | keep-alive system、reactive readiness state、ensureDirectBackend通知 |
| [BackendReadinessContext.jsx](src/contexts/BackendReadinessContext.jsx) | **新規**: useSyncExternalStore + keep-alive lifecycle |
| [main.jsx](src/main.jsx) | BackendReadinessProviderをProvider treeに追加 |
| [Discovery.jsx](src/pages/Discovery.jsx) | warm-up gate、status indicator、MetaBand改修 |

## 変更しないもの

- タイムアウト値（`POLL_MAX_DURATION_MS = 150_000`は維持）
- `ensureDirectBackend`のリトライ間隔 `[0, 5000, 10000]`
- 自動再送信ロジック
- Layout.jsxのfire-and-forget warm-up（keep-aliveが上位互換だが、既存のベルト・アンド・サスペンダーとして残す）

---

## 検証手順

1. `npm run dev`で開発サーバー起動
2. Discovery Hubを開く → バックエンド状態インジケーターが表示されることを確認
3. バックエンドがウォーム時: 緑ドット表示 → URL入力 → 競合を発見 → 2分以内に結果表示
4. ブラウザのDevTools Networkタブで10分間隔のhealth pingを確認
5. タブを非表示にしてpingが停止することを確認、再表示で即pingを確認
6. バックエンドがコールド時（simulated）: 橙インジケーター → 検索ボタンクリック → "サーバー起動待ち…"表示 → 起動後に自動で分析開始
