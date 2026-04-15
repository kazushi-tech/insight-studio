# Phase 2.5: コアロジックテスト — ポーリング・リカバリ・フォールバック

## Context

PR #3 でテスト基盤（81テスト）を構築したが、レビューにて **モグラ叩きの真の原因**
であるコアロジック（ポーリング、stale検知、タイムアウトリカバリ、プロキシフォールバック）
が一切テストされていないことが判明。

本プランはその欠落部分を埋め、「安定化完了」と言い切れる状態にする。

## 新規作成ファイル（3ファイル、全て独立・並列実行可能）

```
src/pages/__tests__/Discovery.polling.test.jsx   — 10テスト（最重要）
src/pages/__tests__/Compare.timeout-recovery.test.jsx — 5テスト
src/api/__tests__/marketLens.transport.test.js    — 4テスト
```

**合計: 19テスト追加（81 → 100テスト）**

## 既存テストの改善（1ファイル）

```
src/pages/__tests__/Compare.recovery.test.jsx — waitForタイムアウト値の縮小
```

---

## Phase 1: 先行準備（オーケストレータ単独、~3分）

PR #3 のブランチ（`feat/test-infrastructure`）がマージ済みであることを確認。
master を pull して最新状態にする。

---

## Phase 2: Agent Team 3並列テスト実装

`/agent-team-workflow` で 3 エージェントを並列起動。

### ┌── Agent A: Discovery ポーリングテスト（最重要・最大）

**ファイル:** `src/pages/__tests__/Discovery.polling.test.jsx`

**モック戦略:**
- `vi.mock('../../api/marketLens')` で API 関数をモック（既存の Discovery.errors.test.jsx と同パターン）
- `vi.useFakeTimers()` で setTimeout/setInterval を制御
- `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` でユーザー操作とタイマーを連携
- ポーリング進行は `vi.advanceTimersByTimeAsync(ms)` で段階的に進める（`vi.runAllTimersAsync()` は再帰 setTimeout で無限ループするため禁止）
- `classifyError` は実関数を維持（正確なエラー分類が必要）

**テストケース（10件）:**

```
1. Happy Path ポーリング → 完了
   - getDiscoveryJob: running → running → completed（result.report_md 付き）
   - advanceTimersByTimeAsync(2000) を3回（POLL_INTERVAL_INITIAL_MS=2000）
   - 検証: レポート内容が画面に表示される

2. Stale 検知（45秒 heartbeat 無変更 → タイムアウト）
   - getDiscoveryJob: 毎回 {status:'running', updated_at:'FIXED_TIMESTAMP'} を返す
   - advanceTimersByTimeAsync で 45000ms 以上経過させる
   - 検証: エラーバナー表示、「応答しなくなりました」等のメッセージ

3. Stale リセット（updated_at 変化で 45秒カウンターがリセット）
   - 40秒間は同じ updated_at → 変更 → さらに 10秒
   - 検証: 45秒超えてもエラーにならない（カウンターがリセットされたため）

4. Hard Ceiling（300秒 → 強制タイムアウト）
   - getDiscoveryJob: 毎回異なる updated_at で running を返し続ける
   - advanceTimersByTimeAsync で 300000ms 以上経過
   - 検証: タイムアウトエラー表示

5. ネットワークエラー 3回連続 → ハードフェイル
   - getDiscoveryJob: mockRejectedValueOnce × 3
   - 検証: 3回目の後にエラーバナー表示

6. ネットワークエラー 2回 + 成功 → カウンターリセットで継続
   - getDiscoveryJob: reject, reject, resolve(running), ..., resolve(completed)
   - 検証: エラーにならず最終的に完了

7. Adaptive Interval（2秒 → 30秒経過後 5秒に切り替え）
   - vi.spyOn(globalThis, 'setTimeout') でタイマー引数を監視
   - 検証: 初期は ~2000ms、30秒後は ~5000ms

8. サーバー retry_after_sec の尊重
   - getDiscoveryJob: {retry_after_sec: 10, status:'running'} を返す
   - 検証: setTimeout が 10000ms で呼ばれる

9. Session Recovery（マウント時にセッション復旧）
   - beforeEach で sessionStorage に is-discovery-active-job をセット
     {jobId:'job-1', pollUrl:'/discovery/jobs/job-1', url:'https://example.com', startedAt: Date.now()}
   - コンポーネント render → getDiscoveryJob が呼ばれる → completed を返す
   - 検証: レポートが表示される（ポーリング復旧成功）

10. 期限切れセッションは無視（300秒超過）
    - startedAt を Date.now() - 301000 に設定
    - 検証: getDiscoveryJob が呼ばれない（復旧スキップ）
```

