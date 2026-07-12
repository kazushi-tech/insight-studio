import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export const REPORT_FILTER_DEFAULTS = Object.freeze({
  period: 'latest',
  theme: 'all',
  view: 'summary',
})

const KNOWN_REPORT_THEMES = new Set(['all', 'cv', 'traffic', 'lp', 'device', 'time', 'anomaly', 'other'])
const REPORT_VIEWS = new Set(['summary', 'analyst'])

function stringValues(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => typeof value === 'string' ? value : value?.id ?? value?.value)
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
}
function safeUnlistedPeriod(value) {
  return value.length <= 80 && !/[\s?#&]/.test(value)
}

export function normalizeReportPeriod(value, availablePeriods = []) {
  const period = String(value ?? '').trim()
  if (!period) return REPORT_FILTER_DEFAULTS.period
  if (period === 'latest' || period === 'all') return period
  const periods = stringValues(availablePeriods)
  if (periods.length > 0) return periods.includes(period) ? period : REPORT_FILTER_DEFAULTS.period
  return safeUnlistedPeriod(period) ? period : REPORT_FILTER_DEFAULTS.period
}

export function normalizeReportTheme(value, availableThemes = []) {
  const alias = String(value ?? '').trim() === 'landing' ? 'lp' : String(value ?? '').trim()
  if (!alias) return REPORT_FILTER_DEFAULTS.theme
  const themes = stringValues(availableThemes)
  const allowed = themes.length > 0
    ? new Set([REPORT_FILTER_DEFAULTS.theme, ...themes])
    : KNOWN_REPORT_THEMES
  return allowed.has(alias) ? alias : REPORT_FILTER_DEFAULTS.theme
}

export function normalizeReportView(value) {
  const rawView = String(value ?? '').trim()
  const view = rawView === 'exec' ? 'summary' : rawView
  return REPORT_VIEWS.has(view) ? view : REPORT_FILTER_DEFAULTS.view
}

function toSearchParams(value) {
  if (value instanceof URLSearchParams) return new URLSearchParams(value)
  return new URLSearchParams(value ?? '')
}

export function normalizeReportFilters(value, options = {}) {
  const params = toSearchParams(value)
  return {
    period: normalizeReportPeriod(params.get('period'), options.availablePeriods),
    theme: normalizeReportTheme(params.get('theme'), options.availableThemes),
    view: normalizeReportView(params.get('view')),
  }
}

export function buildReportSearchParams(currentValue, patch = {}, options = {}) {
  const next = toSearchParams(currentValue)
  if (Object.hasOwn(patch, 'period')) {
    if (patch.period == null || patch.period === '') next.delete('period')
    else next.set('period', normalizeReportPeriod(patch.period, options.availablePeriods))
  }
  if (Object.hasOwn(patch, 'theme')) {
    if (patch.theme == null || patch.theme === '') next.delete('theme')
    else next.set('theme', normalizeReportTheme(patch.theme, options.availableThemes))
  }
  if (Object.hasOwn(patch, 'view')) {
    if (patch.view == null || patch.view === '') next.delete('view')
    else next.set('view', normalizeReportView(patch.view))
  }
  return next
}

/**
 * URL-backed filters shared by the conclusion report and evidence graphs.
 * Setters preserve unrelated query parameters and replace browser history by
 * default so filter changes do not make the Back button noisy.
 */
export function useReportFilters(options = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = normalizeReportFilters(searchParams, options)

  const setFilters = useCallback((patch, navigationOptions = {}) => {
    setSearchParams(
      (current) => buildReportSearchParams(current, patch, options),
      { replace: navigationOptions.replace ?? true },
    )
  }, [options, setSearchParams])

  const setPeriod = useCallback((period, navigationOptions) => {
    setFilters({ period }, navigationOptions)
  }, [setFilters])

  const setTheme = useCallback((theme, navigationOptions) => {
    setFilters({ theme }, navigationOptions)
  }, [setFilters])

  const setView = useCallback((view, navigationOptions) => {
    setFilters({ view }, navigationOptions)
  }, [setFilters])

  return {
    ...filters,
    searchParams,
    setFilters,
    setPeriod,
    setTheme,
    setView,
  }
}
