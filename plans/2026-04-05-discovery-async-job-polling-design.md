# Discovery Async Job + Polling Design (2026-04-05)

## Status

- implemented locally
- backend verification: `pytest` green
- frontend verification: `npm run build` green
- live deploy: pending
- live async smoke: pending

## Decision

`POST /api/discovery/analyze` の長時間同期実行をやめ、`job start + polling` に変える。

理由:

- Render free tier では 60-90 秒級の request が不安定
- 現状の Discovery は成功時でも 120-170 秒かかるケースがある
- Claude-only 化は成立しており、次のボトルネックは provider ではなく request lifetime

## Current State

Current sync path:

- backend: `market-lens-ai/web/app/routers/discovery_routes.py`
- frontend: `insight-studio/src/api/marketLens.js`
- page: `insight-studio/src/pages/Discovery.jsx`

現状の問題:

- HTTP request を開きっぱなしにするため、cold start / upstream timeout の影響を強く受ける
- 成功しても browser / proxy / platform timeout にぶつかりやすい
- search stage と analyze stage を終えるまで user に途中状態を返せない

## Goals

1. user-facing request timeout を Discovery 本体から切り離す
2. stage progress を poll で見えるようにする
3. existing Discovery pipeline のロジックはできるだけ再利用する
4. API key を永続化しない
5. owner 単位の参照制御を維持する

## Non-Goals

- distributed queue をこの段階で導入しない
- Celery / Redis など新 infra を今回いきなり追加しない
- generation 側の async 化までは同時にやらない
- Discovery の Claude-only 方針を崩さない

## Proposed API

### 1. Start job

`POST /api/discovery/jobs`

Request:

```json
{
  "brand_url": "https://www.petabit.co.jp",
  "api_key": "sk-ant-...",
  "provider": "anthropic",
  "model": "claude-sonnet-4-6"
}
```

Response: `202 Accepted`

```json
{
  "job_id": "abc123def456",
  "status": "queued",
  "stage": "queued",
  "poll_url": "/api/discovery/jobs/abc123def456",
  "retry_after_sec": 3
}
```

### 2. Poll job

`GET /api/discovery/jobs/{job_id}`

Running response:

```json
{
  "job_id": "abc123def456",
  "status": "running",
  "stage": "search",
  "progress_pct": 45,
  "created_at": "2026-04-05T10:00:00Z",
  "started_at": "2026-04-05T10:00:01Z",
  "updated_at": "2026-04-05T10:00:40Z",
  "brand_url": "https://www.petabit.co.jp",
  "message": "競合検索を実行中です"
}
```

Completed response:

```json
{
  "job_id": "abc123def456",
  "status": "completed",
  "stage": "complete",
  "progress_pct": 100,
  "result": {
    "...": "current DiscoveryAnalyzeResponse payload"
  }
}
```

Failed response:

```json
{
  "job_id": "abc123def456",
  "status": "failed",
  "stage": "search",
  "progress_pct": 45,
  "error": {
    "status_code": 502,
    "detail": "競合検索がタイムアウトしました。",
    "retryable": true
  }
}
```

### 3. Optional cancel

`POST /api/discovery/jobs/{job_id}/cancel`

これは MVP では optional。先に start + poll を完成させる。

## Backend Design

## A. Extract pipeline into a service

現在 `discovery_routes.py` に大きく入っている同期処理を service に切り出す。

新規候補:

- `web/app/services/discovery/discovery_pipeline.py`

責務:

- current `discovery_analyze` pipeline をそのまま移植
- stage ごとに progress callback を呼ぶ
- 最終的に `DiscoveryAnalyzeResponse` を返す
- route から切り離して test しやすくする

想定インターフェース:

```python
async def run_discovery_pipeline(
    req: DiscoveryAnalyzeRequest,
    *,
    request_id: str,
    owner_id: str | None,
    on_stage: Callable[[DiscoveryJobStage, dict], Awaitable[None] | None] | None = None,
) -> DiscoveryAnalyzeResponse:
    ...
```

## B. Add job record schema

新規 schema 候補:

- `DiscoveryJobStatus`: `queued | running | completed | failed | cancelled`
- `DiscoveryJobStage`: `queued | brand_fetch | classify_industry | search | fetch_competitors | analyze | complete | failed`
- `DiscoveryJobError`
- `DiscoveryJobStartResponse`
- `DiscoveryJobResponse`

重要:

- `api_key` / `search_api_key` は job record に保存しない
- 保存するのは `brand_url`, `provider`, `model`, `owner_id`, `status`, `stage`, `result`, `error`