**参照ファイル:**
- `src/pages/Discovery.jsx` 行342-682（セッション保存、pollJob、resume-on-mount）
- `src/pages/__tests__/Discovery.errors.test.jsx`（vi.mock パターンの参考）
- `src/test/mocks/contexts.js`（TestProviders）

**注意点:**
- Auto-resubmit テストは省略。理由: resubmit は warmMarketLensBackend + startDiscoveryJob + 再帰的 pollJob 呼び出しを含む複合フローで、fake timers との組み合わせが極めて複雑。ポーリングの基盤テスト（stale/ceiling/network error）が先。resubmit は Phase 3 で検討。

---

### ├── Agent B: Compare タイムアウトリカバリテスト

**ファイル:** `src/pages/__tests__/Compare.timeout-recovery.test.jsx`

**モック戦略:**
- `vi.mock('../../api/marketLens')` で `scan`, `getScans`, `warmMarketLensBackend` をモック
- `classifyError` は実関数を維持（timeout 判定に必要）
- タイムアウトリカバリ内の `sleep()` があるため `vi.useFakeTimers()` を使用

**テストケース（5件）:**

```
1. タイムアウト → リカバリ成功
   - scan: mockRejectedValue({isTimeout:true, name:'AbortError'})
   - getScans: {scans:[{status:'completed', urls:['https://example.com','https://competitor.com'], created_at: 最近のタイムスタンプ, run_id:'recovered-1'}]}
   - getScan: 完全な結果を返す
   - 検証: "履歴確認中" が表示され、その後スコアとレポートが表示される

2. URL正規化を経てリカバリ成功
   - scan: timeout エラー
   - getScans: urls に末尾スラッシュ付き ['https://Example.COM/', 'https://Competitor.com/']
   - 検証: normalizeComparableUrl により正規化されマッチ成功

3. リカバリ失敗（マッチなし）→ エラー表示
   - scan: timeout エラー
   - getScans: {scans:[]}
   - 検証: エラーバナー表示

4. 2分以上前のスキャンは無視
   - scan: timeout エラー
   - getScans: created_at が startedAt - 3分前
   - 検証: マッチせずエラー表示

5. timeout 以外のエラーではリカバリをスキップ
   - scan: mockRejectedValue({status:401})
   - 検証: getScans が呼ばれない（リカバリ不要）、即座にエラー表示
```

**参照ファイル:**
- `src/pages/Compare.jsx` 行37-116（normalizeComparableUrl, haveSameUrlList, findMatchingCompletedScan, recoverTimedOutScan）
- `src/pages/Compare.jsx` 行378-413（timeout catch 分岐）
- `src/pages/__tests__/Compare.test.jsx`（既存パターンの参考）

---

### └── Agent C: requestJson トランスポートテスト + 既存テスト改善

**ファイル:** `src/api/__tests__/marketLens.transport.test.js`

**モック戦略:**
- MSW を使用（requestJson はプロキシパスを通るため、MSW で `/api/ml/*` をインターセプトすれば十分）
- jsdom では SHOULD_FORCE_PROXY=true なので、プロキシパスのテストに集中
- 直接バックエンドフォールバックは SHOULD_FORCE_PROXY がブロックするため、公開 API 関数のリトライ挙動（requestDiscoveryJobWithRetry 等）をテスト

**テストケース（4件）:**

```
1. プロキシパスが使用される確認
   - health() を呼ぶ
   - MSW の request handler で request.url をキャプチャ
   - 検証: /api/ml/health にリクエストされている（直接 Render URL ではない）

2. HTTP エラー時の Error オブジェクト構造
   - MSW: /api/ml/discovery/jobs/:id → 500 {detail:'custom error message'}
   - getDiscoveryJob('xxx') を呼ぶ
   - 検証: thrown error に .status=500, .message に 'custom error message' 含む

3. startDiscoveryJob の 503 リトライ
   - MSW handler: 1回目 503 → 2回目 success
   - 検証: 最終的に成功結果が返る（内部リトライが機能）

4. scan のネットワークエラーリトライ
   - MSW handler: 1回目 HttpResponse.error() → 2回目 success
   - 検証: 最終的に成功結果が返る
```

