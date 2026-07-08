# Fix Plan: Discovery Error Handling Chain - Complete Error Analysis

**Date:** 2026-04-15  
**Status:** Plan Mode (Read-Only Analysis)  
**Context:** insight-studio repo error handling chain audit

---

## Executive Summary

The error handling chain spans three critical files with tight integration:
1. **src/api/marketLens.js** - Core fetch wrapper with auto-retry logic
2. **src/pages/Discovery.jsx** - Discovery job submission with Promise.race timeout
3. **src/pages/Compare.jsx** - Compare scan submission with timeout recovery

The main issue is **asymmetric warmup logic**: Discovery uses `Promise.race([warmup + submit, 60s timeout])` while Compare uses `await warmMarketLensBackend()` separately. This creates different error classifications and recovery paths.

---

## Part 1: Core Error Handling Infrastructure (marketLens.js)

### A. Configuration & Constants

**SHOULD_FORCE_PROXY Logic** (Line 12):
```javascript
const SHOULD_FORCE_PROXY = isLocalBrowserOrigin()
const BASE = SHOULD_FORCE_PROXY || !DIRECT_MARKET_LENS_ORIGIN
  ? '/api/ml'
  : `${DIRECT_MARKET_LENS_ORIGIN}/api`
const DIRECT_BACKEND_BASE = DIRECT_MARKET_LENS_ORIGIN
  ? `${DIRECT_MARKET_LENS_ORIGIN}/api`
  : 'https://market-lens-ai.onrender.com/api'
```

**Timeout Constants:**
- `LONG_ANALYSIS_TIMEOUT = 240000` (240s)
- `CREATIVE_UPLOAD_TIMEOUT = 90000` (90s)
- `PRE_POLL_TIMEOUT_MS = 60000` (Discovery warmup+submit cap)

**Retry Configs:**
- `DISCOVERY_JOB_RETRY_COUNT = 2` with delays `[2000, 5000]`
- `SCAN_AUTO_RETRY_COUNT = 2` with delays `[2000, 5000]`
- `REVIEW_AUTO_RETRY_COUNT = 2` with delays `[1500, 4000]`

### B. Backend Readiness System

**State Variables** (Lines 25-31):
```javascript
let _directBackendReady = false          // Cache: direct backend is up
let _directBackendWarmPromise = null    // Ongoing warmup promise
let _warmingUp = false                  // Currently pinging health
let _lastPingAt = null                  // Last successful ping time
const _readinessListeners = new Set()   // UI subscribers
```

**ensureDirectBackend()** (Lines 574-614):
- Checks `_directBackendReady` cache first
- If warming, returns cached promise to prevent duplicate work
- Retries health check 3 times: immediate, +5s, +10s
- Uses `AbortSignal.timeout(30000)` on fetch
- Sets `_directBackendReady = true` only on 200 OK
- Caches result in `_directBackendWarmPromise`
- Returns boolean (true/false)

**warmMarketLensBackend()** (Lines 616-619):
```javascript
export function warmMarketLensBackend() {
  if (SHOULD_FORCE_PROXY) return Promise.resolve(true)
  return ensureDirectBackend()
}
```
- Public entry point for warmup
- Bypasses if using proxy (always returns true)
- Returns Promise<boolean>

### C. Core Fetch Wrapper: requestJson()

**Signature** (Lines 621-708):
```javascript
async function requestJson(path, options = {}) {
  const {
    timeout = 30000,
    direct = false,           // Use DIRECT_BACKEND_BASE?
    directStrategy = 'verified',  // 'optimistic' or 'verified'
    allowProxyFallback = true,    // Fall back to proxy on direct failure?
    _retried = false,
  } = options
```

**Base URL Selection Logic**:
- If `direct=false` → use `BASE` (proxy or direct, based on SHOULD_FORCE_PROXY)
- If `direct=true` AND `SHOULD_FORCE_PROXY=true` → use `BASE` (proxy)
- If `direct=true` AND `directStrategy='optimistic'` → use DIRECT_BACKEND_BASE immediately
- If `direct=true` AND `directStrategy='verified'` → call `ensureDirectBackend()` first
  - If ready → use DIRECT_BACKEND_BASE
  - If not ready AND `allowProxyFallback=true` → use BASE
  - If not ready AND `allowProxyFallback=false` → use DIRECT_BACKEND_BASE anyway

