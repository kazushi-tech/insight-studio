const BASE = '/api/ml'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Market Lens API error: ${res.status}`)
  }
  return res.json()
}

/** POST /api/scan — LP比較分析 */
export function scan(urls, geminiKey) {
  return request('/scan', {
    method: 'POST',
    body: JSON.stringify({ urls }),
    headers: geminiKey ? { 'X-Gemini-Key': geminiKey } : {},
  })
}

/** POST /api/discovery/analyze — 競合発見 Discovery */
export function discoveryAnalyze(url, geminiKey) {
  return request('/discovery/analyze', {
    method: 'POST',
    body: JSON.stringify({ url }),
    headers: geminiKey ? { 'X-Gemini-Key': geminiKey } : {},
  })
}

/** POST /api/review — クリエイティブレビュー */
export function review(url, geminiKey) {
  return request('/review', {
    method: 'POST',
    body: JSON.stringify({ url }),
    headers: geminiKey ? { 'X-Gemini-Key': geminiKey } : {},
  })
}

/** GET /api/history — スキャン履歴 */
export function getHistory() {
  return request('/history')
}

/** GET /api/health */
export function health() {
  return request('/health')
}
