# Compare (LP比較・競合分析) UX 改善 + ノイズ撲滅プラン

## Context (追加観測で刷新)

ユーザーが再度待機した結果、**8分3秒** でレポートは生成された (履歴復旧バナー「ブラウザ側ではタイムアウトしましたが、server 側で完了していた比較結果を履歴から復旧しました。」を表示)。したがって **バックエンドは正しく動いている** が、UI 側で以下が壊れている:

1. **scan の同期設計が現実と乖離**  
   `src/api/marketLens.js:21` `LONG_ANALYSIS_TIMEOUT = 240_000` (4分) で abort 、`src/pages/Compare.jsx:105` `recoverTimedOutScan` は 90s しか履歴を待たない。実測 483s 完了の LP3本 + Sonnet + MAX_COMPETITORS=3 だと **240s+90s=330s では復旧できない**。今回成功したのは、おそらく `useReportEnvelope`/`AnalysisRunsContext` の履歴 rehydrate が別経路で拾ったか、ユーザーが再操作したタイミングで運良く間に合った偶然。

2. **進捗が全く見えない**  
   Compare は非同期ジョブ化されていないため `stage` / `progress_pct` / `heartbeat` が無い。ユーザーからは「分析中…」しか見えず、8分待つかどうかの判断ができない。

3. **`[Discovery]` ログノイズの漏出**  
   `src/pages/Discovery.jsx:724-747` の mount-time auto resume は Discovery ページ mount 時にしか走らないが、`stopPolling` の cleanup ≒ `useEffect(() => stopPolling, [stopPolling])` で古い closure が残る pattern と、 sessionStorage の TTL 無しで、**別タブ or 前回セッション由来の polling** が漏れている可能性。

4. **Login 401 ノイズ**  
   `src/pages/Login.jsx:83-93` の並列パスワード総当たりによる確定 401 が case 数ぶん出る。Compare のハングとは **独立事象** だが、原因切り分けを曇らせる。

5. **バックエンド設計上の制約**  
   `backends/market-lens-ai/web/app/routers/scan_routes.py:24` は完全同期 `async def scan(...)` で `await execute_scan()` するだけ。BackgroundTasks / jobs repo 無し。Render starter plan の単一ワーカーで 8 分占有する設計。

---

## 採用アプローチ: **段階リリース** (P0 即時 → P1 短期 → P2 中期)

Agent team workflow + Skill を駆使し、**即効性のある UX 修正を P0 で先行**、**Compare 非同期ジョブ化**を P1、**コスト/時間最適化**を P2 として分離する。

---

## Phase P0 (即日〜1日): UX 止血 + ノイズ撲滅

**目標**: 8 分待つ間も UI が正常で、ユーザーが状況を把握でき、復旧モードも確実に動く状態にする。バックエンド改修無し。

### P0-A: Compare 側タイムアウト/復旧の再設計
- `src/api/marketLens.js:21` `LONG_ANALYSIS_TIMEOUT` を **600_000ms (10分)** に延長 (Sonnet + 3 competitors の実測 8 分 + 余裕)
- `src/pages/Compare.jsx:105-126` `recoverTimedOutScan` の `timeoutMs` を **300_000 (5分)** に延長し、`intervalMs` を 10s に
- タイムアウト時の `updateRunMeta` 文言を「AI 分析に時間がかかっています (最大10分)」に変更し、経過秒数を表示
- `Compare.jsx:334` `recoveryMode` で **elapsed 表示** を追加 (◯分◯秒経過中)
- **重要**: クライアント abort しても backend は走り続けるので、「再試行」ボタンを押されても同一 URL の in-flight 履歴があれば復旧優先する分岐を追加

### P0-B: 進捗ヒント提示 (擬似 progress)
- `src/pages/Compare.jsx` の `MetaBand` エリアに **elapsed timer** と「通常 3〜8 分」「最大10分」の目安を表示
- ランダムな `[AI がブランド情報を解析中...]` `[競合 LP を取得中...]` `[比較レポートを生成中...]` の stage メッセージを時間帯別に切り替えて表示 (UX 改善のみ、実体は同期のまま)

### P0-C: Discovery polling 漏出停止
- `src/pages/Discovery.jsx:467-468` の `useEffect(() => stopPolling, [stopPolling])` を **依存無しの imperative cleanup** に置換:
  ```js
  useEffect(() => () => {
    pollStoppedRef.current = true
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
  }, [])
  ```
