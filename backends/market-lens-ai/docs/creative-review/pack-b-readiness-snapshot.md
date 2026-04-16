# Pack B Readiness Snapshot

Date: 2026-03-23
Status: **READY FOR KICKOFF-PLANNING** — Pack A formal-complete (2026-03-23). Pack B implementation start requires separate user go-ahead. PDF explicitly deferred (env blocker, not engineering blocker)

---

## Pack B 定義 — Agency Pilot

Purpose: Validate proposal workflow with closed-beta customers.

Scope:

- Exports stabilization (PPTX editing, PDF regression hardening)
- Monitoring lite (watchlist, recurring digest)
- Brand / evidence library (approved examples)
- Competitor compare workflow (discovery + positioning analysis)
- DB-backed metadata (migrate file-backed to SQLite or PostgreSQL)

---

## Pack B 開始条件 (all must be TRUE)

| Condition | Status |
|-----------|--------|
| Pack A implementation-complete (browser smoke, tests, build, probe infrastructure) | **GREEN** |
| Pack A formal-complete sign-off recorded in `internal-alpha-checklist.md` | **GREEN** (2026-03-23) |
| Human closeout checklist complete (12 real Gemini outputs, 9/12 Pass, prohibited-expression check, `@media print` check) | **GREEN** — 75% (9/12 Pass), WARN 4/4 ACCEPTED, prohibited-expr CLEAR, @media print CONFIRMED (2026-03-23) |
| PDF disposition fixed (explicit defer documented; not a kickoff blocker) | **GREEN** |
| Underlying engineering gates (`Gate-RC1/RC2/RC3`, `Gate-SA1/SA2`, `Gate-OS1/OS2`, smoke remediation) | **GREEN** |
| User explicit go-ahead — kickoff-planning | **GREEN** (given 2026-03-23) |
| User explicit go-ahead — implementation start | NOT YET |

---

## 既に満たされた前提条件

| Item | Evidence |
|------|----------|
| ReviewResult schema strictness (`additionalProperties: false`) | Commit d9deddf, 293 tests pass |
| One-pager schema strictness (nested contract alignment) | Commit ab173d9 |
| API contract validation (envelope response, rubric sync) | Commit 4474338 |
| Build (`npm run build`) | CI green |
| PDF 503 handling | Commit 8856c6a, verified via TestClient |
| Acceptance probe infrastructure | `scripts/run_acceptance_probe.py` repaired; 12/12 real Gemini probes executed (8 PASS, 4 WARN, 2026-03-23) |

---

## Remaining Closeout / Readiness Items

| Item | Status | Blocker |
|------|--------|---------|
| Human closeout checklist | **COMPLETE** | 75% (9/12 Pass), WARN 4/4 ACCEPTED, all checks confirmed (2026-03-23) |
| Real Gemini packet completion | **COMPLETE** | 12/12 probed, 9 Pass / 3 Fail, 4 WARN ACCEPTED |
| Pack A formal-complete sign-off | **DONE** | Signed off 2026-03-23 |
| User explicit go-ahead for kickoff-planning | **YES** | Given 2026-03-23 |
| User explicit go-ahead for implementation start | NOT YET | Required before Pack B implementation begins |

---

## Pack B 最初の 3 ワークパック

### WP-B1: DB Metadata Baseline

Migrate asset / review / export metadata from file-backed repositories to DB
(SQLite for local, PostgreSQL for deploy). Implement repository interface swap
so that `FileAssetRepository` -> `DbAssetRepository` is a config toggle.

Ref: CR-A2.5 metadata contract (already designed), Phase 2B in implementation master plan.

### WP-B2: Competitor URL Discovery

Given a brand URL, automatically discover competitor URLs via search API.
Present candidates for operator approval before review execution.

Ref: Pack B scope in execution plan — "competitor compare workflow".

### WP-B3: Compare Review Workflow

Given approved competitor URLs and brand assets, generate comparative analysis
with positioning insights. Output feeds into one-pager sections.

Ref: Execution plan "positioning compare" (Team B responsibility).

---

## なぜ今始めないのか

1. ~~**Browser smoke is pending**~~ — **DONE**: Playwright automation 12/12 PASS (2026-03-22)
2. ~~**Human closeout is incomplete**~~ — **DONE**: 75% (9/12 Pass), all checks confirmed (2026-03-23)
3. ~~**Pack A formal-complete is not yet signed off**~~ — **DONE**: signed off 2026-03-23
4. **Pack B implementation start not yet authorized** — kickoff-planning is ready, but implementation requires separate user go-ahead
5. **CR-9 PDF export remains explicitly deferred** — WeasyPrint requires GTK3 system libraries (not available on current Windows env). This stays in Pack B scope for hardening, but it is not, by itself, a kickoff blocker

Pack A formal-complete was signed off on 2026-03-23 (75% acceptance, 9/12 Pass).
Kickoff-planning is underway. Pack B implementation start requires separate user go-ahead.
PDF remains explicitly deferred (env blocker) per Pack A exit decision memo (2026-03-23).
