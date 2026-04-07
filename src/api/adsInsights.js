const BASE = '/api/ads'
export const DEFAULT_ADS_DATASET_ID = 'analytics_311324674'
export const AUTH_EXPIRED_MESSAGE = '認証エラー: セッションが切れました。再ログインしてください。'

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

async function request(path, options = {}) {
  const {
    skipAuth = false,
    suppressAuthErrorHandler = false,
    headers: customHeaders = {},
    timeout = 30000,
    ...fetchOptions
  } = options

  const headers = new Headers(skipAuth ? clientHeaders() : authHeaders())
  new Headers(customHeaders).forEach((value, key) => {
    headers.set(key, value)
  })

  const didSendAuth = Boolean(headers.get('Authorization'))

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeoutId)
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
