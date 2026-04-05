# Discovery Post-Deploy Stability Plan (2026-04-05)

## Goal

`async rollout` の deploy 自体は完了した前提で、live 成功率を改善し、
`probe success / render-5 acceptable / proxy-5 acceptable` の状態へ寄せる。

## Current State

- backend live commit: `8aef6c9`
- frontend live commit: `8a8f3c7`
- `render-probe`: success
- `render-5`: `2/5` success

観測された失敗:

- `stage=analyze`: Claude API rate limit
- `stage=search`: Claude Web Search busy / unavailable
- stale fallback model `404` は修正済み

## Ownership

### Codex

- retry/backoff 実装
- smoke pacing の調整
- build/test
- result 解釈

### Claude

- Render Logs の startup snapshot 確認
- deploy 後ログの目視確認
- 必要時の live error log 転記

## Workstreams

### Track A. Provider Retry Hardening

対象:

- `market-lens-ai/web/app/anthropic_client.py`
- `market-lens-ai/web/app/services/discovery/anthropic_search_client.py`

やること:

- analyze 側で retryable `APIStatusError` を backoff 付きで再試行
- search 側の retry wait を指数 backoff に寄せる
- `Retry-After` があれば尊重する

期待効果:

- `rate limit`
- `too many requests`
- `overloaded`
- `temporarily unavailable`

系の一時失敗で成功率を上げる

### Track B. Smoke Pacing Hardening

対象:

- `insight-studio/package.json`
- `insight-studio/plans/2026-04-05-discovery-async-rollout-checklist.md`

やること:

- `render-5` / `proxy-5` の間隔を広げる
- operator に「短時間連打で provider limit を踏む」ことを明記する

期待効果:

- synthetic burst による self-inflicted rate limit を減らす

### Track C. Live Re-Verification

1. backend push
2. Render health commit 確認
3. `render-probe`
4. `render-5`
5. 必要なら `proxy-5`

## Acceptance

- `render-probe`: `1/1` success
- `render-5`: 目標 `>= 3/5`
- `render-5` が未達でも、failure が `retryable provider saturation` のみなら
  `code-path valid / provider-limited` と記録して閉じる

## Immediate Next Step

Codex が `Provider Retry Hardening` を先に実装する。
