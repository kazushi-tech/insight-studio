# Deploy: Discovery Analyzer Token Pressure Reduction
**Date:** 2026-04-05 | **Scope:** backend-only | **Branch:** main

---

## Release Note

Site data fields truncated (body 2000->800, features<=5, FAQ<=3, testimonials<=2, CTAs<=3).
Analyzer prompt instructions compressed. New INFO log `prompt_size` per `analyze()` call.

No changes to async job contract, routing, provider selection, or frontend.

---

## Render Deployment

| Item | Value |
|------|-------|
| Commit | `<sha>` |
| Target | Render web service |
| Env changes | none |
| Migration | none |
| Downtime | zero expected |
| Watch | Render logs for `prompt_size prompt_type=` |

---

## Post-Deploy Verification

- [ ] Health-check returns new commit SHA
- [ ] `POST /api/discovery/jobs` -> `202` + `job_id`
- [ ] `GET /api/discovery/jobs/{job_id}` -> `status=completed`, `result.report_md` non-empty
- [ ] `render-probe` pass
- [ ] `render-5` pass (see judgement below)
- [ ] Render logs contain `prompt_size prompt_type=comparison` with `prompt_chars`
- [ ] Spot-check 1 report: 総合サマリー / tables / ファーストビュー / A-D rating
- [ ] Record observed `prompt_chars` baseline
- [ ] Optional: single-URL path emits `prompt_size prompt_type=lp`

---

## Rollback

```bash
git revert <sha> && git push
```

Scope: `web/app/analyzer.py`, `tests/test_analyzer.py`
No migration, schema, contract, or frontend rollback.
Trigger: verification steps 1-4 fail, or `render-5` FAIL.

---

## render-5 Judgement

**Baseline (2026-04-05):** `3/5` pass, dominant failure = `analyze 429`.

|  | Criteria |
|------|----------|
| PASS | completed >= `3/5`, `429` flat or lower, no new `500`-class error, report shape intact |
| FAIL | completed < `3/5`, `429` clearly worse, new `500` in `>=2` runs, or report format regresses |

On FAIL: rollback -> capture logs -> file incident note.
`prompt_size` values are observational, not a fail trigger.
