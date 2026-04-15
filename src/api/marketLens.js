// Prefer the same-origin proxy during local browser runs to avoid CORS drift
// between localhost/127.0.0.1/preview origins and the Render backend.
const DIRECT_MARKET_LENS_ORIGIN =
  import.meta.env.VITE_MARKET_LENS_API_ORIGIN?.replace(/\/$/, '') || ''

function isLocalBrowserOrigin() {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

const SHOULD_FORCE_PROXY = isLocalBrowserOrigin()
const BASE = SHOULD_FORCE_PROXY || !DIRECT_MARKET_LENS_ORIGIN
  ? '/api/ml'
  : `${DIRECT_MARKET_LENS_ORIGIN}/api`
// Vercel rewrite proxy has a ~60s hard timeout. Long-running endpoints
// (discovery/analyze, scan) must bypass the proxy and hit Render directly.
const DIRECT_BACKEND_BASE = DIRECT_MARKET_LENS_ORIGIN
  ? `${DIRECT_MARKET_LENS_ORIGIN}/api`
  : 'https://market-lens-ai.onrender.com/api'
const LONG_ANALYSIS_TIMEOUT = 240000
const CREATIVE_UPLOAD_TIMEOUT = 90000
const DISCOVERY_AUTO_RETRY_COUNT = 2
const DISCOVERY_AUTO_RETRY_DELAYS_MS = [1500, 4000]
let _directBackendReady = false
let _directBackendWarmPromise = null
let _warmingUp = false
let _lastPingAt = null
const _readinessListeners = new Set()

let _readinessSnapshot = { ready: false, warming: false }

function _notifyReadiness() {
  _readinessSnapshot = { ready: _directBackendReady, warming: _warmingUp }
  for (const cb of _readinessListeners) {
    try { cb() } catch { /* swallow */ }
  }
}

export function getBackendReadinessSnapshot() {
  return _readinessSnapshot
}

export function subscribeBackendReadiness(callback) {
  _readinessListeners.add(callback)
  return () => _readinessListeners.delete(callback)
}

// ─── Keep-Alive Ping System ────────────────────────────────
const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000 // 10 min
let _keepAliveTimer = null
let _visibilityHandler = null

function _pingHealth() {
  _warmingUp = true
  _notifyReadiness()
  fetch(`${DIRECT_BACKEND_BASE}/health`, { method: 'GET', signal: AbortSignal.timeout(30000) })
    .then((res) => {
      if (res.ok) {
        _directBackendReady = true
        _lastPingAt = Date.now()
      } else {
        console.warn('[MarketLens] Health ping non-OK:', res.status)
        _directBackendReady = false
      }
    })
    .catch((err) => {
      console.warn('[MarketLens] Health ping failed:', err?.message || err)
      _directBackendReady = false
    })
    .finally(() => {
      _warmingUp = false
      _notifyReadiness()
    })
}

export function startBackendKeepAlive() {
  if (SHOULD_FORCE_PROXY) {
    _directBackendReady = true
    _notifyReadiness()
    return
  }
  // Initial ping
  _pingHealth()
  _keepAliveTimer = setInterval(_pingHealth, KEEP_ALIVE_INTERVAL_MS)

  _visibilityHandler = () => {
    if (document.hidden) {
      // Tab hidden — stop interval
      if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null }
    } else {
      // Tab visible — ping if stale, restart interval
      if (!_lastPingAt || Date.now() - _lastPingAt > KEEP_ALIVE_INTERVAL_MS) {
        _pingHealth()
      }
      if (!_keepAliveTimer) {
        _keepAliveTimer = setInterval(_pingHealth, KEEP_ALIVE_INTERVAL_MS)
      }
    }
  }
  document.addEventListener('visibilitychange', _visibilityHandler)
}

export function stopBackendKeepAlive() {
  if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null }
  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler)
    _visibilityHandler = null
  }
}
const STORAGE_KEY_ADS_TOKEN = 'is_ads_token'
const STORAGE_KEY_CLIENT_ID = 'insight-studio-client-id'
const STORAGE_KEY_MARKET_LENS_PROFILE_ID = 'insight-studio-market-lens-profile-id'
const STORAGE_KEY_MARKET_LENS_SCAN_HISTORY_PREFIX = 'insight-studio-market-lens-scan-history'

