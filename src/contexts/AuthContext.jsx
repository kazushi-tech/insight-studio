import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import {
  login as adsLogin,
  setToken,
  getToken,
  logout as adsLogout,
  setOnAuthError,
  setAuthTokenProvider as setAdsAuthTokenProvider,
  loginWithEmail as apiLoginWithEmail,
} from '../api/adsInsights'
import { setMarketLensAuthTokenProvider } from '../api/marketLens'
import { setProjectReportsAuthTokenProvider } from '../api/projectReports'
import { platformApi, setPlatformAuthTokenProvider } from '../api/platform'
import { setBillingAuthTokenProvider } from '../api/billing'
import { setLegalAuthTokenProvider } from '../api/legal'
import {
  ANALYSIS_PROVIDER_ANTHROPIC,
  ANALYSIS_PROVIDER_GEMINI,
} from '../utils/analysisProvider'
import { isCompatibleApiKey, normalizeApiKey } from '../utils/apiKeys'

const AuthContext = createContext(null)

const STORAGE_KEY_TOKEN = 'is_ads_token'
const SESSION_KEY_CLAUDE = 'is_claude_key'
const SESSION_KEY_GEMINI = 'is_gemini_key'

function loadSessionSecret(key) {
  const value = normalizeApiKey(sessionStorage.getItem(key) || '')
  // 旧版がlocalStorageへ保存したキーは、永続化を避けるため移行せず削除する。
  localStorage.removeItem(key)
  return value
}

