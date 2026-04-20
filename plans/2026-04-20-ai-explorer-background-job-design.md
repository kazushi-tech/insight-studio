# AI考察 バックグラウンド処理化 — 詳細設計書

**Date:** 2026-04-20
**Status:** Draft（Plan ゲート待ち）
**親プラン:** [ai-ai-ai-silly-adleman.md](./ai-ai-ai-silly-adleman.md) Track C-1
**対象PR:** 本PRには本設計書のみコミット。実装は後続PR。

---

## 1. 背景と目的

### 現状の課題

AI考察（`/ads/ai`）は `neonGenerate` を **同期 HTTP リクエスト** で呼び出す構成である。

1. 生成時間が 60〜180 秒級になることがある（長文 `point_pack_md` や `conversation_history` の膨張）。
2. ユーザーが他画面（例: `/discovery`）へ離脱し戻ると **リクエスト状態が失われ、再生成が必要**（コスト・体験の両面で損失）。
3. 既存の `AbortController` 方式では、「バックグラウンドで走らせ続けて復帰時に結果を受け取る」UX を実現できない。

### ゴール

- ユーザーが画面離脱・リロードしても **ジョブは継続** し、復帰時にポーリングで最新状態を取得する
- UX は Discovery（`/discovery`）の非同期ジョブ体験と統一する
- 失敗時は同じエラー導線（`classifyError` ベース）に乗せる

### 非ゴール

- **同期エンドポイント（`/api/ml/neon/generate`）の廃止はしない**（他画面での利用があるため別PR）。
- **WebSocket / SSE 配信は導入しない**（ポーリングで足りる、運用コストを増やさない）。
- 複数ジョブ並列は非対応（既存 Discovery と同じく、1画面1ジョブ）。

---

## 2. 参考アーキテクチャ — Discovery

