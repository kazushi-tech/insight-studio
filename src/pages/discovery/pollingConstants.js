export const POLL_INTERVAL_INITIAL_MS = 2000
export const POLL_INTERVAL_SLOW_MS = 5000
export const POLL_SLOWDOWN_AFTER_MS = 30000
export const POLL_MAX_NETWORK_ERRORS = 3
export const POLL_SOFT_WARNING_MS = 180_000   // ソフト警告のみ — キルしない（backend overall 450s に対して3分で警戒）
export const POLL_HARD_CEILING_MS = 470_000   // 安全弁 — backend overall(450s) + 20s 余裕（backend が先にエラー返せるように）
export const POLL_STALE_TIMEOUT_MS = 90_000   // ← PRIMARY キル判定（heartbeat 90秒無応答 — バックエンド10s間隔に対して余裕あり）
export const STAGE_TIMEOUT_MS = {
  queued: 30_000,
  brand_fetch: 60_000,
  classify_industry: 30_000,
  search: 90_000,
  fetch_competitors: 60_000,
  analyze: 460_000,  // backend overall(450s) + 10s 余裕
  warming: 60_000,
}
export const DISCOVERY_AUTO_RESUBMIT_MAX = 2

export const STAGE_LABELS = {
  warming: 'サーバー起動待ち…',
  queued: 'ジョブ準備中…',
  brand_fetch: 'ブランドURL取得中…',
  classify_industry: '業種分類中…',
  search: '競合検索中…',
  fetch_competitors: '競合サイト取得中…',
  analyze: '比較分析中…',
  complete: '完了',
}

export const STAGE_TYPICAL_SEC = {
  queued: 3,
  brand_fetch: 10,
  classify_industry: 6,
  search: 30,
  fetch_competitors: 20,
  analyze: 55,
}

export const STAGE_ORDER = ['queued', 'brand_fetch', 'classify_industry', 'search', 'fetch_competitors', 'analyze']

export function getPollIntervalMs(retryAfterSec) {
  return Number(retryAfterSec) > 0
    ? Number(retryAfterSec) * 1000
    : POLL_INTERVAL_INITIAL_MS
}

export function estimateRemaining(currentStage, elapsedMs) {
  if (currentStage === 'warming') return null
  const idx = STAGE_ORDER.indexOf(currentStage)
  if (idx < 0) return null
  const elapsedSec = (elapsedMs || 0) / 1000
  const currentTypical = STAGE_TYPICAL_SEC[currentStage] || 10
  const totalTypical = STAGE_ORDER.reduce((sum, s) => sum + (STAGE_TYPICAL_SEC[s] || 10), 0)
  if (elapsedSec > totalTypical * 1.5) {
    return '通常より時間がかかっていますが処理中です'
  }
  const currentRemaining = Math.max(0, currentTypical - elapsedSec * 0.3)
  let total = currentRemaining
  for (let i = idx + 1; i < STAGE_ORDER.length; i++) {
    total += STAGE_TYPICAL_SEC[STAGE_ORDER[i]] || 10
  }
  const rounded = Math.ceil(total / 10) * 10
  if (rounded < 10) return '残り約10秒'
  if (rounded < 60) return `残り約${rounded}秒`
  const min = Math.ceil(rounded / 60)
  return `残り約${min}分`
}

export function formatElapsed(ms) {
  if (!ms) return null
  const sec = Math.round(ms / 1000)
  return sec < 60 ? `${sec}秒` : `${Math.floor(sec / 60)}分${sec % 60}秒`
}

export function isAnalyzeTimeoutFailure(detail, retryable, stage) {
  if (!retryable) return false
  const normalizedDetail = String(detail || '').toLowerCase()
  const normalizedStage = String(stage || '').toLowerCase()
  const mentionsTimeout = normalizedDetail.includes('タイムアウト') || normalizedDetail.includes('timeout')
  const mentionsAnalyze = normalizedDetail.includes('analyze') || normalizedStage === 'analyze'
  return mentionsTimeout && mentionsAnalyze
}

export function isAutoResubmitEligible(detail, retryable, stage, errorInfo) {
  if (!retryable) return false
  const normalizedDetail = String(detail || '').toLowerCase()
  const normalizedStage = String(stage || '').toLowerCase()

  if (normalizedDetail.includes('timeout') || normalizedDetail.includes('タイムアウト')) return false
  if (isAnalyzeTimeoutFailure(detail, retryable, stage)) return false
  if (normalizedDetail.includes('停止しています')) return false

  if (errorInfo?.category === 'stale' || normalizedDetail.includes('応答しなくなりました')) return true

  if (normalizedDetail.includes('接続できませんでした') || normalizedDetail.includes('failed to fetch') || normalizedDetail.includes('cors')) return true
  if (normalizedDetail.includes('サーバー') && normalizedDetail.includes('起動中')) return true
  if (normalizedDetail.includes('job not found')) return true
  if (normalizedStage === 'queued' && normalizedDetail.includes('internal server error')) return true

  return false
}
