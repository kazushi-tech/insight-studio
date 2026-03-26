const BASE = '/api/ads'
export const DEFAULT_ADS_DATASET_ID = 'analytics_311324674'

let authToken = null
let onAuthError = null

export function setOnAuthError(handler) {
  onAuthError = handler
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  let clientId = localStorage.getItem('insight-studio-client-id')
  if (!clientId) {
    clientId = crypto.randomUUID()
    localStorage.setItem('insight-studio-client-id', clientId)
  }
  headers['X-Client-ID'] = clientId
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

async function request(path, options = {}) {
  const {
    skipAuth = false,
    suppressAuthErrorHandler = false,
    ...fetchOptions
  } = options

  const headers = skipAuth
    ? { 'Content-Type': 'application/json', ...fetchOptions.headers }
    : { ...authHeaders(), ...fetchOptions.headers }

  const didSendAuth = !skipAuth && Boolean(authToken)

  const res = await fetch(`${BASE}${path}`, {
    headers,
    ...fetchOptions,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error = new Error(body.detail || `Ads Insights API error: ${res.status}`)
    error.status = res.status
    error.body = body
    error.isAuthError = res.status === 401 && didSendAuth

    if (error.isAuthError && !suppressAuthErrorHandler) {
      onAuthError?.(error)
    }

    throw error
  }
  return res.json()
}

function withDefaultDataset(payload = {}) {
  return { dataset_id: DEFAULT_ADS_DATASET_ID, ...payload }
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
    body: JSON.stringify(withDefaultDataset(payload)),
  })
}

/** POST /api/generate_insights — AI考察生成 */
export function generateInsights(payload) {
  return request('/generate_insights', {
    method: 'POST',
    body: JSON.stringify(withDefaultDataset(payload)),
  })
}

/** POST /api/neon/generate — Point Pack 기반 AI考察 */
export function neonGenerate(payload, apiKey) {
  const headers = {
    Accept: 'application/json',
    ...(apiKey ? { 'X-Gemini-API-Key': apiKey } : {}),
  }

  return request('/neon/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
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

/** GET /api/config — 設定取得 */
export function getConfig() {
  return request('/config')
}

/** POST /api/config — 設定保存 */
export function saveConfig(config) {
  return request('/config', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

/** GET /api/cases — 案件一覧 */
export function getCases() {
  return request('/cases')
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
  const merged = { dataset_id: DEFAULT_ADS_DATASET_ID, ...params }
  const qs = toQueryString(merged)
  return request(qs ? `/bq/periods?${qs}` : '/bq/periods')
}

/** POST /api/bq/generate — BQレポート生成（単一クエリタイプ） */
export function bqGenerate(payload) {
  return request('/bq/generate', {
    method: 'POST',
    body: JSON.stringify(withDefaultDataset(payload)),
  })
}

/** POST /api/bq/generate_batch — BQレポート一括生成（複数クエリタイプ） */
export function bqGenerateBatch(payload) {
  return request('/bq/generate_batch', {
    method: 'POST',
    body: JSON.stringify(withDefaultDataset(payload)),
  })
}
