import { apiErrorSearchText, normalizeApiError } from './apiError'

const BASE = '/api/ads'
// Vercel Services routes the frontend and unified FastAPI backend under the
// same origin.  Keep the exported direct base for callers, but never bypass
// the Vercel deployment with a provider-specific hostname.
export const ADS_DIRECT_BASE = '/api/ads'
const ADS_DIRECT_HEALTH_URL = '/api/ads/health'
export const AI_GENERATE_ENDPOINT = '/api/insights/neon/generate'
const INSIGHTS_BASE = '/api/insights'
const INSIGHTS_DIRECT_BASE = INSIGHTS_BASE
const BQ_BATCH_TIMEOUT_MS = 180000
export const DEFAULT_ADS_DATASET_ID = 'analytics_311324674'
export const AUTH_EXPIRED_MESSAGE = '認証エラー: セッションが切れました。再ログインしてください。'

// --- direct バックエンド準備 ---
const isLocalOrigin = () => {
  try {
    const h = window.location.hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
  } catch { return false }
}
const isRenderStaticOrigin = () => {
  try {
    return window.location.hostname === 'insight-studio-frontend.onrender.com'
  } catch { return false }
}
const SHOULD_FORCE_PROXY = isLocalOrigin() || isRenderStaticOrigin()
let _directReady = false
let _directWarmPromise = null

async function ensureDirectAdsBackend() {
  if (_directReady) return true
  if (_directWarmPromise) return _directWarmPromise

  _directWarmPromise = (async () => {
    const RETRY_DELAYS = [0, 5000, 10000]
    for (const delay of RETRY_DELAYS) {
      try {
        if (delay) await new Promise(r => setTimeout(r, delay))
        const res = await fetch(ADS_DIRECT_HEALTH_URL, {
          method: 'GET',
          signal: AbortSignal.timeout(30000),
        })
        if (res.ok) {
          _directReady = true
          return true
        }
      } catch { /* retry */ }
    }
    return false
  })()

  try {
    return await _directWarmPromise
  } finally {
    _directWarmPromise = null
  }
}

export function warmAdsInsightsBackend() {
  if (SHOULD_FORCE_PROXY) return Promise.resolve(false)
  return ensureDirectAdsBackend()
}

let authToken = null
let authTokenProvider = null
let onAuthError = null

export function setOnAuthError(handler) {
  onAuthError = handler
}

/**
 * Register an async short-lived token source (for example Clerk getToken).
 * Returned tokens stay in memory and are never written to localStorage here.
 */
export function setAuthTokenProvider(provider) {
  authTokenProvider = typeof provider === 'function' ? provider : null
}

function clientHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  let clientId = localStorage.getItem('insight-studio-client-id')
  if (!clientId) {
    clientId = crypto.randomUUID()
    localStorage.setItem('insight-studio-client-id', clientId)
  }
  headers['X-Client-ID'] = clientId
  return headers
}

async function resolveAuthToken() {
  if (authTokenProvider) {
    try {
      return await authTokenProvider()
    } catch {
      return null
    }
  }
  // Legacy tokens may remain in memory during the hybrid period, but browser
  // storage is never an authentication source.
  return authToken
}

async function authHeaders() {
  const headers = clientHeaders()
  const token = await resolveAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

function toQueryString(params = {}) {
  const search = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (value == null) return

    if (Array.isArray(value)) {
      value
        .filter((item) => item != null && item !== '')
        .forEach((item) => search.append(key, item))
      return
    }

    search.append(key, value)
  })

  return search.toString()
}


function isFetchNetworkError(error) {
  return error instanceof TypeError || /Failed to fetch/i.test(String(error?.message))
}

