import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { login as adsLogin, setToken, logout as adsLogout, setOnAuthError } from '../api/adsInsights'

const AuthContext = createContext(null)

const STORAGE_KEY_TOKEN = 'is_ads_token'
const STORAGE_KEY_GEMINI = 'is_gemini_key'
const STORAGE_KEY_CLAUDE = 'is_claude_key'

export function AuthProvider({ children }) {
  const onLogoutCallbacksRef = useRef(new Set())
  const [adsToken, setAdsToken] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_TOKEN)
    if (saved) setToken(saved)
    return saved
  })

  // Claude API key — 分析・類推系 (Compare, Discovery, CreativeReview review, AiExplorer)
  const [claudeKey, setClaudeKeyState] = useState(
    () => localStorage.getItem(STORAGE_KEY_CLAUDE) || ''
  )

  // Gemini API key — 画像生成用 (CreativeReview generation / Nano Banana2)
  // Legacy: 既存の is_gemini_key をそのまま画像生成用として扱う
  const [geminiKey, setGeminiKeyState] = useState(
    () => localStorage.getItem(STORAGE_KEY_GEMINI) || ''
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const setClaudeKey = useCallback((key) => {
    setClaudeKeyState(key)
    if (key) {
      localStorage.setItem(STORAGE_KEY_CLAUDE, key)
    } else {
      localStorage.removeItem(STORAGE_KEY_CLAUDE)
    }
  }, [])

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

  useEffect(() => {
    setOnAuthError(() => logoutAds())
    return () => setOnAuthError(null)
  }, [logoutAds])

  const value = {
    adsToken,
    // Claude key — 分析用
    claudeKey,
    setClaudeKey,
    hasClaudeKey: !!claudeKey,
    // Gemini key — 画像生成用 (legacy互換)
    geminiKey,
    setGeminiKey,
    hasGeminiKey: !!geminiKey,
    // 便利フラグ: 分析系が使える状態か
    hasAnalysisKey: !!claudeKey,
    // Ads auth
    loginAds,
    logoutAds,
    onAdsLogout,
    isAdsAuthenticated: !!adsToken,
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
