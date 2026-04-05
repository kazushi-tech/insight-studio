# Discovery Async Rollout Execution Plan (2026-04-05)

## Goal

`Discovery` の本番運用を `Claude-only` + `async job + polling` で閉じる。

今回のマイルストーンは 2 つ:

1. `Discovery Claude-only rollout complete` を証跡付きで閉じる
2. `POST /api/discovery/jobs` + polling 前提の live rollout を完了する

## Current Status

### Closed

- `Claude-only` 証跡は確認済み
- 記録: `plans/2026-04-05-discovery-claude-render-log-confirmation-result.md`
- live commit: `87e0f6a`
- `anthropic_discovery_search_model=claude-sonnet-4-6`
- `anthropic_discovery_search_tool=web_search_20250305`
- `anthropic_discovery_classify_model=claude-sonnet-4-6`

### Live and Verified

- backend: async job API (`POST /api/discovery/jobs`, `GET /api/discovery/jobs/{job_id}`)
- frontend: Discovery polling UI
- rollout script: async `/jobs` 対応
- `render-probe`: success
- `render-5`: `3/5` success, pass
- failure class は provider-limited (`rate limit`, `web search busy`) に収束

### Residual

- `proxy-5` は `1/5` で未達
- 失敗は `stage=search timeout` と `stage=analyze rate limit`
- production code path の成立自体は確認済み

## Ownership

### Codex

- repo 内の実装
- smoke script / package script / docs 更新
- contract mismatch 修正
- build / test
- deploy 順の整理
- live smoke の解釈

### Claude

- Render Dashboard の手作業確認
- startup logs の転記
- deploy 後の live 観測整理

### Agent Teams

sidecar analysis だけを並列化する。

- explorer 1: `insight-studio` rollout tooling / docs 整合確認
- explorer 2: `market-lens-ai` async job contract / deploy risk 確認
- main Codex: 実装と統合

## Execution Order

### Phase 0. Baseline lock

目的:

- async 実装のローカル整合を固定する

Exit criteria:

- backend Discovery tests green
- frontend build green
- legacy `/api/discovery/analyze` は互換のため残す

### Phase 1. Contract hardening

対象:

- backend async start endpoint
- frontend poll client

やること:

- `POST /api/discovery/jobs` でも `Discovery Claude-only` を即時バリデートする
- frontend が `poll_url` / `retry_after_sec` を尊重する
- sync path と async path の契約差をなくす

Exit criteria:

- invalid `provider=google` / `model=gemini-*` は enqueue 前に `422`
- frontend polling 間隔と poll path が backend response と整合

### Phase 2. Rollout tooling hardening

対象:

- `scripts/discovery-render-rollout-check.mjs`
- `package.json`

やること:

- async smoke が失敗を exit code に反映する
- `render-probe` は 1/1 成功を必須にする
- `render-5` / `proxy-5` はしきい値ベースで判定可能にする
- artifact に `job_id`, `stage`, `progress`, `terminal status`, `via` を残す

Exit criteria:

- `health`, `render-probe`, `render-5`, `proxy-5` の意味が明確
- 全失敗や閾値未達を shell / CI で検知できる

### Phase 3. Operator docs migration

対象:

- rollout checklist
- result / handoff docs

やること:

- async flow 前提の wording に揃える
- script の `via=*` と docs の failure taxonomy を一致させる
- deploy order と rollback 方針を固定する

Exit criteria:

- docs が `/jobs` 前提と整合
- operator が doc だけで live rollout を実行できる

### Phase 4. Production deploy

順序:

1. `market-lens-ai` deploy
2. health check
3. Claude で Render Logs 確認
4. `insight-studio` deploy
5. async smoke 実行

理由:

- frontend は `/api/discovery/jobs` 前提
- backend が先に live でないと frontend が `404` / `501` になる

### Phase 5. Live acceptance

最低限の受け入れ条件:

- `POST /api/discovery/jobs` が `202`
- poll で `queued/running/completed|failed` が返る
- completed 時に `report_md`, `fetched_sites`, `analyzed_count` が返る
- failed 時に `error.detail`, `retryable` が返る
- Discovery で `Gemini` 文言が出ない

Status:

- completed for direct render path
- proxy path remains provider-limited and non-blocking for production rollout

## Concrete Task List

### Track A. Codex

1. 実行 plan を current status に更新
2. async start endpoint の `Claude-only` 事前バリデーションを追加
3. frontend polling を `poll_url` / `retry_after_sec` 対応
4. smoke script に exit criteria を実装
5. checklist を実際の `via=*` と success threshold に合わせる
6. build / test を再実行

### Track B. Claude

1. backend deploy 後の startup snapshot 確認
2. live commit 確認
3. async smoke 実行後の Render Logs 観測

## Risks

### 1. Sync / async contract drift

対策:

- async start でも `Claude-only` を即時チェックする

### 2. Smoke script false green

対策:

- 全失敗または threshold 未達で non-zero exit にする

### 3. Frontend / backend deploy mismatch

対策:

- backend first
- frontend second

### 4. Async jobs are not durable across restarts

対策:

- startup stale cleanup を維持
- durable worker 化は次フェーズ

## Not In Scope

- `GEMINI_DISCOVERY_*` の再導入
- Discovery provider tuning の再開
- generation-side Gemini work の混在
- distributed worker / queue 導入

## Immediate Next Step

Discovery routing の追加変更は止める。次フェーズは `Anthropic org limit / token pressure / optional UX mitigation` の判断に移す。
