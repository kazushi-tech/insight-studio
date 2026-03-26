import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useAuth } from './AuthContext'

const AdsSetupContext = createContext(null)

const STORAGE_KEY = 'insight-studio-ads-setup'

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && parsed.completedAt) return parsed
    return null
  } catch {
    return null
  }
}

function saveState(state) {
  if (state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function AdsSetupProvider({ children }) {
  const { onAdsLogout } = useAuth()
  const [setupState, setSetupState] = useState(loadState)

  const resetSetup = useCallback(() => {
    setSetupState(null)
    saveState(null)
  }, [])

  useEffect(() => {
    return onAdsLogout(resetSetup)
  }, [onAdsLogout, resetSetup])

  const completeSetup = useCallback((payload) => {
    const state = {
      queryTypes: payload.queryTypes,
      period: payload.period,
      granularity: payload.granularity,
      completedAt: new Date().toISOString(),
    }
    setSetupState(state)
    saveState(state)
  }, [])

  return (
    <AdsSetupContext.Provider
      value={{
        setupState,
        isSetupComplete: !!setupState,
        completeSetup,
        resetSetup,
      }}
    >
      {children}
    </AdsSetupContext.Provider>
  )
}

export function useAdsSetup() {
  const ctx = useContext(AdsSetupContext)
  if (!ctx) throw new Error('useAdsSetup must be used within AdsSetupProvider')
  return ctx
}