## C. Add repository

MVP は file-backed を推奨する。

理由:

- 既存 `scan` が file storage を使っている
- 追加 infra が要らない
- Render 上でも最低限の poll 状態共有ができる

新規候補:

- `web/app/repositories/discovery_job_repository.py`
- `web/app/repositories/file_discovery_job_repository.py`

保存先:

- `data/discovery_jobs/{job_id}/job.json`
- `data/discovery_jobs/{job_id}/result.json`

DB-backed を後から足すなら:

- `discovery_jobs`
- `discovery_job_results`

を追加する。

## D. Worker execution model

MVP は web process 内で `asyncio.create_task(...)` を使う。

Flow:

1. `POST /api/discovery/jobs` が request validation を行う
2. queued job record を保存する
3. `asyncio.create_task(_run_job(job_id, req, owner_id))` で非同期実行を開始する
4. poll endpoint は repository から状態を返す

利点:

- request timeout から処理本体を切り離せる
- infra 追加なしで早く導入できる

制約:

- process restart で running job は消える
- durable worker queue ではない

この制約は MVP として許容し、startup 時に stale job を `failed` 扱いへ寄せる。

## E. Stage/progress updates

Progress の固定値で十分:

- `queued`: 0
- `brand_fetch`: 10
- `classify_industry`: 20
- `search`: 45
- `fetch_competitors`: 70
- `analyze`: 90
- `complete`: 100

job record には以下を持たせる:

- `status`
- `stage`
- `progress_pct`
- `message`
- `updated_at`
- `result_summary`:
  - `candidate_count`
  - `fetched_count`
  - `analyzed_count`

## F. Ownership / security

`X-Insight-User` を使って job を owner scope に閉じる。

Rules:

- start 時に `owner_id` を保存
- poll 時に owner 不一致なら `404` 扱い
- API key は永続化しない
- error detail は現行 Discovery の humanized error を再利用する

## Frontend Design

## A. API client

`src/api/marketLens.js`

追加関数:

- `startDiscoveryJob(url, options)`
- `getDiscoveryJob(jobId)`

既存 `discoveryAnalyze()` は段階的に廃止するか、互換 wrapper として残す。

## B. Page flow

`src/pages/Discovery.jsx`

新しい flow:

1. CTA click
2. `POST /api/discovery/jobs`
3. `run.meta.jobId` を保存
4. `setTimeout` ベースで 3 秒ごとに poll
5. `completed` なら `completeRun`
6. `failed` なら `failRun`

## C. UI changes

最低限これだけでよい:

- 現在 stage の表示
- progress 文言
- completed 後は現行と同じ report / cards を描画
- failed 時は現行 ErrorBanner を利用

追加で入れると良いもの:

- `競合検索中...`
- `競合サイト取得中...`
- `比較分析中...`

## D. Retry behavior

start request:

- 既に入れた frontend 自動 retry をそのまま利用可能

poll request:

- network error 時は即 failed にせず、2-3 回は polling を継続

## Migration Plan

### Phase 1: backend extraction

- Discovery pipeline を service に切り出す
- sync route はその service を呼ぶだけにする

### Phase 2: async job API

- job schemas
- file repository
- `POST /api/discovery/jobs`
- `GET /api/discovery/jobs/{job_id}`

### Phase 3: frontend switch

- Discovery page を start + poll に切替
- stage progress UI を追加

### Phase 4: compatibility cleanup

- 旧 `POST /api/discovery/analyze` を internal-only にするか deprecated 化

## Testing Plan

Backend:

- job start returns `202`
- poll returns queued/running/completed/failed
- owner mismatch returns `404`
- API key is not persisted
- stale running job on restart is marked failed

Frontend:

- start success -> polling begins
- completed job renders report
- failed job renders ErrorBanner
- transient poll network error does not immediately collapse the run

## Risks

### 1. `asyncio.create_task` is not durable

MVP limitation として許容する。
本当に durable にするなら worker process が必要。

### 2. web dyno resource contention

request timeout は消せるが、長い discovery job が web process を使う事実は残る。

### 3. duplicate jobs

同 URL に対して連打された時の扱いを決める必要がある。
MVP は duplicate 許容でよい。

## Recommendation

最短で効果がある実装順はこれ。

1. pipeline extraction
2. file-backed job repository
3. start + poll endpoints
4. Discovery page polling UI

この順なら、provider まわりを触り直さず `Render timeout` 問題だけを切り離せる。