const DISCOVERY_STAGE_LABELS = {
  brand_fetch: 'ブランドURL取得',
  search: '競合検索',
  fetch_competitors: '競合サイト取得',
  analyze: '比較分析',
}

// ─── Error Classification ────────────────────────────────────

/**
 * Classify a caught error into a UI-presentable category.
 * Works with both plain Error (network/CORS) and enhanced errors from requestJson.
 * @param {Error} error
 * @returns {{ category: string, label: string, guidance: string, retryable: boolean }}
 */
export function classifyError(error) {
  if (!error) return { category: 'unknown', label: 'エラー', guidance: '予期しないエラーが発生しました。', retryable: true }

  const status = error.status
  const msg = (error.message || '').toLowerCase()

  // Timeout / AbortError
  if (error.isTimeout || error.name === 'AbortError' || msg.includes('タイムアウト') || msg.includes('timeout')) {
    return { category: 'timeout', label: 'タイムアウト', guidance: 'サーバーが起動中だった場合、再試行すると高速に完了します。', retryable: true }
  }

  // Cold start (503)
  if (status === 503 || msg.includes('起動中')) {
    return { category: 'cold_start', label: 'サーバー起動中', guidance: 'バックエンドが起動中です。1〜2分後に再試行してください。', retryable: true }
  }

  // CORS / network / connection failure
  if (
    msg.includes('接続できませんでした') ||
    msg.includes('cors') ||
    msg.includes('failed to fetch') ||
    (error instanceof TypeError && !status)
  ) {
    return { category: 'network', label: 'ネットワークエラー', guidance: 'バックエンドへの接続に失敗しました。ネットワーク状態またはバックエンドの起動状態を確認してください。', retryable: true }
  }

  // Auth error
  if (status === 401 || status === 403) {
    return { category: 'auth_error', label: '認証エラー', guidance: 'API キーが無効または権限が不足しています。設定を確認してください。', retryable: false }
  }

  // Not found
  if (status === 404) {
    return { category: 'not_found', label: 'リソース未検出', guidance: '指定されたリソースまたはエンドポイントが見つかりません。', retryable: false }
  }

  // LLM output parse/validation errors (retryable — transient formatting issue)
  // NOTE: Must precede 422/400 check so that LLM parse errors arriving as 422 are not misclassified as input errors
  if (msg.includes('llm output parse') || msg.includes('json parse error') || msg.includes('output validation failed')) {
    return { category: 'upstream', label: 'AI出力解析エラー', guidance: 'AIの出力フォーマットが想定と異なりました。再試行してください。', retryable: true }
  }

  // Invalid input (422, 400)
  if (status === 422 || status === 400) {
    return { category: 'invalid_input', label: '入力エラー', guidance: '入力内容またはリクエスト形式を確認してください。', retryable: false }
  }

  // Rate limit
  if (status === 429) {
    return { category: 'rate_limit', label: '利用制限', guidance: '利用制限に達しました。しばらく待って再試行してください。', retryable: true }
  }

  // Claude API overloaded (529)
  if (status === 529 || msg.includes('overloaded')) {
    return { category: 'overloaded', label: 'AI一時過負荷', guidance: 'AIサービスが一時的に混み合っています。数分後に再試行してください。', retryable: true }
  }

  // Upstream / backend server error
  if (status === 500 || status === 502) {
    return { category: 'upstream', label: 'バックエンドエラー', guidance: 'サーバー側でエラーが発生しました。しばらく待って再試行してください。', retryable: true }
  }

  // Generic fallback
  return { category: 'unknown', label: 'エラー', guidance: '予期しないエラーが発生しました。', retryable: true }
}

function resolveAiOptions(optionsOrApiKey) {
  if (typeof optionsOrApiKey === 'string') {
    return { apiKey: optionsOrApiKey }
  }
  return optionsOrApiKey || {}
}

function extractStage(detail) {
  if (!detail) return null
  const match = detail.match(/stage=(\w+)/)
  return match ? match[1] : null
}

