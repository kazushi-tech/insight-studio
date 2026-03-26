const BASE = '/api/ads'

let authToken = null

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`
  return headers
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...authHeaders(), ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Ads Insights API error: ${res.status}`)
  }
  return res.json()
}

/** POST /api/auth/login — 認証 */
export async function login(password) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
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
export function listPeriods(params) {
  const qs = new URLSearchParams(params).toString()
  return request(`/list_periods?${qs}`)
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
