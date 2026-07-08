# Discovery External Hardening — Completion Plan

## Context

Discovery backend の external release hardening は実装・テスト済みだが、以下が未完了:
- Smoke scripts が hardened backend の auth contract (X-API-Key + X-Insight-User ヘッダー) に対応していない
- 計画書/handoff が「未解決」と記述している項目が既に解決済みで、docs が stale
- backend の Discovery 変更が selective commit されていない（non-Discovery dirty files と混在）

本セッションで P0 (test hang) と P1 (Discovery gate green) は解消済み。
残りの P2-P4 を agent teams で parallel に完結させ、review gate を通してから commit する。

---

## Phase 0: Pre-flight Validation

**担当**: Main (sequential)
**目的**: 開始時点の baseline を確定

1. Discovery test gate 再実行 — 62 passed, 1 skipped を確認
2. 両 repo で staged changes が無いことを確認 (`git diff --cached`)
3. `git diff --name-only` で 17 files (11 Discovery + 6 non-Discovery) を確認

**Exit**: test green, staging clean

---

## Phase 1: Parallel Implementation (3 Agent Teams)

### Team A: Smoke Script Auth — insight-studio

**Scope**: 3 files

#### A-1. `scripts/discovery-render-rollout-check.mjs`
- `requestJson()` (L239 付近) の headers に `X-API-Key` と `X-Insight-User` を追加
- `resolveApiKey()` (L110 付近) は既存。新規 `resolveUserId()` を追加:
  - CLI arg `--user-id` or env `INSIGHT_USER_ID` or default `"guest:smoke-rollout-check"`
- `startJob()` (L315 付近) と polling の `requestJson()` 呼び出しに auth headers を注入
- `requestJson()` の `options.headers` merge を活用（既存パターン）

#### A-2. `scripts/discovery-postdeploy-smoke.mjs`
- `fetch()` (L84 付近) の headers に追加:
  ```js
  headers: {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'X-API-Key': API_KEY } : {}),
    'X-Insight-User': 'guest:smoke-postdeploy',
  }
  ```
- `api_key` は body にも残す（backward compat）

#### A-3. `scripts/discovery-smoke-v3-api.mjs`
- `fetch()` (L103 付近) に同様のパターンで追加
- `X-Insight-User`: `'guest:smoke-v3-api'`

**検証**:
- `node --check` で 3 ファイルの syntax 確認
- grep で全 `fetch()` / `requestJson()` 呼び出しに auth headers があることを確認

---

### Team B: Docs Cleanup — insight-studio

**Scope**: 5 files in `plans/`

| File | Action |
|------|--------|
| `2026-04-05-discovery-external-release-execution-plan-v2.md` | "Still missing" セクション → "Verified resolved" に書き換え |
| `handoff-2026-04-05-discovery-external-hardening.md` | "What Is Still Not Solved" items 1-3 → "Solved" に移動。テスト数 56→62 |
| `2026-04-05-discovery-external-hardening-followup-plan.md` | "What Is Still Not Solved" → "Resolved" に更新 |
| `2026-04-05-discovery-external-release-hardening-plan.md` | 冒頭に `SUPERSEDED` note 追加 |
| `2026-04-05-discovery-external-release-hardening-result.md` | テスト数 56→62 updated |

**検証**: 各 doc に "not solved" / "still missing" が残っていないことを grep 確認

---

### Team C: Selective Commit Prep — market-lens-ai (read-only)

**Scope**: git diff review

**Include (11 files)**:
- `web/app/auth.py` — verify_token_strict 追加
- `web/app/db/tables.py` — owner_id column 追加
- `web/app/routers/discovery_routes.py` — auth/owner binding 統合
- `web/app/repositories/discovery_job_repository.py` — count_active_jobs abstract
- `web/app/repositories/file_discovery_job_repository.py` — count_active_jobs 実装
- `web/app/schemas/discovery.py` — docstring/deprecation 整理
- `web/app/schemas/discovery_job.py` — error_code + retry_after_sec
- `web/app/services/discovery/discovery_pipeline.py` — PipelineError 拡張
- `tests/test_discovery_routes.py` — owner hardening tests + lazy import fix
- `tests/test_discovery_jobs.py` — auth header 対応
- `tests/test_discovery_analyze.py` — auth header 対応

