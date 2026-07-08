# Discovery Claude-Only Rollout Smoke Results (2026-04-05 JST)

## Summary

- Target: `Discovery` Claude-only rollout
- Live commit: `34c57b874fe70777c0fc0b29107586f85ad9b106`
- Health: `200 OK`
- Scope confirmation:
  - `Discovery search` = Claude Web Search
  - `classify_industry` = Claude
  - `analyze` = Claude
  - `provider=google` / `model=gemini-*` = reject

## Smoke Results

| Check | Result | Detail |
|------|------|------|
| Health check | OK | commit `34c57b8` live |
| Render probe | Partial | initial cold-start request hit `500 UnicodeError` |
| Render 5 | 3/5 | success on 3 runs, failures `500 x1`, `502 x1` |
| Proxy 5 | 3/5 | success on 3 runs, failures `502 x2` |

Successful runs completed with:

- `fetched_sites=5`
- `analyzed_count=6`
- report returned normally

## Failure Interpretation

### 1. `500 UnicodeError`

- observed on cold-start-adjacent first request
- treated as Render free-tier startup instability
- not evidence that Discovery still routes to Gemini

### 2. `502 upstream_502`

- observed around `search` stage
- consistent with Render free-tier request-time limits plus long Claude Web Search latency
- not evidence of Discovery logic regression

## Decision

`Discovery Claude-only` migration itself is functionally complete.

The remaining instability is primarily infrastructure-bound:

- cold start behavior
- request timeout envelope on Render free tier

This means the next track is not `Gemini rollback` and not more Discovery model tuning.
The next track is `runtime stability`.

`Option B (async job + polling)` is no longer only a proposal.
It is implemented locally and verified in repo-level checks; live deploy validation is the next milestone.

## Immediate Next Actions

1. Render Logs confirmation is now recorded separately:
   - `plans/2026-04-05-discovery-claude-render-log-confirmation-result.md`
2. Record this rollout as `code path validated, infra-limited`.
3. Keep `GEMINI_DISCOVERY_*` unset.
4. Do not reintroduce `provider=google` for Discovery.
5. Move to the `async rollout` deploy track.

## Recommended Follow-Up

### Option A: Minimal product mitigation

- add one automatic retry for `Discovery` on retryable cold-start / upstream failures
- keep user-facing messaging explicit that retry may be needed during cold start

### Option B: Real stability fix

- move Discovery off Render free tier, or
- convert Discovery analyze into async job + polling so web request timeout stops being the bottleneck

## What Not To Do

- do not add `GEMINI_DISCOVERY_MODEL`
- do not add `GEMINI_DISCOVERY_FALLBACK_MODELS`
- do not spend more time on Claude vs Gemini provider tuning for Discovery
- do not mix generation-side Gemini work into this rollout decision
