# Discovery External Release Hardening Plan (2026-04-05)

## Decision

現時点では、Discovery は「社外に安心して出せる状態」には未達。

達成済み:

- Claude-only routing
- async job + polling
- single-run completion (`render-probe` pass on live commit `4193643`)

未達:

- 社外公開レベルの auth / abuse control
- provider-limited instability の運用許容化
- public API contract の単純化

## Can This Solve Everything?

結論:

- **Yes**: security / auth / API shape / abuse control / caller-facing error contract は code でかなり解決できる
- **No**: provider budget / org tier / upstream timeout そのものは code だけでは解決できない

したがって、このフェーズのゴールは:

1. 社外公開 blockers のうち code で解けるものを潰す
2. code で解けない provider 制約は「 uncontrolled failure 」ではなく「 controlled degradation 」に変える

期待する最終状態:

- external release として説明可能な auth policy
- async jobs に整理された public contract
- burst traffic でも client が理解できる failure behavior
- ただし provider tier 由来の性能上限は残る

## Current Facts

### Live state

- backend live commit: `4193643`
- direct render `render-probe`: pass
- direct render `render-5`: fail
- dominant failures:
  - `stage=analyze` -> Claude API rate limit
  - `stage=search` -> search timeout

### Current API surface

- `POST /api/discovery/search`
- `POST /api/discovery/analyze`
- `POST /api/discovery/jobs`
- `GET /api/discovery/jobs/{job_id}`

### Current concerns

1. write endpoints on Discovery are not protected by mandatory app auth in the same way as integration/admin routes
2. `X-Insight-User` is used for owner scoping but is not a substitute for real authentication
3. sync and async endpoints coexist, which keeps the public contract harder to explain and support
4. provider budget / tier limits still dominate multi-run stability
5. error handling is improved, but public-facing error contract is still inconsistent for external release

## Assessment

### 1. Security

未解決。

理由:

- Discovery write paths currently rely on BYOK / env-key behavior, not strict caller authentication
- owner scoping around jobs is header-based and light-weight
- public release would need explicit auth policy, request ownership policy, and abuse controls

### 2. Error stability

未解決。

理由:

- single-run succeeds
- burst / repeated traffic still fails on provider rate limits and search timeout
- this is acceptable for internal experimentation, but not yet for a stable external product

### 3. API complexity

未解決。

理由:

- `/search`, `/analyze`, and `/jobs` all exist
- sync and async paths coexist
- request semantics around `api_key`, `search_api_key`, `provider`, and `model` are still more complex than a public surface should expose

## Goal

Claude に依頼する次フェーズは `Discovery External Release Hardening`。

目的:

1. Discovery write surfaceを社外公開前提で harden する
2. provider-limited failure を public API として扱いやすい形にする
3. public contract を async job へ一本化する

## Non-Goals

- Gemini の再導入
- Discovery routing の再設計
- provider tier の購入判断
- unrelated generation-side changes
- frontend の大幅 redesign

## Recommended Scope

優先スコープ:

- `market-lens-ai/web/app/routers/discovery_routes.py`
- `market-lens-ai/web/app/services/discovery/discovery_pipeline.py`
- `market-lens-ai/web/app/auth.py`
- `market-lens-ai/web/app/user_context.py`
- `market-lens-ai/web/app/schemas/discovery.py`
- `market-lens-ai/web/app/schemas/discovery_job.py`
- `market-lens-ai/tests/test_discovery_routes.py`
- `market-lens-ai/tests/test_discovery_jobs.py`
- `market-lens-ai/tests/test_discovery_analyze.py`

必要なら:

- operator docs / release notes only

## Agent Team Execution Model

このフェーズは Claude 側で並列分担する前提で進める。

### Team 1. Security / Auth Explorer

担当:

- Discovery write endpoints の mandatory auth 化
- `X-Insight-User` の役割整理
- owner scope を caller identity に寄せる設計
- abuse control の入口整理

主な確認対象:

- `web/app/auth.py`
- `web/app/user_context.py`
- `web/app/routers/discovery_routes.py`

### Team 2. API Contract / Stability Explorer

担当:

- `/search` / `/analyze` / `/jobs` の contract 整理
- async jobs を canonical path に固定する方針
- provider-limited failure を external API として扱いやすくする方針

主な確認対象:

- `web/app/routers/discovery_routes.py`
- `web/app/services/discovery/discovery_pipeline.py`
- `web/app/schemas/discovery.py`
- `web/app/schemas/discovery_job.py`

### Team 3. Implementation Worker

