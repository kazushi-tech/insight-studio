import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { DEFAULT_ADS_DATASET_ID, loginCase } from '../api/adsInsights'

const AdsSetupContext = createContext(null)

const STORAGE_KEY_PREFIX = 'insight-studio-ads-setup'
const LEGACY_STORAGE_KEY = 'insight-studio-ads-setup'
const CASE_STORAGE_KEY = 'insight-studio-current-case'
const CASE_AUTH_KEY = 'insight-studio-case-authenticated'
const STORAGE_VERSION = 3
const QUERY_TYPE_MIGRATIONS = {
  search_query: 'search',
  lp: 'landing',
  demographics: 'user_attr',
  auction: 'auction_proxy',
}
const VALID_GRANULARITIES = new Set(['monthly', 'weekly', 'daily'])

function storageKeyForCase(caseId) {
  return caseId ? `${STORAGE_KEY_PREFIX}:${caseId}` : LEGACY_STORAGE_KEY
}

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

function loadState(caseId) {
  try {
    const key = storageKeyForCase(caseId)
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const normalized = normalizeSetupState(parsed)
    if (!normalized) {
      localStorage.removeItem(key)
      return null
    }
    localStorage.setItem(key, JSON.stringify(normalized))
    return normalized
  } catch {
    return null
  }
}

function saveState(state, caseId) {
  const key = storageKeyForCase(caseId)
  if (!state) {
    localStorage.removeItem(key)
    return
  }

  const normalized = normalizeSetupState(state)
  if (!normalized) {
    localStorage.removeItem(key)
    return
  }

  localStorage.setItem(key, JSON.stringify(normalized))
}

function migrateLegacyStorage() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    const normalized = normalizeSetupState(parsed)
    if (normalized) {
      const petabitKey = storageKeyForCase('petabit')
      if (!localStorage.getItem(petabitKey)) {
        localStorage.setItem(petabitKey, JSON.stringify(normalized))
      }
    }
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  }
}

export function AdsSetupProvider({ children }) {
  const { onAdsLogout, syncTokenFromApi, user } = useAuth()
  const [currentCase, setCurrentCase] = useState(() => {
    try {
      const saved = localStorage.getItem(CASE_STORAGE_KEY)
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })
  const [isCaseAuthenticated, setIsCaseAuthenticated] = useState(() => {
    return localStorage.getItem(CASE_AUTH_KEY) === 'true'
  })

  // Auto-set case for case_user login
  useEffect(() => {
    if (user?.role === 'case_user' && user.case_id) {
      const caseInfo = {
        case_id: user.case_id,
        name: user.display_name || user.case_id,
        dataset_id: user.dataset_id,
      }
      setCurrentCase(caseInfo)
      setIsCaseAuthenticated(true)
      localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(caseInfo))
      localStorage.setItem(CASE_AUTH_KEY, 'true')
    }
  }, [user?.role, user?.case_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Run legacy migration on first mount
  useEffect(() => {
    migrateLegacyStorage()
    // If no case is set and not a case_user, auto-select petabit
    if (!currentCase && user?.role !== 'case_user') {
      const petabitCase = { case_id: 'petabit', name: 'ペタビット', dataset_id: 'analytics_311324674' }
      setCurrentCase(petabitCase)
      localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(petabitCase))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [setupState, setSetupState] = useState(() => loadState(currentCase?.case_id))
  const [reportBundle, setReportBundle] = useState(null)

  // Re-load setup state when case changes
  useEffect(() => {
    const state = loadState(currentCase?.case_id)
    setSetupState(state)
    setReportBundle(null)
  }, [currentCase?.case_id])

  const resetSetup = useCallback(() => {
    setSetupState(null)
    setReportBundle(null)
    saveState(null, currentCase?.case_id)
  }, [currentCase?.case_id])

  // Case management functions
  const selectCase = useCallback((caseInfo) => {
    setCurrentCase(caseInfo)
    localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(caseInfo))
  }, [])

  const authenticateCase = useCallback(async (caseId, password) => {
    const result = await loginCase(caseId, password)
    const caseInfo = {
      case_id: result.case_id,
      name: result.name,
      dataset_id: result.dataset_id,
    }
    setCurrentCase(caseInfo)
    setIsCaseAuthenticated(true)
    localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(caseInfo))
    localStorage.setItem(CASE_AUTH_KEY, 'true')
    // loginCase が token を返していたら AuthContext にも同期
    syncTokenFromApi()
    return caseInfo
  }, [syncTokenFromApi])

  const clearCase = useCallback(() => {
    setCurrentCase(null)
    setIsCaseAuthenticated(false)
    localStorage.removeItem(CASE_STORAGE_KEY)
    localStorage.removeItem(CASE_AUTH_KEY)
    resetSetup()
  }, [resetSetup])

  const getCurrentDatasetId = useCallback(() => {
    return currentCase?.dataset_id ?? DEFAULT_ADS_DATASET_ID
  }, [currentCase])

  useEffect(() => {
    return onAdsLogout(() => {
      resetSetup()
      setIsCaseAuthenticated(false)
      localStorage.removeItem(CASE_AUTH_KEY)
    })
  }, [onAdsLogout, resetSetup])

  const completeSetup = useCallback((payload, nextReportBundle = null) => {
    const state = {
      version: STORAGE_VERSION,
      queryTypes: payload.queryTypes,
      periods: payload.periods,
      granularity: payload.granularity,
      datasetId: payload.datasetId ?? getCurrentDatasetId(),
      completedAt: new Date().toISOString(),
    }
    setSetupState(state)
    setReportBundle(nextReportBundle)
    saveState(state, currentCase?.case_id)
    // Setup completion implies the current case is authenticated
    // (data was successfully fetched from backend during wizard)
    setIsCaseAuthenticated(true)
    localStorage.setItem(CASE_AUTH_KEY, 'true')
  }, [currentCase?.case_id, getCurrentDatasetId])

  return (
    <AdsSetupContext.Provider
      value={{
        setupState,
        isSetupComplete: !!setupState,
        reportBundle,
        setReportBundle,
        completeSetup,
        resetSetup,
        // Case management
        currentCase,
        isCaseAuthenticated,
        selectCase,
        authenticateCase,
        clearCase,
        getCurrentDatasetId,
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
