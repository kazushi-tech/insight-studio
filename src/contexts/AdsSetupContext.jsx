import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { DEFAULT_ADS_DATASET_ID } from '../api/adsInsights'

const AdsSetupContext = createContext(null)

const STORAGE_KEY = 'insight-studio-ads-setup'
const STORAGE_VERSION = 3
const QUERY_TYPE_MIGRATIONS = {
  search_query: 'search',
  lp: 'landing',
  demographics: 'user_attr',
  auction: 'auction_proxy',
}
const VALID_GRANULARITIES = new Set(['monthly', 'weekly', 'daily'])

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return []

  const seen = new Set()

  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false
      seen.add(value)
      return true
    })
}

function normalizeSetupState(state) {
  if (!state?.completedAt) return null

  const queryTypes = normalizeStringArray(
    normalizeStringArray(state.queryTypes).map(
      (queryType) => QUERY_TYPE_MIGRATIONS[queryType] ?? queryType,
    ),
  )
  const periods = normalizeStringArray(state.periods)
  const granularity = VALID_GRANULARITIES.has(state.granularity) ? state.granularity : 'monthly'
  const datasetId =
    typeof state.datasetId === 'string' && state.datasetId.trim().length > 0
      ? state.datasetId.trim()
      : DEFAULT_ADS_DATASET_ID

  if (queryTypes.length === 0 || periods.length === 0) return null

  return {
    version: STORAGE_VERSION,
    queryTypes,
    periods,
    granularity,
    datasetId,
    completedAt: state.completedAt,
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const normalized = normalizeSetupState(parsed)
    if (!normalized) {
      localStorage.removeItem(STORAGE_KEY)
      return null
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    return normalized
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

function saveState(state) {
  if (!state) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }

  const normalized = normalizeSetupState(state)
  if (!normalized) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
}

export function AdsSetupProvider({ children }) {
  const { onAdsLogout } = useAuth()
  const [setupState, setSetupState] = useState(loadState)
  const [reportBundle, setReportBundle] = useState(null)

  const resetSetup = useCallback(() => {
    setSetupState(null)
    setReportBundle(null)
    saveState(null)
  }, [])

  useEffect(() => {
    return onAdsLogout(resetSetup)
  }, [onAdsLogout, resetSetup])

  const completeSetup = useCallback((payload, nextReportBundle = null) => {
    const state = {
      version: STORAGE_VERSION,
      queryTypes: payload.queryTypes,
      periods: payload.periods,
      granularity: payload.granularity,
      datasetId: payload.datasetId ?? DEFAULT_ADS_DATASET_ID,
      completedAt: new Date().toISOString(),
    }
    setSetupState(state)
    setReportBundle(nextReportBundle)
    saveState(state)
  }, [])

  return (
    <AdsSetupContext.Provider
      value={{
        setupState,
        isSetupComplete: !!setupState,
        reportBundle,
        setReportBundle,
        completeSetup,
        resetSetup,
      }}
    >
      {children}
    </AdsSetupContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAdsSetup() {
  const ctx = useContext(AdsSetupContext)
  if (!ctx) throw new Error('useAdsSetup must be used within AdsSetupProvider')
  return ctx
}