- `sessionStorage.is-discovery-active-job` に **startedAt** を含める → `Discovery.jsx:724-747` の resume で `POLL_HARD_CEILING_MS` 超過分は破棄
- 現在 Discovery 側でしか clear しないので、**Layout.jsx の route 変化時に非 /discovery パスなら polling 停止シグナルを送る** mechanism を検討 (過剰なら skip)

### P0-D: Login 401 ノイズ削減
- `src/pages/Login.jsx:83-108` を **直列試行** に変更:
  ```js
  // admin を先に試す → 成功したら return
  const admin = await loginAds(password).catch(() => null)
  if (admin?.ok) { ... return }
  // case は device trust token ある順で直列試行 (早期 break)
  for (const c of sortedCases) {
    const r = await loginCase(c.case_id, password, {...}).catch(() => null)
    if (r?.ok) { handleCaseLoginSuccess(r); return }
    if (r?.totp_required) { setPendingTotp(...); return }
  }
  setError('パスワードが一致しません')
  ```
- これにより admin hit で **401 ゼロ**、case hit でも高々 **admin 試行 1 回のみ** の 401 に抑制

### P0 Verification
- `/project-health` で `npm run build` + `pytest` 通過
- `/devtools-verify` で:
  - Compare 3 本 LP で 10 分以内に結果表示、経過秒数が UI に出る
  - 途中で `[Discovery]` ログが出続けないこと (console filter)
  - Login 401 回数の計測
- `/codex-review` で Critical/Major=0 まで

---

## Phase P1 (3〜5日): Compare 非同期ジョブ化

**目標**: Discovery と同じ `POST jobs` + `GET jobs/{id}` の設計に揃え、真の進捗表示と長時間ジョブの安定化を実現する。

### P1-A: バックエンド async jobs 追加
- `backends/market-lens-ai/web/app/routers/scan_routes.py` に以下を追加:
  - `POST /api/scan/jobs` → job_id 発行、202 + `poll_url` 返却
  - `GET /api/scan/jobs/{id}` → status / stage / progress_pct / result
  - Discovery の `discovery_routes.py:198-489` の実装 (asyncio.Task + heartbeat + stall detection) を **ほぼ流用**
- `FileScanJobRepository` or 既存 `ScanRepository` 拡張で永続化
- render.yaml に `SCAN_OVERALL_JOB_TIMEOUT_SEC=600` `SCAN_STALE_THRESHOLD_SEC=300` を追加

### P1-B: フロント marketLens.js 非同期クライアント追加
- `src/api/marketLens.js` に `scanAsync(urlList, opts)` を新設 → 内部で `submitScanJob` + polling
- Discovery の `getDiscoveryJob` と同じインターフェースに揃える
- 既存 `scan(...)` は **deprecated** としてフォールバック残す

### P1-C: Compare.jsx を pollJob 方式に移行
- `Discovery.jsx` の `pollJob` + stage 表示 + progress bar を **Compare 専用の useScanJob フック** に抽出
- 両ページから共通利用できるよう `src/hooks/useAsyncJob.js` へリファクタ
- stage: `queued` → `fetching_lps` → `extracting` → `analyzing` → `complete` の定義

### P1-D: Discovery と Compare で **共通 polling フック** を導入
- B で作る `useAsyncJob` を Discovery も採用し、現在の Discovery 実装を置換
- これで sessionStorage 管理 / TTL ガード / stale detection が 1 箇所に集約され、P0-C の問題が構造的に解消

### P1 Verification
- `/devtools-verify` で:
  - Compare ジョブが progress_pct を 0→100 で段階表示
  - 途中でブラウザリロード → sessionStorage 経由で resume
  - Discovery 同様のスキーマで動く
- `/codex-review` 4 ゲート (Plan/Diff/Runtime/Release)

---

## Phase P2 (1〜2週間・任意): コスト/時間最適化

**目標**: 8 分を 3〜5 分に短縮し、AI コストも最適化。

- P2-A: LP fetch を `asyncio.gather` で並列化 (現状逐次と推定)
- P2-B: Claude prompt caching を導入 (`cache_control: ephemeral` でシステムプロンプト・共通指示をキャッシュ)
- P2-C: SSE/WebSocket でのリアルタイム進捗通知 (polling 負荷削減)
- P2-D: LP 抽出を軽量モデル (Haiku) でプレ分類 → Sonnet で最終分析のハイブリッド

---

## Agent Team 実行マッピング