**Network Error Handling** (Lines 655-675):
```javascript
catch (e) {
  clearTimeout(timeoutId)
  if (direct && !_retried && isFetchNetworkError(e)) {
    if (usingDirectBackend) {
      _directBackendReady = false  // Mark backend as down
    }
    // Retry with verified strategy to re-check backend
    return requestJson(path, {
      ...,
      directStrategy: 'verified',
      allowProxyFallback,
      _retried: true,
    })
  }
  if (e.name === 'AbortError') throw createTimeoutError(path)
  if (isFetchNetworkError(e)) {
    throw new Error(buildBackendConnectionErrorMessage(...))
  }
  throw e
}
```

**502/503 Handling During Optimistic Direct** (Lines 681-696):
```javascript
if (
  usingDirectBackend &&
  directStrategy === 'optimistic' &&
  !_retried &&
  (res.status === 502 || res.status === 503)
) {
  _directBackendReady = false  // Backend is recovering
  return requestJson(path, {
    ...,
    directStrategy: 'verified',  // Re-verify before retry
    allowProxyFallback,
    _retried: true,
  })
}
```

**Error Enrichment** (Lines 698-706):
```javascript
if (!res.ok) {
  const body = await res.json().catch(() => ({}))
  const error = new Error(buildErrorMessage(path, res.status, body))
  error.status = res.status
  error.body = body
  error.path = path
  error.stage = extractStage(body?.detail)  // Discovery stage label
  throw error
}
```

### D. Auto-Retry Wrappers

**requestDiscoveryJobWithRetry()** (Lines 387-413):
- Retries up to 2 times on retryable errors
- Uses `direct: true, directStrategy: attempt === 0 ? 'optimistic' : 'verified'`
- `allowProxyFallback: true` — falls back to proxy on direct failure
- Delays: `[2000, 5000]` ms
- Checks `isDiscoveryRetryableError()` (Lines 317-352)

**requestScanWithRetry()** (Lines 420-460):
- Retries up to 2 times
- Uses `direct: true, directStrategy: 'optimistic'`
- **Key: `allowProxyFallback: false`** — does NOT fall back to proxy
- Timeout: `LONG_ANALYSIS_TIMEOUT` (240s)
- Timeout handling: If timeout on attempt 0, marks backend down and retries. If attempt 1, breaks.
- Delays: `[2000, 5000]` ms

**requestDiscoveryAnalyzeWithRetry()** (Lines 354-380):
- Retries up to 2 times
- Uses `direct: true, directStrategy: 'optimistic'`
- **Key: `allowProxyFallback: false`** — no proxy fallback
- Timeout: `LONG_ANALYSIS_TIMEOUT` (240s)
- Delays: `[1500, 4000]` ms

### E. Error Classification

**classifyError()** (Lines 131-195):
Categorizes errors into UI-presentable types:

| Error Type | Category | Conditions | Retryable |
|-----------|----------|-----------|-----------|
| Timeout | `timeout` | `isTimeout`, `AbortError`, msg contains "timeout" | ✅ |
| Cold Start | `cold_start` | Status 503 or msg contains "起動中" | ✅ |
| Network | `network` | `TypeError`, CORS, "failed to fetch" | ✅ |
| Auth | `auth_error` | Status 401/403 | ❌ |
| Not Found | `not_found` | Status 404 | ❌ |
| LLM Parse | `upstream` | Msg contains "llm output parse" | ✅ |
| Invalid Input | `invalid_input` | Status 400/422 | ❌ |
| Rate Limit | `rate_limit` | Status 429 | ✅ |
| Overloaded | `overloaded` | Status 529 or "overloaded" | ✅ |
| Backend Error | `upstream` | Status 500/502 | ✅ |
| Unknown | `unknown` | Everything else | ✅ |

---

## Part 2: Discovery Job Submission (Discovery.jsx)

### A. handleDiscover Flow (Lines 684-774)

**Setup Phase**:
```javascript
const handleDiscover = useCallback(async () => {
  console.info('[Discovery] handleDiscover start', { url, provider })
  
  // Validate auth
  if (!analysisKey || !analysisProvider) {
    failRun('discovery', 'APIキーまたはプロバイダーが...', {
      category: 'auth_error', label: '設定不足', retryable: false,
    })
    return
  }
  
  stopPolling()
  startRun('discovery', { url })
  resubmitCountRef.current = 0
  
  const requestOptions = {
    apiKey: analysisKey,
    provider: analysisProvider,
    model: getAnalysisModel(analysisProvider),
  }
  submitOptionsRef.current = { url, requestOptions }
  
  const PRE_POLL_TIMEOUT_MS = 60_000  // ← KEY: 60s cap
```

**Promise.race Implementation** (Lines 708-736):
```javascript
try {
  updateRunMeta('discovery'
