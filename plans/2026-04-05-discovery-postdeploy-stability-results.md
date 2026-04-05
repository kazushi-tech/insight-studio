# Discovery Post-Deploy Stability Results (2026-04-05)

## Deployed Commits

- backend `market-lens-ai`: `87e0f6a`
  - retry transient Anthropic discovery failures
- frontend `insight-studio`: `03311ec`
  - stability plan + rollout checklist / smoke pacing update

## What Codex Implemented

- analyze 側 Anthropic client に retryable `APIStatusError` retry/backoff を追加
- search 側 AnthropicSearchClient に指数 backoff と `Retry-After` 尊重を追加
- `render-5` / `proxy-5` の smoke pause を `15s` に変更

## Verification

### Render probe

- result: success
- health commit: `87e0f6a`
- artifact:
  - `.tmp-discovery-rollout/2026-04-05T01-03-27-243Z-discovery-async-rollout-render.json`

### Render 5-run

- result: `3/5` success
- decision: pass
- dominant failures:
  - `stage=analyze`
  - `Claude API rate limit`
- artifact:
  - `.tmp-discovery-rollout/2026-04-05T01-05-32-901Z-discovery-async-rollout-render.json`

### Proxy 5-run

- result: `1/5` success
- decision: fail
- dominant failures:
  - `stage=search`
  - search timeout
  - `stage=analyze`
  - Claude API rate limit
- artifact:
  - `.tmp-discovery-rollout/2026-04-05T01-15-09-070Z-discovery-async-rollout-proxy.json`

## Interpretation

- `render` path は acceptance の `>= 3/5` を満たした
- `proxy` path はまだ provider / timeout 制約に引っ張られている
- stale fallback model 由来の deterministic `404` は解消済み
- 残件は `provider-limited stability` であり、Claude-only / async job の code path は成立
- Claude Render Logs confirmation により `87e0f6a` の live snapshot も確認済み

## Next Step

Discovery routing の変更はここで止める。次にやるなら以下のどちらか:

1. Anthropic org limit を引き上げる、または usage tier を上げる
2. analyze 入力トークン量を減らす軽量化を設計する
