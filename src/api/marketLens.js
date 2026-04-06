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
const LONG_ANALYSIS_TIMEOUT = 180000
const DISCOVERY_AUTO_RETRY_COUNT = 1
const DISCOVERY_AUTO_RETRY_DELAY_MS = 2500
let _directBackendReady = false
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
  if (error.name === 'AbortError' || msg.includes('タイムアウト') || msg.includes('timeout')) {
    return { category: 'timeout', label: 'タイムアウト', guidance: '処理に時間がかかっています。しばらく待って再試行してください。', retryable: true }
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

  // Invalid input (422, 400)
  if (status === 422 || status === 400) {
    return { category: 'invalid_input', label: '入力エラー', guidance: '入力内容またはリクエスト形式を確認してください。', retryable: false }
  }

  // Rate limit
  if (status === 429) {
    return { category: 'rate_limit', label: '利用制限', guidance: '利用制限に達しました。しばらく待って再試行してください。', retryable: true }
  }

  // Upstream / backend server error
  if (status === 500 || status === 502) {
    return { category: 'upstream', label: 'バックエンドエラー', guidance: 'サーバー側でエラーが発生しました。しばらく待って再試行してください。', retryable: true }
  }

  // LLM output parse/validation errors (retryable — transient formatting issue)
  if (msg.includes('llm output parse') || msg.includes('json parse error') || msg.includes('output validation failed')) {
    return { category: 'upstream', label: 'AI出力解析エラー', guidance: 'AIの出力フォーマットが想定と異なりました。再試行してください。', retryable: true }
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
  if (status === 503) return 'バックエンドサーバーが起動中です。1〜2分待って再試行してください。'

  return `Market Lens API error: ${status}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    if (msg.includes('unicodeerror') || msg.includes('internal server error')) return true
    if (stage === 'search' || stage === 'analyze') return true
  }

  if (error?.name === 'AbortError' || msg.includes('タイムアウト') || msg.includes('timeout')) {
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
      })
    } catch (error) {
      lastError = error
      const shouldRetry =
        attempt < DISCOVERY_AUTO_RETRY_COUNT && isDiscoveryRetryableError(error)

      if (!shouldRetry) break

      _directBackendReady = false
      await sleep(DISCOVERY_AUTO_RETRY_DELAY_MS)
    }
  }

  throw lastError
}

// ─── Creative Review auto-retry ──────────────────────────────

const REVIEW_AUTO_RETRY_COUNT = 1
const REVIEW_AUTO_RETRY_DELAY_MS = 2000

function isReviewRetryableError(error) {
  const status = Number(error?.status || 0)
  const msg = String(error?.message || '').toLowerCase()

  if (msg.includes('llm output parse') || msg.includes('json parse error')) return true
  if (status === 500 || status === 502 || status === 503) return true
  if (error?.name === 'AbortError' || msg.includes('timeout')) return true

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
  const RETRY_DELAYS = [0, 5000, 10000]
  for (let i = 0; i < RETRY_DELAYS.length; i++) {
    if (RETRY_DELAYS[i] > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[i]))
    }
    try {
      const res = await fetch(`${DIRECT_BACKEND_BASE}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        _directBackendReady = true
        return true
      }
    } catch {
      // CORS failure or network error — retry
    }
  }
  return false
}

