import { createContext, useContext, useState, useEffect } from 'react'
import { login as adsLogin, setToken, getToken, logout as adsLogout } from '../api/adsInsights'

const AuthContext = createContext(null)

const STORAGE_KEY_TOKEN = 'is_ads_token'
const STORAGE_KEY_GEMINI = 'is_gemini_key'

export function AuthProvider({ children }) {
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

  function setGeminiKey(key) {
    setGeminiKeyState(key)
    if (key) {
      localStorage.setItem(STORAGE_KEY_GEMINI, key)
    } else {
      localStorage.removeItem(STORAGE_KEY_GEMINI)
    }
  }

  async function loginAds(password) {
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
  }

  const onLogoutCallbacks = []

  function onAdsLogout(cb) {
    onLogoutCallbacks.push(cb)
  }

  function logoutAds() {
    adsLogout()
    setAdsToken(null)
    localStorage.removeItem(STORAGE_KEY_TOKEN)
    onLogoutCallbacks.forEach((cb) => cb())
  }

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

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
