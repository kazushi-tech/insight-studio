# Pack A Exit Decision Memo

Date: 2026-03-23
Decision Turn: Gate-ED1/ED2/ED3

---

## Authoritative Pack A Exit Criteria (Single Source)

Pack A (Internal Alpha) は以下が全て満たされた時点で formal-complete とする。

| # | Criteria | Status | Type |
|---|----------|--------|------|
| 1 | operator が banner を upload できる | GREEN | Automated (A) |
| 2 | banner review が Good/Keep/Improve/Test/Evidence で返る | GREEN | Automated (A) |
| 3 | ad-to-LP review が返る | GREEN | Automated (A) |
| 4 | one-pager HTML を preview できる | GREEN | Automated (A) |
| 5 | PDF export path の扱いが truthfully fixed されている (verified or explicit defer documented) | GREEN | Decision / Env (B) |
| 6 | 12 件 banner の human closeout が完了している (12 real Gemini outputs, 70% threshold, prohibited-expression check, @media print check) | **GREEN** — 75% (9/12 Pass), WARN 4件 ACCEPTED, prohibited-expr CLEAR, @media print CONFIRMED (2026-03-23) | Human closeout (H) |
| 7 | current MVP regression がない | GREEN | Automated (T) |

---

## Acceptance Baseline Decision

- **Formal gate: 12 fixtures / 70% threshold (9/12 Pass)**
- Rationale: 12 fixtures exist (`banner_review_input_01` ~ `12`). No plan or timeline to create remaining 8
- This is an explicit rebaseline, not a silent downgrade
- Updated in: implementation-master-plan.md, execution-plan.md, internal-alpha-checklist.md, human-review-scorecard.md, refactor-smoke-checklist.md, pack-b-readiness-snapshot.md

---

## PDF Classification

- **Classification: EXPLICIT DEFER (not Pack A engineering blocker)**
- Code: implemented and tested (503 graceful fallback verified via TestClient)
- Blocker: WeasyPrint requires GTK3 system libraries, unavailable on current Windows env
- Resolution path: verify on Linux/Mac deployment environment or install GTK3
- This is NOT green — it is truthfully deferred with documented reason
- PDF verification moves to deployment-time or staging-environment verification outside Pack A engineering closeout

---

## Real Gemini Classification

- **Classification: 12/12 PROBED (2026-03-23)**
- Script: `scripts/run_acceptance_probe.py` — repaired and production-aligned (2026-03-23)
- Results: 8 PASS, 4 WARN (evidence grounding soft warning only — 「ベストプラクティス」表現), 0 ERROR, 0 SKIPPED
- Prohibited-expression machine precheck: automated regex 12/12 CLEAN (not a substitute for human review of real outputs)
- `@media print` machine precheck: CSS rule present in template + exported HTML (not a substitute for human visual print confirmation)
- 4 WARN cases (banner_01, 04, 07, 12) flagged vague evidence source「ベストプラクティス」— requires human adjudication
- Human-only gates: **ALL COMPLETE** (2026-03-23) — 5-axis scoring done (9 Pass / 3 Fail), WARN 4/4 ACCEPTED, prohibited-expr CLEAR, @media print CONFIRMED, formal sign-off recorded

---

## Engineering Boundary Summary (3 lines)

1. All code paths are implemented, tested (306 pass), and browser-smoke automated (12/12 PASS)
2. PDF export code is complete; local verification is env-blocked (WeasyPrint/GTK3), and the disposition is fixed as explicit defer
3. Acceptance probe script is repaired and 12/12 probes executed (8 PASS, 4 WARN); human judgment work (scoring, WARN adjudication, print visual, sign-off) was completed 2026-03-23 — no remaining work

---

## Human Closeout Checklist

| # | Task | Type | Input | Output |
|---|------|------|-------|--------|
| 1 | ~~Run remaining 11 Gemini probes~~ | ~~Human + API~~ | — | **DONE** 12/12 probed (2026-03-23) |
| 2 | ~~Score 12 reviews using 5-axis rubric~~ | ~~Human-only~~ | `human-review-scorecard.md` | **DONE** — 9 Pass / 3 Fail, 75% acceptance (2026-03-23) |
| 3 | ~~Adjudicate 4 WARN cases (evidence grounding: 「ベストプラクティス」)~~ | ~~Human-only~~ | `banner_01/04/07/12_review.json` | **DONE** — 4/4 ACCEPTED (2026-03-23) |
| 4 | ~~Review prohibited expressions in all 12 real outputs~~ | ~~Human-only~~ | `banner_XX_review.json` files | **DONE** — CLEAR (2026-03-23) |
| 5 | ~~Visually confirm `@media print` layout in HTML one-pager~~ | ~~Human-only~~ | Browser print preview | **DONE** — CONFIRMED (2026-03-23) |
| 6 | ~~Record closeout result and sign off Pack A formal-complete~~ | ~~Human-only~~ | Scorecard + checklist | **DONE** — Formal-complete signed off (2026-03-23) |

PDF disposition is already fixed as explicit defer. It is not part of the remaining Pack A closeout checklist.

---

## Decision Matrix

| Question | Answer |
|----------|--------|
| Pack A implementation-complete | **YES** |
| Pack A formal-complete | **YES** (2026-03-23) |
| Pack A can close without more engineering | **YES** |
| Pack A blocked by product decision | **NO** |
| Pack B ready-for-kickoff-planning | **YES** (Pack A formal-complete achieved; user go-ahead given 2026-03-23) |
| Pack B implementation start | **NO** (explicit user go-ahead for implementation not yet given) |

---

## Outcome

**Outcome C: Pack A Formal-Complete**

- All exit criteria met: 75% acceptance (9/12 Pass), WARN 4/4 ACCEPTED, prohibited-expr CLEAR, @media print CONFIRMED
- PDF remains EXPLICIT DEFER (env blocker, not Pack A blocker)
- Pack B kickoff-planning is ready; Pack B implementation start requires separate user go-ahead

---

## Gate Judgments

| Gate | Status | Evidence |
|------|--------|----------|
| Gate-ED1 (Criteria Freeze) | **GREEN** | Acceptance baseline 12 fixtures, singular across all docs |
| Gate-ED2 (Machine Residual) | **GREEN** | Engineering boundary frozen, PDF disposition fixed, remaining work limited to human closeout |
| Gate-ED3 (Exit Decision) | **GREEN** | Decision explicit, no premature green, Pack B not started |
