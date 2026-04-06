import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { login as adsLogin, setToken, getToken, logout as adsLogout, setOnAuthError } from '../api/adsInsights'
import {
  ANALYSIS_PROVIDER_ANTHROPIC,
} from '../utils/analysisProvider'
import { isCompatibleApiKey, normalizeApiKey } from '../utils/apiKeys'

const AuthContext = createContext(null)

const STORAGE_KEY_TOKEN = 'is_ads_token'
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

  // loginCase() 経由で取得したtokenをAuthContextにも反映
  const syncTokenFromApi = useCallback(() => {
    const currentToken = getToken()
    if (currentToken && !adsToken) {
      setAdsToken(currentToken)
      localStorage.setItem(STORAGE_KEY_TOKEN, currentToken)
    }
  }, [adsToken])

  const [authExpiredMessage, setAuthExpiredMessage] = useState(null)
  const clearAuthExpiredMessage = useCallback(() => setAuthExpiredMessage(null), [])

  useEffect(() => {
    setOnAuthError(() => {
      logoutAds()
      setAuthExpiredMessage('セッションの有効期限が切れました。再ログインしてください。')
    })
    return () => setOnAuthError(null)
  }, [logoutAds])

  const hasClaudeKey = isCompatibleApiKey(claudeKey, ANALYSIS_PROVIDER_ANTHROPIC)
  const analysisKey = hasClaudeKey ? claudeKey : ''
  const analysisProvider = hasClaudeKey ? ANALYSIS_PROVIDER_ANTHROPIC : null

  const value = {
    adsToken,
    // Claude key — 分析用
    claudeKey,
    setClaudeKey,
    hasClaudeKey,
    // 分析系は Claude のみを使用
    analysisKey,
    analysisProvider,
    hasAnalysisKey: !!analysisKey,
    // Ads auth
    loginAds,
    logoutAds,
    onAdsLogout,
    syncTokenFromApi,
    isAdsAuthenticated: !!adsToken,
    loading,
    error,
    authExpiredMessage,
    clearAuthExpiredMessage,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
