# Handoff — Discovery Claude-Only / Async Rollout / Token Pressure Follow-up (2026-04-05)

## 1. Executive Summary

Discovery の `Claude-only` 化と `async job + polling` 化は完了した。

現時点の判定:

- `Discovery Claude-only rollout`: complete
- `Discovery async rollout (direct render path)`: complete
- `Discovery proxy path`: provider-limited, non-blocking
- 次フェーズ: `Anthropic org rate limit / token pressure reduction`

重要:

- もう `Discovery routing` を主戦場にしない
- Gemini を戻さない
- 直近の改善対象は `analyze` の入力サイズと provider limit

## 2. Live Status

### Backend

- repo: `market-lens-ai`
- branch: `main`
- live backend commit: `87e0f6a`
- live service: Render `market-lens-ai`

### Frontend

- repo: `insight-studio`
- branch: `master`
- runtime-affecting frontend commit: `03311ec`
- docs-only pushes went further after that
- deploy target: Vercel

## 3. What Was Completed

### A. Discovery Claude-only

完了内容:

- Discovery から Gemini path を排除
- `provider=google` / `model=gemini-*` を reject
- search を Claude Web Search に統一
- `classify_industry` を Claude に統一
- frontend 文言を Claude-only 前提へ修正

最終証跡:

- `anthropic_analysis_model=claude-sonnet-4-6`
- `anthropic_discovery_search_model=claude-sonnet-4-6`
- `anthropic_discovery_search_tool=web_search_20250305`
- `anthropic_discovery_classify_model=claude-sonnet-4-6`
- `default_analysis_provider=anthropic`
- Gemini Discovery 痕跡なし

参照:

- `plans/2026-04-05-discovery-claude-render-log-confirmation-result.md`

### B. Async job + polling

完了内容:

- backend:
  - `POST /api/discovery/jobs`
  - `GET /api/discovery/jobs/{job_id}`
- frontend:
  - sync 呼び出しから polling 方式へ切替
- smoke script:
  - `/jobs` 前提へ更新
  - exit code 判定追加

参照:

- `plans/2026-04-05-discovery-async-rollout-execution-plan.md`
- `plans/2026-04-05-discovery-async-job-polling-design.md`
- `plans/2026-04-05-discovery-async-rollout-checklist.md`

### C. Post-deploy stability hardening

完了内容:

- analyze 側 Anthropic client に retryable `APIStatusError` retry/backoff 追加
- search 側 AnthropicSearchClient に指数 backoff と `Retry-After` 対応追加
- stale fallback model default を削除
- smoke の `render-5` / `proxy-5` pause を `15s` に変更

参照:

- `plans/2026-04-05-discovery-postdeploy-stability-results.md`

## 4. Observed Verification Results

### Render probe

- result: pass
- contract:
  - `POST /api/discovery/jobs` => `202`
  - `GET /api/discovery/jobs/{id}` => `200`
  - terminal `completed`

### Render 5-run

- result: `3/5`
- status: pass
- dominant failures:
  - `stage=analyze`
  - `Claude API rate limit`

### Proxy 5-run

- result: `1/5`
- status: fail
- dominant failures:
  - `stage=search`
  - search timeout
  - `stage=analyze`
  - Claude API rate limit

Interpretation:

- direct render path は acceptance を満たした
- proxy path は provider-limited
- code path regression ではない

## 5. Key Commits

### market-lens-ai

- `2433214` `feat: add Discovery async job API with pipeline extraction`
- `8ebc97c` `feat: complete Discovery Claude-only async rollout`
- `8aef6c9` `fix: remove stale Anthropic fallback defaults`
- `87e0f6a` `fix: retry transient Anthropic discovery failures`

### insight-studio

- `e4ddcaf` `feat: switch Discovery to async job + polling flow`
- `8a8f3c7` `chore: harden Discovery async rollout tooling`
- `03311ec` `docs: add discovery postdeploy stability plan`
- `fb29dee` `docs: record discovery postdeploy stability results`
- `f0409cf` `docs: close discovery rollout status`
- `1aaabf2` `docs: plan discovery token pressure reduction`

注意:

- `insight-studio` の後半 commit は主に docs
- frontend runtime の主変更は `e4ddcaf` と `8a8f3c7`

## 6. Main Files Touched

### market-lens-ai

