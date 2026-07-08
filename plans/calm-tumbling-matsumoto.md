# Discovery Hub + LP比較分析 根本修正計画 — 「生成されない」問題の完全解決

## Context

Discovery Hub・LP比較分析の両方で、分析が始まるが **完了せずエラーになる** 問題が繰り返し発生。
過去7日間で 33件の fix コミット（全69件の48%）が投入されたが、対症療法の繰り返しで根本原因に到達していなかった。

### 確認された根本原因

**フロントエンドの絶対タイムアウト（150秒）が、正常動作中のバックエンドジョブを殺している。**

```
POLL_MAX_DURATION_MS = 150,000ms  ← これが犯人

Backend analyze ステージ = Claude API 呼び出し = 120〜180秒
Frontend 絶対タイムアウト = 150秒
→ バックエンドが heartbeat を送り続けていても、150秒で強制終了
→ ユーザー再試行 → 新ジョブ → また150秒で殺される → 無限ループ
```

DevTools で確認した症状:
- 「比較分析中...」→「予想以上に時間がかかっています」→ タイムアウトエラー
- 401 エラーは `/api/ads/` 系（別問題、Discovery には影響なし）

### 副次的な問題

| # | 問題 | 場所 | 影響 |
|---|------|------|------|
| S1 | `report_md` が null → レポート欄が完全に空白（エラー表示なし） | Discovery.jsx L735 | Silent blank |
| S2 | `handleDiscover` で auth 不足時に silent return | Discovery.jsx L599 | ボタン押しても無反応 |
| S3 | ping 失敗で `_directBackendReady` がリセットされない | marketLens.js L64 | Stale readiness |
| S4 | `completed + result===null` が素通り | Discovery.jsx L485 | Silent pass-through |

---

## 修正計画（6つの変更）

### Change 1: ハートビート認識型タイムアウト（主修正）

**ファイル:** `src/pages/Discovery.jsx`  
**対象行:** L94-100（定数）, L418-432（tick 関数内ガード）

**方針:** 「150秒の壁」を **絶対キル → ソフト警告** に変更。
**プライマリ**のキル判定を stale detection（45秒間 heartbeat なし）に委ねる。

```
変更前: 150秒経過 → 即座に failRun（バックエンドの状態を無視）
変更後: 150秒経過 → ソフト警告表示「サーバーは応答中です」
         45秒間 heartbeat なし → failRun（正しいシグナル）
         300秒（安全弁） → failRun（stale 検知も機能しなかった場合のみ）
```

定数変更:
```javascript
// 変更前
const POLL_MAX_DURATION_MS = 150_000

// 変更後
const POLL_SOFT_WARNING_MS = 150_000   // ソフト警告のみ — キルしない
const POLL_HARD_CEILING_MS = 300_000   // 安全弁 — stale 検知の二重保険
const POLL_STALE_TIMEOUT_MS = 45_000   // ← これが PRIMARY キル判定（変更なし）
```

**重要: タイムアウト値を「増やす」のではなく、判定基準を「壁クロック」→「ハートビート有無」に変える。**
実効タイムアウトは stale の 45秒であり、現在の 150秒より **短い**。

新規 ref: `softWarningShownRef = useRef(false)`（L358 付近に追加）

tick 関数内の絶対タイムアウトガードを以下に置換:
```javascript
// Hard ceiling — stale 検知も効かなかった場合の最終安全弁
if (Date.now() - pollStartTimeRef.current > POLL_HARD_CEILING_MS) {
  stopPolling()
  console.warn('[Discovery] Hard ceiling reached', { elapsed: POLL_HARD_CEILING_MS })
  failRun('discovery', '分析がタイムアウトしました。再試行してください。', {
    category: 'timeout', label: 'タイムアウト',
    guidance: '分析に時間がかかりすぎています。再試行してください。', retryable: true,
  })
  return
}

// Soft warning — バックエンドは生きているが時間がかかっている
if (Date.now() - pollStartTimeRef.current > POLL_SOFT_WARNING_MS && !softWarningShownRef.current) {
  softWarningShownRef.current = true
  console.warn('[Discovery] Soft warning — backend still responding')
  updateRunMeta('discovery', {
    statusLabel: '通常より時間がかかっていますが、サーバーは応答中です…',
  })
}
```

`estimateRemaining` のメッセージも修正（L170）:
```javascript
// 変更前
return '予想以上に時間がかかっています'
// 変更後
return '通常より時間がかかっていますが処理中です'
```

### Change 2: `report_md` null 時のエラー表示

**ファイル:** `src/pages/Discovery.jsx`  
**対象行:** L485-500（completed ハンドラー内）

completed + result ありだが `report_md` が空の場合と、completed + result null の場合を明示的に処理:

