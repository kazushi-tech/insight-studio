const BASE = '/api/ml'

function buildErrorMessage(path, status, body) {
  if (body?.detail) return body.detail

  if (status === 404) {
    return `Market Lens API endpoint ${path} が見つかりません。`
  }

  if (status === 422) {
    return 'リクエストの形式が正しくありません。入力内容を確認してください。'
  }

  return `Market Lens API error: ${status}`
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
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

/**
 * POST /api/scan — LP比較分析
 *
 * api_key は backend contract 上 optional だが、
 * product 仕様として UI 側で必須（hasGeminiKey gating）にしている。
 * 分析品質を担保するための意図的な制約。
 */
export function scan(urls, apiKey) {
  return request('/scan', {
    method: 'POST',
    body: JSON.stringify({ urls, api_key: apiKey }),
  })
}

/** POST /api/discovery/analyze — 競合発見 Discovery */
export function discoveryAnalyze(url, apiKey) {
  return request('/discovery/analyze', {
    method: 'POST',
    body: JSON.stringify({ brand_url: url, api_key: apiKey }),
  })
}

/** POST /api/reviews/:type — クリエイティブレビュー (banner | ad-lp | compare) */
export function reviewByType(type, payload, apiKey) {
  return request(`/reviews/${type}`, {
    method: 'POST',
    body: JSON.stringify({ ...payload, api_key: apiKey }),
  })
}

/** GET /api/scans — スキャン履歴 */
export function getScans() {
  return request('/scans')
}

/** GET /api/health */
export function health() {
  return request('/health')
}
