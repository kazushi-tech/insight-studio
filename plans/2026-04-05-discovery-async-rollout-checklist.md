# Discovery Async Rollout Checklist (2026-04-05)

## Goal

`Discovery` を `POST /api/discovery/jobs` + `GET /api/discovery/jobs/{job_id}` polling 方式で live に反映し、
Claude-only rollout と async rollout を分けて検証する。

## Milestones

### Milestone A: Claude-only rollout close

必要条件:

- Render Logs で live commit 時点の startup snapshot が確認できている
- `default_analysis_provider=anthropic`
- Discovery 用 Gemini path が戻っていない

補足:

- live commit `34c57b8` では `anthropic_discovery_*` startup keys はまだ未導入
- その commit では `gemini_discovery_*=<default>` と pipeline log の `provider=Claude` を補助根拠に使う
- `anthropic_discovery_*` の startup snapshot は async backend commit deploy 後の確認対象

### Milestone B: Async rollout close

必要条件:

- `POST /api/discovery/jobs` が `202`
- poll の terminal state が `completed` または expected `failed`
- completed 時に `result.report_md`, `result.fetched_sites`, `result.analyzed_count` が返る

## Deploy Order

1. `market-lens-ai` を deploy
2. health 復帰確認
3. Claude で Render Logs startup snapshot 確認
4. `insight-studio` を deploy
5. async smoke 実行

重要:

- backend first
- frontend second
- legacy `/api/discovery/analyze` は当面残す

## Do Not Do

- `GEMINI_DISCOVERY_MODEL` を戻さない
- `GEMINI_DISCOVERY_FALLBACK_MODELS` を戻さない
- Discovery で `provider=google` を送らない
- async rollout と同じ deploy で legacy sync endpoint を削除しない

## Pre-Deploy

- [ ] backend async job + polling 実装が test green
- [ ] frontend build が green
- [ ] deploy 対象が Production である
- [ ] rollback target commit を控えた
- [ ] operator / Claude の役割を確認した

記録テンプレート:

```text
Date:
Operator:
Render service:
Backend commit:
Frontend commit:
Start time (JST):
Rollback target:
```

## Claude Task

Claude に依頼する手作業:

- Render Logs で startup snapshot を確認
- 転記対象:
  - `anthropic_analysis_model`
  - `default_analysis_provider`
  - live commit が `34c57b8` なら:
    - `gemini_discovery_model`
    - `gemini_discovery_fallback_models`
    - pipeline log の `provider=Claude`
  - async backend commit deploy 後なら:
    - `anthropic_discovery_search_model`
    - `anthropic_discovery_search_tool`
    - `anthropic_discovery_classify_model`

## Codex Task

Codex が持つもの:

- rollout script
- docs/checklist
- build/test
- live smoke の解釈

## Verification Commands

### 1. Health

```bash
npm run smoke:discovery:rollout:health
```

期待:

- `200`
- commit が想定 backend commit

### 2. Render probe

```bash
npm run smoke:discovery:rollout:render-probe
```

期待:

- `POST /api/discovery/jobs` が `202`
- poll で terminal status が返る
- `1/1` success で command exit code が `0`

### 3. Render 5-run

```bash
npm run smoke:discovery:rollout:render-5
```

見るもの:

- success rate
- run 間隔は `15s` pause 前提
- `success >= 3/5` で command exit code が `0`
- `via=job_start_http`, `via=job_start_error`, `via=job_start_invalid` の有無
- `stage=search` / `stage=analyze` fail の内訳
- `job_result_missing` がないこと
- `Gemini` 文言が Discovery で出ないこと

### 4. Proxy 5-run

別ターミナル:

```bash
npm run dev
```

その後:

```bash
npm run smoke:discovery:rollout:proxy-5
```

期待:

- run 間隔は `15s` pause 前提
- `success >= 3/5` で command exit code が `0`

## Acceptance Criteria

- startup logs で Claude-only 証跡が確認済み
- async probe が `202 -> completed` を確認できる
- `render-5` と `proxy-5` は少なくとも `3/5` 成功
- failed case でも `error.detail` と `retryable` が返る
- completed case で `report_md` / `fetched_sites` / `analyzed_count` が返る
- Discovery で `Gemini` 文言が出ない

## Rollback

問題が出た場合:

1. backend deploy を戻す
2. health 復帰確認
3. startup snapshot 再確認
4. 必要なら frontend を前 commit に戻す

重要:

- rollback は deploy rollback で行う
- Gemini env を足して逃がさない

## Operator Log

```text
Date:
Operator:
Render service:
Backend commit:
Frontend commit:
Health restored at (JST):

Claude-only close:
- startup snapshot confirmed:
- anthropic_analysis_model:
- anthropic_discovery_search_model:
- anthropic_discovery_search_tool:
- anthropic_discovery_classify_model:
- default_analysis_provider:

Render probe:
- command:
- start_status:
- job_id:
- terminal_status:
- stage:
- elapsed:
- artifact:

Render 5-run:
- command:
- success:
- failure:
- dominant failure stage/class:
- artifact:

Proxy 5-run:
- command:
- success:
- failure:
- dominant failure stage/class:
- artifact:

Decision:
- Claude-only rollout complete:
- Async rollout complete:
- Rollback needed:
```
