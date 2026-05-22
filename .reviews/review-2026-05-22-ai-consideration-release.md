<!-- codex-review -->
## Review: AI consideration evidence pack and ads graphs release

- Date: 2026-05-22 16:30
- Mode: Plan / Diff / Runtime / Release
- Verdict: PASS

### Critical
- None.

### Major
- None.

### Minor
- FIND-001: `multi_agent_v1` defaults to deterministic staged agents for speed and grounding. Independent multi-LLM stages exist behind `MULTI_AGENT_LLM_STAGES=1`, so production quality should be compared again if that flag is enabled.
- FIND-002: The in-app Codex browser blocked local URLs with `ERR_BLOCKED_BY_CLIENT`; release verification used real Playwright Chromium against the same local app instead.

### Required Fixes
1. No blocking fixes remain for this release.

### Evidence
- Command: `npm test -- adsReports.test.js adsResponse.test.js InsightTurnCard.test.jsx ChartGroupCard.test.jsx`
- Result: 4 files passed, 65 tests passed.
- Command: `python -m pytest backends\ads-insights\tests\test_v39_inference.py backends\ads-insights\tests\test_bq_periods_and_batch_summary.py -q`
- Result: 15 tests passed.
- Command: `python -m py_compile backends\ads-insights\web\app\backend_api.py backends\ads-insights\web\app\bq_chart_builder.py`
- Result: passed.
- Command: `npm run build`
- Result: passed with existing Vite chunk-size warning only.
- Command: `node tmp\verify-ai-consideration-flow.mjs`
- Result: passed. Verified five consecutive AI questions, date alias consistency between `20260507` and `2026年5月7日`, evidence-table values, Review Agent status, forbidden KPI suppression, and fixed right-column graph AI rail.