function stripStageMarker(detail) {
  if (typeof detail !== 'string') return detail
  return detail
    .replace(/\s*\(stage=\w+\)\s*/gi, ' ')
    .replace(/\bstage=\w+\b[:：]?\s*/gi, '')
    .replace(/\s+:/g, ':')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Strip raw provider error prefixes that should never reach the user. */
function stripRawProviderPrefixes(msg) {
  if (typeof msg !== 'string') return msg
  return msg
    .replace(/^Anthropic Search error:\s*/i, '')
    .replace(/^Anthropic web search error:\s*/i, '')
    .replace(/^Anthropic error:\s*/i, '')
    .trim()
}

function buildErrorMessage(path, status, body) {
  const detail = body?.detail
  const cleanedDetail = stripStageMarker(detail)
  const normalizedDetail = typeof cleanedDetail === 'string' ? cleanedDetail.toLowerCase() : ''

  // Discovery stage-aware error mapping
  if (path.includes('/discovery')) {
    const stage = extractStage(detail)
    const stageLabel = stage ? DISCOVERY_STAGE_LABELS[stage] || stage : null

    if (status === 400) {
      if (normalizedDetail.includes('claude api key is required for discovery search')) {
        return '競合発見の検索設定が不足しています。サーバー側の Claude 設定または分析用 API キーを確認してください。'
      }
      return cleanedDetail || '競合発見の実行条件が不足しています。分析用 Claude API キーとサーバー側設定を確認してください。'
    }
    if (status === 401) {
      if (normalizedDetail.includes('api key')) {
        return '競合発見で使用する Claude API キーが無効です。分析用 Claude API キー、またはサーバー側設定を確認してください。'
      }
      return cleanedDetail || '競合発見の認証に失敗しました。API キー設定を確認してください。'
    }
    if (status === 404) return cleanedDetail || '競合サイトが見つかりませんでした。別のURLで試してください。'
    if (status === 422) return cleanedDetail || 'URLの形式が正しくありません。'
    if (status === 429) return '本日の検索上限に達しました。明日再度お試しください。'
    if (status === 500 && stageLabel) return `${stageLabel}でサーバーエラーが発生しました。しばらく待って再試行してください。`
    if (status === 500 && normalizedDetail.startsWith('internal server error')) {
      return `Discovery バックエンドで内部エラーが発生しました。サーバーログを確認してください。(${cleanedDetail})`
    }
    if (status === 500) return cleanedDetail || 'バックエンドでサーバーエラーが発生しました。対象サイトの構造が複雑か、一時的な負荷の可能性があります。しばらく待って再試行してください。'
    if (status === 502 && stageLabel) return `${stageLabel}で失敗しました。${stripRawProviderPrefixes(cleanedDetail)}`
    if (status === 502) return stripRawProviderPrefixes(cleanedDetail) || '競合分析パイプラインでエラーが発生しました。'
    if (status === 503) return 'バックエンドサーバーが起動中です。1〜2分待って再試行してください。'
    if (cleanedDetail) return stripRawProviderPrefixes(cleanedDetail)
    return `Discovery API error: ${status}`
  }

  if (cleanedDetail) return cleanedDetail

  if (status === 404) {
    if (path.includes('/assets')) return 'アセットが見つかりません。再アップロードしてください。'
    return `Market Lens API endpoint ${path} が見つかりません。`
  }

  if (status === 409) {
    return '画像がまだ準備できていません。しばらくお待ちください。'
  }

  if (status === 422) {
    if (path.includes('/assets')) return 'アップロードされたファイルが不正です。PNG/JPG画像を選択してください。'
    if (path.includes('/reviews')) return 'レビューリクエストが不正です。入力内容を確認してください。'
    return 'リクエストの形式が正しくありません。入力内容を確認してください。'
  }

  if (status === 500) return detail || 'バックエンドでサーバーエラーが発生しました。しばらく待って再試行してください。'
  if (status === 529) return 'AIサービスが一時的に混み合っています。数分後に再試行してください。'
  if (status === 503) return 'バックエンドサーバーが起動中です。1〜2分待って再試行してください。'

  return `Market Lens API error: ${status}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isFetchNetworkError(error) {
  return error instanceof TypeError || /Failed to fetch/i.test(String(error?.message))
}

function buildBackendConnectionErrorMessage(usingDirectBackend) {
  return usingDirectBackend
    ? 'Market Lens backend に接続できませんでした。CORS 設定またはバックエンドの起動状態を確認してください。'
    : 'Market Lens backend に接続できませんでした。しばらく待って再試行してください。'
}

function createTimeoutError(path) {
  const isLongAnalysisPath = path === '/scan' || path === '/discovery/analyze'
  const error = new Error(
    isLongAnalysisPath
      ? '分析がタイムアウトしました。サーバーが起動中だった場合、再試行すると高速に完了します。'
      : 'リクエストがタイムアウトしました。ネットワーク接続を確認してください。',
  )
  error.isTimeout = true
  error.path = path
  return error
}

function isDiscoveryRetryableError(error) {
  const status = Number(error?.status || 0)
  const stage = typeof error?.stage === 'string' ? error.stage.toLowerCase() : ''
  const msg = String(error?.message || '').toLowerCase()

  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422 || status === 429) {
    return false
  }

  if (status === 502 || status === 503) {
    return true
  }

  if (status === 500) {
    if (msg.includes('unicodeerror') || msg.includes('internal server error') || msg.includes('overloaded') || msg.includes('529')) return true
    if (stage === 'search' || stage === 'analyze') return true
  }

  if (status === 529) return true

  if (error?.isTimeout || error?.name === 'AbortError' || msg.includes('タイムアウト') || msg.includes('timeout')) {
    return true
  }

  if (
    msg.includes('起動中') ||
    msg.includes('接続できませんでした') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('cors')
  ) {
    return true
  }

  return false
}

async function requestDiscoveryAnalyzeWithRetry(payload) {
  let lastError = null

  for (let attempt = 0; attempt <= DISCOVERY_AUTO_RETRY_COUNT; attempt += 1) {
    try {
      return await requestJson('/discovery/analyze', {
        method: 'POST',
        body: JSON.stringify(payload),
        timeout: LONG_ANALYSIS_TIMEOUT,
        direct: true,
        directStrategy: 'optimistic',
        allowProxyFallback: false,
      })
    } catch (error) {
      lastError = error
      const shouldRetry =
        attempt < DISCOVERY_AUTO_RETRY_COUNT && isDiscoveryRetryableError(error)

      if (!shouldRetry) break

      _directBackendReady = false
      await sleep(DISCOVERY_AUTO_RETRY_DELAYS_MS[attempt] ?? 4000)
    }
  }

  throw lastError
}

// ─── Discovery Job auto-retry (cold-start / 502 / 503) ─────

const DISCOVERY_JOB_RETRY_COUNT = 2
const DISCOVERY_JOB_RETRY_DELAYS_MS = [2000, 5000]

async function requestDiscoveryJobWithRetry(payload) {
  let lastError = null

  for (let attempt = 0; attempt <= DISCOVERY_JOB_RETRY_COUNT; attempt += 1) {
    try {
      return await requestJson('/discovery/jobs', {
        method: 'POST',
        body: JSON.stringify(payload),
        timeout: 30000,
        direct: true,
        directStrategy: attempt === 0 ? 'optimistic' : 'verified',
        allowProxyFallback: false,
      })
    } catch (error) {
      lastError = error
      const shouldRetry =
        attempt < DISCOVERY_JOB_RETRY_COUNT && isDiscoveryRetryableError(error)

      if (!shouldRetry) break

      _directBackendReady = false
      await sleep(DISCOVERY_JOB_RETRY_DELAYS_MS[attempt] ?? 5000)
    }
  }

  throw lastError
}

// ─── Scan auto-retry (cold-start / 502 / 503) ───────────────

const SCAN_AUTO_RETRY_COUNT = 2
const SCAN_AUTO_RETRY_DELAYS_MS = [2000, 5000]

async function requestScanWithRetry(payload, options) {
  let lastError = null

  for (let attempt = 0; attempt <= SCAN_AUTO_RETRY_COUNT; attempt += 1) {
    try {
      return await requestJson('/scan', {
        method: 'POST',
        body: JSON.stringify(payload),
        timeout: LONG_ANALYSIS_TIMEOUT,
        direct: true,
        directStrategy: 'optimistic',
        // /scan routinely runs longer than the Vercel rewrite budget.
        // If direct Render access is temporarily unavailable, retry direct
        // after re-verifying backend readiness instead of degrading to proxy.
        allowProxyFallback: false,
        ...options,
      })
    } catch (error) {
      lastError = error
      const isTimeout = error?.isTimeout || error?.name === 'AbortError'
      if (isTimeout) {
        if (attempt === 0) {
          console.warn('[Compare] scan timeout on attempt 0, re-verifying backend')
          _directBackendReady = false
        } else {
          break
        }
      }
      const status = error.status || error.statusCode
      const retryable = isTimeout
        || [502, 503].includes(status)
        || isFetchNetworkError(error)
        || (status === 500 && /unicodeerror|internal server error|overloaded|529/i.test(error.message))
        || status === 529
      if (!retryable || attempt >= SCAN_AUTO_RETRY_COUNT) break
      _directBackendReady = false
      await sleep(SCAN_AUTO_RETRY_DELAYS_MS[attempt] ?? 5000)
    }
  }
  throw lastError
}

// ─── Creative Review auto-retry ──────────────────────────────

const REVIEW_AUTO_RETRY_COUNT = 2
const REVIEW_AUTO_RETRY_DELAYS_MS = [1500, 4000]

function isReviewRetryableError(error) {
  const status = Number(error?.status || 0)
  const msg = String(error?.message || '').toLowerCase()

  // Deterministic failures — never retry
  if (status === 400 || status === 401 || status === 402 || status === 403 || status === 404 || status === 422) return false

  if (msg.includes('llm output parse') || msg.includes('json parse error') || msg.includes('output validation failed')) return true

  if (status === 500 || status === 502 || status === 503 || status === 529) {
    // Provider auth/model/billing errors arriving as 502 should not be retried
    if (msg.includes('api キー') || msg.includes('api key') || msg.includes('権限')) return false
    if (msg.includes('モデル設定')) return false
    if (msg.includes('クレジット') || msg.includes('請求')) return false
    return true
  }

  if (msg.includes('overloaded')) return true

  if (error?.isTimeout || error?.name === 'AbortError' || msg.includes('timeout')) return true

  return false
}

function ensureMarketLensProfileId() {
  if (typeof window === 'undefined') return 'guest-unknown'

  let profileId = window.localStorage.getItem(STORAGE_KEY_MARKET_LENS_PROFILE_ID)
  if (profileId) return profileId

  profileId = window.localStorage.getItem(STORAGE_KEY_CLIENT_ID)
  if (!profileId) {
    profileId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    window.localStorage.setItem(STORAGE_KEY_CLIENT_ID, profileId)
  }

  window.localStorage.setItem(STORAGE_KEY_MARKET_LENS_PROFILE_ID, profileId)
  return profileId
}

function getCurrentHistoryScope() {
  if (typeof window === 'undefined') return ''

  const profileId = ensureMarketLensProfileId()
  const adsToken = window.localStorage.getItem(STORAGE_KEY_ADS_TOKEN)
  if (adsToken) {
    return `auth:${profileId}`
  }

  return `guest:${profileId}`
}

function getTrackedScanStorageKey() {
  return `${STORAGE_KEY_MARKET_LENS_SCAN_HISTORY_PREFIX}:${getCurrentHistoryScope()}`
}

function loadTrackedScanIds() {
  if (typeof window === 'undefined') return []

  try {
    const parsed = JSON.parse(window.localStorage.getItem(getTrackedScanStorageKey()) || '[]')
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string' && value.trim()) : []
  } catch {
    return []
  }
}

function saveTrackedScanIds(runIds) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(getTrackedScanStorageKey(), JSON.stringify(runIds.slice(0, 50)))
}

function rememberTrackedScan(runId) {
  if (!runId || typeof window === 'undefined') return

  const nextIds = [runId, ...loadTrackedScanIds().filter((value) => value !== runId)]
  saveTrackedScanIds(nextIds)
}

function filterTrackedScans(items) {
  if (!Array.isArray(items)) return []

  const trackedIds = new Set(loadTrackedScanIds())
  if (trackedIds.size === 0) return []

  return items.filter((item) => trackedIds.has(item?.run_id || item?.id))
}

async function resolveInsightUserHeader() {
  const scope = getCurrentHistoryScope()
  return scope ? { 'X-Insight-User': scope } : {}
}

async function buildRequestHeaders(customHeaders = {}) {
  const identityHeaders = await resolveInsightUserHeader()
  return { ...identityHeaders, ...customHeaders }
}

/**
 * JSON リクエスト用の共通 fetch wrapper。
 * Content-Type: application/json を自動付与する。
 */
/**
 * Wake up the Render backend (cold start) and verify CORS works.
 * Retries with backoff to survive deploys and cold starts.
 * Caches success so subsequent calls skip the check.
 */
async function ensureDirectBackend() {
  if (_directBackendReady) return true
  if (_directBackendWarmPromise) return _directBackendWarmPromise

  _warmingUp = true
  _notifyReadiness()

  _directBackendWarmPromise = (async () => {
    const RETRY_DELAYS = [0, 5000, 10000]
    for (let i = 0; i < RETRY_DELAYS.length; i++) {
      if (RETRY_DELAYS[i] > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]))
      }
      try {
        const res = await fetch(`${DIRECT_BACKEND_BASE}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        })
        if (res.ok) {
          _directBackendReady = true
          _lastPingAt = Date.now()
          _warmingUp = false
          _notifyReadiness()
          return true
        }
      } catch {
        // CORS failure or network error — retry
      }
    }
    _warmingUp = false
    _directBackendReady = false
    _notifyReadiness()
    return false
  })()

  try {
    return await _directBackendWarmPromise
  } finally {
    _directBackendWarmPromise = null
  }
}

