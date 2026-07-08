# Handoff — Discovery Token Pressure / Load Shaping / External Hardening Follow-up (2026-04-05)

## 1. Executive Summary

Discovery はここまでで大きく3段階進んでいる。

1. `Claude-only + async job + polling` への移行
2. `token pressure reduction` と `load shaping`
3. `external release hardening` の初回パッチ

現時点の結論:

- **live backend** は `4193643`
- **single-run** は成立している
- **burst / render-5** は provider-limited fail のまま
- **external release hardening** は初回パッチまで入ったが、まだ完了ではない

重要:

- routing bug は主戦場ではない
- Gemini は戻さない
- 次フェーズの本筋は `external hardening follow-up`

## 2. Live Status

### Backend

- repo: `market-lens-ai`
- branch: `main`
- live backend commit: `419364360f187fb4aee97e2b1673b37b9965b042`
- live short SHA: `4193643`
- live service: Render `market-lens-ai`

### Frontend / Operator Repo

- repo: `insight-studio`
- branch: `master`
- deploy target: Vercel
- current work here is mainly plans / smoke / handoff docs

## 3. What Has Been Successfully Completed

### A. Discovery Claude-only + async jobs

既完了:

- Discovery から Gemini path を排除
- `POST /api/discovery/jobs`
- `GET /api/discovery/jobs/{job_id}`
- frontend polling flow へ切替

### B. Token pressure reduction

live に出た主変更:

- `4acb3ac` `perf(analyzer): reduce discovery prompt token pressure and add size logging`

内容:

- `body_text_snippet` の圧縮
- site payload の削減
- prompt 文面圧縮
- `prompt_size` log 追加

### C. Load shaping

live に出た主変更:

- `38c28ea` `perf(discovery): reduce async analyze competitor count`
- `4193643` `perf(discovery): further reduce analyze comparison set`

内容:

- Discovery compare set を `5 -> 4 -> 3` に削減

## 4. Current Live Verification State

### A. Direct Anthropic API

- 新しい API key で local direct call は `200 OK`
- billing / dead key 問題は切り分け済み

### B. render-probe

- live commit `4193643` で **pass**
- terminal state: `completed`
- fetched sites: `3`
- analyzed count: `4`

### C. render-5

- live commit `4193643` で **fail**
- result: `0/5`
- dominant failures:
  - `stage=analyze` -> Claude API rate limit
  - `stage=search` -> search timeout

Interpretation:

- Discovery async job path は live で成立
- `single-run healthy / burst-limited`
- code path regression ではない
- provider / budget / tier 制約がまだ支配的

## 5. Deployed Commits

### market-lens-ai

- `87e0f6a` `fix: retry transient Anthropic discovery failures`
- `4acb3ac` `perf(analyzer): reduce discovery prompt token pressure and add size logging`
- `38c28ea` `perf(discovery): reduce async analyze competitor count`
- `4193643` `perf(discovery): further reduce analyze comparison set`

### insight-studio

主に docs / smoke / handoff:

- deploy note / result note
- load-shaping result note
- external hardening plan

## 6. Important Docs Created In This Chat

### Core rollout / result docs

- `plans/2026-04-05-discovery-analyzer-token-pressure-deploy.md`
- `plans/2026-04-05-discovery-analyzer-token-pressure-deploy-result.md`
- `plans/2026-04-05-discovery-load-shaping-results.md`

### Planning docs

- `plans/2026-04-05-discovery-external-release-hardening-plan.md`
- `plans/2026-04-05-discovery-external-hardening-followup-plan.md`

### Earlier source-of-truth docs still relevant

- `plans/handoff-2026-04-05-discovery-token-pressure.md`
- `plans/2026-04-05-discovery-token-pressure-reduction-plan.md`
- `plans/2026-04-05-discovery-token-pressure-claude-handoff.md`
- `plans/2026-04-05-discovery-postdeploy-stability-results.md`
- `plans/2026-04-05-discovery-claude-render-log-confirmation-result.md`

## 7. Claude Hardening Patch Status

Claude から external hardening の初回パッチが返っており、**local `market-lens-ai` working tree に未commitで入っている**。

主な変更対象:

- `web/app/routers/discovery_routes.py`
- `web/app/services/discovery/discovery_pipeline.py`
- `web/app/schemas/discovery.py`
- `web/app/schemas/discovery_job.py`
- `web/app/repositories/discovery_job_repository.py`
- `web/app/repositories/file_discovery_job_repository.py`
- `tests/test_discovery_auth.py` (new)

Claude patch の要点:

- Discovery write endpoints に auth dependency 追加
- `/search` / `/analyze` に deprecation
- per-user concurrent job limit 追加
- job error contract に `error_code` / `retry_after_sec`
- repository に `count_active_jobs`
- Discovery auth / concurrency / error contract の focused tests

Local verification:

- `pytest tests/test_discovery_auth.py tests/test_discovery_jobs.py tests/test_discovery_routes.py tests/test_discovery_analyze.py`
- result: `56 passed`

## 8. Why The Claude Hardening Patch Is Not “Done” Yet

初回パッチは前進しているが、review すると external release 完了とはまだ言えない。

### Main unresolved gaps

1. `web/app/auth.py`

- `verify_token()` が `API_KEYS` 未設定時に `"dev"` を返す
- つまり fail-open
- Discovery routes に auth を付けても、設定次第で external release としては弱い

2. `web/app/routers/discovery_routes.py`

- `POST /jobs` は `owner_id` optional
- `owner_id` が無いと ownerless job を作れる
- concurrent job limit も owner-based なので ownerless caller では弱い

3. `web/app/routers/discovery_routes.py`

- `GET /jobs/{job_id}` は `verify_auth_optional`
- ownerless job が存在すると、job_id を知っていれば参照しやすい

