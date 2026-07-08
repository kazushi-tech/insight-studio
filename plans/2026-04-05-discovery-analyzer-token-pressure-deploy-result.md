# Discovery Analyzer Token Pressure Reduction — Deploy Result (2026-04-05)

## Deployed Commit

- repo: `market-lens-ai`
- branch: `main`
- commit: `4acb3ac`
- title: `perf(analyzer): reduce discovery prompt token pressure and add size logging`

## What Was Verified

- Render health updated to commit `4acb3ac6569b44a9a4a5ce6c1f72ff6bc8d515d0`
- backend tests passed before push:
  - `pytest tests/test_analyzer.py tests/test_discovery_analyze.py`
  - discovery regression suite

## Post-Deploy Result

### render-probe

- result: fail
- stage: `search`
- failure class: `upstream_502`
- observed detail:
  - Anthropic API returned billing / credit exhaustion
  - `"Your credit balance is too low to access the Anthropic API"`

Artifacts:

- `C:\Users\PEM N-266\work\insight-studio\.tmp-discovery-rollout\2026-04-05T03-09-28-451Z-discovery-async-rollout-render.json`
- `C:\Users\PEM N-266\AppData\Local\Temp\.tmp-discovery-rollout\2026-04-05T03-09-57-138Z-discovery-async-rollout-render.json`

## Interpretation

- deploy itself succeeded
- current verification is blocked by Anthropic billing / credit state
- failure happened in `search`, before the new token-pressure change in `analyze` could be evaluated
- this is not enough evidence to attribute the failure to the deployed patch

## Decision

- do not use this probe result to judge analyzer regression
- `render-5` was not run because `render-probe` already failed on provider billing
- next operator action is to restore Anthropic credits / billing, then rerun:
  1. `render-probe`
  2. `render-5`