async function requestJson(path, options = {}) {
  const { timeout = 30000, direct = false, _retried = false, ...restOptions } = options
  let baseUrl = BASE
  if (direct && !SHOULD_FORCE_PROXY) {
    // Outside local dev/preview, long-running endpoints should still prefer
    // the direct Render connection to avoid upstream proxy timeouts.
    await ensureDirectBackend()
    baseUrl = DIRECT_BACKEND_BASE
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

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
    // On CORS / network error for direct requests, reset readiness and retry once.
    // This handles Render deploys where the service briefly returns 503 without CORS headers.
    if (direct && !_retried && (e instanceof TypeError || /Failed to fetch/i.test(String(e?.message)))) {
      _directBackendReady = false
      return requestJson(path, { timeout, direct, _retried: true, ...restOptions })
    }
    if (e.name === 'AbortError') {
      if (path === '/scan' || path === '/discovery/analyze') {
        throw new Error('分析の完了まで時間がかかっています。対象サイトの取得やバックエンドの起動待ちで数十秒かかることがあります。少し待って再実行してください。')
      }
      throw new Error('リクエストがタイムアウトしました。ネットワーク接続を確認してください。')
    }
    if (e instanceof TypeError || /Failed to fetch/i.test(String(e?.message))) {
      throw new Error(
        DIRECT_MARKET_LENS_ORIGIN
          ? 'Market Lens backend に接続できませんでした。CORS 設定またはバックエンドの起動状態を確認してください。'
          : 'Market Lens backend に接続できませんでした。しばらく待って再試行してください。'
      )
    }
    throw e
  }
  clearTimeout(timeoutId)

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
  const { timeout = 60000, ...restOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  let res
  try {
    const headers = await buildRequestHeaders(restOptions.headers)
    res = await fetch(`${BASE}${path}`, {
      headers,
      ...restOptions,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      throw new Error('アップロードがタイムアウトしました。ファイルサイズを確認してください。')
    }
    if (e instanceof TypeError || /Failed to fetch/i.test(String(e?.message))) {
      throw new Error(
        DIRECT_MARKET_LENS_ORIGIN
          ? 'Market Lens backend に接続できませんでした。CORS 設定またはバックエンドの起動状態を確認してください。'
          : 'Market Lens backend に接続できませんでした。しばらく待って再試行してください。'
      )
    }
    throw e
  }
  clearTimeout(timeoutId)

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
  return requestJson('/scan', {
    method: 'POST',
    body: JSON.stringify({
      urls,
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    }),
    timeout: LONG_ANALYSIS_TIMEOUT,
    direct: true,
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
  return requestJson('/discovery/jobs', {
    method: 'POST',
    body: JSON.stringify({
      brand_url: url,
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(searchApiKey ? { search_api_key: searchApiKey } : {}),
    }),
    timeout: 30000,
    direct: true,
  }).then((data) => ({
    ...data,
    poll_url: normalizeDiscoveryPollPath(data?.poll_url || data?.job_id),
    retry_after_sec: Number.isFinite(Number(data?.retry_after_sec)) && Number(data.retry_after_sec) > 0
      ? Number(data.retry_after_sec)
      : null,
  }))
}

/** GET /api/discovery/jobs/{jobId} — ジョブ状態ポーリング */
export function getDiscoveryJob(jobIdOrPollPath) {
  return requestJson(normalizeDiscoveryPollPath(jobIdOrPollPath), {
    timeout: 15000,
    direct: true,
  })
}

/** GET /api/scans — スキャン履歴 */
export async function getScans() {
  const data = await requestJson('/scans')
  const items = data?.scans ?? data?.history ?? data?.results ?? (Array.isArray(data) ? data : [])
  const filteredItems = filterTrackedScans(items)

  if (Array.isArray(data)) return filteredItems
  if (Array.isArray(data?.scans)) return { ...data, scans: filteredItems }
  if (Array.isArray(data?.history)) return { ...data, history: filteredItems }
  if (Array.isArray(data?.results)) return { ...data, results: filteredItems }
  return filteredItems
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
      })
    } catch (error) {
      lastError = error
      if (!(attempt < REVIEW_AUTO_RETRY_COUNT && isReviewRetryableError(error))) break
      await sleep(REVIEW_AUTO_RETRY_DELAY_MS)
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
      })
    } catch (error) {
      lastError = error
      if (!(attempt < REVIEW_AUTO_RETRY_COUNT && isReviewRetryableError(error))) break
      await sleep(REVIEW_AUTO_RETRY_DELAY_MS)
    }
  }
  throw lastError
}