4. Public contract simplification is partial

- `/jobs` が preferred でも `/search` と `/analyze` はまだ public surface に残っている
- deprecated ではあるが contract はまだ重い

5. Provider-limited instability remains

- これは code だけで完全解決ではなく、controlled degradation に寄せる対象

## 9. Current Assessment

### Solved / substantially improved

- Claude-only routing
- async jobs contract
- single-run completion
- token pressure reduction
- compare depth reduction
- discovery-specific error contract の整理開始
- auth / concurrency / deprecation の初回 hardening patch

### Mitigated but not solved

- `analyze 429`
- `search timeout`
- external error contract consistency
- public API complexity

### Not solvable in code alone

- Anthropic org tier / budget / provider capacity
- burst / sustained multi-run stability under current provider limits

## 10. Security / Stability / API Complexity Bottom Line

今の Discovery は:

- internal / controlled use: かなり前進
- external release: **まだ未完成**

明確に未解決:

- fail-closed auth
- caller identity と owner binding
- ownerless job 禁止
- `/jobs` read/write の stronger auth
- `/search` / `/analyze` の public surface 後退
- provider-limited failure の productized handling

## 11. Recommended Next Phase

phase 名:

- `Discovery External Hardening Follow-up`

目標:

1. Discovery auth を fail-closed にする
2. job ownership を authenticated identity に寄せる
3. ownerless job を作れないようにする
4. `/jobs` を canonical public contract に寄せる
5. provider-limited instability を controlled failure として扱う

## 12. Agent Team Strategy For Claude

次チャットでは Claude 側を以下の team 構成で回す前提がよい。

### Team 1. Security/Auth Explorer

担当:

- `auth.py` の fail-open 問題
- Discovery write endpoints の fail-closed 化
- `X-Insight-User` / caller identity / owner binding の整理

### Team 2. API/Stability Explorer

担当:

- `/search` / `/analyze` / `/jobs` contract 整理
- `/jobs` canonical 化
- provider-limited failure を retry-later / admission-control として扱う案

### Team 3. Worker

担当:

- explorer の結論を low-risk patch と focused tests に落とす

### Codex Role

Codex は最後に:

1. Claude patch review
2. selective apply
3. regression test
4. deploy / smoke

## 13. Skills Strategy

このフェーズでは skill は補助用途。

確認済み候補:

- `sickn33/antigravity-awesome-skills@api-security-best-practices`
- `pbakaus/impeccable@harden`

方針:

- まず repo 現物ベースで explorers を回す
- 詰まる箇所だけ skill を補助参照
- skill install を先に必須化しない

## 14. Current Local Working Tree Warning

`market-lens-ai` は dirty。

Discovery 以外にも unrelated changes がある:

- `README.md`
- generation / banner 系
- その他 untracked files

重要:

- Discovery hardening patch だけを selective commit すること
- unrelated dirty changes は revert しないこと

## 15. Concrete Files To Review Next

優先:

- `market-lens-ai/web/app/auth.py`
- `market-lens-ai/web/app/user_context.py`
- `market-lens-ai/web/app/routers/discovery_routes.py`
- `market-lens-ai/web/app/services/discovery/discovery_pipeline.py`
- `market-lens-ai/web/app/schemas/discovery.py`
- `market-lens-ai/web/app/schemas/discovery_job.py`
- `market-lens-ai/web/app/repositories/discovery_job_repository.py`
- `market-lens-ai/web/app/repositories/file_discovery_job_repository.py`
- `market-lens-ai/tests/test_discovery_auth.py`
- `market-lens-ai/tests/test_discovery_jobs.py`
- `market-lens-ai/tests/test_discovery_routes.py`
- `market-lens-ai/tests/test_discovery_analyze.py`

## 16. Suggested Next Chat Opening

次チャットではこれをそのまま渡せばよい。

```text
Discovery は single-run では成立していますが、external release hardening はまだ完了していません。

まず以下を読んでください:
- plans/handoff-2026-04-05-discovery-external-hardening.md
- plans/2026-04-05-discovery-external-hardening-followup-plan.md
- plans/2026-04-05-discovery-external-release-hardening-plan.md
- plans/2026-04-05-discovery-load-shaping-results.md

現状:
- live backend commit は 4193643
- render-probe は pass
- render-5 は 0/5 fail
- provider-limited failure は analyze 429 と search timeout
- Claude の external hardening patch は local working tree に未commitで入っており、Discovery regression 56 tests は pass

やってほしいこと:
1. Security/Auth Explorer と API/Stability Explorer を並列で回す
2. auth.py の fail-open 問題、ownerless job、optional auth GET /jobs を主対象にする
3. low-risk patch と focused tests を返す
4. solved / mitigated / provider-dependent を分けて返す

制約:
- Gemini は戻さない
- unrelated generation-side changes は触らない
- Discovery 周辺だけを write scope にする
- Claude中心で進め、Codexは最後の review / apply / test / deploy に限定する
```

## 17. Useful Commands

### Discovery focused tests

```bash
cd ../market-lens-ai
pytest tests/test_discovery_auth.py tests/test_discovery_jobs.py tests/test_discovery_routes.py tests/test_discovery_analyze.py
```

### Health check

```bash
curl https://market-lens-ai.onrender.com/api/health
```

### Smoke

```bash
npm run smoke:discovery:rollout:render-probe
npm run smoke:discovery:rollout:render-5
```

## 18. Final Bottom Line

現時点の Discovery は:

- `internal / controlled use`: かなり前進
- `external release`: 未完成

次の本筋は `external hardening follow-up` であり、
token pressure そのものよりも `fail-closed auth + owner binding + public contract simplification + controlled failure behavior` が主戦場。