担当:

- explorer の結論をもとに low-risk patch を実装
- focused tests を追加 / 更新

主な write scope:

- Discovery 周辺ファイルだけ

### Codex Role

Codex は最後に:

1. Claude team outputs review
2. selective apply
3. regression test
4. deploy / smoke

## Claude Tasks

### Track A. Security Hardening

1. Discovery write endpointsに mandatory auth を導入する案を作る
2. `X-Insight-User` 依存を補助用途に限定し、caller identity を auth に寄せる
3. external abuse を抑えるための最小 guard を提案する
   - per-user / per-key admission control
   - concurrent job limit
   - replay / spam guard
4. BYOK を残す場合の secret handling / logging risk を点検する

### Track B. API Simplification

1. public contract を `POST /api/discovery/jobs` + `GET /api/discovery/jobs/{id}` 中心に整理する案を作る
2. `/api/discovery/analyze` を legacy/internal 扱いに落とす方針を作る
3. request fields を整理する
   - `api_key`
   - `search_api_key`
   - `provider`
   - `model`
4. external docs に出せる最小 contract を定義する

### Track C. Stability Hardening

1. provider-limited failure を product-levelに扱う改善案を作る
2. public API として「fail fastすべきか / queueすべきか」を決める
3. `search` / `analyze` の failure class を整理し、 client-facing error contract を単純化する
4. low-cost な安定化案を比較する
   - per-job concurrency shaping
   - queued admission
   - immediate `retry later` rejection
   - optional reduced-depth mode

### Track D. Public Release Exit Criteria

1. 「社外に出せる」と言うための条件を明文化する
2. solved / mitigated / provider-dependent を分離する
3. release blocker を `must fix` / `can defer` に分類する

## Concrete Deliverables From Claude

Claude に返してほしいもの:

1. 変更方針の要約
2. public release blocker の一覧
3. low-risk patch 案
4. 必要最小限の tests 更新案
5. API contract 変更有無
6. 残るリスク
7. `solved / mitigated / not solvable in code` の仕分け

## Skills Strategy

このフェーズでは skill は補助用途に限定する。

### Already used

- local skill: `find-skills`
  - hardening 補助に使える skill 候補を探索済み

### Candidate external skills found

- `sickn33/antigravity-awesome-skills@api-security-best-practices`
  - `4.2K installs`
- `pbakaus/impeccable@harden`
  - `32.4K installs`

注意:

- まだ GitHub stars / source review まで検証していない
- したがって、現時点では「必須依存」ではなく「補助参照候補」

方針:

1. まずは repo 現物を基準に Claude explorers で設計を出す
2. 詰まったときだけ skill を補助参照する
3. skill install を先にやるのではなく、必要になった時点で限定導入する

## Acceptance Criteria

最低条件:

1. Discovery write endpointsに public releaseとして説明可能な auth policy がある
2. public API の canonical path が async jobs に整理される
3. caller-facing error contract が簡潔で一貫している
4. repeated callsに対して uncontrolled failure ではなく、説明可能な behavior になる
5. tests で auth / scope / error contract を押さえられる
6. 「何が code で解決済みか」と「何が provider 依存で残るか」を明確に説明できる

## Suggested Claude Prompt

```text
Discovery は single-run では成立していますが、社外公開レベルの hardening には未達です。
次は token pressure ではなく external release hardening を進めたいです。

まず以下を読んでください:
- plans/2026-04-05-discovery-external-release-hardening-plan.md
- plans/2026-04-05-discovery-load-shaping-results.md
- plans/handoff-2026-04-05-discovery-token-pressure.md
- plans/2026-04-05-discovery-analyzer-token-pressure-deploy-result.md

やってほしいこと:
1. Discovery write endpoints の auth / abuse / owner-scope の弱点を特定
2. public API contract を async jobs 中心に整理する low-risk 案を作成
3. provider-limited instability を public release として扱いやすくする案を作成
4. 必要なら patch と focused tests まで返す
5. solved / mitigated / provider-dependent を分離して報告

制約:
- Gemini は戻さない
- unrelated generation-side changes はしない
- write scope は Discovery 周辺に限定
- まずは low-risk で実装可能な案を優先

進め方:
- explorer 2本で Security/Auth と API/Stability を並列調査
- その後 worker 1本で low-risk patch に落とす
- skill は必要時のみ補助利用
```

## Bottom Line

今の Discovery は:

- internal / controlled use: かなり前進
- external release: まだ未完成

したがって、次フェーズは `security + API simplification + stability hardening` が本筋。