```javascript
if (data.status === 'completed' && data.result) {
  stopPolling()
  clearActiveJob() // Change 5 で追加

  // ★ 追加: report_md 存在チェック
  if (!data.result.report_md) {
    console.warn('[Discovery] Completed but report_md missing', { jobId, keys: Object.keys(data.result) })
    failRun('discovery', 'レポート生成は完了しましたが、本文が空でした。再試行してください。', {
      category: 'upstream', label: 'レポート空', guidance: '再試行すると解決する場合があります。', retryable: true,
    })
    return
  }

  completeRun('discovery', data.result, { ... })
  return
}

// ★ 追加: completed + result null
if (data.status === 'completed' && !data.result) {
  stopPolling()
  clearActiveJob()
  console.warn('[Discovery] Completed but result is null', { jobId })
  failRun('discovery', 'ジョブは完了しましたが、結果データがありません。再試行してください。', {
    category: 'upstream', label: '結果なし', retryable: true,
  })
  return
}
```

### Change 3: `handleDiscover` の silent return 修正

**ファイル:** `src/pages/Discovery.jsx`  
**対象行:** L598-599

```javascript
// 変更前
if (!analysisKey || !analysisProvider) return

// 変更後
if (!analysisKey || !analysisProvider) {
  console.warn('[Discovery] Missing auth', { hasKey: !!analysisKey, hasProvider: !!analysisProvider })
  startRun('discovery', { url })
  failRun('discovery', 'APIキーまたはプロバイダーが設定されていません。設定画面を確認してください。', {
    category: 'auth_error', label: '設定不足',
    guidance: '設定 → AI設定 から Claude API キーを入力してください。', retryable: false,
  })
  return
}
```

### Change 4: ping 失敗で readiness をリセット

**ファイル:** `src/api/marketLens.js`  
**対象行:** L54-68

```javascript
// 変更前
.catch(() => { /* swallow */ })

// 変更後
.catch((err) => {
  console.warn('[MarketLens] Health ping failed:', err?.message || err)
  _directBackendReady = false
})

// 変更前（.then 内に else 追加）
.then((res) => {
  if (res.ok) {
    _directBackendReady = true
    _lastPingAt = Date.now()
  }
})

// 変更後
.then((res) => {
  if (res.ok) {
    _directBackendReady = true
    _lastPingAt = Date.now()
  } else {
    console.warn('[MarketLens] Health ping non-OK:', res.status)
    _directBackendReady = false
  }
})
```

### Change 5: ジョブ再開（sessionStorage ベース）

**ファイル:** `src/pages/Discovery.jsx`  
**追加位置:** コンポーネント先頭 + handleDiscover + tick 完了/失敗箇所

sessionStorage にアクティブジョブを保存し、ページ再読み込み/遷移後に再開:

```javascript
const DISCOVERY_ACTIVE_JOB_KEY = 'is-discovery-active-job'

function persistActiveJob(jobId, pollUrl, url) {
  try { sessionStorage.setItem(DISCOVERY_ACTIVE_JOB_KEY, JSON.stringify({ jobId, pollUrl, url, startedAt: Date.now() })) } catch {}
}
function clearActiveJob() {
  try { sessionStorage.removeItem(DISCOVERY_ACTIVE_JOB_KEY) } catch {}
}
function getActiveJob() {
  try {
    const raw = sessionStorage.getItem(DISCOVERY_ACTIVE_JOB_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (Date.now() - parsed.startedAt > 300_000) { clearActiveJob(); return null }
    return parsed
  } catch { return null }
}
```

mount 時の useEffect で再開:
```javascript
useEffect(() => {
  if (loading) return
  const activeJob = getActiveJob()
  if (!activeJob) return
  console.info('[Discovery] Resuming poll for active job', activeJob.jobId)
  if (activeJob.url && !url) setUrl(activeJob.url)
  startRun('discovery', { url: activeJob.url })
  updateRunMeta('discovery', { stage: 'analyze', statusLabel: '前回のジョブを再開中…', jobId: activeJob.jobId })
  pollJob(activeJob.jobId, { pollPath: activeJob.pollUrl, resetStartTime: true })
}, []) // mount only
```

### Change 6: 診断ログ（console.info/warn）

**ファイル:** `src/pages/Discovery.jsx`（tick 関数内各所）

各状態遷移で `[Discovery]` プレフィックス付きログを出力:
- tick 開始: elapsed, stage, stale duration
- ステージ遷移: 前 → 後、elapsed
- stale 検出開始
- 完了/失敗/自動再試行
- handleDiscover 開始

---

## 実装順序

