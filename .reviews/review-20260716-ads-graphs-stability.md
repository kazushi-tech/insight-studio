<!-- codex-review -->
## Review: Ads graphs stability code candidate (`eacf0019482af354e4f77798689397f78abb7913` → working tree)

- Date: 2026-07-16 10:33 +09:00
- Mode: Plan / Diff / Runtime
- Verdict: PASS
- Authorization: exact-path commit / branch push may proceed; Production deploy is governed by the separate Release review below.

### Critical
- None.

### Major
- None.

### Minor
- None open.

### Required Fixes
1. None for the reviewed code candidate.
2. Stage only the 25 tracked implementation/test paths plus `src/contexts/__tests__/RbacContext.test.jsx` and this review record. Do not stage the pre-existing untracked review, sales-kit, handoff, or output files.

### Resolved During Review
- FIND-001: A chart card error boundary could remain in its fallback state after a successful refresh when title, period, and index produced the same React key. `ChartCardErrorBoundary` now resets only when the report-level `resetKey` changes. The regression test proves that the same report keeps the safe fallback and a new report recovers the card. Post-fix targeted result: 11/11 passed.

### Gate Assessment
- Plan: PASS. The acceptance criteria are explicit: show/select all 12 query cards immediately, render every available graph without beginner/advanced hiding, preserve honest no-data states, verify both demo and Petabit locally, then gate publishing. AI-key work is intentionally out of scope. The branch is isolated at the recorded base SHA, which is also the pre-release rollback point.
- Diff: PASS. The reviewed scope contains 25 tracked files (1,707 insertions / 368 deletions) plus the intended untracked RBAC regression test. Query selection, campaign graph construction, deterministic demo coverage, period-scoped graph status, stale-auth cleanup, bounded local-only rate-limit fallback, cache locking, timeout uncertainty, and in-flight deduplication align with the requested behavior.
- Tenant and auth boundary: PASS. Case-user dataset scope remains server-signed; a wrong dataset returns 403, the owned dataset remains usable locally, demo routes are fixture-isolated, stale browser users cannot authenticate without an in-memory token, and RBAC requires both user and active auth state.
- Duplicate BigQuery execution: PASS. Identical in-flight batches/regenerations share one promise; periods execute sequentially; browser timeout/network/ambiguous 5xx outcomes are not replayed automatically; only explicit pre-handler `rate_limited` / `rate_limit_unavailable` responses are eligible for retry.
- Graph completeness and failure semantics: PASS. All 12 registered queries have a chart-builder entry; campaign is implemented; all query cards start visible and selected; missing/CV-zero results stay explicit; latest-period failure cannot reuse a previous period's graph; every theme/card opens by default; one malformed chart is isolated and can recover on the next report version.
- Runtime: PASS for the code candidate and local application. Production readiness is not included in this verdict.

### Evidence
- Command: `git diff --check eacf0019482af354e4f77798689397f78abb7913`
- Result: PASS (only Windows LF→CRLF notices; no whitespace errors).
- Command: `npm test`
- Result: PASS — 96 files, 549 tests, 0 failures (94.94s) after the final error-boundary fix.
- Command: `npm run lint`
- Result: PASS.
- Command: `npm run build`
- Result: PASS — Vite built 922 modules.
- Command: `npm run bundle:check`
- Result: PASS — entry 82.71 KiB gzip; all JS 449.73 KiB across 54 chunks.
- Command: ads-insights full pytest
- Result: PASS — 381 passed, 6 skipped; skips are intentional external/live cases, warnings are existing FastAPI deprecations / pytest cache permission.
- Command: market-lens full pytest
- Result: PASS — 1,295 passed, 0 failed, 0 skipped; 232 Python files compiled successfully.
- Command: `python scripts/check_secret_leaks.py`
- Result: PASS — tracked-file secret scan passed.
- Command: `python scripts/check_python_locks.py`
- Result: PASS — exact hashed Python lock gate passed.
- Command: `python scripts/check_ci_config.py`
- Result: PASS — workflow YAML and CI helper syntax passed.
- Orchestrator live DevTools evidence (clean Chrome guest, DOM/ARIA/console/network instrumentation): desktop 1440px and mobile 390px both had `scrollWidth == clientWidth`; 12/12 query cards were pressed by default; demo used two periods, showed 12 coverage labels, 7/7 themes open and 28/28 cards open; page errors and request failures were zero. Screenshot capture itself timed out at 30 seconds, so the timeout was not increased and no screenshot artifact was saved.
- Right-column in-app verification: Petabit 2026-07 requested all 12 queries; 11 produced 23 graphs and CV was explicitly shown as 0 rows rather than fabricated; 6/6 themes and 23/23 cards were open; console errors were zero.
- Demo backend contract: both fixture periods execute all 12 queries with deterministic, fictional-only results, no external/AI calls, and full graph coverage.

<!-- codex-review -->
## Review: Production release of Ads graphs stability

- Date: 2026-07-16 10:33 +09:00
- Mode: Release
- Verdict: BLOCKED
- Authorization: do not merge/deploy to Production until the required fixes below pass a new Release review.

### Critical
- None.

### Major
- REL-001: Production has no managed PostgreSQL `DATABASE_URL`. The deployed services correctly fail closed: `/api/ads/health` and `/api/ml/health` return 503 with persistence unavailable, and `/api/projects/demo/reports` returns 503. Therefore neither the production demo nor the end-to-end commercial flow can be certified. This is an environment/configuration blocker, not a defect in the reviewed code.

### Minor
- None.

### Required Fixes
1. With explicit infrastructure authorization, connect an approved managed PostgreSQL database to the existing Production project and set the canonical `DATABASE_URL` without exposing its value.
2. Apply/verify the repository's database migrations and readiness contract for both Ads and Market Lens services.
3. Require HTTP 200 and available persistence from `/api/ads/health` and `/api/ml/health`; require `/api/projects/demo/reports` to stop returning the database-unavailable 503.
4. Deploy the reviewed commit, verify that the Production deployment SHA matches it, and rerun the clean-session demo and Petabit journeys with console/network monitoring on desktop and mobile.
5. Record the previous healthy deployment/SHA as the rollback target before promoting the new deployment.

### Evidence
- Vercel Production environment inspection: `DATABASE_URL` is absent; BigQuery credentials exist, so BigQuery credentials and managed persistence are separate concerns.
- Current Production probes: `/api/ads/health` = 503, `/api/ml/health` = 503, `/api/projects/demo/reports` = 503.
- Runtime observation: the clean demo flow emitted the known report-history 503 caused by missing persistence; this is the only observed console error in that flow. Petabit local/right-column graph generation itself had zero console errors.
- Backend fail-closed regression: Production mode without the shared database returns `rate_limit_unavailable` / unavailable persistence and never falls back to per-process state; non-production fallback is limited to the two legacy BQ generation routes.
- Release conclusion: code commit and branch push are safe after exact-path staging, but Production promotion is not safe until REL-001 is cleared and this Release gate is rerun.