- `web/app/routers/discovery_routes.py`
- `web/app/services/discovery/discovery_pipeline.py`
- `web/app/services/discovery/anthropic_search_client.py`
- `web/app/services/discovery/keyword_extractor.py`
- `web/app/anthropic_client.py`
- `web/app/main.py`
- `web/app/schemas/discovery_job.py`
- `web/app/repositories/discovery_job_repository.py`
- `web/app/repositories/file_discovery_job_repository.py`
- `tests/test_discovery_jobs.py`
- `tests/test_anthropic_client.py`
- `tests/test_search_client.py`
- `tests/test_discovery_routes.py`
- `tests/test_discovery_analyze.py`

### insight-studio

- `src/api/marketLens.js`
- `src/pages/Discovery.jsx`
- `src/contexts/AnalysisRunsContext.jsx`
- `scripts/discovery-render-rollout-check.mjs`
- `package.json`

## 7. Current Problem Statement

残件は `Discovery routing bug` ではない。

残っている問題:

- Anthropic org rate limit (`429`)
- Claude Web Search busy / timeout
- analyze prompt が重い可能性

したがって、次の改善は `token pressure reduction` が本筋。

## 8. Recommended Next Phase

phase 名:

- `Discovery Token Pressure Reduction`

目的:

- `analyze` の入力サイズを下げる
- burst で provider limit を踏みにくくする
- report 品質を大きく落とさず success rate を改善する

参照:

- `plans/2026-04-05-discovery-token-pressure-reduction-plan.md`
- `plans/2026-04-05-discovery-token-pressure-claude-handoff.md`

## 9. Ownership Recommendation

### Claude Primary

この次フェーズは Claude 主担当が推奨。

理由:

- Codex weekly headroom が低い
- 調査と prompt compaction の反復が多い
- スコープを `analyzer.py` 中心に絞れば Claude に向く

Claude にやらせる内容:

1. `market-lens-ai/web/app/analyzer.py` を中心に token pressure 要因を特定
2. prompt compaction 案を作る
3. 必要なら prompt size 計測 log を追加
4. low-risk patch と test 案を返す

### Codex Secondary

Codex は最後の integration と deploy に限定する。

Codex がやる内容:

1. Claude patch review
2. selective apply
3. test / build / smoke
4. deploy

## 10. Suggested Next Chat Opening

次のチャットでは、これをそのまま渡せばよい。

```text
Discovery の Claude-only 化と async rollout は完了しています。
現在の live backend commit は 87e0f6a、direct render path は render-5=3/5 で pass、proxy path は provider-limited fail です。
次は routing ではなく token pressure reduction を進めたいです。

まず以下を読んでください:
- plans/handoff-2026-04-05-discovery-token-pressure.md
- plans/2026-04-05-discovery-token-pressure-reduction-plan.md
- plans/2026-04-05-discovery-token-pressure-claude-handoff.md
- plans/2026-04-05-discovery-postdeploy-stability-results.md
- plans/2026-04-05-discovery-claude-render-log-confirmation-result.md

やってほしいこと:
1. market-lens-ai/web/app/analyzer.py を中心に token pressure の主因を特定
2. low-risk な prompt compaction 案を作成
3. 必要なら prompt size 計測 log を追加
4. 変更ファイル一覧、根拠、リスク込みで返答

Gemini は戻さないでください。
Discovery routing や async job contract は変更しないでください。
```

## 11. Operational Commands

### Backend tests

```bash
cd ../market-lens-ai
python -m pytest tests/test_anthropic_client.py tests/test_search_client.py tests/test_discovery_jobs.py tests/test_discovery_routes.py tests/test_discovery_analyze.py
```

### Frontend build

```bash
npm run build
```

### Smoke

```bash
npm run smoke:discovery:rollout:health
npm run smoke:discovery:rollout:render-probe
npm run smoke:discovery:rollout:render-5
npm run dev
npm run smoke:discovery:rollout:proxy-5
```

## 12. Cautions

- `market-lens-ai` には Discovery 以外の dirty changes がある
  - generation / banner 系など
  - revert しないこと
- `insight-studio` にも多数の untracked plan files がある
  - 必要なものだけ commit すること
- rollback は deploy rollback で行う
  - Gemini env を足して逃がさない

## 13. Source-of-Truth Docs

優先して読む順番:

1. `plans/handoff-2026-04-05-discovery-token-pressure.md`
2. `plans/2026-04-05-discovery-token-pressure-reduction-plan.md`
3. `plans/2026-04-05-discovery-token-pressure-claude-handoff.md`
4. `plans/2026-04-05-discovery-postdeploy-stability-results.md`
5. `plans/2026-04-05-discovery-claude-render-log-confirmation-result.md`
6. `plans/2026-04-05-discovery-async-job-polling-design.md`