**Exclude (6 files)**:
- `README.md` — Gemini→Claude ドキュメント更新（別 commit）
- `web/app/routers/generation_routes.py` — MIME type fix
- `web/app/gemini_vision_client.py` — return type 変更
- `web/app/services/generation/banner_gen_service.py` — MIME type unpack
- `web/app/schemas/banner_generation.py` — image_mime_type field
- `tests/test_integration_pack_b.py` — Pack B auth 対応（別 commit）

**Not in diff (confirmed)**:
- `web/app/user_context.py` — 既に committed (require_user_id は既存)

**検証**: 各 include file の diff が Discovery scope のみであることを確認

**注意点**: `auth.py` の `verify_auth_optional` 変更 (API_KEYS 未設定時 `"dev"` → `None` 返却) は non-Discovery read endpoints にも影響するが、これは正しい hardening behavior。read endpoints は `None` をハンドルしている前提。

---

## Phase 2: Review Gate

**担当**: codex-review style の thorough review
**入力**: Phase 1 の 3 team 成果物

### Checklist

#### Smoke Scripts Review
- [ ] 全 `fetch()` / `requestJson()` 呼び出しに `X-API-Key` header あり
- [ ] 全 `fetch()` / `requestJson()` 呼び出しに `X-Insight-User` header あり
- [ ] `X-Insight-User` value が `^(auth|guest):[A-Za-z0-9_-]{8,128}$` パターンに合致
- [ ] `api_key` が body にも残っている（backward compat）
- [ ] hardcoded secret なし（key は env var から取得）
- [ ] `node --check` 3 ファイル pass

#### Docs Review
- [ ] 5 docs に残る "not solved" / "still missing" 主張が code truth と矛盾しない
- [ ] テスト数が正確 (62 passed, 1 skipped)
- [ ] 新たな factual error が導入されていない

#### Selective Commit Review
- [ ] 11 files が全て Discovery scope
- [ ] 6 files が確実に exclude
- [ ] `auth.py` の変更が非 Discovery routes を壊さない
- [ ] Gemini re-enablement が無い

**Exit**: 全チェック green → Phase 3 へ

---

## Phase 3: Test Gate

**担当**: Main (sequential)

```bash
# 1. Discovery test suite
cd C:\Users\PEM N-266\work\market-lens-ai
python -m pytest tests/test_discovery_auth.py tests/test_discovery_routes.py \
  tests/test_discovery_jobs.py tests/test_discovery_analyze.py -q
# Expected: 62 passed, 1 skipped

# 2. Smoke script syntax
cd C:\Users\PEM N-266\work\insight-studio
node --check scripts/discovery-render-rollout-check.mjs
node --check scripts/discovery-postdeploy-smoke.mjs
node --check scripts/discovery-smoke-v3-api.mjs
# Expected: no output (clean)
```

**Exit**: 62 passed + 1 skipped + 3 syntax clean

---

## Phase 4: Selective Commit

**担当**: Main (sequential)

### Commit 1: Backend hardening (market-lens-ai)

```bash
cd C:\Users\PEM N-266\work\market-lens-ai
git add web/app/auth.py \
        web/app/db/tables.py \
        web/app/routers/discovery_routes.py \
        web/app/repositories/discovery_job_repository.py \
        web/app/repositories/file_discovery_job_repository.py \
        web/app/schemas/discovery.py \
        web/app/schemas/discovery_job.py \
        web/app/services/discovery/discovery_pipeline.py \
        tests/test_discovery_routes.py \
        tests/test_discovery_jobs.py \
        tests/test_discovery_analyze.py
```