function isBackendConfigAuthError(status, body = {}) {
  if (status !== 401 && status !== 403) return false
  const problem = normalizeApiError(body, status)
  const code = problem.code.toLowerCase()
  const marker = apiErrorSearchText(body, status)
  return (
    code === 'api_key_required' ||
    code.startsWith('gemini_') ||
    marker.includes('gemini api') ||
    marker.includes('gemini_api_key') ||
    marker.includes('google_api_key') ||
    marker.includes('anthropic_api_key') ||
    code.startsWith('bq_') ||
    code === 'credentials_missing'
  )
}

function splitProjectScope(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  const projectRef = String(input.project_ref || input.projectRef || '').trim()
  const scopedValue = { ...input }
  delete scopedValue.project_ref
  delete scopedValue.projectRef
  return { projectRef, value: scopedValue }
}

function projectScopeHeaders(projectRef) {
  return projectRef ? { 'X-Insight-Project': projectRef } : {}
}

function defaultApiErrorMessage(status) {
  if (status === 502 || status === 503) {
    return '分析サーバーに接続できません。少し待ってから再試行してください。ローカル確認ではAdsバックエンド（8001番）の起動も確認してください。'
  }
  return `Ads Insights API error: ${status}`
}

async function request(path, options = {}) {
  const {
    neutralApi = false,
    direct = false,
    directStrategy = 'verified',
    allowProxyFallback = true,
    skipAuth = false,
    suppressAuthErrorHandler = false,
    headers: customHeaders = {},
    timeout = 30000,
    _retried = false,
    ...fetchOptions
  } = options

  const headers = new Headers(skipAuth ? clientHeaders() : await authHeaders())
  new Headers(customHeaders).forEach((value, key) => {
    headers.set(key, value)
  })

  const didSendAuth = Boolean(headers.get('Authorization'))

  let base = neutralApi ? INSIGHTS_BASE : BASE
  const directBase = neutralApi ? INSIGHTS_DIRECT_BASE : ADS_DIRECT_BASE
  const shouldUseDirect = direct && !SHOULD_FORCE_PROXY
  if (shouldUseDirect) {
    if (directStrategy === 'optimistic') {
      base = directBase
    } else {
      const ready = await ensureDirectAdsBackend()
      base = ready || !allowProxyFallback
        ? directBase
        : neutralApi ? INSIGHTS_BASE : BASE
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const usingDirectBackend = shouldUseDirect && base === directBase

  let res
  try {
    res = await fetch(`${base}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeoutId)
    if (direct && !_retried && isFetchNetworkError(e)) {
      if (usingDirectBackend) {
        _directReady = false
      }
      return request(path, {
        direct,
        neutralApi,
        directStrategy: 'verified',
        allowProxyFallback,
        skipAuth,
        suppressAuthErrorHandler,
        headers: customHeaders,
        timeout,
        _retried: true,
        ...fetchOptions,
      })
    }
    if (e.name === 'AbortError') {
      const sec = Math.round(timeout / 1000)
      const timeoutError = new Error(
        sec >= 60
          ? `リクエストが ${sec} 秒でタイムアウトしました。集計処理またはバックエンドの起動に時間がかかっている可能性があります。処理状況を確認してから再試行してください。`
          : 'リクエストがタイムアウトしました。ネットワーク接続を確認してください。'
      )
      // The server may still be running after the browser stops waiting.  Mark
      // this as an uncertain outcome so callers do not immediately duplicate a
      // long-running BigQuery batch.
      timeoutError.code = 'request_timeout'
      timeoutError.retryable = false
      timeoutError.uncertain = true
      throw timeoutError
    }
    throw e
  }
  clearTimeout(timeoutId)
  if (usingDirectBackend) {
    _directReady = true
  }

  if (
    usingDirectBackend &&
    directStrategy === 'optimistic' &&
    !_retried &&
    (res.status === 502 || res.status === 503)
  ) {
    _directReady = false
    return request(path, {
      direct,
      neutralApi,
      directStrategy: 'verified',
      allowProxyFallback,
      skipAuth,
      suppressAuthErrorHandler,
      headers: customHeaders,
      timeout,
      _retried: true,
      ...fetchOptions,
    })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const problem = normalizeApiError(body, res.status, defaultApiErrorMessage(res.status))
    const error = new Error(problem.message)
    error.status = res.status
    error.body = body
    error.code = problem.code
    error.category = problem.category
    error.retryable = problem.retryable
    error.requestId = problem.requestId
    error.fieldErrors = problem.fieldErrors
    error.isBackendConfigAuthError = isBackendConfigAuthError(res.status, body)
    error.isAuthError = (res.status === 401 || res.status === 403) && didSendAuth && !error.isBackendConfigAuthError

    if (error.isAuthError && !suppressAuthErrorHandler) {
      onAuthError?.(error)
    }

    throw error
  }
  return res.json()
}

async function requestLocalAds(path, options = {}) {
  const {
    skipAuth = false,
    suppressAuthErrorHandler = false,
    headers: customHeaders = {},
    timeout = 30000,
    ...fetchOptions
  } = options

  const headers = new Headers(skipAuth ? clientHeaders() : await authHeaders())
  new Headers(customHeaders).forEach((value, key) => {
    headers.set(key, value)
  })
  const didSendAuth = Boolean(headers.get('Authorization'))
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  let res
  try {
    res = await fetch(`http://127.0.0.1:8001/api${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      const sec = Math.round(timeout / 1000)
      throw new Error(`リクエストが ${sec} 秒でタイムアウトしました。`)
    }
    throw e
  }
  clearTimeout(timeoutId)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const problem = normalizeApiError(body, res.status, defaultApiErrorMessage(res.status))
    const error = new Error(problem.message)
    error.status = res.status
    error.body = body
    error.code = problem.code
    error.category = problem.category
    error.retryable = problem.retryable
    error.requestId = problem.requestId
    error.fieldErrors = problem.fieldErrors
    error.isBackendConfigAuthError = isBackendConfigAuthError(res.status, body)
    error.isAuthError = (res.status === 401 || res.status === 403) && didSendAuth && !error.isBackendConfigAuthError
    if (error.isAuthError && !suppressAuthErrorHandler) {
      onAuthError?.(error)
    }
    throw error
  }
  return res.json()
}



/** POST /api/auth/login — 認証 */
export async function login(password) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
    skipAuth: true,
  })
  authToken = data.token
  return data
}

