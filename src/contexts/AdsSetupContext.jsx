import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useAuth } from './AuthContext'
import {
  DEFAULT_ADS_DATASET_ID,
  getCases,
  loginCase,
  getCaseTrustToken,
  setCaseTrustToken,
} from '../api/adsInsights'
import { platformApi } from '../api/platform'
import {
  buildEntry as buildHistoryEntry,
  loadHistory as loadReportHistory,
  saveHistory as saveReportHistory,
  REPORT_HISTORY_MAX,
} from '../utils/reportHistoryStorage'

const REPORT_HISTORY_UPDATED_EVENT = 'report-history-updated'
const AI_EXPLORER_DRAFT_KEY = 'is-draft-ai-explorer'

function arraysDiffer(a, b) {
  const arrA = Array.isArray(a) ? a : []
  const arrB = Array.isArray(b) ? b : []
  if (arrA.length !== arrB.length) return true
  const sortedA = [...arrA].sort()
  const sortedB = [...arrB].sort()
  for (let i = 0; i < sortedA.length; i += 1) {
    if (sortedA[i] !== sortedB[i]) return true
  }
  return false
}

function hasSetupChanged(prev, next) {
  if (!prev || !next) return false
  if (prev.projectRef !== next.projectRef) return true
  if (prev.datasetId !== next.datasetId) return true
  if (arraysDiffer(prev.periods, next.periods)) return true
  if (arraysDiffer(prev.queryTypes, next.queryTypes)) return true
  return false
}

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
  const projectRef = typeof state.projectRef === 'string' && state.projectRef.trim()
    ? state.projectRef.trim()
    : null

  if (queryTypes.length === 0 || periods.length === 0) return null

  return {
    version: STORAGE_VERSION,
    queryTypes,
    periods,
    granularity,
    datasetId,
    projectRef,
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
  const { authMode, isAdsAuthenticated, onAdsLogout, syncTokenFromApi, user } = useAuth()
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
    if (authMode !== 'clerk' && user?.role === 'case_user' && user.case_id) {
      const caseInfo = {
        case_id: user.case_id,
        name: user.display_name || user.case_id,
        dataset_id: user.dataset_id,
        is_demo: user.is_demo === true,
      }
      setCurrentCase(caseInfo) // eslint-disable-line react-hooks/set-state-in-effect -- sync user role
      setIsCaseAuthenticated(true)
      localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(caseInfo))
      localStorage.setItem(CASE_AUTH_KEY, 'true')
    }
  }, [authMode, user?.role, user?.case_id, user?.is_demo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clerk users select only from projects returned by the tenant-scoped API.
  // The browser keeps the project reference for navigation, but never receives
  // or persists the BigQuery dataset identifier.
  useEffect(() => {
    if (authMode !== 'clerk') return undefined
    let active = true

    if (!user?.user_id) {
      Promise.resolve().then(() => {
        if (!active) return
        setCurrentCase(null)
        setIsCaseAuthenticated(false)
        localStorage.removeItem(CASE_STORAGE_KEY)
        localStorage.removeItem(CASE_AUTH_KEY)
      })
      return () => { active = false }
    }

    platformApi.listProjects().then((response) => {
      if (!active) return
      const projects = (Array.isArray(response?.projects) ? response.projects : [])
        .filter((project) => !['archived', 'deleted'].includes(project?.status))

      let savedProjectId = null
      try {
        const saved = JSON.parse(localStorage.getItem(CASE_STORAGE_KEY) || 'null')
        savedProjectId = saved?.project_id || saved?.case_id || null
      } catch {
        localStorage.removeItem(CASE_STORAGE_KEY)
      }
      const selected = projects.find((project) => project.id === savedProjectId) || projects[0] || null
      if (!selected) {
        setCurrentCase(null)
        setIsCaseAuthenticated(false)
        localStorage.removeItem(CASE_STORAGE_KEY)
        localStorage.removeItem(CASE_AUTH_KEY)
        return
      }
      const caseInfo = {
        case_id: selected.id,
        project_id: selected.id,
        project_ref: selected.id,
        project_role: user?.project_roles?.[selected.id] || user?.workspace_role || null,
        name: selected.name,
        status: selected.status,
        is_demo: selected.is_demo === true,
      }
      setCurrentCase(caseInfo)
      setIsCaseAuthenticated(true)
      localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(caseInfo))
      localStorage.setItem(CASE_AUTH_KEY, 'true')
    }).catch(() => {
      if (!active) return
      setCurrentCase(null)
      setIsCaseAuthenticated(false)
      localStorage.removeItem(CASE_STORAGE_KEY)
      localStorage.removeItem(CASE_AUTH_KEY)
    })

    return () => { active = false }
  }, [authMode, user?.user_id, user?.workspace_role, user?.project_roles])

  // Run legacy migration on first mount. A legacy selection is not trusted
  // until it has been reconciled with the authenticated server registry.
  useEffect(() => {
    if (authMode === 'clerk') return
    migrateLegacyStorage()
  }, [authMode])

  // Admin selections are browser convenience state, not an authority source.
  // Reconcile them after every authenticated legacy login so a removed,
  // disabled, or differently configured case can never survive a new session.
  useEffect(() => {
    if (authMode === 'clerk' || user?.role === 'case_user') return undefined

    let active = true
    const savedCaseId = currentCase?.case_id || null

    const clearSelection = () => {
      setCurrentCase(null)
      setIsCaseAuthenticated(false)
      localStorage.removeItem(CASE_STORAGE_KEY)
      localStorage.removeItem(CASE_AUTH_KEY)
    }

    if (!isAdsAuthenticated) {
      Promise.resolve().then(() => {
        if (!active) return
        setIsCaseAuthenticated(false)
        localStorage.removeItem(CASE_AUTH_KEY)
      })
      return () => { active = false }
    }

    if (!['admin', 'operator'].includes(user?.role)) {
      Promise.resolve().then(() => {
        if (active) clearSelection()
      })
      return () => { active = false }
    }

    // Do not expose the saved selection while the server is validating it.
    Promise.resolve().then(() => {
      if (active) clearSelection()
    })

    getCases().then((response) => {
      if (!active) return
      const cases = (Array.isArray(response) ? response : response?.cases || [])
        .filter((caseInfo) => caseInfo?.case_id)
        .filter((caseInfo) => caseInfo.is_active !== false)
        .filter((caseInfo) => !['inactive', 'archived', 'deleted'].includes(caseInfo?.status))
      const selected = cases.find((caseInfo) => caseInfo.case_id === savedCaseId)
        || cases.find((caseInfo) => caseInfo.case_id === 'petabit')
        || cases[0]
        || null

      if (!selected) {
        clearSelection()
        return
      }

      setCurrentCase(selected)
      setIsCaseAuthenticated(true)
      localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(selected))
      localStorage.setItem(CASE_AUTH_KEY, 'true')
    }).catch(() => {
      if (active) clearSelection()
    })

    return () => { active = false }
  }, [authMode, isAdsAuthenticated, user?.role]) // eslint-disable-line react-hooks/exhaustive-deps

  const [setupState, setSetupState] = useState(() => loadState(currentCase?.case_id))
  const [reportBundle, setReportBundle] = useState(null)

  // Re-load setup state when case changes
  useEffect(() => {
    const state = loadState(currentCase?.case_id)
    setSetupState(state) // eslint-disable-line react-hooks/set-state-in-effect -- sync on case change
    setReportBundle(null)
  }, [currentCase?.case_id])

  const resetSetup = useCallback(() => {
    setSetupState(null)
    setReportBundle(null)
    saveState(null, currentCase?.case_id)
  }, [currentCase?.case_id])

  // Case management functions
  const selectCase = useCallback((caseInfo) => {
    const nextCase = authMode === 'clerk' && caseInfo
      ? {
          case_id: caseInfo.project_id || caseInfo.id || caseInfo.case_id,
          project_id: caseInfo.project_id || caseInfo.id || caseInfo.case_id,
          project_ref: caseInfo.project_ref || caseInfo.project_id || caseInfo.id || caseInfo.case_id,
          project_role: caseInfo.project_role || user?.project_roles?.[caseInfo.project_id || caseInfo.id || caseInfo.case_id] || user?.workspace_role || null,
          name: caseInfo.name,
          status: caseInfo.status,
          is_demo: caseInfo.is_demo === true,
        }
      : caseInfo
    setCurrentCase(nextCase)
    setIsCaseAuthenticated(Boolean(nextCase))
    if (nextCase) {
      localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(nextCase))
      localStorage.setItem(CASE_AUTH_KEY, 'true')
    }
  }, [authMode, user?.project_roles, user?.workspace_role])

  // Returns { status: 'ok', caseInfo } or { status: 'totp_required', caseName }.
  // Throws on hard failures (wrong password, network, etc.).
  const authenticateCase = useCallback(async (caseId, password, { totpCode = null } = {}) => {
    if (authMode === 'clerk') {
      throw new Error('組織の招待と案件権限でログインしてください。')
    }
    const trustToken = getCaseTrustToken(caseId)
    const result = await loginCase(caseId, password, {
      totpCode,
      deviceTrustToken: trustToken,
    })
    if (!result.ok) {
      if (result.totp_required) {
        return { status: 'totp_required', caseName: result.name || caseId, caseId }
      }
      throw new Error(result.error || '認証に失敗しました')
    }
    const caseInfo = {
      case_id: result.case_id,
      name: result.name,
      dataset_id: result.dataset_id,
      is_demo: result.is_demo === true,
    }
    setCurrentCase(caseInfo)
    setIsCaseAuthenticated(true)
    localStorage.setItem(CASE_STORAGE_KEY, JSON.stringify(caseInfo))
    localStorage.setItem(CASE_AUTH_KEY, 'true')
    // Stale trust token → server didn't accept it; loginCase already saved a new one on success
    if (trustToken && !result.device_trust_token) {
      setCaseTrustToken(caseId, null)
    }
    // loginCase が token を返していたら AuthContext にも同期
    syncTokenFromApi()
    return { status: 'ok', caseInfo }
  }, [authMode, syncTokenFromApi])

  const clearCase = useCallback(() => {
    setCurrentCase(null)
    setIsCaseAuthenticated(false)
    localStorage.removeItem(CASE_STORAGE_KEY)
    localStorage.removeItem(CASE_AUTH_KEY)
    resetSetup()
  }, [resetSetup])

  const getCurrentDatasetId = useCallback(() => {
    if (authMode === 'clerk') return undefined
    return currentCase?.dataset_id ?? DEFAULT_ADS_DATASET_ID
  }, [authMode, currentCase])

  useEffect(() => {
    return onAdsLogout(() => {
      setSetupState(null)
      setReportBundle(null)
      setCurrentCase(null)
      setIsCaseAuthenticated(false)
      localStorage.removeItem(CASE_STORAGE_KEY)
      localStorage.removeItem(CASE_AUTH_KEY)
      sessionStorage.removeItem(AI_EXPLORER_DRAFT_KEY)
    })
  }, [onAdsLogout])

  const completeSetup = useCallback((payload, nextReportBundle = null) => {
    const state = {
      version: STORAGE_VERSION,
      queryTypes: payload.queryTypes,
      periods: payload.periods,
      granularity: payload.granularity,
      datasetId: authMode === 'clerk' ? 'managed' : (payload.datasetId ?? getCurrentDatasetId()),
      projectRef: authMode === 'clerk'
        ? (payload.projectRef || currentCase?.project_id || currentCase?.case_id || null)
        : (payload.projectRef || null),
      completedAt: new Date().toISOString(),
    }

    // Auto-archive previous report before overwriting state.
    // Only fires when setup semantically changes (periods / datasetId / queryTypes),
    // so granularity-only tweaks do not pollute history.
    const caseId = currentCase?.case_id ?? null
    if (caseId && setupState && reportBundle?.reportMd && hasSetupChanged(setupState, state)) {
      try {
        const draftRaw = sessionStorage.getItem(AI_EXPLORER_DRAFT_KEY)
        const draft = draftRaw ? JSON.parse(draftRaw) : null
        const prevMessages = Array.isArray(draft?.messages) ? draft.messages : []
        if (prevMessages.length > 0) {
          const existing = loadReportHistory(caseId)
          const entry = buildHistoryEntry({
            caseId,
            setupState,
            reportBundle,
            messages: prevMessages,
            contextMode: draft?.contextMode ?? 'ads-only',
          })
          const next = [entry, ...existing].slice(0, REPORT_HISTORY_MAX)
          saveReportHistory(caseId, next)
          sessionStorage.removeItem(AI_EXPLORER_DRAFT_KEY)
          window.dispatchEvent(new Event(REPORT_HISTORY_UPDATED_EVENT))
        }
      } catch (e) {
        console.warn('[ReportHistory] auto-archive failed:', e)
      }
    }

    setSetupState(state)
    setReportBundle(nextReportBundle)
    saveState(state, currentCase?.case_id)
    // Setup completion implies the current case is authenticated
    // (data was successfully fetched from backend during wizard)
    setIsCaseAuthenticated(true)
    localStorage.setItem(CASE_AUTH_KEY, 'true')
  }, [authMode, currentCase?.case_id, currentCase?.project_id, getCurrentDatasetId, setupState, reportBundle])

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
