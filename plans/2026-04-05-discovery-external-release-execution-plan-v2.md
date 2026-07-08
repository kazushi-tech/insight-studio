# Discovery External Release Execution Plan v2 (2026-04-05)

## Why This Plan Exists

最新の Claude 報告は前進しているが、`market-lens-ai` のローカル working tree と完全一致していない。
このため、以後は **報告書ではなく repo 現物を source of truth** として進める。

## Current Repo Truth

### Confirmed in local `market-lens-ai`

- `web/app/routers/discovery_routes.py` には `POST /search`, `GET /candidates/{search_id}`, `POST /candidates/{candidate_id}/approve`, `POST /candidates/{candidate_id}/reject`, `POST /analyze`, `POST /jobs`, `GET /jobs/{job_id}` が存在する
- `/search` と `/analyze` には `deprecated=True` が入っている
- `retry_after_sec` を返す Discovery job error contract は入っている
- Discovery focused tests は `56 passed`

### Still missing in current local code

- `web/app/auth.py` に `verify_token_strict` はまだ無い
- Discovery routes はまだ `verify_token` / `verify_auth_optional` / `get_optional_user_id` ベースの箇所が残っている
- `GET /candidates/{search_id}` は fail-closed owner check になっていない
- approve/reject は candidate owner verification が無い
- `_persist_search(...)` は DB path で `owner_id` を保存していない

### Frontend constraint

- `insight-studio` の Discovery client は現状 `X-Insight-User` は送るが、`Authorization` / `X-API-Key` を運んでいない
- したがって external release candidate 判定は **backend-first** で進める
- frontend / proxy smoke は auth carriage が入るまで non-blocking 扱いにする

## Decision

次の本筋は `Discovery external release candidate` を作ること。
ただし順番は以下に固定する。

1. auth / owner binding の事実確認
2. candidate owner hardening の適用
3. Discovery-only test gate
4. selective commit
5. deploy and smoke

External RC の補足:

- backend の external contract が先
- frontend は auth carriage 変更が入った時だけ RC gate に含める

## Agent Team

### Team 1. Security/Auth Explorer

責務:

- `auth.py` と `discovery_routes.py` を見て、strict auth patch が未適用かを repo 現物ベースで判定
- Discovery external release に必要な最低 auth 条件を確定

主対象:

- `../market-lens-ai/web/app/auth.py`
- `../market-lens-ai/web/app/user_context.py`
- `../market-lens-ai/web/app/routers/discovery_routes.py`
- `../market-lens-ai/tests/test_discovery_auth.py`

期待成果:

- strict auth が未適用なら、その gap を短く列挙
- owner binding の required / optional を endpoint ごとに整理

### Team 2. Discovery Owner Hardening Worker

責務:

- search record に `owner_id` を永続化
- `GET /candidates/{search_id}` を fail-closed にする
- approve/reject で candidate ownership を検証する
- focused tests を追加 / 更新する

write scope:

- `../market-lens-ai/web/app/routers/discovery_routes.py`
- `../market-lens-ai/web/app/db/tables.py`
- `../market-lens-ai/tests/test_discovery_auth.py`
- `../market-lens-ai/tests/test_discovery_routes.py`

### Team 3. Release/Smoke Explorer

責務:

- deploy 前後の確認順序を Discovery 専用に整理する
- smoke scripts / operator docs のズレを抽出する
- provider-limited risk と code-complete risk を分ける

主対象:

- `plans/2026-04-05-discovery-next-steps-codex-claude-plan.md`
- `plans/2026-04-05-discovery-load-shaping-results.md`
- `plans/2026-04-05-discovery-postdeploy-stability-results.md`
- `scripts/` 内の Discovery rollout / smoke scripts

### Codex Role

Codex は以下だけを持つ。

1. agent output の review
2. selective apply / integration
3. Discovery gate 実行
4. commit slicing
5. deploy / smoke go-no-go 判断

## Skills

### Use now

- `find-skills`
  - security / hardening 系 skill の install 数と質を確認するため

### Optional support skill

- `pbakaus/impeccable@harden`
  - install 数が多く、hardening checklist 用として使いやすい

### Do not use by default

- install 数が低い API security skills
  - repo 現物 review より信頼度が低い

## Execution Sequence

### Step 1. Reconcile auth reality

- Security/Auth Explorer に現在の local code を読ませる
- `verify_token_strict` が本当に入っているか、報告ではなく実コードで判定する

Exit condition:

- strict auth が既に入っているか、未適用かが明文化される

### Step 2. Land candidate owner hardening

- Worker で `owner_id` 永続化、candidate owner verification、fail-closed `GET /candidates` を入れる
- DB path と in-memory path の両方を揃える

Exit condition:

- approve/reject owner mismatch が `404`
- unknown or mismatched `search_id` の candidate read が `404`

### Step 3. Discovery test gate

最低:

```bash
cd ../market-lens-ai
pytest tests/test_discovery_auth.py tests/test_discovery_routes.py tests/test_discovery_jobs.py tests/test_discovery_analyze.py -q
```

可能なら追加:

```bash
cd ../market-lens-ai
pytest tests/test_discovery_db.py tests/test_discovery_routes.py tests/test_discovery_jobs.py tests/test_discovery_auth.py tests/test_discovery_analyze.py -q
```

Exit condition:

- focused Discovery gate が green
- broader Discovery gate は pass か、少なくとも timeout / infra issue かを切り分け済み

### Step 4. Selective commit

Discovery hardening だけを commit に含める。
generation / banner / Gemini 側の差分は混ぜない。

Target files:

- Discovery route / auth / schema / repository / db table / focused tests

### Step 5. Deploy and smoke

順番:

1. backend deploy
2. health check
3. auth-required Discovery smoke
4. owner-scope smoke
5. provider failure contract smoke
6. burst smoke

Minimum smoke assertions:

- unauthenticated Discovery write は `401`
- missing `X-Insight-User` が required な endpoint は `400`
- owner mismatch read/write は `404`
- approve/reject owner mismatch は `404`
- provider-limited failure は `error_code` / `retry_after_sec` を返す

## Success Criteria

1. Discovery write surface は repo 現物で fail-closed と説明できる
2. candidate read/write が owner-bound になっている
3. search owner data が DB と in-memory の両方で保存される
4. Discovery-only test gate が green
5. deploy smoke で auth / owner leak が無い
6. provider-limited failure は productized error contract として返る

## Non-Goals

- `Gemini` を戻す
- generation-side の未整理差分を今回の commit に混ぜる
- provider tier / Anthropic billing を code で解決したことにする

## Immediate Next Action

今すぐ回す順番はこれで固定する。

1. Team 2 worker で candidate owner hardening 実装
2. Team 1 explorer で strict auth reality check
3. Team 3 explorer で smoke / docs gap 抽出
4. Codex が review して selective integrate