**追加タスク: 既存テストの waitFor タイムアウト縮小**

`Compare.recovery.test.jsx` の `{ timeout: 30000 }` を `{ timeout: 10000 }` に統一。
CI での無駄な待ち時間を防止する。

対象:
- `src/pages/__tests__/Compare.recovery.test.jsx` — 全 waitFor
- `src/pages/__tests__/Compare.test.jsx` — 全 waitFor

**参照ファイル:**
- `src/api/marketLens.js` 行621-708（requestJson）、行354-460（リトライラッパー）
- `src/api/__tests__/marketLens.test.js`（既存パターンの参考）
- `src/test/mocks/handlers.js`（デフォルトMSWハンドラ）

---

## Phase 2 の Agent Team 構成

```
/agent-team-workflow で起動:

┌─────────────────────────────────────────────────────┐
│  Orchestrator (メインセッション)                      │
│  PR #3 マージ確認 → master pull → 3 agent 並列起動    │
├────────────┬─────────────────┬───────────────────────┤
│  Agent A   │    Agent B      │      Agent C          │
│  Discovery │    Compare      │   Transport +         │
│  Polling   │    Recovery     │   既存テスト改善        │
│            │                 │                       │
│ 新規1ファイル│  新規1ファイル    │  新規1ファイル          │
│ 10テスト    │   5テスト        │  4テスト + 改善        │
│            │                 │                       │
│ 見積: ~25分 │  見積: ~15分     │  見積: ~15分           │
└────────────┴─────────────────┴───────────────────────┘
                       ↓
              Phase 3: 統合検証
```

---

## Phase 3: 統合検証（オーケストレータ単独、~5分）

1. `npm test` — 全テスト通過（目標: ~100テスト）
2. `npm run lint` — エラー 0
3. `npm run build` — ビルド成功
4. **意図的破壊テスト:**
   - Discovery.jsx の `POLL_STALE_TIMEOUT_MS` を 45000 → 99999 に変更 → polling stale テストが失敗 → 戻す
   - Compare.jsx の `findMatchingCompletedScan` 内の `item.status === 'completed'` を削除 → recovery テストが失敗 → 戻す
5. `/codex-review` でテスト品質レビュー

---

## 実行手順サマリ

```
1. PR #3 がマージ済みか確認、master を pull
2. /agent-team-workflow を起動
3. Phase 2 を 3 agent 並列実行（~25分）
4. 全 agent 完了後、npm test で全テスト通過を確認
5. 意図的破壊テストでテストの有効性を検証
6. /codex-review でレビュー
7. git commit & push & PR 作成
```

---

## 完了基準

- [ ] Discovery ポーリング: stale検知・hard ceiling・ネットワークエラー閾値がテスト済み
- [ ] Discovery セッション復旧: 復旧成功・期限切れ無視がテスト済み
- [ ] Compare リカバリ: timeout→リカバリ成功・URL正規化・リカバリ失敗がテスト済み
- [ ] Transport: プロキシパス確認・リトライ動作がテスト済み
- [ ] 既存テストの waitFor タイムアウトが 10秒以下に統一
- [ ] 意図的破壊テストでテストの検知力を実証済み
- [ ] `npm test` 全件パス、lint/build 成功
- [ ] CI でテスト自動実行を確認

---

## 前回プランとの差分

| 項目 | PR #3 (Phase 2) | 本プラン (Phase 2.5) |
|------|-----------------|---------------------|
| テスト対象 | UI描画・エラー表示 | **非同期フロー・状態遷移** |
| ポーリング | 未実装 | **10テスト** |
| タイムアウトリカバリ | 未実装 | **5テスト** |
| トランスポート | 未実装 | **4テスト** |
| fake timers | 不使用 | **必須（vi.useFakeTimers）** |
| テスト総数 | 81 | **~100** |
| モグラ叩き防止 | UI変更のみ | **コアロジック変更も検知** |