export function warmMarketLensBackend() {
  if (SHOULD_FORCE_PROXY) return Promise.resolve(true) // proxy IS the warm path
  return ensureDirectBackend()
}

async function requestJson(path, options = {}) {
  const {
    timeout = 30000,
    direct = false,
    directStrategy = 'verified',
    allowProxyFallback = true,
    _retried = false,
    ...restOptions
  } = options
  let baseUrl = BASE
  const shouldUseDirect = direct && !SHOULD_FORCE_PROXY
  if (shouldUseDirect) {
    if (directStrategy === 'optimistic') {
      baseUrl = DIRECT_BACKEND_BASE
    } else {
      const ready = await ensureDirectBackend()
      baseUrl = ready || !allowProxyFallback
        ? DIRECT_BACKEND_BASE
        : BASE
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const usingDirectBackend = shouldUseDirect && baseUrl === DIRECT_BACKEND_BASE

  let res
  try {
    const headers = await buildRequestHeaders(restOptions.headers)
    res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...headers },
      ...restOptions,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeoutId)
    if (direct && !_retried && isFetchNetworkError(e)) {
      if (usingDirectBackend) {
        _directBackendReady = false
      }
      return requestJson(path, {
        timeout,
        direct,
        directStrategy: 'verified',
        allowProxyFallback,
        _retried: true,
        ...restOptions,
      })
    }
    if (e.name === 'AbortError') throw createTimeoutError(path)
    if (isFetchNetworkError(e)) {
      throw new Error(buildBackendConnectionErrorMessage(usingDirectBackend || Boolean(DIRECT_MARKET_LENS_ORIGIN)))
    }
    throw e
  }
  clearTimeout(timeoutId)
  if (usingDirectBackend) {
    _directBackendReady = true
  }

  if (
    usingDirectBackend &&
    directStrategy === 'optimistic' &&
    !_retried &&
    (res.status === 502 || res.status === 503)
  ) {
    _directBackendReady = false
    return requestJson(path, {
      timeout,
      direct,
      directStrategy: 'verified',
      allowProxyFallback,
      _retried: true,
      ...restOptions,
    })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error = new Error(buildErrorMessage(path, res.status, body))
    error.status = res.status
    error.body = body
    error.path = path
    error.stage = extractStage(body?.detail)
    throw error
  }
  return res.json()
}

