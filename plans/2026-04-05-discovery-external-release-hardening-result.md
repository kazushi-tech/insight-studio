# Discovery External Release Hardening — Implementation Result (2026-04-05)

## Summary

Discovery write surface を社外公開レベルに hardening した。全56テスト PASSED。

## Changes Made

### Track A: Security Hardening

| File | Change |
|------|--------|
| `web/app/routers/discovery_routes.py` | 全 write endpoints に `Depends(verify_token)` mandatory auth 追加 |
| `web/app/routers/discovery_routes.py` | read endpoints に `Depends(verify_auth_optional)` 追加 |
| `web/app/routers/discovery_routes.py` | `POST /jobs` に per-user concurrent job limit (default 2) 追加 |
| `web/app/routers/discovery_routes.py` | `GET /jobs/{id}` の owner scope を `get_optional_user_id` dependency に移行 |
| `web/app/repositories/discovery_job_repository.py` | `count_active_jobs(owner_id)` abstract method 追加 |
| `web/app/repositories/file_discovery_job_repository.py` | `count_active_jobs` 実装追加 |

Auth enforcement:

- `POST /search` → `verify_token` (mandatory)
- `POST /analyze` → `verify_token` (mandatory)
- `POST /jobs` → `verify_token` (mandatory) + `get_optional_user_id`
- `POST /candidates/{id}/approve` → `verify_token` (mandatory)
- `POST /candidates/{id}/reject` → `verify_token` (mandatory)
- `GET /candidates/{id}` → `verify_auth_optional`
- `GET /jobs/{id}` → `verify_auth_optional` + `get_optional_user_id` (owner scope)

Abuse control:

- Per-user concurrent job limit: `DISCOVERY_MAX_CONCURRENT_JOBS` env (default 2)
- Daily search limit: existing `DISCOVERY_DAILY_LIMIT` (default 100)
- Owner scope: `X-Insight-User` header で job を owner に紐付け

### Track B: API Simplification

| Change | Detail |
|--------|--------|
| `/search` deprecated | `deprecated=True` on route + docstring |
| `/analyze` deprecated | `deprecated=True` on route + docstring |
| Canonical path | `POST /jobs` + `GET /jobs/{id}` が public API の正式パス |
| `search_api_key` deprecated | schema に `description="Deprecated: use api_key instead."` |
| `provider` deprecated | schema に `description="Deprecated: only 'anthropic' is supported."` |
| `model` documented | `description="Claude model override. Omit to use server default."` |

Public API contract (for external docs):

```
POST /api/discovery/jobs
  Headers: Authorization: Bearer <server-api-key>
           X-Insight-User: <user-id>  (optional, for job ownership)
  Body: { "brand_url": "https://...", "api_key": "<claude-api-key>" }
  Response 202: { "job_id", "status", "stage", "poll_url", "retry_after_sec" }

GET /api/discovery/jobs/{job_id}
  Headers: X-Insight-User: <user-id>  (must match job owner)
  Response 200: { "job_id", "status", "stage", "progress_pct", "message", "result", "error", ... }
```

### Track C: Stability Hardening

| Change | Detail |
|--------|--------|
| `PipelineError` enhanced | `error_code` + `retry_after_sec` fields 追加 |
| `DiscoveryJobError` enhanced | `error_code` + `retry_after_sec` fields 追加 |
| Error codes classified | `search_timeout`, `search_auth`, `search_provider_error`, `analyze_timeout`, `analyze_auth`, `analyze_provider_error`, `daily_limit_exceeded`, `internal_error` |
| Retry guidance | provider errors → `retry_after_sec: 30-60`、auth errors → `null` |

Error contract (caller-facing):

```json
{
  "status_code": 502,
  "detail": "Claude Web Search が混み合っています。少し待って再試行してください。 (stage=search)",
  "retryable": true,
  "error_code": "search_provider_error",
  "retry_after_sec": 30
}
```

### Track D: Tests

| File | Tests |
|------|-------|
| `tests/test_discovery_auth.py` (NEW) | 14 tests: auth enforcement, concurrent job limit, error contract |
| `tests/test_discovery_routes.py` | 14 tests: unchanged, all pass |
| `tests/test_discovery_jobs.py` | 4 tests: unchanged, all pass |
| `tests/test_discovery_analyze.py` | 24 tests: unchanged, all pass |

Total: **56 tests, 56 passed, 0 failed**

## Public Release Exit Criteria

### Solved (code で解決済み)

1. **Auth policy**: Discovery write endpoints に mandatory server auth (`API_KEYS` / `Bearer`) を適用
2. **Owner scope**: `X-Insight-User` + `get_optional_user_id` で job を caller に紐付け
3. **Abuse control**: per-user concurrent job limit (default 2) + daily search limit (default 100)
4. **API simplification**: canonical path は `POST /jobs` + `GET /jobs/{id}`、旧 endpoints は deprecated
5. **Request fields**: `api_key` に統一、`search_api_key` / `provider` は deprecated
6. **Error contract**: 統一された `error_code` + `retry_after_sec` + `retryable` フィールド
7. **Secret handling**: API keys are never logged (existing `_sanitize_secret`)

### Mitigated (code で軽減済み、完全解決は運用次第)

1. **Provider rate limits**: `error_code` + `retry_after_sec` で client が理解・対応可能に
2. **Search timeout**: structured error + retry guidance で uncontrolled failure → controlled degradation
3. **Burst traffic**: concurrent job limit で per-user burst を抑制

### Provider-dependent (code では解決不可)

1. **Anthropic API credit/billing state**: server-side credit exhaustion は検知してエラー返却するが、回復は運用者の課金操作が必要
2. **Anthropic tier rate limits**: org tier の RPM/TPM 上限は Anthropic Console での tier 変更が必要
3. **Search availability**: Claude Web Search の可用性は Anthropic 側の SLA に依存

## Remaining Risks

- `API_KEYS` が空の場合、MVP mode として auth がスキップされる（既存仕様）。本番では必ず `API_KEYS` を設定すること
- `X-Insight-User` は self-asserted header。厳密な caller identity には別途 auth provider 統合が必要
- file-based job repository は単一プロセス前提。水平スケールには DB-backed repository が必要