| Step | Change | 所要時間 | 依存 |
|------|--------|----------|------|
| 1 | Change 1（ハートビート型タイムアウト） | 中 | なし — **これだけで主問題が解決** |
| 2 | Change 4（ping readiness リセット） | 小 | なし |
| 3 | Change 2（report_md null ガード） | 小 | なし |
| 4 | Change 3（auth 不足フィードバック） | 小 | なし |
| 5 | Change 6（診断ログ） | 小 | 1-4 と並行 |
| 6 | Change 5（ジョブ再開） | 中 | 1 完了後 |

---

## 検証手順

### 1. ローカル動作確認（devtools-verify skill）
- `npm run dev` でローカルサーバー起動
- ゲストモード Chrome で `localhost:3002/discovery` を開く
- DevTools Console タブを開く
- URL を入力して「競合を発見」ボタンをクリック
- Console に `[Discovery]` ログが出力されるか確認
- 150秒超えてもジョブが継続し、ソフト警告が出ることを確認
- 最終的にレポートが生成されるか確認

### 2. エラーケーステスト
- API キーを一時的に削除 → ボタン押下 → エラーバナー表示確認
- ネットワーク切断 → stale timeout が 45秒で発火することを確認

### 3. Smoke test
```bash
npm run smoke:discovery:rollout:render-probe
```

### 4. codex-review skill でコード品質レビュー

### 5. 本番デプロイ後の確認
- Vercel preview deploy で動作確認
- DevTools で `[Discovery]` ログを確認

---

## Part 2: LP比較分析 (Compare) の根本修正

### Compare の根本原因

Discovery とは **設計が全く違う** ため、Discovery の修正では Compare は直らない。

| 項目 | Discovery Hub | Compare (LP比較) |
|------|---------------|------------------|
| 通信方式 | 非同期ジョブ + ポーリング | **同期リクエスト（1発待ち）** |
| タイムアウト | POLL_MAX_DURATION_MS = 150s | **LONG_ANALYSIS_TIMEOUT = 240s** |
| heartbeat | あり（updated_at） | **なし** |
| 回復手段 | 自動リサブミット（2回） | 履歴検索（90秒間探索） |
| 進捗表示 | ステージ名 + %バー | ただの「分析中…」スピナー |

**Compare の問題フロー:**
```
1. handleScan() 開始
2. warmup レース: Promise.race([warmBackend(), sleep(3000)])
   → 3秒で諦める → backend がまだ cold のまま scan 送信
3. scan() = /scan POST, タイムアウト 240秒
   → cold backend で応答遅延 → 240秒で AbortError
4. 1回リトライ (isTimeout && attempt >= 1 → break)
   → 合計 ~482秒 待ってからエラー
5. recoverTimedOutScan() で 90秒間履歴検索
   → backend で完了していても履歴に載っていなければ回復不可
6. failRun → ユーザーにエラー表示
```

### Compare の副次的問題

| # | 問題 | 場所 | 影響 |
|---|------|------|------|
| C1 | `handleScan` で auth 不足時に silent return | Compare.jsx L321 | ボタン押しても無反応 |
| C2 | 3秒 warmup レースが短すぎる | Compare.jsx L342-345 | cold backend に分析投げて 240s 待ち |
| C3 | タイムアウト後リトライで合計 ~482秒 ハング | marketLens.js L436 | UX 崩壊 |
| C4 | 回復が履歴 API 依存 — 履歴に載らなければ失敗 | Compare.jsx L75-113 | 回復失敗 |
| C5 | 進捗表示がスピナーのみ — 何が起きているか不明 | Compare.jsx L493-497 | ユーザー不安 |

---

### Change 7: Compare の warmup を Discovery と同じ完全待機に変更

**ファイル:** `src/pages/Compare.jsx`  
**対象行:** L341-345

```javascript
// 変更前: 3秒で諦める
await Promise.race([
  warmMarketLensBackend(),
  new Promise((resolve) => setTimeout(resolve, 3000)),
])

// 変更後: Discovery と同じ完全待機パターン
updateRunMeta('compare', { statusLabel: 'サーバー起動待ち…' })
const warmResult = await warmMarketLensBackend()
if (!warmResult) {
  failRun('compare', 'サーバー起動に失敗しました。しばらく待って再試行してください。', {
    category: 'cold_start', label: 'サーバー起動失敗',
    guidance: 'バックエンドが起動できませんでした。ネットワーク接続を確認してください。', retryable: true,
  })
  return
}
```

**効果:** cold backend に無駄な 240秒リクエストを投げなくなる。warm 確認後に scan するので成功率が上がる。

### Change 8: Compare の handleScan silent return 修正

**ファイル:** `src/pages/Compare.jsx`  
**対象行:** L321

