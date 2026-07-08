# Discovery Load Shaping Results (2026-04-05)

## Live Backend Commits

- `4acb3ac` `perf(analyzer): reduce discovery prompt token pressure and add size logging`
- `38c28ea` `perf(discovery): reduce async analyze competitor count`
- `4193643` `perf(discovery): further reduce analyze comparison set`

## What Changed

- analyze prompt compaction + prompt size logging
- Discovery competitor comparison set reduced:
  - `5 -> 4`
  - then `4 -> 3`

## Verification

### Direct Anthropic API check

- local `.env` key: pass
- status: `200`
- simple `messages` call returned `OK`

### Render health

- live commit confirmed: `419364360f187fb4aee97e2b1673b37b9965b042`

### render-probe

- result: pass
- elapsed: `134.2s`
- terminal state: `completed`
- fetched sites: `3`
- analyzed count: `4`
- artifact:
  - `.tmp-discovery-rollout/2026-04-05T03-46-29-266Z-discovery-async-rollout-render.json`

### render-5

- result: fail
- success count: `0/5`
- dominant failures:
  - `stage=analyze` -> Claude API rate limit
  - `stage=search` -> search timeout
- artifact:
  - `.tmp-discovery-rollout/2026-04-05T03-48-52-430Z-discovery-async-rollout-render.json`

## Interpretation

- Discovery async job path is live and functional
- `3 competitors` is enough for a single run to complete on the current org setup
- repeated burst traffic is still provider-limited on the current Anthropic budget / tier
- this is not a routing regression
- this is not a deterministic async job contract failure

## Decision

- keep live commit `4193643`
- do not rollback based on current evidence
- stop additional paid smoke for now
- if work continues later, the next options are:
  1. accept `single-run healthy / burst-limited` as the current operating state
  2. reduce comparison depth further
  3. increase Anthropic budget / tier and rerun `render-5`
