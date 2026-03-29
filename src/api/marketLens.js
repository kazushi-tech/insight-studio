// Prefer the same-origin proxy in both dev and prod to avoid browser-side CORS drift.
const DIRECT_MARKET_LENS_ORIGIN =
  import.meta.env.VITE_MARKET_LENS_API_ORIGIN?.replace(/\/$/, '') || ''
const BASE = DIRECT_MARKET_LENS_ORIGIN ? `${DIRECT_MARKET_LENS_ORIGIN}/api` : '/api/ml'
const LONG_ANALYSIS_TIMEOUT = 180000
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

function buildErrorMessage(path, status, body) {
  const detail = body?.detail
  const normalizedDetail = typeof detail === 'string' ? detail.toLowerCase() : ''

  // Discovery stage-aware error mapping
  if (path.includes('/discovery')) {
    const stage = extractStage(detail)
    const stageLabel = stage ? DISCOVERY_STAGE_LABELS[stage] || stage : null

    if (status === 400) {
      if (normalizedDetail.includes('gemini api key is required for discovery search')) {
        return '競合発見の検索設定が不足しています。サーバー側の Discovery 検索キー設定を確認してください。'
      }
      return detail || '競合発見の実行条件が不足しています。分析用 Claude API キーとサーバー側設定を確認してください。'
    }
    if (status === 401) {
      if (normalizedDetail.includes('api key')) {
        return '競合発見で使用する API キーが無効です。分析用 Claude API キー、またはサーバー側の検索キー設定を確認してください。'
      }
      return detail || '競合発見の認証に失敗しました。API キー設定を確認してください。'
    }
    if (status === 404) return detail || '競合サイトが見つかりませんでした。別のURLで試してください。'
    if (status === 422) return detail || 'URLの形式が正しくありません。'
    if (status === 429) return '本日の検索上限に達しました。明日再度お試しください。'
    if (status === 500 && stageLabel) return `${stageLabel}でサーバーエラーが発生しました。しばらく待って再試行してください。`
    if (status === 500) return detail || 'バックエンドでサーバーエラーが発生しました。対象サイトの構造が複雑か、一時的な負荷の可能性があります。しばらく待って再試行してください。'
    if (status === 502 && stageLabel) return `${stageLabel}で失敗しました。${detail}`
    if (status === 502) return detail || '競合分析パイプラインでエラーが発生しました。'
    if (status === 503) return 'バックエンドサーバーが起動中です。1〜2分待って再試行してください。'
    if (detail) return detail
    return `Discovery API error: ${status}`
  }

  if (detail) return detail

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

  if (status === 500) return detail || 'バックエンドでサーバーエラーが発生しました。しばらく待って再試行してください。'
  if (status === 503) return 'バックエンドサーバーが起動中です。1〜2分待って再試行してください。'

  return `Market Lens API error: ${status}`
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
async function requestJson(path, options = {}) {
  const { timeout = 30000, ...restOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  let res
  try {
    const headers = await buildRequestHeaders(restOptions.headers)
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...headers },
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
  }).then((data) => {
    rememberTrackedScan(data?.run_id)
    return data
  })
}

/** POST /api/discovery/analyze — 競合発見 Discovery */
export function discoveryAnalyze(url, optionsOrApiKey) {
  const { apiKey, provider, model, searchApiKey } = resolveAiOptions(optionsOrApiKey)
  return requestJson('/discovery/analyze', {
    method: 'POST',
    body: JSON.stringify({
      brand_url: url,
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(searchApiKey ? { search_api_key: searchApiKey } : {}),
    }),
    timeout: LONG_ANALYSIS_TIMEOUT,
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
export function reviewBanner(payload, optionsOrApiKey) {
  const { apiKey, provider, model } = resolveAiOptions(optionsOrApiKey)
  return requestJson('/reviews/banner', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    }),
    timeout: 120000,
  })
}

/**
 * POST /api/reviews/ad-lp — 広告LP統合レビュー
 * @param {{ asset_id, landing_page: { url }, brand_info?, operator_memo? }} payload
 * @param {string|{ apiKey?: string, provider?: string, model?: string }} optionsOrApiKey
 */
export function reviewAdLp(payload, optionsOrApiKey) {
  const { apiKey, provider, model } = resolveAiOptions(optionsOrApiKey)
  return requestJson('/reviews/ad-lp', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    }),
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
