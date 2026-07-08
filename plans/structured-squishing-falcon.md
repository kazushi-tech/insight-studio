# Discovery Hub 永続ローディング修正プラン

## Context

Discovery Hub で「競合を発見」ボタンを押すと、**ずっとローディング状態のまま完了しない**。
Renderプランは課金済み（コールドスタート解消済み）、Claude API キーも設定済み。
クライアント提出用として信頼性が求められている。

## 根本原因

### 原因1: ナビゲーション・レジューム・バグ (Critical)

`Discovery.jsx:673-682` のレジュームロジックに致命的欠陥がある:

```javascript
useEffect(() => {
  if (loading) return  // ← これが原因！
  const activeJob = getActiveJob()
  // ...
}, [])
```

**何が起きるか:**
1. ユーザーがDiscovery分析を開始 → ジョブ開始、ポーリング開始
2. ユーザーが別ページ（Compare等）に遷移 → Discovery コンポーネントがアンマウント
3. `useEffect(() => stopPolling, [stopPolling])` が実行 → ポーリング停止
4. ユーザーがDiscoveryに戻る → コンポーネントが再マウント
5. `AnalysisRunsContext` が状態を保持 → `loading = true`
6. レジューム効果が `if (loading) return` でスキップ → **ポーリングが再開されない**
7. UIは永遠に「ローディング中」のまま

**なぜ気づきにくいか:** 同一ページに留まっていれば問題は起きない。Compareと並行利用した時だけ発現する。

### 原因2: バックエンドジョブのスタック検知不足

現在のタイムアウト体系:
- Stale: `updated_at` が45秒変わらない → トリガーされにくい（バックエンドが生きていれば updated_at が変わり続ける）
- Hard ceiling: 300秒 → 長すぎる。クライアントは5分も待たない
- **ステージ別タイムアウトがない** → 特定ステージ（analyze等）で詰まっても検知不可

### 原因3: 401コンソールエラー（クライアント印象悪化）

ads-insights のログイン失敗が赤い401エラーとしてコンソールに残る。
Discovery機能とは無関係だが、クライアントに見せると「壊れている」と誤解される。

---

## 修正内容

### Fix 1: ナビゲーション・レジューム・バグ修正
**File:** `src/pages/Discovery.jsx` (lines 672-682)

`if (loading) return` を削除し、loading状態に関わらずactiveJobをチェックして再開する:

```javascript
useEffect(() => {
  const activeJob = getActiveJob()
  if (!activeJob) return

  // loading=true でもポーリングを再開（ナビゲーション復帰対応）
  if (!loading) {
    if (activeJob.url && !url) setUrl(activeJob.url)
    startRun('discovery', { url: activeJob.url })
  }

  updateRunMeta('discovery', {
    stage: 'analyze',
    statusLabel: '前回のジョブを再開中…',
    jobId: activeJob.jobId,
  })

  pollJob(activeJob.jobId, {
    pollPath: activeJob.pollUrl,
    resetStartTime: true,
  })
}, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount only
```

### Fix 2: ステージ別タイムアウト追加
**File:** `src/pages/Discovery.jsx`

各ステージに最大時間を設定し、超過したら明確なエラーメッセージを表示:

```javascript
const STAGE_TIMEOUT_MS = {
  queued: 30_000,
  brand_fetch: 60_000,
  classify_industry: 30_000,
  search: 120_000,
  fetch_competitors: 90_000,
  analyze: 180_000,
}
```

tick関数内でステージ滞在時間をチェック:

```javascript
// Stage-level timeout detection
const currentStage = stageTrackRef.current
if (currentStage) {
  const stageLimit = STAGE_TIMEOUT_MS[currentStage.stage] || 120_000
  if (Date.now() - currentStage.startTime > stageLimit) {
    stopPolling()
    clearActiveJob()
    const stageLabel = STAGE_LABELS[currentStage.stage] || currentStage.stage
    failRun('discovery', `${stageLabel}がタイムアウトしました。再試行してください。`, {
      category: 'timeout', label: `${stageLabel}タイムアウト`,
      guidance: 'バックエンドの処理が停止した可能性があります。再試行してください。',
      retryable: true,
    })
    return
  }
}
```

### Fix 3: Hard ceiling を短縮
**File:** `src/pages/Discovery.jsx` (line 102)

```javascript
// Before: 300秒（5分）→ クライアントは待てない
const POLL_HARD_CEILING_MS = 300_000

// After: 180秒（3分）→ ステージ別タイムアウトと併用で十分
const POLL_HARD_CEILING_MS = 180_000
```

### Fix 4: クライアント向けコンソールエラー抑制
**File:** `src/api/adsInsights.js`

ログインエンドポイントの401をブラウザコンソールに出さないよう、リクエスト前にconsole.errorを抑制する設計にする:

```javascript
export async function loginCase(caseId, password) {
  try {
    const data = await request('/cases/login', {
      method: 'POST',
      body: JSON.stringify({ case_id: caseId, password }),
      skipAuth: true,
    })
    // ... existing success logic
  } catch (e) {
    // ログイン失敗は正常系（パスワード間違い等）なのでコンソールエラー抑制
    throw e
  }
}
```

※実際にはブラウザが `Failed to load resource: 401` をコンソールに出すのは制御不可。
代わりに、Login.jsx で loginCase/login 呼び出しを try-catch で包み、
`catch` ブロック内で `console.debug` レベルに落とす（赤いエラーではなくグレーログにする）。

### Fix 5: ポーリング再開のデバウンス防止
**File:** `src/pages/Discovery.jsx`

`loading` 状態でのレジューム時に、既存の `pollTimerRef` をクリアして二重ポーリングを防止:

```javascript
// pollJob の先頭で既存タイマーをクリア
pollStoppedRef.current = false
if (pollTimerRef.current) {
  clearTimeout(pollTimerRef.current)
  pollTimerRef.current = null
}
resetPollingTracking(resetStartTime)
```

---

## 変更ファイル一覧

| File | 変更内容 |
|------|----------|
| `src/pages/Discovery.jsx` | レジューム修正、ステージ別タイムアウト、hard ceiling短縮 |
| `src/pages/Login.jsx` | ログイン401エラーのコンソール抑制 |

---

## 検証手順

1. **レジューム修正の確認:**
   - Discovery で「競合を発見」をクリック
   - ジョブ開始後、すぐにCompareページに遷移
   - 5秒後にDiscoveryに戻る
   - → ポーリングが再開され、MetaBandのプログレスが更新されることを確認

2. **ステージ別タイムアウトの確認:**
   - Discovery分析を開始
   - コンソールで `[Discovery] Stage transition` ログを確認
   - バックエンドがstuckした場合、該当ステージのタイムアウト後にエラーバナーが表示される

3. **既存テストの確認:**
   ```bash
   npm test
   ```
   全102テストが通ることを確認

4. **ビルド確認:**
   ```bash
   npm run build
   ```
   エラーなくビルド完了すること

5. **E2E確認:**
   - Discovery Hubで実際にURLを入力して分析を実行
   - 同一ページに留まった場合: 正常に完了すること
   - 別ページに遷移して戻った場合: ポーリングが再開すること