/**
 * Raw リクエスト用 wrapper。Content-Type を自動付与しない。
 * multipart/form-data などブラウザに任せたい場合に使う。
 */
async function requestRaw(path, options = {}) {
  const {
    timeout = 60000,
    direct = false,
    directStrategy = 'verified',
    allowProxyFallback = true,
    _retried = false,
    ...restOptions
  } = options

  let baseUrl = BASE
  const shouldUseDirect = direct && !SHOULD_FORCE_PROXY
  if (shouldUseDirect) {
    if (directStrategy === 'optimistic') {
      baseUrl = DIRECT_BACKEND_BASE
    } else {
      const ready = await ensureDirectBackend()
      baseUrl = ready ? DIRECT_BACKEND_BASE : BASE
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const usingDirectBackend = shouldUseDirect && baseUrl === DIRECT_BACKEND_BASE

  let res
  try {
    const headers = await buildRequestHeaders(restOptions.headers)
    res = await fetch(`${baseUrl}${path}`, {
      headers,
      ...restOptions,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeoutId)
    if (usingDirectBackend && isFetchNetworkError(e)) {
      _directBackendReady = false
      if (!_retried && allowProxyFallback) {
        return requestRaw(path, {
          timeout,
          direct,
          directStrategy: 'verified',
          allowProxyFallback,
          _retried: true,
          ...restOptions,
        })
      }
    }
    if (e.name === 'AbortError') {
      throw new Error('アップロードがタイムアウトしました。ファイルサイズを確認してください。')
    }
    if (isFetchNetworkError(e)) {
      throw new Error(buildBackendConnectionErrorMessage(usingDirectBackend || Boolean(DIRECT_MARKET_LENS_ORIGIN)))
    }
    throw e
  }
  clearTimeout(timeoutId)
  if (usingDirectBackend) {
    _directBackendReady = true
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error = new Error(buildErrorMessage(path, res.status, body))
    error.status = res.status
    error.body = body
    error.path = path
    throw error
  }
  return res.json()
}

// ─── Scan / Discovery ────────────────────────────────────────

/** POST /api/scan — LP比較分析 */
export function scan(urls, optionsOrApiKey) {
  const { apiKey, provider, model } = resolveAiOptions(optionsOrApiKey)
  return requestScanWithRetry({
    urls,
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  }).then((data) => {
    rememberTrackedScan(data?.run_id)
    return data
  })
}

/** POST /api/discovery/analyze — 競合発見 Discovery (sync, legacy) */
export function discoveryAnalyze(url, optionsOrApiKey) {
  const { apiKey, provider, model, searchApiKey } = resolveAiOptions(optionsOrApiKey)
  return requestDiscoveryAnalyzeWithRetry({
    brand_url: url,
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(searchApiKey ? { search_api_key: searchApiKey } : {}),
  })
}

function normalizeDiscoveryPollPath(jobIdOrPollPath) {
  if (!jobIdOrPollPath || typeof jobIdOrPollPath !== 'string') return null
  if (jobIdOrPollPath.startsWith('http://') || jobIdOrPollPath.startsWith('https://')) {
    const url = new URL(jobIdOrPollPath)
    return `${url.pathname}${url.search}`
  }
  // Already a relative path like "/discovery/jobs/xxx"
  if (jobIdOrPollPath.startsWith('/discovery/')) return jobIdOrPollPath
  // Legacy: "/api/discovery/..." — strip /api prefix
  if (jobIdOrPollPath.startsWith('/api/discovery/')) return jobIdOrPollPath.slice(4)
  // Bare job ID
  return `/discovery/jobs/${jobIdOrPollPath}`
}

/** POST /api/discovery/jobs — 非同期ジョブ開始 */
export function startDiscoveryJob(url, optionsOrApiKey) {
  const { apiKey, provider, model, searchApiKey } = resolveAiOptions(optionsOrApiKey)
  return requestDiscoveryJobWithRetry({
    brand_url: url,
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(searchApiKey ? { search_api_key: searchApiKey } : {}),
  }).then((data) => ({
    ...data,
    poll_url: normalizeDiscoveryPollPath(data?.poll_url || data?.job_id),
    retry_after_sec: Number.isFinite(Number(data?.retry_after_sec)) && Number(data.retry_after_sec) > 0
      ? Number(data.retry_after_sec)
      : null,
  }))
}

/** GET /api/discovery/jobs/{jobId} — ジョブ状態ポーリング */
export async function getDiscoveryJob(jobIdOrPollPath) {
  try {
    return await requestJson(normalizeDiscoveryPollPath(jobIdOrPollPath), {
      timeout: 15000,
      direct: true,
      directStrategy: 'optimistic',
    })
  } catch (error) {
    // Reset backend readiness on network/server errors so next attempt re-verifies
    const status = Number(error?.status || 0)
    if (!status || status >= 500) {
      _directBackendReady = false
    }
    throw error
  }
}

/** GET /api/scans — スキャン履歴 */
export async function getScans(options = {}) {
  const { includeUntracked = false } = options
  const data = await requestJson('/scans')
  const items = data?.scans ?? data?.history ?? data?.results ?? (Array.isArray(data) ? data : [])
  const filteredItems = includeUntracked ? items : filterTrackedScans(items)

  if (Array.isArray(data)) return filteredItems
  if (Array.isArray(data?.scans)) return { ...data, scans: filteredItems }
  if (Array.isArray(data?.history)) return { ...data, history: filteredItems }
  if (Array.isArray(data?.results)) return { ...data, results: filteredItems }
  return filteredItems
}

/** GET /api/scans/{runId} — スキャン詳細 */
export async function getScan(runId) {
  const data = await requestJson(`/scans/${runId}`)
  if (data?.run_id) {
    rememberTrackedScan(data.run_id)
  }
  return data
}

/** GET /api/health */
export function health() {
  return requestJson('/health')
}

// ─── Creative Review: Upload ─────────────────────────────────

/**
 * POST /api/assets — クリエイティブアセット画像アップロード
 * @param {File} file - アップロードする画像ファイル
 * @returns {{ asset_id, file_name, mime_type, size_bytes, width, height }}
 */
export function uploadCreativeAsset(file) {
  const formData = new FormData()
  formData.append('file', file)
  return requestRaw('/assets', {
    method: 'POST',
    body: formData,
    direct: true,
    directStrategy: 'optimistic',
    allowProxyFallback: false,
    timeout: CREATIVE_UPLOAD_TIMEOUT,
  })
}

/**
 * 元クリエイティブ画像のダウンロード URL を組み立てる
 * @param {string} assetId
 * @returns {string}
 */
export function getCreativeAssetDownloadUrl(assetId) {
  return `${BASE}/assets/${assetId}/download`
}

// ─── Creative Review: Review ─────────────────────────────────

/**
 * POST /api/reviews/banner — バナーレビュー
 * @param {{ asset_id, brand_info?, operator_memo? }} payload
 * @param {string|{ apiKey?: string, provider?: string, model?: string }} optionsOrApiKey
 */
export async function reviewBanner(payload, optionsOrApiKey) {
  const { apiKey, provider, model } = resolveAiOptions(optionsOrApiKey)
  const body = JSON.stringify({
    ...payload,
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  })

  let lastError = null
  for (let attempt = 0; attempt <= REVIEW_AUTO_RETRY_COUNT; attempt += 1) {
    try {
      return await requestJson('/reviews/banner', {
        method: 'POST',
        body,
        timeout: LONG_ANALYSIS_TIMEOUT,
        direct: true,
        directStrategy: 'optimistic',
        allowProxyFallback: false,
      })
    } catch (error) {
      lastError = error
      if (!(attempt < REVIEW_AUTO_RETRY_COUNT && isReviewRetryableError(error))) break
      await sleep(REVIEW_AUTO_RETRY_DELAYS_MS[attempt] ?? 4000)
    }
  }
  throw lastError
}

/**
 * POST /api/reviews/ad-lp — 広告LP統合レビュー
 * @param {{ asset_id, landing_page: { url }, brand_info?, operator_memo? }} payload
 * @param {string|{ apiKey?: string, provider?: string, model?: string }} optionsOrApiKey
 */
export async function reviewAdLp(payload, optionsOrApiKey) {
  const { apiKey, provider, model } = resolveAiOptions(optionsOrApiKey)
  const body = JSON.stringify({
    ...payload,
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
  })

  let lastError = null
  for (let attempt = 0; attempt <= REVIEW_AUTO_RETRY_COUNT; attempt += 1) {
    try {
      return await requestJson('/reviews/ad-lp', {
        method: 'POST',
        body,
        timeout: LONG_ANALYSIS_TIMEOUT,
        direct: true,
        directStrategy: 'optimistic',
        allowProxyFallback: false,
      })
    } catch (error) {
      lastError = error
      if (!(attempt < REVIEW_AUTO_RETRY_COUNT && isReviewRetryableError(error))) break
      await sleep(REVIEW_AUTO_RETRY_DELAYS_MS[attempt] ?? 4000)
    }
  }
  throw lastError
}
