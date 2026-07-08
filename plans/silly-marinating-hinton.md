# Discovery Hub 永続ローディング修正 — レビュー改善プラン

## Context

`structured-squishing-falcon` プランのレビューで5つの問題を特定。
根本原因分析は正確だが、実装に設計矛盾・テスト更新欠落・無効な修正が含まれている。
本プランは元プランの修正項目を改善した決定版。

---

## レビューで発見した問題と対処

### C1: Hard ceiling と analyze ステージタイムアウトの矛盾

**問題:** hard ceiling = 180s に対し analyze ステージタイムアウトも 180s。
analyze 到達時に既に60〜120s経過 → hard ceiling が先に発火 → analyze タイムアウトは実質無意味。

**対処:** ステージタイムアウトはあくまで「個別ステージの異常検知」として運用。
hard ceiling より短く設定すべし:

```javascript
const STAGE_TIMEOUT_MS = {
  queued: 30_000,           // 30s — 長いキューは異常
  brand_fetch: 60_000,      // 60s — ブランド取得は高速であるべき
  classify_industry: 30_000, // 30s — 分類は軽量
  search: 90_000,           // 90s ← 120sから短縮（検索は並列化可能）
  fetch_competitors: 60_000, // 60s ← 90sから短縮
  analyze: 120_000,          // 120s ← 180sから短縮（hard ceilingより60s余裕）
}
```

全ステージ合計: 30+60+30+90+60+120 = 390s（hard ceiling 180s が全体安全ネットとして機能）。

### C2: sessionStorage 有効期限の不整合

**問題:** `getActiveJob` の300s期限に対し hard ceiling は180s。
180sで失敗→リロード→sessionStorageに残存（最大120s）→再レジューム→更に180s待機の可能性。

**対処:** sessionStorage の有効期限も180sに統一:

```javascript
// Discovery.jsx getActiveJob() 内
// Before: if (Date.now() - parsed.startedAt > 300_000)
// After:
if (Date.now() - parsed.startedAt > 180_000) {
  clearActiveJob()
  return null
}
```

### C3: 既存テストの破壊

**問題:** `Discovery.polling.test.jsx` の hard ceiling テストが `305000ms` で検証。
180s変更で FAIL するがテスト更新が未記載。

**対処:** 既存テストの期待値を更新 + 新規テスト3件を追加（I2で記載）。

---

### I1: レジューム時のステージハードコード修正

**問題:** `stage: 'analyze'` 固定 → 実際のステージと不一致の可能性。

**対処:** 既存 run のステージを参照:

```javascript
// Fix 1: ナビゲーション・レジューム（改善版）
useEffect(() => {
  const activeJob = getActiveJob()
  if (!activeJob) return

  if (!loading) {
    if (activeJob.url && !url) setUrl(activeJob.url)
    startRun('discovery', { url: activeJob.url })
  }

  // ハードコード 'analyze' ではなく現在のステージを継承
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

### I2: 新規テスト3件の追加

**テスト1: ナビゲーション復帰レジューム（主バグのテスト）**
ファイル: `src/pages/__tests__/Discovery.polling.test.jsx` に追加

```javascript
it('resumes polling when navigating back while loading', async () => {
  // 1. 初回マウント → ジョブ開始
  const { unmount } = render(<Discovery />, { wrapper: TestProviders })
  // URL入力 → Submit（ヘルパー使用）
  // → ポーリング開始を確認

  // 2. アンマウント（別ページ遷移をシミュレート）
  unmount()

  // 3. 再マウント（Discoveryに戻る）
  // AnalysisRunsContext は状態を保持（TestProviders再ラップ）
  render(<Discovery />, { wrapper: TestProviders })

  // 4. ポーリングが再開されることを確認
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(getDiscoveryJob).toHaveBeenCalled()
})
```

**テスト2: ステージ別タイムアウト**
ファイル: `src/pages/__tests__/Discovery.polling.test.jsx` に追加

```javascript
it('detects stage-level timeout when a stage exceeds its limit', async () => {
  // brand_fetch ステージで60s以上停止するモック
  getDiscoveryJob.mockResolvedValue({
    status: 'running',
    stage: 'brand_fetch',
    progress_pct: 20,
    updated_at: new Date().toISOString(), // staleは回避
  })

  renderAndSubmit()
  // brand_fetch のステージタイムアウト (60s) を超過
  await act(async () => { await vi.advanceTimersByTimeAsync(65000) })

  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByText(/タイムアウト/)).toBeInTheDocument()
})
```

**テスト3: 更新後 hard ceiling (180s)**
既存テスト `triggers hard ceiling timeout after 300s` を修正:

```javascript
// Before: 305000ms → After: 185000ms
it('triggers hard ceiling timeout after 180s', async () => {
  // ... (same setup)
  await act(async () => { await vi.advanceTimersByTimeAsync(185000) })
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(screen.getByText(/タイムアウトしました/)).toBeInTheDocument()
})
```

### I3: Fix 4（401コンソールエラー）の方針変更

**問題:** ブラウザの `Failed to load resource: 401` は JavaScript から制御不可。
`console.debug` 化してもネットワークパネルの赤エラーは消えない。

**対処:** Fix 4 を「対応なし」に変更。理由:
- ブラウザ DevTools のコンソール/ネットワークエラーは制御不可
- Login.jsx は既に try-catch でUIにエラー表示済み
- クライアントへの説明で対応（「ログイン失敗の赤い行は正常な動作です」）

**Fix 4 は削除し、変更対象ファイルから `Login.jsx` を外す。**

---

### M1: STAGE_LABELS の定義

既存コードに `STAGE_LABELS` が存在しない場合、新規定数として定義:

```javascript
const STAGE_LABELS = {
  queued: 'キュー待機',
  brand_fetch: 'ブランド情報取得',
  classify_industry: '業界分類',
  search: '競合検索',
  fetch_competitors: '競合データ収集',
  analyze: '分析',
}
```

### M2: Fix 5 の明確化

`resetPollingTracking(resetStartTime)` は pollJob の**冒頭に追加**（既存呼び出しとの重複確認後に統合）。

---

## 最終変更ファイル一覧

| File | 変更内容 | 優先度 |
|------|----------|--------|
| `src/pages/Discovery.jsx` | Fix 1（レジューム改善版）、Fix 2（ステージタイムアウト）、Fix 3（hard ceiling 180s）、Fix 5（デバウンス防止）、sessionStorage期限180s、STAGE_LABELS定義 | Critical |
| `src/pages/__tests__/Discovery.polling.test.jsx` | 既存テスト更新（180s）、新規テスト3件追加 | Critical |

---

## 検証手順

1. **テスト実行:**
   ```bash
   npm test
   ```
   全テスト（105件想定: 102既存 + 3新規）が通ること

2. **ビルド確認:**
   ```bash
   npm run build
   ```
   エラーなく完了

3. **E2E確認:**
   - Discovery で「競合を発見」クリック → ジョブ開始
   - Compare ページに遷移 → 5秒後に Discovery に戻る
   - → ポーリングが再開し、プログレスが更新されることを確認
   - ジョブ正常完了まで検証

4. **ステージタイムアウト確認:**
   - バックエンドが停止した場合、該当ステージのタイムアウト後にエラーバナー表示
   - コンソールに `[Discovery] Stage timeout` ログが出力される
