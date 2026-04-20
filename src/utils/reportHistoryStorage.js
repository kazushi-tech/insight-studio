/**
 * AI考察画面のレポート履歴 localStorage 永続化層。
 * 案件 (case_id) スコープで v1 エントリを保存し、20件上限 FIFO + quota フォールバック。
 */

import { extractMarkdownSummary } from './adsReports'

const STORAGE_PREFIX = 'insight-studio-ads-report-history'
const MAX_ENTRIES = 20
const ENTRY_VERSION = 1

const QUERY_TYPE_LABELS = {
  search: '検索クエリ',
  landing: 'LP流入',
  user_attr: 'ユーザー属性',
  auction_proxy: 'オークション',
}

export function storageKeyForCase(caseId) {
  if (!caseId || typeof caseId !== 'string') return null
  return `${STORAGE_PREFIX}:${caseId}`
}

function safeParse(raw) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && typeof m.role === 'string' && typeof m.text === 'string')
    .map((m) => ({
      role: m.role === 'ai' ? 'assistant' : m.role,
      text: m.text,
      ...(m.isError ? { isError: true } : {}),
      ...(m.timestamp ? { timestamp: m.timestamp } : {}),
    }))
    .slice(-50)
}

function formatPeriods(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return '—'
  if (periods.length <= 3) return periods.join(', ')
  return `${periods.slice(0, 3).join(', ')} 他${periods.length - 3}件`
}

function formatQueryTypes(queryTypes) {
  if (!Array.isArray(queryTypes) || queryTypes.length === 0) return '—'
  return queryTypes.map((q) => QUERY_TYPE_LABELS[q] ?? q).join(' / ')
}

function firstParagraph(md) {
  if (typeof md !== 'string') return ''
  const cleaned = md
    .replace(/^#{1,6}\s.*$/gm, '')
    .replace(/^\s*[-*]\s?/gm, '')
    .replace(/\*\*/g, '')
    .trim()
  const lines = cleaned.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  return lines[0] ?? ''
}

export function buildEntryMetadata(setupState, reportBundle, messages) {
  const tldrSource = extractMarkdownSummary(reportBundle?.reportMd) || reportBundle?.reportMd || ''
  const tldrText = firstParagraph(tldrSource) || firstParagraph(reportBundle?.reportMd || '')
  const tldr = tldrText.length > 120 ? `${tldrText.slice(0, 120)}…` : tldrText

  const title = setupState?.completedAt
    ? new Date(setupState.completedAt).toLocaleString('ja-JP', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'レポート'

  return {
    title,
    tldr,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    periodsLabel: formatPeriods(setupState?.periods),
    queryTypesLabel: formatQueryTypes(setupState?.queryTypes),
  }
}

export function buildEntry({ caseId, setupState, reportBundle, messages, contextMode }) {
  const sanitizedMessages = sanitizeMessages(messages)
  const normalizedContextMode = contextMode === 'ads-with-ml' ? 'ads-with-ml' : 'ads-only'

  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  return {
    version: ENTRY_VERSION,
    id,
    caseId: caseId || null,
    createdAt: new Date().toISOString(),
    setupState: setupState
      ? {
          queryTypes: Array.isArray(setupState.queryTypes) ? [...setupState.queryTypes] : [],
          periods: Array.isArray(setupState.periods) ? [...setupState.periods] : [],
          granularity: setupState.granularity ?? 'monthly',
          datasetId: setupState.datasetId ?? '',
          completedAt: setupState.completedAt ?? null,
        }
      : null,
    reportBundle: reportBundle
      ? {
          reportMd: reportBundle.reportMd ?? '',
          chartGroups: Array.isArray(reportBundle.chartGroups) ? reportBundle.chartGroups : [],
          generatedAt: reportBundle.generatedAt ?? null,
          source: reportBundle.source ?? null,
        }
      : null,
    messages: sanitizedMessages,
    contextMode: normalizedContextMode,
    metadata: buildEntryMetadata(setupState, reportBundle, sanitizedMessages),
  }
}

export function loadHistory(caseId) {
  const key = storageKeyForCase(caseId)
  if (!key) return []
  try {
    const parsed = safeParse(localStorage.getItem(key))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e) => e && e.version === ENTRY_VERSION && typeof e.id === 'string')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  } catch {
    return []
  }
}

function trySaveRaw(key, entries) {
  localStorage.setItem(key, JSON.stringify(entries))
}

export function saveHistory(caseId, entries) {
  const key = storageKeyForCase(caseId)
  if (!key) return false
  const capped = Array.isArray(entries) ? entries.slice(0, MAX_ENTRIES) : []

  try {
    trySaveRaw(key, capped)
    return true
  } catch (err) {
    if (!isQuotaError(err)) {
      console.warn('[ReportHistory] save failed:', err)
      return false
    }
  }

  // Fallback 1: drop oldest 5, retry
  try {
    const trimmed = capped.slice(0, Math.max(0, capped.length - 5))
    trySaveRaw(key, trimmed)
    return true
  } catch (err) {
    if (!isQuotaError(err)) {
      console.warn('[ReportHistory] save fallback-1 failed:', err)
      return false
    }
  }

  // Fallback 2: strip chartGroups, cap at 10
  try {
    const slim = capped.slice(0, 10).map((e) => ({
      ...e,
      reportBundle: e.reportBundle ? { ...e.reportBundle, chartGroups: [] } : null,
    }))
    trySaveRaw(key, slim)
    return true
  } catch (err) {
    console.warn('[ReportHistory] save fallback-2 failed:', err)
    return false
  }
}

function isQuotaError(err) {
  if (!err) return false
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 ||
    err.code === 1014
  )
}

export const REPORT_HISTORY_MAX = MAX_ENTRIES
