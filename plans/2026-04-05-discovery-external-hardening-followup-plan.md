# Discovery External Hardening Follow-up Plan (2026-04-05)

## Current Status

Claude 実装で前進した点:

- Discovery write endpoints に auth dependency が追加された
- concurrent job limit が入った
- `/search` と `/analyze` に deprecation が入った
- `error_code` / `retry_after_sec` が job error contract に入った
- focused tests (`test_discovery_auth.py`) が追加された

テスト状況:

- `56 passed`
- Discovery regression は崩れていない

## What Is Still Not Solved

### 1. Auth is still fail-open in MVP mode

`web/app/auth.py`

- `verify_token()` は `API_KEYS` が空だと `"dev"` を返す
- つまり Discovery routes が `Depends(verify_token)` を使っていても、設定次第では fail-closed にならない

これは社外公開前提では未解決。

### 2. Job ownership is still optional

`web/app/routers/discovery_routes.py`

- `POST /jobs` は `owner_id: Depends(get_optional_user_id)` で optional
- `owner_id` が無いと `resolved_owner = ""`
- この場合 concurrent job limit も owner-based scope も効かない

これは abuse / visibility control として弱い。

### 3. GET /jobs is still effectively public for ownerless jobs

`web/app/routers/discovery_routes.py`

- `GET /jobs/{job_id}` は `verify_auth_optional`
- owner check は `record.owner_id` がある時だけ効く
- `owner_id=""` の job は job_id を知っていれば参照できる

これは external release 向きではない。

### 4. Public contract is only partially simplified

- `/jobs` が canonical になりつつあるが、`/search` と `/analyze` はまだ生きている
- deprecated は入ったが、public surface からはまだ消えていない
- request fields も完全には整理されていない

### 5. Provider-limited instability remains

- current live state:
  - single-run: pass
  - burst / render-5: fail
- これは code で完全解決ではなく、controlled degradation に寄せる対象

## Decision

この patch は「捨てる」のではなく「次の hardening patch の土台」にする。

ただし、**この状態のまま external release 完了とは判断しない**。

## Next Phase

phase 名:

- `Discovery External Hardening Follow-up`

目的:

1. Discovery auth を fail-closed にする
2. job ownership を required identity に寄せる
3. `/jobs` read/write を authenticated identity に縛る
4. deprecated endpoint を public surface からさらに後退させる
5. provider-limited instability は controlled failure policy に整理する

## Agent Team Plan

### Team 1. Security/Auth Explorer

担当:

- `auth.py` の fail-open 問題を external-release 前提でどう閉じるか
- Discovery だけ stricter auth policy を適用する案
- `X-Insight-User` の optional 運用をどうやめるか

主対象:

- `web/app/auth.py`
- `web/app/user_context.py`
- `web/app/routers/discovery_routes.py`

期待成果:

- fail-closed auth 案
- authenticated caller identity と owner_id binding 案
- migration / compatibility note

### Team 2. API/Stability Explorer

担当:

- `/jobs` のみを public canonical path に寄せる案
- `/search` / `/analyze` を internal/legacy に落とす具体策
- provider-limited failure を public API として説明可能にする案

主対象:

- `web/app/routers/discovery_routes.py`
- `web/app/services/discovery/discovery_pipeline.py`
- `web/app/schemas/discovery.py`
- `web/app/schemas/discovery_job.py`

期待成果:

- minimal public API contract
- retry / retry_after / queue/reject policy
- release note 更新方針

### Team 3. Worker

担当:

- Team 1 / Team 2 の合意案を low-risk patch に落とす
- focused tests を追加する

write scope:

- Discovery 周辺のみ

## Skills

補助候補:

- `sickn33/antigravity-awesome-skills@api-security-best-practices`
- `pbakaus/impeccable@harden`

方針:

- まず repo 現物ベースで explorers を回す
- skill は設計の詰まりどころだけ補助参照
- skill install は必要になった時だけ

## Concrete Claude Tasks

1. `auth.py` の MVP fail-open が Discovery external release に対して許容か否かを判定
2. Discovery routes だけ fail-closed にする low-risk 実装案を作る
3. `POST /jobs` で owner identity を required にする案を作る
4. `GET /jobs/{id}` を optional auth から mandatory auth へ寄せる案を作る
5. ownerless job を作らせない contract にできるか判断する
6. `/search` / `/analyze` を internal / legacy 扱いに進める patch 案を作る
7. provider-limited failure を `retry later` / `retry_after` / admission control で整理する案を作る
8. tests を追加する

## Tests Claude Should Add

最低限:

1. API_KEYS 未設定時に Discovery write endpoints が fail-open しないこと
2. `POST /jobs` が authenticated identity なしでは通らないこと
3. ownerless job が作られないこと
4. `GET /jobs/{id}` が caller mismatch で `404` になること
5. `GET /jobs/{id}` が unauthenticated で通らないこと
6. `retry_after_sec` / `error_code` contract が維持されること

## Success Criteria

この follow-up で到達したい状態:

1. Discovery write surface は fail-closed auth
2. job identity / owner scope は authenticated caller ベース
3. ownerless job が残らない
4. `/jobs` が public canonical path として説明可能
5. provider-limited 失敗は controlled failure として返る

## Suggested Claude Prompt

```text
Discovery hardening patch は入りましたが、external release 完了とはまだ判断できません。

まず以下を読んでください:
- plans/2026-04-05-discovery-external-hardening-followup-plan.md
- plans/2026-04-05-discovery-external-release-hardening-plan.md
- plans/2026-04-05-discovery-load-shaping-results.md

現時点の重要な懸念:
1. auth.py の verify_token が API_KEYS 未設定時に fail-open
2. POST /jobs が owner_id optional なので ownerless job を作れる
3. GET /jobs/{id} が verify_auth_optional なので ownerless job だと public に近い
4. /search と /analyze は deprecated だが public surface からはまだ消えていない

やってほしいこと:
1. Security/Auth Explorer と API/Stability Explorer を並列で回す
2. その後 Worker で low-risk patch と focused tests を作る
3. solved / mitigated / provider-dependent を分けて返す

制約:
- Gemini は戻さない
- unrelated generation-side changes はしない
- Discovery 周辺だけ触る
- external release 向けに fail-closed を優先
```
