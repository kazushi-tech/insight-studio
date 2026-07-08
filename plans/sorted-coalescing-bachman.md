# Discovery Hub 永続ローディング修正 — 徹底レビュー & 改善プラン

## Context

`structured-squishing-falcon.md`（レビュー改善プラン）と `silly-marinating-hinton.md`（元プラン）を
実際のコードと照合して徹底レビュー。正確な部分は踏襲し、不正確・不足箇所を修正した決定版プラン。

**バグの概要:** Discovery Hub で「競合を発見」→ 別ページ遷移 → 戻ると、永久ローディング状態に陥る。
根本原因はレジューム useEffect の `if (loading) return` がポーリング再開を阻害するため。

---

## レビュー結果サマリー

| 評価 | 対象 | 判定 |
|------|------|------|
| ✅ 正確 | 原因1: `if (loading) return` バグ | コード line 674 で確認 |
| ✅ 正確 | 原因2: バックエンドスタック検知不足 | stageTrackRef はあるがタイムアウト判定なし |
| ✅ 正確 | 原因3: 401コンソールエラー（無害） | 制御不可、I3の「対応なし」方針は妥当 |
| ✅ 正確 | C1: hard ceiling vs analyze タイムアウト矛盾 | 180s vs 180s で analyze タイムアウトが無意味 |
| ✅ 正確 | C2: sessionStorage 有効期限の不整合 | 300s vs 180s で最大120sの遊離 |
| ✅ 正確 | C3: 既存テスト破壊 | hard ceiling テスト line 217 で 305000ms 使用 |
| ✅ 正確 | I3: Fix 4 削除方針 | ブラウザ制御不可、Login.jsx 変更不要 |
| ⚠️ 不完全 | C1: ステージタイムアウト値 | 値は妥当だが、tick関数への挿入位置が未指定 |
| ❌ 誤り | M1: STAGE_LABELS 新規定義 | **既に lines 106-115 に存在** — 新規作成不要 |
| ❌ 誤り | テスト件数「102件」 | **実際は 683件** — 全テスト通過を確認すべき |
| ❌ 欠落 | sessionStorage期限テスト更新 | line 439 の `301_000` → `181_000` 更新が未記載 |
| ❌ 欠落 | stage timeout の tick内挿入位置 | 既存 stale チェックとの順序関係が未指定 |
| ❌ 欠落 | ポーリング二重起動防止の既存コード確認 | pollJob 先頭に既にガードがあるか未検証 |

---

## 改善後の修正内容

### Fix 1: ナビゲーション・レジューム・バグ修正（Critical）
**File:** `src/pages/Discovery.jsx` lines 673-682

**現状コード:**
```javascript
// Resume active job on mount (page reload / navigation)
useEffect(() => {
  if (loading) return  // ← これが原因
  const activeJob = getActiveJob()
  if (!activeJob) return
  // ...
}, [])
```

**修正後:**
```javascript
useEffect(() => {
  const activeJob = getActiveJob()
  if (!activeJob) return

  // loading=true（ナビゲーション復帰）でもポーリングを再開
  if (!loading) {
    if (activeJob.url && !url) setUrl(activeJob.url)
    startRun('discovery', { url: activeJob.url })
  }

  // ハードコード 'analyze' ではなく最後のステージを継承
  const currentStage = run?.meta?.stage || 'analyze'
  updateRunMeta('discovery', {
    stage: currentStage,
    statusLabel: '前回のジョブを再開中…',
    jobId: activeJob.jobId,
  })

  pollJob(activeJob.jobId, {
    pollPath: activeJob.pollUrl,
    resetStartTime: true,
  })
}, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount only
```

**変更点:**
- `if (loading) return` を削除 — loading状態でもレジュームを許可
- `stage: 'analyze'` ハードコード → `run?.meta?.stage || 'analyze'` に改善
- `run` 変数は line ~384 の `const run = getRun('discovery')` でスコープ内に存在

### Fix 2: ステージ別タイムアウト追加（Critical）
**File:** `src/pages/Discovery.jsx`

**STAGE_TIMEOUT_MS 定義 — lines 101-103 付近に追加:**
```javascript
const STAGE_TIMEOUT_MS = {
  queued: 30_000,            // 30s — キュー停滞は異常
  brand_fetch: 60_000,       // 60s — ブランド取得は高速であるべき
  classify_industry: 30_000, // 30s — 分類は軽量
  search: 90_000,            // 90s — 検索（並列化可能）
  fetch_competitors: 60_000, // 60s — データ収集
  analyze: 120_000,          // 120s — hard ceiling(180s)より60s余裕
  warming: 60_000,           // 60s — warmupは既に別途60s timeoutあり
}
```

**tick関数内への挿入位置 — 既存 stage tracking (lines 521-527) の直後:**

```javascript
// Stage-level timeout detection（既存 stageTrackRef 更新の直後に配置）
if (stageTrackRef.current) {
  const { stage, startTime } = stageTrackRef.current
  const stageLimit = STAGE_TIMEOUT_MS[stage]
  if (stageLimit && Date.now() - startTime > stageLimit) {
    stopPolling()
    clearActiveJob()
    const stageLabel = STAGE_LABELS[stage] || stage
    console.warn('[Discovery] Stage timeout', { stage, elapsed: Date.now() - startTime })
    failRun('discovery', `${stageLabel}がタイムアウトしました。再試行してください。`, {
      category: 'timeout', label: `${stageLabel}タイムアウト`,
      guidance: 'バックエンドの処理が停止した可能性があります。再試行してください。',
      retryable: true,
    })
    return
  }
}
```

**重要:** 既存の `STAGE_LABELS`（lines 106-115）はそのまま利用。新規作成不要。

### Fix 3: Hard ceiling を 180s に短縮
**File:** `src/pages/Discovery.jsx` line 102

