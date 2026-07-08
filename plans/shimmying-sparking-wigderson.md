# Fix: LP比較分析 & Discovery の根本的エラー耐性強化

## Context

デプロイ済みの前回修正（タイムアウトメッセージ分類 + ステージ停滞検知）は部分的にしか効いていない:
- LP比較分析: タイムアウト分類は正しくなったが、**そもそもタイムアウトが頻発**する
- Discovery: ステージ停滞検知に**レースコンディション**があり、60秒で打ち切らず4分まで待たされる

ユーザー要件: **タイムアウト延長は絶対NG。時間は短いほど良い。エラーが出ないようにする。**

---

## 根本原因分析

### LP比較分析がタイムアウトする理由
1. `/scan` に**自動リトライが無い** — `/discovery/analyze` には3回リトライがあるのに `/scan` は1発勝負
2. `allowProxyFallback: false` — バックエンドが落ちていてもプロキシにフォールバックしない
3. Render無料枠のコールドスタート(30-60秒)で初回リクエストが即失敗

### Discovery停滞検知が効かない理由
`lastStageRef.current` が React の `useEffect`（非同期）で更新されるが、`tick()` 内のステージ変更チェックは同期的に参照する。タイミングずれで `stageStartTimeRef` が毎tickリセットされ、60秒に到達しない。

---

## 修正内容

### 1. `/scan` に自動リトライ追加 (marketLens.js)

**ファイル:** `src/api/marketLens.js`

`requestDiscoveryAnalyzeWithRetry()` と同パターンで `requestScanWithRetry()` を追加:

```javascript
async function requestScanWithRetry(payload, options) {
  let lastError = null
  const RETRY_COUNT = 2
  const RETRY_DELAYS = [2000, 5000]

  for (let attempt = 0; attempt <= RETRY_COUNT; attempt += 1) {
    try {
      return await requestJson('/scan', {
        method: 'POST',
        body: JSON.stringify(payload),
        timeout: LONG_ANALYSIS_TIMEOUT,
        direct: true,
        directStrategy: 'optimistic',
        allowProxyFallback: true,  // ← プロキシフォールバック有効化
        ...options,
      })
    } catch (error) {
      lastError = error
      // タイムアウト(AbortError)はリトライしない — バックエンドが本当に遅い
      if (error.name === 'AbortError') break
      const status = error.status || error.statusCode
      const retryable = [502, 503].includes(status)
        || isFetchNetworkError(error)
        || (status === 500 && /unicodeerror|internal server error/i.test(error.message))
      if (!retryable || attempt >= RETRY_COUNT) break
      _directBackendReady = false
      await sleep(RETRY_DELAYS[attempt] ?? 5000)
    }
  }
  throw lastError
}
```

`scan()` 関数内で `requestJson` → `requestScanWithRetry` に差し替え。

**ポイント:**
- タイムアウト(3分)でのリトライは**しない**（さらに3分待たせることになるため）
- 502/503/ネットワークエラーのみリトライ（コールドスタート対策）
- `allowProxyFallback: true` に変更 → 直接接続失敗時にVercelプロキシ経由で再試行

### 2. Discovery停滞検知のレースコンディション修正 (Discovery.jsx)

**ファイル:** `src/pages/Discovery.jsx`

#### 2A: `stageStartTimeRef` を `stageTrackRef` に統合（同期的に管理）

`lastStageRef`（useEffect経由）への依存を排除し、tick()内で完結する自己完結型トラッキングに変更:

```javascript
// 定義
const stageTrackRef = useRef(null)  // { stage: string, startTime: number }

// pollJob初期化
stageTrackRef.current = null

// tick()内（updateRunMeta()の後）
if (data.stage && (data.status === 'running' || data.status === 'queued')) {
  if (!stageTrackRef.current || data.stage !== stageTrackRef.current.stage) {
    stageTrackRef.current = { stage: data.stage, startTime: Date.now() }
  }
  const stageElapsedMs = Date.now() - stageTrackRef.current.startTime
  const typicalMs = (STAGE_TYPICAL_SEC[data.stage] || 10) * 1000
  const stageMaxMs = Math.max(typicalMs * STAGE_MAX_MULTIPLIER, STAGE_MIN_TIMEOUT_MS)
  if (stageElapsedMs > stageMaxMs) {
    stopPolling()
    const stageName = STAGE_LABELS[data.stage] || data.stage
    failRun('discovery', `「${stageName.replace(/…$/, '')}」が長時間停止しています。再試行してください。`, {
      category: 'timeout', label: 'ステージ停滞',
      guidance: `「${stageName.replace(/…$/, '')}」ステージが${Math.round(stageElapsedMs / 1000)}秒以上進行していません。再試行してください。`,
      retryable: true,
    })
    return
  }
}
```

**なぜこれで直るか:** `stageTrackRef.current.stage` は tick() 内で同期的に設定・比較されるため、React の非同期レンダリングタイミングに影響されない。

#### 2B: 停滞検知しきい値を短縮

```javascript
const STAGE_MAX_MULTIPLIER = 3    // 4 → 3
const STAGE_MIN_TIMEOUT_MS = 30_000  // 60s → 30s
```

| Stage | typical | 旧上限 | 新上限 |
|-------|---------|--------|--------|
| queued | 2s | 60s | **30s** |
| brand_fetch | 5s | 60s | **30s** |
| classify_industry | 4s | 60s | **30s** |
| search | 20s | 80s | **60s** |
| fetch_competitors | 8s | 60s | **30s** |
| analyze | 50s | 200s | **150s** |

### 3. Compare / Discovery ページにバックエンド暖機追加

**ファイル:** `src/pages/Compare.jsx`, `src/pages/Discovery.jsx`

ページマウント時に `warmMarketLensBackend()` を呼び出す:

```javascript
import { warmMarketLensBackend } from '../api/marketLens'

useEffect(() => {
  void warmMarketLensBackend()
}, [])
```

Layout.jsx で既に初回呼び出し済みだが、ユーザーが長時間放置後にページ遷移した場合のコールドスタート対策。`_directBackendReady` が true なら即return（ノーコスト）。

### 4. 不要になった `stageStartTimeRef` の削除

`stageTrackRef` に統合されるため、以下を削除:
- `const stageStartTimeRef = useRef(null)` の定義
- `stageStartTimeRef.current = Date.now()` の初期化

---

## 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src/api/marketLens.js` | `requestScanWithRetry()` 追加、`scan()` でそれを使用 |
| `src/pages/Discovery.jsx` | 停滞検知を `stageTrackRef` で同期管理、しきい値短縮、暖機追加 |
| `src/pages/Compare.jsx` | 暖機追加 |

---

## 検証

1. `npm run build` — ビルド成功確認
2. LP比較分析:
   - バックエンドがコールド状態で分析開始 → 自動リトライで成功することを確認
   - プロキシフォールバック経由で分析成功することを確認
3. Discovery:
   - `queued` ステージが30秒超で停滞エラーが出ることを確認
   - 正常完了ケースで誤検知がないことを確認
4. 両ページで暖機処理が走ることをDevToolsのNetworkタブで確認
