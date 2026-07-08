# Fix: LP比較分析エラー表示 & Discovery長時間ハング

## Context

本番で2つの症状が再発している:
1. **LP比較分析** — 3分タイムアウト後に「予期しないエラーが発生しました」と表示（適切なタイムアウト表示にならない）
2. **Discovery Hub** — 「競合サイト取得中...」で3分以上止まり、4分の絶対タイムアウトまで待たされる

いずれもフロントエンド側の分類・検知ロジックの欠陥。バックエンド変更は不要。

---

## Bug 1: タイムアウトが "予期しないエラー" に誤分類される

### 根本原因

[marketLens.js:475-478](src/api/marketLens.js#L475-L478) で AbortError を捕捉後、カスタムメッセージの `new Error(...)` に差し替えるが:
- `error.name` は `'Error'`（`'AbortError'` でない）
- メッセージに `'タイムアウト'` も `'timeout'` も含まない

→ [classifyError()](src/api/marketLens.js#L47-L106) のどの条件にもマッチせず、フォールバックの `'予期しないエラーが発生しました'` が表示される。

### 修正

**ファイル:** `src/api/marketLens.js` L477

```diff
- throw new Error('分析の完了まで時間がかかっています。対象サイトの取得やバックエンドの起動待ちで数十秒かかることがあります。少し待って再実行してください。')
+ throw new Error('分析がタイムアウトしました。対象サイトの取得やバックエンドの起動待ちで数十秒かかることがあります。少し待って再実行してください。')
```

これで `msg.includes('タイムアウト')` が true → `category: 'timeout'` に正しく分類される。

---

## Bug 2: Discovery のステージ停滞検知が無い

### 根本原因

現状の検知は2つだけ:
1. **Stale検知** (30s) — `updated_at` が変わらなくなったら発火。だがバックエンドがハートビート(10s周期)を送り続ければ永遠に発火しない
2. **絶対タイムアウト** (4min) — 最終防壁。遅すぎる

`fetch_competitors` の典型所要時間は8秒なのに、3分以上待たされる。「残り約50秒」も残ステージの合計値しか見ないため誤解を招く。

### 修正

**ファイル:** `src/pages/Discovery.jsx`

#### 修正A: 定数追加 (L14の後)

```javascript
const STAGE_MAX_MULTIPLIER = 4
const STAGE_MIN_TIMEOUT_MS = 60_000
```

各ステージの停滞判定: `max(typicalDuration × 4, 60秒)`

| Stage | typical | 判定上限 |
|-------|---------|---------|
| queued | 2s | 60s |
| brand_fetch | 5s | 60s |
| search | 20s | 80s |
| fetch_competitors | 8s | **60s** ← 3分待ちが60sで打ち切り |
| analyze | 50s | 200s |

#### 修正B: Ref追加 (L206の後)

```javascript
const stageStartTimeRef = useRef(null)
```

#### 修正C: pollJob初期化に追加 (~L255, `staleStartRef.current = null` の後)

```javascript
stageStartTimeRef.current = Date.now()
```

#### 修正D: tick()内にステージ停滞チェック追加 (L314の後、L316の前)

`updateRunMeta()` の後、`data.status === 'completed'` チェックの前に挿入:

```javascript
// Per-stage stall detection
if (data.stage && (data.status === 'running' || data.status === 'queued')) {
  if (data.stage !== lastStageRef.current) {
    stageStartTimeRef.current = Date.now()
  }
  if (stageStartTimeRef.current) {
    const stageElapsedMs = Date.now() - stageStartTimeRef.current
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
}
```

#### 修正E: estimateRemaining() の改善 (L37-53)

全ステージの典型合計(89s)の1.5倍(~134s)を超えたら正直に表示:

```javascript
function estimateRemaining(currentStage, elapsedMs) {
  const idx = STAGE_ORDER.indexOf(currentStage)
  if (idx < 0) return null
  const elapsedSec = (elapsedMs || 0) / 1000
  const currentTypical = STAGE_TYPICAL_SEC[currentStage] || 10
  const totalTypical = STAGE_ORDER.reduce((sum, s) => sum + (STAGE_TYPICAL_SEC[s] || 10), 0)
  if (elapsedSec > totalTypical * 1.5) {
    return '予想以上に時間がかかっています'
  }
  const currentRemaining = Math.max(0, currentTypical - elapsedSec * 0.3)
  let total = currentRemaining
  for (let i = idx + 1; i < STAGE_ORDER.length; i++) {
    total += STAGE_TYPICAL_SEC[STAGE_ORDER[i]] || 10
  }
  const rounded = Math.ceil(total / 10) * 10
  if (rounded < 10) return '残り約10秒'
  if (rounded < 60) return `残り約${rounded}秒`
  const min = Math.ceil(rounded / 60)
  return `残り約${min}分`
}
```

---

## 変更ファイル一覧

| ファイル | 変更行 | 内容 |
|---------|--------|------|
| `src/api/marketLens.js` | L477 | タイムアウトメッセージに「タイムアウト」キーワード追加 |
| `src/pages/Discovery.jsx` | L14後 | 定数2つ追加 |
| `src/pages/Discovery.jsx` | L206後 | `stageStartTimeRef` 追加 |
| `src/pages/Discovery.jsx` | ~L255 | pollJob初期化にref初期化追加 |
| `src/pages/Discovery.jsx` | L37-53 | `estimateRemaining()` 改善 |
| `src/pages/Discovery.jsx` | L314後 | ステージ停滞チェック挿入(18行) |

**総変更量:** ~30行、2ファイル

---

## 検証

1. `npm run build` — ビルド成功確認
2. LP比較分析でタイムアウト時に「タイムアウト」カテゴリで表示されることを確認
3. Discovery で `fetch_competitors` が60秒超えたら停滞エラーが出ることを確認
4. 正常完了ケース（89秒以内）で誤検知がないことを確認
