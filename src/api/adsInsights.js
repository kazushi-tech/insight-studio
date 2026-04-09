const BASE = '/api/ads'
const ADS_DIRECT_BASE = 'https://ads-insights-9q5s.onrender.com/api'
export const DEFAULT_ADS_DATASET_ID = 'analytics_311324674'
export const AUTH_EXPIRED_MESSAGE = '認証エラー: セッションが切れました。再ログインしてください。'

// --- direct バックエンド準備 ---
const isLocalOrigin = () => {
  try {
    const h = window.location.hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
  } catch { return false }
}
const SHOULD_FORCE_PROXY = isLocalOrigin()
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
        const res = await fetch(`${ADS_DIRECT_BASE}/health`, {
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
let onAuthError = null

export function setOnAuthError(handler) {
  onAuthError = handler
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

function authHeaders() {
  const headers = clientHeaders()
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
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

function isUnauthorizedErrorPayload(body) {
  const markers = [body?.detail, body?.error, body?.message]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())

  return markers.some((value) => value === 'unauthorized')
}

function isFetchNetworkError(error) {
  return error instanceof TypeError || /Failed to fetch/i.test(String(error?.message))
}

async function request(path, options = {}) {
  const {
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

  const headers = new Headers(skipAuth ? clientHeaders() : authHeaders())
  new Headers(customHeaders).forEach((value, key) => {
    headers.set(key, value)
  })

  const didSendAuth = Boolean(headers.get('Authorization'))

  let base = BASE
  const shouldUseDirect = direct && !SHOULD_FORCE_PROXY
  if (shouldUseDirect) {
    if (directStrategy === 'optimistic') {
      base = ADS_DIRECT_BASE
    } else {
      const ready = await ensureDirectAdsBackend()
      base = ready || !allowProxyFallback
        ? ADS_DIRECT_BASE
        : BASE
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const usingDirectBackend = shouldUseDirect && base === ADS_DIRECT_BASE

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
      throw new Error(
        sec >= 60
          ? `リクエストが ${sec} 秒でタイムアウトしました。AI生成の処理に時間がかかっている、またはバックエンドのコールドスタートが原因の可能性があります。しばらく待ってから再試行してください。`
          : 'リクエストがタイムアウトしました。ネットワーク接続を確認してください。'
      )
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
    const error = new Error(
      body.detail || body.error || body.message || `Ads Insights API error: ${res.status}`,
    )
    error.status = res.status
    error.body = body
    error.isAuthError = res.status === 401 && didSendAuth && isUnauthorizedErrorPayload(body)

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

/** ログアウト */
export function logout() {
  authToken = null
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

/** POST /api/neon/generate — Point Pack ベース AI考察 */
export function neonGenerate(payload, apiKey) {
  const headers = {
    Accept: 'application/json',
    ...(payload.provider ? { 'X-Analysis-Provider': payload.provider } : {}),
  }
  const body = { ...payload, ...(apiKey ? { api_key: apiKey } : {}) }

  return request('/neon/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    timeout: 120000,
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

/** GET /api/cases — 案件一覧 */
export function getCases() {
  return request('/cases', { suppressAuthErrorHandler: true })
}

/** GET /api/cases — 案件一覧（認証なし・ログイン画面用） */
export function getCasesPublic() {
  return request('/cases', { skipAuth: true, suppressAuthErrorHandler: true })
}

/** POST /api/cases/login — 案件認証 */
export async function loginCase(caseId, password) {
  const data = await request('/cases/login', {
    method: 'POST',
    body: JSON.stringify({ case_id: caseId, password }),
    skipAuth: true,
  })
  // バックエンドがtokenを返した場合、グローバル認証も完了
  if (data.token) {
    authToken = data.token
  }
  return data // { ok, case_id, name, dataset_id, token? }
}

/** GET /api/health */
export function health() {
  return request('/health')
}

// ── BigQuery endpoints ──

/** GET /api/bq/query_types — BQクエリタイプ一覧 */
export function bqQueryTypes() {
  return request('/bq/query_types')
}

/** GET /api/bq/periods — BQ期間一覧 */
export function bqPeriods(params = {}) {
  const qs = toQueryString(params)
  return request(qs ? `/bq/periods?${qs}` : '/bq/periods')
}

/** POST /api/bq/generate — BQレポート生成（単一クエリタイプ） */
export function bqGenerate(payload) {
  return request('/bq/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** POST /api/bq/generate_batch — BQレポート一括生成（複数クエリタイプ） */
export function bqGenerateBatch(payload) {
  return request('/bq/generate_batch', {
    method: 'POST',
    body: JSON.stringify(payload),
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