/** トークンをセット（localStorage復元用） */
export function setToken(token) {
  authToken = token
}

/** トークンを取得 */
export function getToken() {
  return authToken
}

/** ログアウト — 全セッション状態を一括 purge */
export function logout() {
  authToken = null
  authTokenProvider = null
  // 共有端末で別顧客の分析内容が残らないよう、認証・案件・履歴を一括削除する。
  try {
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      if (
        key.startsWith(CASE_TRUST_TOKEN_KEY_PREFIX)
        || key.startsWith('insight-studio-ads-report-history')
        || key.startsWith('insight-studio-ads-setup')
        || key.startsWith('insight-studio-market-lens-scan-history')
        || key === 'insight-studio-current-case'
        || key === 'insight-studio-case-authenticated'
        || key === 'insight-studio-market-lens-profile-id'
        || key === 'insight-studio-client-id'
        || key === 'is-score-history'
      ) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k))
  } catch { /* ignore storage failures */ }
  try {
    const keysToRemove = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (
        key
        && (
          key.startsWith('is-draft-')
          || key === 'is-discovery-active-job'
          || key === 'is-compare-active-scan-job'
          || key === 'is_gemini_key'
          || key === 'is_claude_key'
        )
      ) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key))
  } catch { /* ignore storage failures */ }
}

/** GET /api/folders — 案件フォルダ一覧 */
export function getFolders() {
  return request('/folders')
}

/** GET /api/list_periods — 期間一覧 */
export function listPeriods(params = {}) {
  const qs = toQueryString(params)
  return request(qs ? `/list_periods?${qs}` : '/list_periods')
}

