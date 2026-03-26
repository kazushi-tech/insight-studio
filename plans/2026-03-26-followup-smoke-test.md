# Market Lens Follow-up — Live Smoke Test Results

**Date:** 2026-03-26T14:05+09:00
**Backend:** market-lens-ai.onrender.com

## Endpoint Results

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/api/health` | GET | 200 | OK |
| `/api/scans` | GET | 200 | Returns empty array (no prior scans) |
| `/api/scan` | POST | 200 | Full report returned with `report_md` |
| `/api/discovery/analyze` | POST | 502 | SSL error on example.com — expected for test URL |

## Confirmed Response Shape: POST /api/scan

```json
{
  "run_id": "8f8225ee7830",
  "status": "completed",
  "report_md": "# Market Lens AI — ...",
  "total_time_sec": 18.9,
  "error": null
}
```

**Key finding:** `scores`, `overall_score`, `extracted` are **NOT present** in the response.
This validates the Compare UI redesign — `report_md` is the only meaningful display content.

## Build

- `npm run build` — SUCCESS (406ms, 323.49 kB JS gzip 92.71 kB)

## Route Validation Summary

| Route | State | Behavior |
|-------|-------|----------|
| `/` (Dashboard) | success | Shows scan history table |
| `/` (Dashboard) | empty | "分析履歴がまだありません" |
| `/` (Dashboard) | error | Red error banner with message |
| `/compare` | success | report_md displayed, score panel hidden (no scores in response) |
| `/compare` | error | Red error banner |
| `/compare` | no key | Amber warning + submit disabled |
| `/discovery` | success | Competitor list rendered |
| `/discovery` | error | Error message from API |
| `/ads/ai` | ML ready | "履歴接続済" indicator |
| `/ads/ai` | ML unavailable (404) | "連携停止中" + fallback message |
| `/ads/ai` | ML error (500/timeout) | "読込失敗" + fallback message |
| `/creative-review` | always | Clean unavailable page with alternatives |

## Acceptance Criteria Check

- [x] Dashboard does NOT swallow 404 as empty state
- [x] AiExplorer distinguishes 404 (unavailable) from other failures (error)
- [x] Compare displays report_md as primary content, no `--` KPI panel
- [x] CreativeReview is consistently unavailable with no dead code
- [x] api_key: UI-mandatory, backend-optional — documented as intentional
- [x] `npm run build` passes
- [x] Live smoke test recorded
