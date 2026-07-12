<!-- codex-review -->
## Review: commercial-hardening commit candidate

- Date: 2026-07-12 21:55 JST
- Mode: Plan / Diff / Runtime
- Verdict: PASS

### Critical
- None.

### Major
- None.

### Minor
- Production release remains separately blocked until Vercel authentication, production database backup/migration, required environment settings and live canaries are verified. This does not block committing and pushing the reviewed feature branch.

### Required Fixes
1. None before feature-branch commit and push.

### Evidence
- Frontend: lint passed; 95 test files / 530 tests passed; production build and bundle budgets passed.
- Ads backend: 364 tests passed, 6 skipped.
- ML backend: 1295 tests passed after final error-response sanitization.
- Browser: one clean-context run passed at 360 / 390 / 768 / 1440 px, including report, evidence, AI, project dialogs, share and print.
- Security/schema: freeze diff 0, secret scan passed, exact Python locks passed, deterministic OpenAPI snapshots passed.
- Workflow: Nitro + Vercel Workflow preview server compile passed.
- Diff review: customer error details are sanitized; no Google Ads / とどくくん implementation was added; protected user-owned sales, handoff, prior review and UX-output files are excluded from the commit candidate.
