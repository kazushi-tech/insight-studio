import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { login as adsLogin, setToken, logout as adsLogout, setOnAuthError } from '../api/adsInsights'
import {
  ANALYSIS_PROVIDER_ANTHROPIC,
} from '../utils/analysisProvider'
import { isCompatibleApiKey, normalizeApiKey } from '../utils/apiKeys'

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
    () => normalizeApiKey(localStorage.getItem(STORAGE_KEY_CLAUDE) || '')
  )

  // Gemini API key — 画像生成用
  const [geminiKey, setGeminiKeyState] = useState(
    () => normalizeApiKey(localStorage.getItem(STORAGE_KEY_GEMINI) || '')
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const setClaudeKey = useCallback((key) => {
    const normalized = normalizeApiKey(key)
    setClaudeKeyState(normalized)
    if (normalized) {
      localStorage.setItem(STORAGE_KEY_CLAUDE, normalized)
    } else {
      localStorage.removeItem(STORAGE_KEY_CLAUDE)
    }
  }, [])

  const setGeminiKey = useCallback((key) => {
    const normalized = normalizeApiKey(key)
    setGeminiKeyState(normalized)
    if (normalized) {
      localStorage.setItem(STORAGE_KEY_GEMINI, normalized)
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

  const hasClaudeKey = isCompatibleApiKey(claudeKey, ANALYSIS_PROVIDER_ANTHROPIC)
  const hasGeminiKey = isCompatibleApiKey(geminiKey, 'google')
  const analysisKey = hasClaudeKey ? claudeKey : ''
  const analysisProvider = hasClaudeKey ? ANALYSIS_PROVIDER_ANTHROPIC : null

  const value = {
    adsToken,
    // Claude key — 分析用
    claudeKey,
    setClaudeKey,
    hasClaudeKey,
    // Gemini key — 画像生成用
    geminiKey,
    setGeminiKey,
    hasGeminiKey,
    // 分析系は Claude のみを使用
    analysisKey,
    analysisProvider,
    hasAnalysisKey: !!analysisKey,
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