**Staging 検証**:
- `git diff --cached --name-only` → exactly 11 files
- `git diff --name-only` → exactly 6 files remain unstaged

**Commit message**:
```
feat(discovery): external release hardening — auth, owner binding, abuse limits

- Add verify_token_strict (fails closed when API_KEYS unset)
- Enforce require_user_id on all Discovery write endpoints
- Add per-user concurrent job limit
- Bind searches/jobs to owner_id via X-Insight-User
- Add owner_id column to discovery_searches table
- Deprecate /search and /analyze in favor of /jobs
- Fix test_discovery_routes.py hang (lazy sqlalchemy import)

Discovery test gate: 62 passed, 1 skipped
```

### Commit 2: Smoke scripts (insight-studio)

```bash
cd C:\Users\PEM N-266\work\insight-studio
git add scripts/discovery-render-rollout-check.mjs \
        scripts/discovery-postdeploy-smoke.mjs \
        scripts/discovery-smoke-v3-api.mjs
```

**Commit message**:
```
feat(discovery): add auth headers to smoke scripts

- Add X-API-Key and X-Insight-User headers to all API smoke scripts
- Required for hardened backend contract (verify_token_strict + require_user_id)
- Keys from environment variables, no hardcoded secrets
```

### Commit 3: Docs (insight-studio)

```bash
git add plans/2026-04-05-discovery-external-release-execution-plan-v2.md \
        plans/handoff-2026-04-05-discovery-external-hardening.md \
        plans/2026-04-05-discovery-external-hardening-followup-plan.md \
        plans/2026-04-05-discovery-external-release-hardening-plan.md \
        plans/2026-04-05-discovery-external-release-hardening-result.md
```

**Commit message**:
```
docs(discovery): update hardening docs to match repo truth

- Mark resolved items in execution plan and handoff
- Update test count 56 → 62
- Add SUPERSEDED note to pre-implementation plan
```

---

## Phase 5: Final Verification

1. Discovery test suite 再実行 → 62 passed, 1 skipped
2. `git diff --name-only` (market-lens-ai) → 6 non-Discovery files のみ残存
3. `git log --oneline -3` (market-lens-ai) → commit 1 確認
4. `git log --oneline -3` (insight-studio) → commits 2+3 確認
5. Gemini check: `grep -r "gemini" web/app/routers/discovery_routes.py` → deprecation comment のみ

---

## Agent Team Summary

| Phase | Team | Repo | Parallel | Write Scope |
|-------|------|------|----------|-------------|
| 0 | Main | both | - | read-only |
| 1-A | Smoke Worker | insight-studio | A,B,C parallel | 3 scripts |
| 1-B | Docs Worker | insight-studio | A,B,C parallel | 5 plan docs |
| 1-C | Commit Prep | market-lens-ai | A,B,C parallel | read-only |
| 2 | Reviewer | both | sequential | read-only |
| 3 | Test Runner | both | sequential | read-only |
| 4 | Committer | both | sequential | git commit |
| 5 | Verifier | both | sequential | read-only |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| auth.py verify_auth_optional change affects non-Discovery routes | Low | High | Returns None instead of "dev" — read endpoints handle None. Verify no crash in Phase 2 review. |
| Smoke script runtime failure (wrong header format) | Medium | Low | X-Insight-User must match `^(auth\|guest):[A-Za-z0-9_-]{8,128}$`. Use `guest:smoke-*` pattern. |
| Wrong files staged in selective commit | Low | High | Phase 4 explicit verification: `--cached --name-only` exact match. |
| SQLAlchemy Windows hang recurrence | Known | Low | Already mitigated by lazy import + skipif. CI (Linux) unaffected. |

---

## Non-Goals

- Frontend (marketLens.js) auth header 追加 — backend-first なので non-blocking
- Browser-based smoke scripts (v3.mjs, v3-run.mjs) — frontend 依存
- Deploy / push — user 判断
- Gemini re-enablement
- Non-Discovery dirty files のcommit/revert
