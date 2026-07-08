# Discovery Claude-Only Render Log Confirmation (2026-04-05 JST)

Render service:
- `market-lens-ai` Production

Observed at (JST):
- 2026-04-05 10:22–10:24 AM (from Render Dashboard screenshots)

Live commit:
- `87e0f6a8473f32052cb9a5b6554c353b79d13e40` (health check confirmed)
- Commit message: `fix: retry transient Anthropic discovery failures`

Startup snapshot (from live pipeline logs):
- `anthropic_analysis_model=claude-sonnet-4-6`
- `anthropic_discovery_search_model=claude-sonnet-4-6`
- `anthropic_discovery_search_tool=web_search_20250305`
- `anthropic_discovery_classify_model=claude-sonnet-4-6` (inferred: `classify_industry` calls `call_anthropic`)
- `default_analysis_provider=anthropic`

Additional observed values:
- `max_uses=4`
- `timeout_sec=25.0`
- `fallback_models=1`
- `deadline_remaining_sec=73.0`

Decision:
- Discovery Claude-only rollout complete: **yes**

Evidence:
1. ✅ All Discovery pipeline stages route through `call_anthropic` (no Gemini calls)
2. ✅ `tool_type=web_search_20250305` confirmed in search stage logs
3. ✅ `classify_industry` stage uses `call_anthropic` (`anthropic_client.py:217`)
4. ✅ No `provider=google` or `gemini` references in Discovery logs
5. ✅ Async job + polling (`GET /api/discovery/jobs/{id}`) is live
6. ✅ Live commit `87e0f6a` includes retry logic for transient failures

Notes:
- 429 `rate_limit_error` observed (30,000 input tokens/min org limit)
  - Anthropic Search retries are working (attempt=1→2→3)
  - Final timeout at `stage=search` after `elapsed_ms=75000.3`
  - This is an org rate-limit issue, not a Discovery routing issue
- No Gemini discovery-related log was seen
- Async job polling confirmed working (multiple `200 OK` poll responses)
- Free-tier banner present: "spin down with inactivity, delays up to 50 seconds"
