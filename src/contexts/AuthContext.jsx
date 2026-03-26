import { createContext, useContext, useState, useCallback, useRef } from 'react'
import { login as adsLogin, setToken, logout as adsLogout } from '../api/adsInsights'

const AuthContext = createContext(null)

const STORAGE_KEY_TOKEN = 'is_ads_token'
const STORAGE_KEY_GEMINI = 'is_gemini_key'

export function AuthProvider({ children }) {
  const onLogoutCallbacksRef = useRef(new Set())
  const [adsToken, setAdsToken] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TOKEN)
    if (saved) setToken(saved)
    return saved
  })
  const [geminiKey, setGeminiKeyState] = useState(
    () => localStorage.getItem(STORAGE_KEY_GEMINI) || ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const setGeminiKey = useCallback((key) => {
    setGeminiKeyState(key)
    if (key) {
      localStorage.setItem(STORAGE_KEY_GEMINI, key)
    } else {
      localStorage.removeItem(STORAGE_KEY_GEMINI)
    }
  }, [])

  const loginAds = useCallback(async (password) => {
    setLoading(true)
    setError(null)
    try {
      const data = await adsLogin(password)
      setAdsToken(data.token)
      localStorage.setItem(STORAGE_KEY_TOKEN, data.token)
      return data
    } catch (e) {
      setError(e.message)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const onAdsLogout = useCallback((cb) => {
    onLogoutCallbacksRef.current.add(cb)
    return () => onLogoutCallbacksRef.current.delete(cb)
  }, [])

  const logoutAds = useCallback(() => {
    adsLogout()
    setAdsToken(null)
    localStorage.removeItem(STORAGE_KEY_TOKEN)
    onLogoutCallbacksRef.current.forEach((cb) => cb())
  }, [])

  const value = {
    adsToken,
    geminiKey,
    setGeminiKey,
    loginAds,
    logoutAds,
    onAdsLogout,
    isAdsAuthenticated: !!adsToken,
    hasGeminiKey: !!geminiKey,
    loading,
    error,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