[src/pages/Discovery.jsx:714-736](../src/pages/Discovery.jsx#L714-L736) の実装を踏襲する:

```js
useEffect(() => {
  const activeJob = getActiveJob()
  if (!activeJob) return
  if (!loading) {
    startRun('discovery', { url: activeJob.url })
  }
  updateRunMeta('discovery', { stage: ..., jobId: activeJob.jobId })
  pollJob(activeJob.jobId, { pollPath: activeJob.pollUrl, resetStartTime: true })
}, [])
```

API 契約（バック）:

- `POST /api/discovery/jobs` → `{ job_id, poll_url, retry_after_sec }`
- `GET /api/discovery/jobs/{job_id}` → `{ status: 'pending'|'running'|'success'|'error', result?, error?, progress? }`

---

## 3. 提案設計

### 3.1 バックエンド — 新規エンドポイント

#### ディレクトリ

```
backends/market-lens-ai/web/app/
  jobs/
    __init__.py
    ai_insight_job.py          # ジョブ仕様・ペイロード
    ai_insight_service.py      # 生成ロジック（既存 neon_generate を流用）
  routes/
    ai_insight_jobs.py         # FastAPI router
```

※ 既存の Discovery ジョブストレージ（file-backed repository）を流用する方針。場所は後述 3.3。

#### エンドポイント

| Method | Path | 役割 |
|--------|------|------|
| POST | `/api/ml/ai-insights/jobs` | ジョブ起動。リクエスト本体は現在の `neonGenerate` ペイロード互換 |
| GET  | `/api/ml/ai-insights/jobs/{job_id}` | ジョブ状態取得（ポーリング用） |
| DELETE（任意） | `/api/ml/ai-insights/jobs/{job_id}` | ユーザー主導キャンセル（Phase 2 以降で追加検討） |

#### リクエスト/レスポンス

```http
POST /api/ml/ai-insights/jobs
Content-Type: application/json

{
  "mode": "question",
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "temperature": 0.3,
  "message": "...",
  "point_pack_md": "...",
  "conversation_history": [...],
  "ai_chart_context": {...},
  "api_key": "sk-ant-..."
}

→ 202 Accepted
{
  "job_id": "aij_01HXYZ...",
  "poll_url": "/ai-insights/jobs/aij_01HXYZ...",
  "retry_after_sec": 3
}
```

```http
GET /api/ml/ai-insights/jobs/aij_01HXYZ...

→ 200 OK
{
  "job_id": "aij_01HXYZ...",
  "status": "running",             // pending|running|success|error
  "progress": { "stage": "generate" },
  "result": null,
  "error": null,
  "created_at": "2026-04-20T10:00:00Z",
  "updated_at": "2026-04-20T10:00:12Z"
}
```

成功時 `result` は `{ text: string, truncated: bool, usage: {...} }` 形式とし、Track B の `truncated` フラグを伝搬する。

### 3.2 バックエンド — 実行モデル

- **非同期 Task:** `asyncio.create_task` + ジョブ状態を repository に書き込み
- **タイムアウト:** ジョブ側で 240s（現状の `LONG_ANALYSIS_TIMEOUT` と合わせる）。超過時は `status=error, error.category=timeout`
- **並列数:** プロセスあたり同時実行数は `AI_INSIGHT_JOB_CONCURRENCY`（環境変数、デフォルト `4`）で上限。`asyncio.Semaphore` でガード
- **ワーカー:** Render Starter プランの 1 インスタンス前提（スケールアウト時は未対応 — ジョブストレージを DB 化してから考える）

### 3.3 ストレージ — 既存 Discovery と共通化

現状 Discovery ジョブは `services/discovery/discovery_pipeline.py` 系列の file-backed repo（`jobs/{job_id}.json`）に保存されている想定。

**方針:** 共通ディレクトリ `backends/market-lens-ai/var/jobs/` 配下に、`discovery/{job_id}.json` と `ai_insights/{job_id}.json` を並置する。Repository クラスを抽出して再利用:

```
backends/market-lens-ai/web/app/jobs/
  repository.py            # 共通クラス（get/put/delete, TTL 管理）
```

- **永続先:** local file / Render disk（既存 Discovery 同様）
- **TTL:** 24h（Discovery に合わせる）
- **同時書込競合:** 1プロセス前提なので asyncio.Lock で十分。将来 DB 化する場合は `SELECT FOR UPDATE` 方式に差し替え

### 3.4 フロントエンド — API 層

[src/api/marketLens.js](../src/api/marketLens.js) に追加:

```js
/** POST /api/ml/ai-insights/jobs — 非同期ジョブ起動 */
export function startAiInsightJob(payload, apiKey)

/** GET /api/ml/ai-insights/jobs/{jobId} */
export async function getAiInsightJob(jobIdOrPollPath)
```

Discovery の `startDiscoveryJob` / `getDiscoveryJob` を参考に、`poll_url` 正規化・`_directBackendReady` リセットのロジックを流用する。

### 3.5 フロントエンド — AiExplorer 改修

- **sessionStorage キー:** `AI_EXPLORER_ACTIVE_JOB_KEY = 'aiExplorerActiveJob'`
  - 値: `{ jobId, pollUrl, createdAt, contextMode, messagesSnapshot }`
- `handleSend` 内で:
  1. `startAiInsightJob(payload)` を await
  2. `setActiveJob({ jobId, pollUrl, ... })` で sessionStorage に保存
  3. `pollAiInsightJob(jobId)` を開始
- **復帰処理 useEffect:**
  ```js
  useEffect(() => {
    const activeJob = getActiveAiExplorerJob()
    if (!activeJob) return
    pollAiInsightJob(activeJob.jobId, { pollPath: activeJob.pollUrl })
  }, [])
  ```
- **完了時:** `messages` に assistant 応答を push し、sessionStorage をクリア
- **失敗時:** 既存の `classifyError` 経路（`cold_start` / `rate_limit` / `auth_error`）に振り分け

### 3.6 ポーリング戦略

Discovery のロジックを共通化（`src/hooks/useJobPolling.js` を新設）。ただし **本PRの範囲外**、Track C-2 で対応。

- 初回 3s → 指数バックオフ（上限 15s）
- 総タイムアウト 5分（超えたら UI 側で `status=error, category=timeout`）
- `stopPolling` はアンマウント時 `cancelled = true` + `clearTimeout`（Track A と同じ防御）

---

## 4. 実装フェーズ分割

| Phase | 範囲 | PR |
|-------|------|----|
| **C-1** | 本設計書 | 本PR |
| **C-2a** | バックエンド: エンドポイント + repository（Discovery 共通化含む） | PR#n+1 |
| **C-2b** | フロント: API層 + AiExplorer 改修 + ポーリング復帰 | PR#n+2 |
| **C-2c** | E2E 検証 + 負荷試験 + observability（Sentry breadcrumb） | PR#n+3 |

---

## 5. 受け入れ基準

### 機能
- [ ] AI考察画面で質問送信 → `/discovery` へ遷移 → `/ads/ai` に戻る → 直前の質問の応答が表示される
- [ ] ブラウザリロードしても同様に応答が表示される
- [ ] 失敗（API key 無効・Anthropic 500）時は既存エラー UX と同等
- [ ] ネットワーク切断 → 自動リトライ（2回）で復旧できる
- [ ] `truncated=true` 時はレスポンス末尾に警告注記が表示される（Track B と連動）

### 非機能
- [ ] ジョブストレージ破損時も次リクエスト以降の影響を局所化（該当 job_id のみ `status=error`）
- [ ] 同時 4 ジョブでメモリ使用が既存比 +50MB 以内（Render Starter の 512MB 枠内）
- [ ] `/health` は影響を受けない

### テスト
- pytest: ジョブ状態遷移、timeout、ストレージ再読込、並列ガード（Semaphore）
- Playwright（/webapp-testing）: 離脱→復帰、リロード、切断→復旧

---

## 6. 懸念とリスク

| リスク | 発火条件 | 緩和 |
|--------|---------|------|
| ジョブストレージの肥大化 | TTL クリーンアップ不動 | 起動時 & 毎時 `cleanup_expired_jobs` |
| Render の単一インスタンス前提崩壊 | スケールアウト設定変更 | 今は file-backed で封じ、DB化は別設計 |
| sessionStorage に API key をそのまま保存しない | セキュリティ | ペイロードから `api_key` を外し、ジョブ起動時のみ使用（sessionStorage には job_id のみ） |
| 既存同期エンドポイントとの整合 | 並行運用期間での混乱 | 既存 `neonGenerate` は据え置き、AiExplorer のみ新エンドポイントに移行 |

---

## 7. 参考

- 既存: [src/pages/Discovery.jsx:714-736](../src/pages/Discovery.jsx#L714-L736)
- 既存: [src/api/marketLens.js:828-862](../src/api/marketLens.js#L828-L862)
- 関連: [plans/2026-04-05-discovery-async-job-polling-design.md](./2026-04-05-discovery-async-job-polling-design.md)

---

## 8. Open Questions

1. **マルチユーザー対応:** `api_key` が BYOK なので、ユーザー間でジョブが混ざらない保証は?
   → `job_id` は生成時に 128bit エントロピーの ULID/UUID を用いる。URL に含まれる以上、知らない `job_id` は推測困難なので当面これで十分
2. **DELETE エンドポイント:** Phase 2 入れるか
   → 現状の AbortController で十分では? 運用負荷を増やすので必要性が出てから
3. **既存 Discovery repository の共通化規模:** 共通化リファクタを C-2a 内で済ますか、先に独立 PR として切るか
   → C-2a 着手時点で判断（リファクタ量が 200行超えたら独立PR推奨）