export function AuthProvider({ children, initialToken = null, initialUser = null, clerkSession = null }) {
  const authMode = clerkSession ? 'clerk' : 'legacy'
  const onLogoutCallbacksRef = useRef(new Set())
  const [adsToken, setAdsToken] = useState(() => {
    // Remove credentials left by the pre-Clerk client. Authentication tokens
    // are memory-only; Clerk will supply short-lived tokens through providers.
    localStorage.removeItem(STORAGE_KEY_TOKEN)
    if (initialToken) setToken(initialToken)
    return initialToken || null
  })

  // Claude API key — 分析・類推系 (Compare, Discovery, CreativeReview review, AiExplorer)
  const [claudeKey, setClaudeKeyState] = useState(
    () => loadSessionSecret(SESSION_KEY_CLAUDE)
  )

  // Gemini API key — BYOK: ユーザーが自分のキーを使う (課金はユーザーのGCPアカウントへ)
  const [geminiKey, setGeminiKeyState] = useState(
    () => loadSessionSecret(SESSION_KEY_GEMINI)
  )

  // RBAC user object { user_id, email, role, display_name }
  const [user, setUser] = useState(() => {
    if (initialUser) return initialUser
    if (clerkSession) {
      localStorage.removeItem('is_user')
      return null
    }
    try {
      const saved = localStorage.getItem('is_user')
      return saved ? JSON.parse(saved) : null
    } catch { return null }
  })

  const [loading, setLoading] = useState(false)
  const [platformSyncing, setPlatformSyncing] = useState(Boolean(clerkSession))
  const [platformSyncError, setPlatformSyncError] = useState(null)
  const [platformSyncNonce, setPlatformSyncNonce] = useState(0)
  const [error, setError] = useState(null)
  const [authExpiredMessage, setAuthExpiredMessage] = useState(null)
  const clearAuthExpiredMessage = useCallback(() => setAuthExpiredMessage(null), [])

  const setClaudeKey = useCallback((key) => {
    const normalized = normalizeApiKey(key)
    setClaudeKeyState(normalized)
    if (normalized) {
      sessionStorage.setItem(SESSION_KEY_CLAUDE, normalized)
    } else {
      sessionStorage.removeItem(SESSION_KEY_CLAUDE)
    }
  }, [])

  const setGeminiKey = useCallback((key) => {
    const normalized = normalizeApiKey(key)
    setGeminiKeyState(normalized)
    if (normalized) {
      sessionStorage.setItem(SESSION_KEY_GEMINI, normalized)
    } else {
      sessionStorage.removeItem(SESSION_KEY_GEMINI)
    }
  }, [])

  const loginAds = useCallback(async (password) => {
    setLoading(true)
    setError(null)
    try {
      const data = await adsLogin(password)
      setAuthExpiredMessage(null)
      setAdsToken(data.token)
      const userData = { role: 'admin', display_name: 'オペレーター' }
      setUser(userData)
      localStorage.setItem('is_user', JSON.stringify(userData))
      return data
    } catch (e) {
      setError(e.message)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  // Email login (RBAC) — returns JWT with user_id + role
  const handleLoginWithEmail = useCallback(async (email, password) => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiLoginWithEmail(email, password)
      setAuthExpiredMessage(null)
      if (data.token) {
        setAdsToken(data.token)
      }
      const userData = data.user || { user_id: data.user_id, email, role: data.role, display_name: data.display_name || email }
      setUser(userData)
      localStorage.setItem('is_user', JSON.stringify(userData))
      return data
    } catch (e) {
      setError(e.message)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  // Case login — パスワード1つで案件にログイン
  const handleLoginWithCase = useCallback((caseResult) => {
    setAuthExpiredMessage(null)
    // caseResult = { case_id, name, dataset_id, token? }
    if (caseResult.token) {
      setAdsToken(caseResult.token)
      setToken(caseResult.token)
    }
    const userData = {
      role: 'case_user',
      case_id: caseResult.case_id,
      display_name: caseResult.name || caseResult.case_id,
      dataset_id: caseResult.dataset_id,
      is_demo: caseResult.is_demo === true,
    }
    setUser(userData)
    localStorage.setItem('is_user', JSON.stringify(userData))
  }, [])

  const onAdsLogout = useCallback((cb) => {
    onLogoutCallbacksRef.current.add(cb)
    return () => onLogoutCallbacksRef.current.delete(cb)
  }, [])

  const logoutAds = useCallback(() => {
    adsLogout()
    setAdsToken(null)
    setUser(null)
    setClaudeKeyState('')
    setGeminiKeyState('')
    sessionStorage.removeItem(SESSION_KEY_CLAUDE)
    sessionStorage.removeItem(SESSION_KEY_GEMINI)
    localStorage.removeItem(STORAGE_KEY_TOKEN)
    localStorage.removeItem('is_user')
    onLogoutCallbacksRef.current.forEach((cb) => cb())
    if (clerkSession?.signOut) void clerkSession.signOut()
  }, [clerkSession])

  const refreshPlatformSession = useCallback(() => {
    setPlatformSyncNonce((value) => value + 1)
  }, [])

  // loginCase() 経由で取得したtokenをAuthContextにも反映
  const syncTokenFromApi = useCallback(() => {
    const currentToken = getToken()
    if (currentToken && !adsToken) {
      setAdsToken(currentToken)
    }
  }, [adsToken])

  // Token refresh: APIレスポンスに新しいトークンが含まれていたら差し替える
  const refreshTokenIfNeeded = useCallback((response) => {
    if (response?.refreshed_token) {
      setAdsToken(response.refreshed_token)
      setToken(response.refreshed_token)
    }
  }, [])

  const getAccessToken = useCallback(async () => {
    if (clerkSession?.isSignedIn && clerkSession?.getToken) {
      return clerkSession.getToken()
    }
    return adsToken || null
  }, [adsToken, clerkSession])

  useEffect(() => {
    setAdsAuthTokenProvider(getAccessToken)
    setMarketLensAuthTokenProvider(getAccessToken)
    setProjectReportsAuthTokenProvider(getAccessToken)
    setPlatformAuthTokenProvider(getAccessToken)
    setBillingAuthTokenProvider(getAccessToken)
    setLegalAuthTokenProvider(getAccessToken)
    return () => {
      setAdsAuthTokenProvider(null)
      setMarketLensAuthTokenProvider(null)
      setProjectReportsAuthTokenProvider(null)
      setPlatformAuthTokenProvider(null)
      setBillingAuthTokenProvider(null)
      setLegalAuthTokenProvider(null)
    }
  }, [getAccessToken])

  useEffect(() => {
    if (!clerkSession) return undefined
    let active = true
    if (!clerkSession.isLoaded) return () => { active = false }
    if (!clerkSession.isSignedIn) {
      Promise.resolve().then(() => {
        if (!active) return
        setUser(null)
        setPlatformSyncing(false)
        setPlatformSyncError(null)
        localStorage.removeItem('is_user')
      })
      return () => { active = false }
    }
    Promise.resolve().then(() => {
      if (!active) return null
      setPlatformSyncing(true)
      setPlatformSyncError(null)
      return platformApi.me()
    }).then((response) => {
      if (!response) return
      if (!active) return
      const platformUser = {
        ...(response.user || {}),
        workspace: response.workspace || null,
        workspace_role: response.workspace_role || null,
        project_roles: response.project_roles || {},
        role: response.user?.platform_role === 'platform_admin' ? 'admin' : 'member',
        display_name: response.user?.display_name || clerkSession.profile?.displayName || 'メンバー',
      }
      setUser(platformUser)
      setPlatformSyncError(null)
    }).catch(() => {
      if (!active) return
      setUser(null)
      setPlatformSyncError('契約企業との接続を確認できませんでした。招待された組織を選び直してください。')
    }).finally(() => {
      if (active) setPlatformSyncing(false)
    })
    return () => { active = false }
  }, [clerkSession, platformSyncNonce])

  useEffect(() => {
    setOnAuthError(() => {
      logoutAds()
      setAuthExpiredMessage('セッションの有効期限が切れました。再ログインしてください。')
    })
    return () => setOnAuthError(null)
  }, [logoutAds])

  const hasClaudeKey = isCompatibleApiKey(claudeKey, ANALYSIS_PROVIDER_ANTHROPIC)
  const hasGeminiKey = isCompatibleApiKey(geminiKey, ANALYSIS_PROVIDER_GEMINI)
  // Gemini優先 (BYOK): Geminiキーがあればそちら、なければClaude
  const analysisKey = hasGeminiKey ? geminiKey : hasClaudeKey ? claudeKey : ''
  const analysisProvider = hasGeminiKey ? ANALYSIS_PROVIDER_GEMINI : hasClaudeKey ? ANALYSIS_PROVIDER_ANTHROPIC : null

  const value = {
    authMode,
    clerkLoaded: clerkSession?.isLoaded ?? true,
    clerkSignedIn: clerkSession?.isSignedIn ?? false,
    clerkOrganizationId: clerkSession?.organizationId ?? null,
    platformSyncError,
    refreshPlatformSession,
    adsToken,
    getAccessToken,
    // Claude key — 分析用
    claudeKey,
    setClaudeKey,
    hasClaudeKey,
    // Gemini key — BYOK
    geminiKey,
    setGeminiKey,
    hasGeminiKey,
    // 分析キー (Gemini優先)
    analysisKey,
    analysisProvider,
    hasAnalysisKey: !!analysisKey,
    // Ads auth
    loginAds,
    logoutAds,
    onAdsLogout,
    syncTokenFromApi,
    isAdsAuthenticated: authMode === 'clerk'
      ? Boolean(clerkSession?.isSignedIn && user)
      : !!adsToken,
    loading: loading || platformSyncing || (authMode === 'clerk' && !clerkSession?.isLoaded),
    error,
    authExpiredMessage,
    clearAuthExpiredMessage,
    // RBAC
    user,
    loginWithEmail: handleLoginWithEmail,
    loginWithCase: handleLoginWithCase,
    // Token refresh
    refreshTokenIfNeeded,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
