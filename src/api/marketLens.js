const BASE = '/api/ml'
const LONG_ANALYSIS_TIMEOUT = 180000

function buildErrorMessage(path, status, body) {
  if (body?.detail) return body.detail

  if (status === 404) {
    if (path.includes('/assets')) return 'アセットが見つかりません。再アップロードしてください。'
    if (path.includes('/generation')) return '生成結果が見つかりません。'
    return `Market Lens API endpoint ${path} が見つかりません。`
  }

  if (status === 409) {
    return '画像がまだ準備できていません。しばらくお待ちください。'
  }

  if (status === 422) {
    if (path.includes('/assets')) return 'アップロードされたファイルが不正です。PNG/JPG画像を選択してください。'
    if (path.includes('/reviews')) return 'レビューリクエストが不正です。入力内容を確認してください。'
    if (path.includes('/generation')) return 'バナー生成リクエストが不正です。先にレビューを完了してください。'
    return 'リクエストの形式が正しくありません。入力内容を確認してください。'
  }

  return `Market Lens API error: ${status}`
}

/**
 * JSON リクエスト用の共通 fetch wrapper。
 * Content-Type: application/json を自動付与する。
 */
async function requestJson(path, options = {}) {
  const { timeout = 30000, ...restOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...restOptions.headers },
      ...restOptions,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      if (path === '/scan' || path === '/discovery/analyze') {
        throw new Error('分析の完了まで時間がかかっています。対象サイトの取得やバックエンドの起動待ちで数十秒かかることがあります。少し待って再実行してください。')
      }
      throw new Error('リクエストがタイムアウトしました。ネットワーク接続を確認してください。')
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
    res = await fetch(`${BASE}${path}`, {
      ...restOptions,
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      throw new Error('アップロードがタイムアウトしました。ファイルサイズを確認してください。')
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
export function scan(urls, apiKey) {
  return requestJson('/scan', {
    method: 'POST',
    body: JSON.stringify({ urls, api_key: apiKey }),
    timeout: LONG_ANALYSIS_TIMEOUT,
  })
}

/** POST /api/discovery/analyze — 競合発見 Discovery */
export function discoveryAnalyze(url, apiKey) {
  return requestJson('/discovery/analyze', {
    method: 'POST',
    body: JSON.stringify({ brand_url: url, api_key: apiKey }),
    timeout: LONG_ANALYSIS_TIMEOUT,
  })
}

/** GET /api/scans — スキャン履歴 */
export function getScans() {
  return requestJson('/scans')
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

// ─── Creative Review: Review ─────────────────────────────────

/**
 * POST /api/reviews/banner — バナーレビュー
 * @param {{ asset_id, brand_info?, operator_memo? }} payload
 * @param {string} apiKey - Gemini BYOK API キー
 */
export function reviewBanner(payload, apiKey) {
  return requestJson('/reviews/banner', {
    method: 'POST',
    body: JSON.stringify({ ...payload, api_key: apiKey }),
    timeout: 120000,
  })
}

/**
 * POST /api/reviews/ad-lp — 広告LP統合レビュー
 * @param {{ asset_id, landing_page: { url }, brand_info?, operator_memo? }} payload
 * @param {string} apiKey
 */
export function reviewAdLp(payload, apiKey) {
  return requestJson('/reviews/ad-lp', {
    method: 'POST',
    body: JSON.stringify({ ...payload, api_key: apiKey }),
    timeout: 120000,
  })
}

// ─── Creative Review: Generation ─────────────────────────────

/**
 * POST /api/generation/banner — 改善バナー生成開始
 * @param {{ review_run_id, style_guidance? }} payload
 * @param {string} apiKey
 * @returns {{ id, status, ... }}
 */
export function generateBanner(payload, apiKey) {
  return requestJson('/generation/banner', {
    method: 'POST',
    body: JSON.stringify({ ...payload, api_key: apiKey }),
    timeout: 120000,
  })
}

/**
 * GET /api/generation/{genId} — 生成状態ポーリング
 * @param {string} genId
 * @returns {{ id, status, error_message? }}
 */
export function getGeneration(genId) {
  return requestJson(`/generation/${genId}`)
}

/**
 * 生成画像の URL を組み立てる
 * @param {string} genId
 * @returns {string}
 */
export function getGenerationImageUrl(genId) {
  return `${BASE}/generation/${genId}/image`
}