| Phase | トラック | 担当 Agent / Skill | 備考 |
|-------|---------|-------------------|------|
| P0 | A (timeout 再設計) | `Edit` + `Plan` agent | 即時実装 |
| P0 | B (進捗ヒント) | `Edit` + `ui-design-review` skill | UX レビュー込み |
| P0 | C (Discovery 漏出) | `Explore` agent (再現条件特定) → `Edit` | Playwright 再現検証 |
| P0 | D (401 ノイズ) | `Edit` のみ | 直列化はシンプル |
| P0 | 検証 | `/devtools-verify` + `/project-health` | 必須 |
| P0 | 最終 | `/codex-review` | ゲート |
| P1 | A (backend jobs) | `general-purpose` Agent in worktree | 隔離作業 |
| P1 | B/C (frontend) | `Plan` → `Edit` | 並列 |
| P1 | D (共通フック) | `simplify` skill | 共通化判定 |
| P1 | 検証 | `/devtools-verify` + `/codex-review` | 4 ゲート厳格 |
| P2 | 全般 | `/agent-team-workflow` で分担 | 段階実装 |

---

## Critical Files

| Phase | ファイル | 変更内容 |
|-------|---------|---------|
| P0-A | [src/api/marketLens.js:21](src/api/marketLens.js#L21) | `LONG_ANALYSIS_TIMEOUT` → 600000 |
| P0-A | [src/pages/Compare.jsx:105-126](src/pages/Compare.jsx#L105-L126) | `recoverTimedOutScan` timeout → 300000, interval → 10000 |
| P0-A | [src/pages/Compare.jsx:432-450](src/pages/Compare.jsx#L432-L450) | recoveryMode の elapsed 表示追加 |
| P0-B | [src/pages/Compare.jsx:340-465](src/pages/Compare.jsx#L340-L465) | 擬似 stage メッセージの時間帯切替 |
| P0-C | [src/pages/Discovery.jsx:467-468](src/pages/Discovery.jsx#L467-L468) | imperative cleanup への置換 |
| P0-C | [src/pages/Discovery.jsx:724-747](src/pages/Discovery.jsx#L724-L747) | TTL ガード追加 |
| P0-D | [src/pages/Login.jsx:83-108](src/pages/Login.jsx#L83-L108) | 並列 → 直列化 |
| P1-A | [backends/market-lens-ai/web/app/routers/scan_routes.py](backends/market-lens-ai/web/app/routers/scan_routes.py) | jobs endpoint 追加 |
| P1-A | [backends/market-lens-ai/web/app/routers/discovery_routes.py:198-489](backends/market-lens-ai/web/app/routers/discovery_routes.py#L198-L489) | 実装パターンの参照元 |
| P1-A | [render.yaml](render.yaml) | SCAN_*_TIMEOUT env 追加 |
| P1-B | [src/api/marketLens.js](src/api/marketLens.js) | `scanAsync` + polling client |
| P1-C | [src/pages/Compare.jsx](src/pages/Compare.jsx) | pollJob 方式移行 |
| P1-D | src/hooks/useAsyncJob.js (新規) | Discovery/Compare 共通フック |

---

## Verification チェックリスト (Phase ごと)

### P0
- [ ] Compare 3 本 LP で 10 分以内にレポート表示、経過時間表示が動作
- [ ] Compare 中の console に `[Discovery]` ログゼロ
- [ ] Login admin-hit 時 401 ゼロ
- [ ] `npm run build` + `pytest` grsen
- [ ] `/codex-review` Critical/Major=0

### P1
- [ ] `POST /api/scan/jobs` が 202 と poll_url を返す
- [ ] `GET /api/scan/jobs/{id}` で stage/progress_pct が段階進行
- [ ] ブラウザリロードでジョブ resume
- [ ] Discovery と同じ UI コンポーネントで progress bar 表示
- [ ] pytest で jobs lifecycle テスト追加
- [ ] `/codex-review` 4 ゲート合格

### P2 (任意)
- [ ] LP fetch 並列化で中央値 3〜5 分
- [ ] Claude cache hit rate 30% 以上
- [ ] Render メトリクスで worker 占有率低下

---

## 次アクション選択肢 (ユーザー判断)

ExitPlanMode 後、以下のいずれかで進めたい:

- **A. P0 のみ今日実装** (最短・止血のみ、async化は後日)
- **B. P0 + P1 を今週中に実装** (推奨・根本治療)
- **C. P0→P1→P2 を順次実装** (全部入り・複数日)

実装開始時に `/agent-team-workflow` を起動し、トラック別に並列実装+検証を回す。