```javascript
// Before:
const POLL_HARD_CEILING_MS = 300_000

// After:
const POLL_HARD_CEILING_MS = 180_000
```

### Fix 4: sessionStorage 有効期限を 180s に統合
**File:** `src/pages/Discovery.jsx` line 355

```javascript
// Before:
if (Date.now() - parsed.startedAt > 300_000) { clearActiveJob(); return null }

// After:
if (Date.now() - parsed.startedAt > 180_000) { clearActiveJob(); return null }
```

### Fix 5: ポーリング二重起動防止
**File:** `src/pages/Discovery.jsx` pollJob 関数の先頭（~line 437）

既存コードに `pollStoppedRef.current = false` があるが、
`pollTimerRef` のクリアと `resetPollingTracking` の呼び出しを追加:

```javascript
// pollJob 関数先頭に追加
pollStoppedRef.current = false
if (pollTimerRef.current) {
  clearTimeout(pollTimerRef.current)
  pollTimerRef.current = null
}
resetPollingTracking(resetStartTime)
```

**注意:** 既存コードに `resetPollingTracking` 呼び出しが既にある場合は統合し、重複呼び出しを避ける。

---

## テスト更新

**File:** `src/pages/__tests__/Discovery.polling.test.jsx`

### T1: 既存テスト更新（2件）

**1. Hard ceiling テスト更新 — line ~230:**
```javascript
// Before: await vi.advanceTimersByTimeAsync(305000)
// After:
await act(async () => { await vi.advanceTimersByTimeAsync(185000) })
```

**2. sessionStorage期限テスト更新 — line ~441:**
```javascript
// Before: startedAt: Date.now() - 301_000  (300s超え)
// After:
startedAt: Date.now() - 181_000  // 180s超え
```

### T2: 新規テスト追加（3件）

**テスト1: ナビゲーション復帰レジューム（主バグのテスト）**
```javascript
it('resumes polling when navigating back while loading', async () => {
  // 1. sessionStorage にアクティブジョブを設定
  sessionStorage.setItem('is-discovery-active-job', JSON.stringify({
    jobId: 'job-nav-1',
    pollUrl: '/discovery/jobs/job-nav-1',
    url: 'https://example.com',
    startedAt: Date.now(),
  }))

  // 2. 初回マウント — getDiscoveryJob は running を返す
  getDiscoveryJob.mockResolvedValue({
    status: 'running',
    stage: 'search',
    progress_pct: 50,
    updated_at: new Date().toISOString(),
  })

  const { unmount } = render(<Discovery />, { wrapper: TestProviders })

  // URL入力 & Submit
  // ... (ヘルパー使用)

  // 3. アンマウント（ナビゲーション離脱をシミュレート）
  unmount()

  // 4. 再マウント — AnalysisRunsContext は loading=true を保持
  //    ※ TestProviders で再ラップするため、Context状態の引き継ぎ方法に注意
  render(<Discovery />, { wrapper: TestProviders })

  // 5. ポーリングが再開されることを確認
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(getDiscoveryJob).toHaveBeenCalled()
})
```

**テスト2: ステージ別タイムアウト**
```javascript
it('detects stage-level timeout when a stage exceeds its limit', async () => {
  // brand_fetch ステージで65s停止（limit=60s）
  getDiscoveryJob.mockResolvedValue({
    status: 'running',
    stage: 'brand_fetch',
    progress_pct: 20,
    updated_at: new Date().toISOString(), // stale は回避
  })

  renderAndSubmit()

  // brand_fetch タイムアウト (60s) を超過
  await act(async () => { await vi.advanceTimersByTimeAsync(65000) })

  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByText(/タイムアウト/)).toBeInTheDocument()
})
```

**テスト3: hard ceiling 180s 動作確認（更新版）**
既存テスト `triggers hard ceiling timeout after 300s` を更新:
- テスト名: `triggers hard ceiling timeout after 180s`
- タイマー値: `305000` → `185000`

---

## 最終変更ファイル一覧

| File | 変更内容 | 優先度 |
|------|----------|--------|
| `src/pages/Discovery.jsx` | Fix 1（レジューム修正）、Fix 2（ステージタイムアウト）、Fix 3（hard ceiling 180s）、Fix 4（sessionStorage 180s）、Fix 5（二重起動防止） | Critical |
| `src/pages/__tests__/Discovery.polling.test.jsx` | T1（既存2件更新）、T2（新規3件追加） | Critical |

---

## 実装順序

1. **Fix 3 + Fix 4:** タイムアウト値変更（最も単純、影響範囲小）
2. **Fix 2:** ステージ別タイムアウト追加（STAGE_TIMEOUT_MS 定義 + tick内ロジック）
3. **Fix 5:** ポーリング二重起動防止（pollJob 先頭）
4. **Fix 1:** レジュームバグ修正（主修正、最後に適用してテストで確認）
5. **T1 + T2:** テスト更新・追加

---

## 検証手順

1. **全テスト実行:**
   ```bash
   npm test
   ```
   683件 + 新規3件 = 686件が通ること

2. **ビルド確認:**
   ```bash
   npm run build
   ```
   エラーなく完了

3. **E2E確認:**
   - Discovery Hub で「競合を発見」クリック → ジョブ開始
   - **テストA（同一ページ）:** そのまま待機 → 正常に完了
   - **テストB（ナビゲーション）:** Compareページに遷移 → 5秒後に戻る → ポーリング再開 → 完了
   - **テストC（ステージタイムアウト）:** コンソールに `[Discovery] Stage timeout` ログを確認

4. **コンソール確認:**
   - 401エラーは引き続き表示されるが、Discovery動作に影響ないことを確認
   - `[Discovery] Stage transition` ログでステージ遷移を確認
