# Compare LP比較が「56分以上進まない」問題 — 即時救済＋恒久対策プラン（別セッション引継ぎ版）

> **このプランは別セッションで実装される前提で書かれている。**
> 次セッションのエージェントは本ファイルだけで完結して実行できるように、既知のコード位置・再現条件・検証手順まで記載している。

## Context

ユーザー（オペレーター）が本番 `insight-studio-chi.vercel.app/compare` でLP比較分析を実行したところ、「比較分析中… / Claude / 56分44秒 経過」のまま1時間ほど結果が返らなかった。

しかし実装を読むと、多重タイムアウトにより **正常動作なら最長11分で必ず失敗判定されるはず**:

| 層 | 上限 | 根拠 |
|---|---|---|
| Backend job実行 | **600秒** (10分) | `render.yaml` / `routers/scan_routes.py` `SCAN_OVERALL_JOB_TIMEOUT_SEC` |
| Frontend hardCeiling | **660秒** (11分) | [useAsyncJob.js:63](src/hooks/useAsyncJob.js#L63) |
| Frontend stale検知 | **90秒** | [useAsyncJob.js:64](src/hooks/useAsyncJob.js#L64) |
| Frontend ネットワーク連続失敗 | **3回** | [useAsyncJob.js:7](src/hooks/useAsyncJob.js#L7) |

**56分は理論上到達不能** → **ポーリングループが既に死んでいる or resumeで無限復元されている状態で、画面の経過タイマーだけが進み続けている** と推定。具体的な故障モード（最有力）:

1. **hardCeiling発火時に `sessionStorage` の `activeScanJob_*` がクリアされない** → 次マウントで [Compare.jsx:383-411](src/pages/Compare.jsx#L383-L411) の resume が再度走り、`resetStartTime: true` で11分カウントが何度もリセットされる。ユーザーがタブを再表示するたびに事実上「永久運転」状態。
2. **Render Starter dyno の再起動／入れ替え** → `FileScanJobRepository` のローカルFSが吹き飛び、`GET /api/scan/jobs/{id}` が 404 もしくは古い `updated_at` のまま。3連続失敗ならfail扱いになるが、成功レスポンスが散発的に返るケースでは stale にもならず running表示のまま。

## 作業フェーズ

### Phase A: 即時救済（ユーザーが自分で実施・本セッション中）

> ⚠️ **これはユーザーが今すぐやるべき操作**。別セッションのエージェントは実施不要。

1. DevTools → Application → Session Storage → `insight-studio-chi.vercel.app` 配下の `activeScanJob_*` キーを **全削除**
2. `/compare` をハードリロード（Ctrl+Shift+R）
3. 再び分析を投入。3分以内に `queued → fetching(30%) → analyzing(70%) → completed` が進むのを確認

### Phase B: Render側診断（別セッションのエージェントが実施・読取のみ）

> 📝 ログ取得には Render ダッシュボードアクセスが必要。ユーザー認証セッションが無い場合はユーザーに MCP / 資格情報を要求するか、このPhaseをスキップしてPhase Cに進むこと（Phase Cだけでも障害は再発しない）。

1. Render Dashboard → `market-lens-staging` → Logs で過去24時間を取得し、以下を grep:
   - `Scan job timed out` / `Stale scan job auto-failed` / `Scan job unexpected error`
   - `job_id=<対象>`（ユーザーから `job_id` を取得できた場合）
2. 可能なら Render shell で `backends/market-lens-ai/data/scan_jobs/<job_id>/job.json` を確認（`status` / `updated_at` / `error` / `progress_pct` の最終値）
3. heartbeat が600秒以内で止まっていれば backend の `asyncio.wait_for` 経路まで到達していない ＝ dyno再起動が原因の可能性大
4. 調査結果は `plans/2026-04-22-compare-hang-rca.md` に新規作成して追記

### Phase C: 恒久対策の実装（別セッションのエージェントが実施）

優先度順に4本。**C-1〜C-3は必須 (hotfix PR)**、C-4・C-5は任意（別PR推奨）。

#### C-1. hardCeiling/stale/ネットワーク失敗時に sessionStorage を必ずクリア（最優先）

**対象ファイル**: [src/pages/Compare.jsx](src/pages/Compare.jsx)

- `handleJobFail` の**全経路**で `clearActiveScanJob()` を呼ぶ。既に呼んでいれば変更不要だが、要確認。
- `handleRetry` でも `clearActiveScanJob()` を呼ぶ（既存実装確認）。
- `handleJobComplete` でも同様（ジョブ成功時に古い jobId が残らないように）。
- 参考: `clearActiveScanJob` は [src/api/marketLens.js](src/api/marketLens.js) にあるはず（exportされているか要確認、無ければ追加）。

#### C-2. resume経路に「経過時間ガード」追加

**対象ファイル**: [src/pages/Compare.jsx](src/pages/Compare.jsx) / [src/api/marketLens.js](src/api/marketLens.js)

- `persistActiveScanJob` が保存する構造に `startedAt`(ISO string) を追加（既存の形状を先に読んでから破壊変更にならないように migration を書く）。
- [Compare.jsx:383-411](src/pages/Compare.jsx#L383-L411) の resume 前に以下チェック:
  ```js
  const activeJob = getActiveScanJob()
  if (activeJob?.startedAt && Date.now() - new Date(activeJob.startedAt).getTime() > SCAN_POLL_HARD_CEILING_MS) {
    clearActiveScanJob()
    // 「前回のジョブはタイムアウトしました。再実行してください」をトースト or エラーバナー
    return
  }
  ```
- `SCAN_POLL_HARD_CEILING_MS` 定数の所在を grep で確認し、一箇所で管理。

#### C-3. 明示的キャンセルボタン

**対象ファイル**: [src/pages/Compare.jsx](src/pages/Compare.jsx) の「比較分析中」パネル

- 「分析中…」状態のUI（スクリーンショットだと「分析中…」ボタンの近辺）に **「キャンセル」ボタン** を追加。
- ハンドラ: `stopPolling()` + `clearActiveScanJob()` + `clearRun('compare')`。
- Discovery 画面([src/pages/Discovery.jsx](src/pages/Discovery.jsx) 相当)に同じパターンがあるか確認し、流用／統一。
- バックエンドDELETEは C-4 に切り出し。フロント先行で出荷（孤児ジョブは backend の600秒で自然死するため実害少）。

#### C-4. (任意) Backend `DELETE /api/scan/jobs/{id}`

**対象ファイル**: [backends/market-lens-ai/web/app/routers/scan_routes.py](backends/market-lens-ai/web/app/routers/scan_routes.py) / [backends/market-lens-ai/web/app/repositories/file_scan_job_repository.py](backends/market-lens-ai/web/app/repositories/file_scan_job_repository.py)

- DELETE追加。`asyncio.Task` の `cancel()` + `FileScanJobRepository.mark_as_cancelled()`。
- `plans/2026-04-05-discovery-async-job-polling-design.md` L129 で先送りされていた項目。別PRで良い。

#### C-5. (任意) 経過時間表示を `updated_at` ベースに

**対象ファイル**: [src/pages/Compare.jsx](src/pages/Compare.jsx) の「◯分◯秒 経過」表示部

- 現状は `run.startedAt` 基準の疑い。ポーリング死亡後も進む挙動を改めるため、`lastUpdatedAt` を併記して「最終応答 〇秒前」バッジを追加。

## 検証手順（別セッションエージェントが実施）

### 1. Frontend ビルド・型チェック

```bash
npm run build
```

エラー0を確認。

### 2. Playwright動作確認（webapp-testing skill で自動実行）

**ルール**: `src/` を触るので `webapp-testing` skill の利用は **必須**（`c:\Users\PEM N-266\work\insight-studio\CLAUDE.md` 準拠）。追加の npm 依存（`@playwright/test` 等）は入れない。skill の `scripts/with_server.py` で `npm run dev`(port 3002) を起動し、Playwright sync API で検証。

**ゲスト（クリーンな localStorage）で Chrome を起動**（`devtools-verify` skill 準拠）。

検証シナリオ（コンソール/ネットワークエラー監視 `page.on('console', ...)` を併用）:

| ID | シナリオ | 期待結果 |
|---|---|---|
| V1 | `/compare` を開き、有効なURLセットで分析実行→正常完了を待つ | `completed` 画面遷移。sessionStorage の `activeScanJob_*` がクリアされていること |
| V2 | 分析実行中に DevTools Network offline → 再オンライン | 3連続失敗→`onFail`発火→画面にエラー表示→ `activeScanJob_*` クリア（C-1検証）|
| V3 | 分析実行直後に `sessionStorage.activeScanJob_*.startedAt` を `Date.now() - 12*60*1000` に改変 → リロード | resume されず、エラーバナー表示／再入力可能状態。`activeScanJob_*` クリア（C-2検証）|
| V4 | 分析実行中に「キャンセル」ボタン押下 | ポーリング停止・sessionStorage クリア・idle 状態へ（C-3検証）|
| V5 | 隣接画面リグレッション: `/discovery`（非同期ジョブ兄弟機能）, `/`(ダッシュボード)を開いて既存機能が動くか | コンソールエラー0・主要UIが描画される |

**タイムアウトが出たら値を増やさず根本原因を探す**（ユーザーの `feedback_never_increase_timeouts` 準拠）。

### 3. Backend テスト（C-4実装した場合のみ）

```bash
cd backends/market-lens-ai && python -m pytest
```

DELETEエンドポイントの単体テストを追加（running / completed / 不存在の3パターン）。

## コミット・デプロイ手順

### PR分割

- **PR1 (hotfix)**: C-1 + C-2 + C-3（フロントのみ）
  - ブランチ名例: `fix/compare-hang-sessionstorage-guard`
  - タイトル例: `fix(compare): resumeガード＋キャンセルボタン＋sessionStorage確実クリアでハング根治`
  - 本番影響: Vercelのみ
- **PR2 (任意)**: C-4 + C-5
  - ブランチ名例: `feat/compare-cancel-and-progress-truth`
  - 本番影響: Render + Vercel

### コミット前チェックリスト

- [ ] `npm run build` 成功
- [ ] Playwright V1〜V5 全て成功・コンソールエラー0
- [ ] C-4実装時: `python -m pytest` 成功
- [ ] 不要なconsole.log追加なし（既存の `console.info('[Compare] ...')` は踏襲可）
- [ ] `universal-review` skill（または `codex-review` skill）で差分レビュー実施

### コミット

```bash
git switch -c fix/compare-hang-sessionstorage-guard
git add src/pages/Compare.jsx src/hooks/useAsyncJob.js src/api/marketLens.js
git commit -m "$(cat <<'EOF'
fix(compare): prevent infinite resume + add cancel button + guarantee sessionStorage cleanup

LP比較ジョブがフロントのhardCeiling(11分)を超えて「56分」のようにハングする障害を根治。

- resume前にstartedAt経過時間をチェックし、hardCeiling超過ならsessionStorageクリアして再入力促し
- 分析中UIに明示キャンセルボタンを追加
- hardCeiling/stale/ネットワーク失敗の全経路でclearActiveScanJob()を確実に呼ぶ

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push -u origin fix/compare-hang-sessionstorage-guard
gh pr create --title "fix(compare): Compareハング根治 (resumeガード + キャンセル + sessionStorage確実クリア)" --body "..."
```

### デプロイ

- **Vercel(フロント)**: PRマージ → master が自動デプロイ。1〜2分で反映。
- **Render(backend)**: C-4 実装した場合のみ master マージで自動デプロイ（`render.yaml` 準拠）。
- デプロイ後 `insight-studio-chi.vercel.app/compare` で最終動作確認（Phase A手順後）。

## 参照ファイル

- [src/pages/Compare.jsx](src/pages/Compare.jsx) — UI・resume経路・キャンセル導線追加箇所
- [src/hooks/useAsyncJob.js](src/hooks/useAsyncJob.js) — ポーリングループ本体
- [src/api/marketLens.js](src/api/marketLens.js) — `startScanJob` / `getScanJob` / sessionStorage helpers
- [backends/market-lens-ai/web/app/routers/scan_routes.py](backends/market-lens-ai/web/app/routers/scan_routes.py) — C-4 追加先
- [backends/market-lens-ai/web/app/repositories/file_scan_job_repository.py](backends/market-lens-ai/web/app/repositories/file_scan_job_repository.py) — `mark_as_cancelled` 追加先
- [render.yaml](render.yaml) — タイムアウト設定の確認のみ（変更予定なし）
- [plans/2026-04-05-discovery-async-job-polling-design.md](plans/2026-04-05-discovery-async-job-polling-design.md) — 元設計とリスク記載
- [CLAUDE.md](CLAUDE.md) — `src/` 変更時のwebapp-testing skill利用ルール

## 別セッション引継ぎ時の最初にやること

1. 本ファイル全文を再読
2. `git status` / `git log -5` で現在の状態確認
3. `plans/2026-04-22-compare-hang-rca.md` があれば読む（Phase B診断結果）
4. Phase B未実施でも Phase C (C-1〜C-3) は単独で着手可能 — **最優先でC-1〜C-3のhotfix PRを出すこと**
5. 実装前に `TodoWrite` でタスク分解（C-1, C-2, C-3, build, playwright V1〜V5, commit, PR作成）