/** GET /api/months — 月別データ */
export function getMonths() {
  return request('/months')
}

/** POST /api/load — データ読み込み */
export function loadData(payload) {
  return request('/load', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** POST /api/generate_insights — AI考察生成 */
export function generateInsights(payload) {
  return request('/generate_insights', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** POST /api/insights/neon/generate — Point Pack ベース AI考察 */
export function neonGenerate(payload, apiKey) {
  const { projectRef, value: scopedPayload } = splitProjectScope(payload)
  const isGemini = scopedPayload.provider === 'google'
  const headers = {
    Accept: 'application/json',
    ...projectScopeHeaders(projectRef),
    ...(scopedPayload.provider ? { 'X-Analysis-Provider': scopedPayload.provider } : {}),
    ...(isGemini && apiKey ? { 'X-Gemini-API-Key': apiKey } : {}),
  }
  const body = { ...scopedPayload, ...(!isGemini && apiKey ? { api_key: apiKey } : {}) }

  return request('/neon/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    neutralApi: true,
    direct: true,
    timeout: 300000,
  })
}

/** POST /api/validate — レポート検証 */
export function validateReport(payload) {
  return request('/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** GET /api/key_status — APIキー状態 */
export function keyStatus() {
  return request('/key_status')
}

/** GET /api/usage/budget — Ads Gemini budget status */
export function getAdsGeminiBudget() {
  if (isLocalOrigin()) {
    return requestLocalAds('/usage/budget')
  }
  return request('/usage/budget')
}

/** POST /api/usage/gemini-smoke-test — saved Gemini key connectivity + budget usage check */
export function runAdsGeminiBudgetSmokeTest(apiKey) {
  if (isLocalOrigin()) {
    return requestLocalAds('/usage/gemini-smoke-test', {
      method: 'POST',
      headers: {
        ...(apiKey ? { 'X-Gemini-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ model: 'gemini-3.1-flash-lite' }),
      timeout: 120000,
    })
  }
  return request('/usage/gemini-smoke-test', {
    method: 'POST',
    headers: {
      ...(apiKey ? { 'X-Gemini-API-Key': apiKey } : {}),
    },
    body: JSON.stringify({ model: 'gemini-3.1-flash-lite' }),
    suppressAuthErrorHandler: true,
    timeout: 120000,
  })
}

/** GET /api/cases — 案件一覧 */
export function getCases() {
  return request('/cases')
}

/** localStorage key for case-specific device trust token (TOTP skip) */
export const CASE_TRUST_TOKEN_KEY_PREFIX = 'is_case_trust_'

export function getCaseTrustToken(caseId) {
  if (!caseId) return null
  try {
    return localStorage.getItem(`${CASE_TRUST_TOKEN_KEY_PREFIX}${caseId}`) || null
  } catch { return null }
}

export function setCaseTrustToken(caseId, token) {
  if (!caseId) return
  try {
    if (token) {
      localStorage.setItem(`${CASE_TRUST_TOKEN_KEY_PREFIX}${caseId}`, token)
    } else {
      localStorage.removeItem(`${CASE_TRUST_TOKEN_KEY_PREFIX}${caseId}`)
    }
  } catch { /* ignore storage failures */ }
}

/**
 * POST /api/cases/login — 案件認証 (optional TOTP)
 * Returns:
 *   成功: { ok: true, case_id, name, dataset_id, token, device_trust_token }
 *   TOTP要求: { ok: false, totp_required: true, case_id, name }
 * Throws on wrong password/TOTP (401) or other errors.
 */
export async function loginCase(caseId, password, { totpCode = null, deviceTrustToken = null } = {}) {
  const body = { case_id: caseId, password }
  if (totpCode) body.totp_code = String(totpCode).trim()
  if (deviceTrustToken) body.device_trust_token = deviceTrustToken
  let data
  try {
    data = await request('/cases/login', {
      method: 'POST',
      body: JSON.stringify(body),
      skipAuth: true,
      suppressAuthErrorHandler: true,
    })
  } catch (err) {
    // 401 時は case trust token を削除して無限 auth ループを防ぐ
    if (err.status === 401) {
      setCaseTrustToken(caseId, null)
    }
    throw err
  }
  if (data.ok && data.token) {
    authToken = data.token
    // case 切替時に Discovery の古いジョブをクリア
    try { sessionStorage.removeItem('is-discovery-active-job') } catch { /* ignore */ }
  }
  if (data.ok && data.case_id && data.device_trust_token) {
    setCaseTrustToken(data.case_id, data.device_trust_token)
  }
  return data
}

/** GET /api/health */
export function health() {
  return request('/health')
}

// ── BigQuery endpoints ──

/** GET /api/bq/query_types — BQクエリタイプ一覧 */
export function bqQueryTypes(projectRef = null) {
  return request('/bq/query_types', {
    headers: projectScopeHeaders(projectRef),
  })
}

/** GET /api/bq/periods — BQ期間一覧 */
export function bqPeriods(params = {}) {
  const { projectRef, value: queryParams } = splitProjectScope(params)
  if (queryParams.dataset_id === 'managed') delete queryParams.dataset_id
  const qs = toQueryString(queryParams)
  return request(qs ? `/bq/periods?${qs}` : '/bq/periods', {
    headers: projectScopeHeaders(projectRef),
  })
}

/** POST /api/bq/generate — BQレポート生成（単一クエリタイプ） */
export function bqGenerate(payload) {
  const { projectRef, value: body } = splitProjectScope(payload)
  if (body.dataset_id === 'managed') delete body.dataset_id
  return request('/bq/generate', {
    method: 'POST',
    headers: projectScopeHeaders(projectRef),
    body: JSON.stringify(body),
  })
}

/** POST /api/bq/generate_batch — BQレポート一括生成（複数クエリタイプ） */
export function bqGenerateBatch(payload) {
  const { projectRef, value: body } = splitProjectScope(payload)
  if (body.dataset_id === 'managed') delete body.dataset_id
  return request('/bq/generate_batch', {
    method: 'POST',
    headers: projectScopeHeaders(projectRef),
    body: JSON.stringify(body),
    timeout: BQ_BATCH_TIMEOUT_MS,
  })
}

/** GET /api/cases/:case_id/bq-status — BQ接続テスト */
export function getCaseBqStatus(caseId) {
  return request(`/cases/${encodeURIComponent(caseId)}/bq-status`)
}

/** POST /api/cases — 案件新規登録 */
export function createCase(payload) {
  return request('/cases', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** PUT /api/cases/:case_id — 案件更新 */
export function updateCase(caseId, payload) {
  return request(`/cases/${encodeURIComponent(caseId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

// ── RBAC endpoints ──

/** POST /api/auth/login-email — メール認証（RBAC用JWT取得） */
export async function loginWithEmail(email, password) {
  const data = await request('/auth/login-email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
    skipAuth: true,
  })
  if (data.token) authToken = data.token
  return data // { token, user: { user_id, email, role, display_name } }
}

/** POST /api/auth/register — ユーザー登録（admin用） */
export function registerUser(userData) {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify(userData),
  })
}

/** POST /api/projects/:project_id/invite — メンバー招待 */
export function inviteMember(projectId, email, permission) {
  return request(`/projects/${encodeURIComponent(projectId)}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email, permission }),
  })
}

/** GET /api/projects/:project_id/members — メンバー一覧 */
export function getProjectMembers(projectId) {
  return request(`/projects/${encodeURIComponent(projectId)}/members`)
}

/** DELETE /api/projects/:project_id/members/:user_id — メンバー削除 */
export function removeMember(projectId, userId) {
  return request(`/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}