```javascript
// 変更前
if (!analysisKey || !analysisProvider) return

// 変更後
if (!analysisKey || !analysisProvider) {
  console.warn('[Compare] Missing auth', { hasKey: !!analysisKey, hasProvider: !!analysisProvider })
  startRun('compare', { urls })
  failRun('compare', 'APIキーまたはプロバイダーが設定されていません。設定画面を確認してください。', {
    category: 'auth_error', label: '設定不足',
    guidance: '設定 → AI設定 から Claude API キーを入力してください。', retryable: false,
  })
  return
}
```

### Change 9: scan タイムアウト時のリトライ戦略を改善

**ファイル:** `src/api/marketLens.js`  
**対象行:** L416-448 (requestScanWithRetry)

現在: タイムアウト → 2秒待ち → 2回目もタイムアウト → 合計 ~482秒。
問題: 1回目で 240秒待ったなら、backend が cold だったか Claude API が遅い。同じ条件で即リトライしても同じ結果。

```javascript
// 変更前 (L436)
if (isTimeout && attempt >= 1) break

// 変更後: タイムアウト時はリトライ前に backend readiness を再検証
if (isTimeout) {
  // 1回目のタイムアウト: backend warm を再確認してからリトライ
  if (attempt === 0) {
    console.warn('[Compare] scan timeout on attempt 0, re-verifying backend')
    _directBackendReady = false
    // リトライは directStrategy: 'verified' で行われる（既存フォールバック挙動）
  } else {
    // 2回目のタイムアウト: 回復フローに委ねる
    break
  }
}
```

### Change 10: Compare の診断ログ

**ファイル:** `src/pages/Compare.jsx`  
**対象箇所:** handleScan 内各所

```javascript
// handleScan 開始
console.info('[Compare] handleScan called', { target: urls.target, compA: urls.compA, compB: urls.compB })

// warmup 完了後
console.info('[Compare] Backend warm, submitting scan')

// scan 成功
console.info('[Compare] Scan completed', { hasReport: !!data.report, hasScore: data.overall_score != null })

// タイムアウト → 回復モード
console.warn('[Compare] Scan timed out, entering recovery mode')

// 回復成功/失敗
console.info('[Compare] Recovery succeeded/failed')
```

---

## 実装順序（統合）

| Step | Change | 対象 | 所要時間 | 依存 |
|------|--------|------|----------|------|
| 1 | Change 1（Discovery ハートビート型タイムアウト） | Discovery | 中 | なし — **Discovery 主修正** |
| 2 | Change 4（ping readiness リセット） | 共通 API 層 | 小 | なし — **両方に効く** |
| 3 | Change 7（Compare warmup 完全待機化） | Compare | 小 | なし — **Compare 主修正** |
| 4 | Change 2（Discovery report_md null ガード） | Discovery | 小 | なし |
| 5 | Change 3 + 8（auth silent return 修正） | 両方 | 小 | なし |
| 6 | Change 9（scan リトライ戦略改善） | Compare API 層 | 小 | Change 4 後推奨 |
| 7 | Change 6 + 10（診断ログ） | 両方 | 小 | 並行可 |
| 8 | Change 5（Discovery ジョブ再開） | Discovery | 中 | Change 1 後 |

---

## 検証手順

### 1. ローカル動作確認（devtools-verify skill）
- `npm run dev` でローカルサーバー起動
- ゲストモード Chrome で開く

**Discovery Hub (localhost:3002/discovery):**
- DevTools Console 開く → URL 入力 → 「競合を発見」クリック
- `[Discovery]` ログが出力されるか確認
- 150秒超えてもジョブが継続し、ソフト警告が出ることを確認
- 最終的にレポートが生成されるか確認

**LP比較分析 (localhost:3002/compare):**
- DevTools Console 開く → URL 入力 → 「分析開始」クリック
- `[Compare]` ログが出力されるか確認
- warmup が完了してから scan が始まることを確認（「サーバー起動待ち…」表示）
- 分析が完了してレポートが表示されるか確認

### 2. エラーケーステスト
- API キーを一時的に削除 → 両方のボタン押下 → エラーバナー表示確認
- ネットワーク切断 → Discovery は stale 45秒で発火、Compare は scan タイムアウトで回復フロー起動

### 3. Smoke test
```bash
npm run smoke:discovery:rollout:render-probe
```

### 4. codex-review skill でコード品質レビュー

### 5. 本番デプロイ後の確認
- Vercel preview deploy で両機能の動作確認
- DevTools で `[Discovery]` `[Compare]` ログを確認

---

## 修正対象ファイル

- `src/pages/Discovery.jsx` — Change 1, 2, 3, 5, 6
- `src/pages/Compare.jsx` — Change 7, 8, 10
- `src/api/marketLens.js` — Change 4, 9
