import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { useAnalysisRuns } from '../contexts/AnalysisRunsContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useRbac } from '../contexts/RbacContext'
import {
  ANALYSIS_PROVIDER_ANTHROPIC,
  ANALYSIS_PROVIDER_GEMINI,
  getAnalysisProviderLabel,
} from '../utils/analysisProvider'
import { warmMarketLensBackend } from '../api/marketLens'
import { warmAdsInsightsBackend } from '../api/adsInsights'
import { getApiKeyValidationError, validateClaudeKeyRemote } from '../utils/apiKeys'
import GuideModal from './GuideModal'
import CaseSelector from './CaseSelector'
import CaseAuthModal from './CaseAuthModal'
import ReportHistoryDrawer from './report-history/ReportHistoryDrawer'

const SETUP_GATED_PATHS = ['/ads/graphs', '/ads/ai', '/insights/ai']
const AI_EXPLORER_PATH = '/insights/ai'

const NAV_ITEMS = [
  { to: '/', icon: 'home', label: 'ダッシュボード' },
  {
    icon: 'balance',
    label: '競合分析',
    children: [
      { to: '/compare', icon: 'balance', label: '競合LP分析' },
      { to: '/discovery', icon: 'search', label: '競合発見' },
      { to: '/creative-review', icon: 'image', label: 'バナーレビュー' },
    ],
  },
  {
    icon: 'monitoring',
    label: '広告分析',
    children: [
      { to: '/ads/wizard', icon: 'tune', label: 'セットアップ' },
      { to: '/ads/graphs', icon: 'monitoring', label: '広告グラフ', requiresSetup: true },
      { to: AI_EXPLORER_PATH, icon: 'auto_awesome', label: 'AI考察', requiresSetup: true },
    ],
  },
  { to: '/settings', icon: 'settings', label: '設定' },
  { to: '/projects', icon: 'account_tree', label: 'プロジェクト', adminOnly: true },
]

function SidebarLink({ to, icon, label, isChild, disabled, badge }) {
  const spacingClass = isChild ? 'pl-12 pr-3' : 'px-4'

  if (disabled) {
    return (
      <a
        href="#"
        aria-disabled="true"
        tabIndex={-1}
        onClick={(e) => e.preventDefault()}
        className={`mx-4 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-xl ${spacingClass} py-2.5 text-[15px] text-[#a8b5a0]/40 cursor-not-allowed`}
        title="セットアップを完了してください"
      >
        {icon && <span className="material-symbols-outlined row-span-2 shrink-0 self-start text-[20px] leading-6">{icon}</span>}
        <span className="japanese-text min-w-0 truncate leading-6">{label}</span>
        {badge ? (
          <span className="col-start-2 mt-0.5 inline-flex w-fit max-w-full items-center gap-1 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-300/80">
            <span className="material-symbols-outlined text-[12px]" aria-hidden="true">lock</span>
            {badge}
          </span>
        ) : (
          <span className="material-symbols-outlined col-start-2 mt-0.5 shrink-0 text-[14px] leading-none">lock</span>
        )}
      </a>
    )
  }
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `mx-4 flex min-w-0 items-center gap-3 rounded-xl ${spacingClass} py-3 transition-colors text-[15px] focus-visible:outline-2 focus-visible:outline-[#a8e7c5] focus-visible:outline-offset-[-2px] ${
          isActive
            ? 'text-white font-bold bg-white/20 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
            : 'text-white/80 hover:text-white hover:bg-white/10'
        }`
      }
    >
      {icon && <span className="material-symbols-outlined shrink-0 text-[20px]">{icon}</span>}
      <span className="japanese-text min-w-0 flex-1 truncate">{label}</span>
      {badge && <span className="shrink-0 text-[10px] font-bold text-amber-300 bg-amber-900/30 px-1.5 py-0.5 rounded">{badge}</span>}
    </NavLink>
  )
}

function SidebarGroup({ item, disabledPaths }) {
  const location = useLocation()
  const isGroupActive = item.children?.some((c) => location.pathname === c.to)
  const [open, setOpen] = useState(isGroupActive)

  return (
    <div className="py-0.5">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 px-6 py-2.5 text-[15px] transition-colors border-l-2 focus-visible:outline-2 focus-visible:outline-[#2d6a4f] focus-visible:outline-offset-[-2px] ${
          isGroupActive
            ? 'text-white border-[#2d6a4f] bg-[#2d6a4f] font-bold'
            : 'text-[#a8b5a0] hover:text-white/80 hover:bg-white/5 border-transparent'
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
        <span className="japanese-text flex-1 text-left">{item.label}</span>
        <span className={`material-symbols-outlined text-[16px] transition-transform ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>
      {open && (
        <div className="mt-1.5 mb-2 flex flex-col gap-1">
          {item.children.map((child) => (
            <SidebarLink
              key={child.to}
              to={child.to}
              icon={child.icon}
              label={child.label}
              isChild
              disabled={disabledPaths?.includes(child.to)}
              badge={disabledPaths?.includes(child.to) && child.requiresSetup ? '要設定' : child.badge}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MobileNavLink({ to, icon, label, disabled }) {
  const baseClass = 'flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-black japanese-text'

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className={`${baseClass} cursor-not-allowed text-on-surface-variant/40`}
        aria-label={`${label}はセットアップ完了後に利用できます`}
      >
        <span className="material-symbols-outlined text-[21px]" aria-hidden="true">{icon}</span>
        <span className="max-w-full truncate">{label}</span>
      </button>
    )
  }

  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `${baseClass} rounded-2xl transition-colors ${
          isActive
            ? 'bg-primary text-on-primary shadow-sm'
            : 'text-on-surface-variant hover:bg-primary/[0.06] hover:text-primary'
        }`
      }
    >
      <span className="material-symbols-outlined text-[21px]" aria-hidden="true">{icon}</span>
      <span className="max-w-full truncate">{label}</span>
    </NavLink>
  )
}

function KeySettingsModal({ onClose }) {
  const { claudeKey, setClaudeKey, geminiKey, setGeminiKey, loginAds, isAdsAuthenticated, logoutAds, loading } = useAuth()
  const [localClaudeKey, setLocalClaudeKey] = useState(claudeKey)
  const [localGeminiKey, setLocalGeminiKey] = useState(geminiKey)
  const [claudeError, setClaudeError] = useState(null)
  const [claudeWarning, setClaudeWarning] = useState(null)
  const [geminiError, setGeminiError] = useState(null)
  const [geminiSaved, setGeminiSaved] = useState(false)
  const [adsPassword, setAdsPassword] = useState('')
  const [adsError, setAdsError] = useState(null)
  const [claudeValidating, setClaudeValidating] = useState(false)
  const modalRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const modal = modalRef.current
      if (!modal) return
      const focusable = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    modalRef.current?.querySelector('button, input')?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSaveClaude = async () => {
    const validationError = getApiKeyValidationError(localClaudeKey, ANALYSIS_PROVIDER_ANTHROPIC)
    if (validationError) {
      setClaudeError(validationError)
      return
    }
    setClaudeError(null)
    setClaudeWarning(null)
    setClaudeValidating(true)
    try {
      const result = await validateClaudeKeyRemote(localClaudeKey)
      if (result.error) {
        setClaudeError(result.error)
        return
      }
      if (result.warning) {
        setClaudeWarning(result.warning)
      }
    } finally {
      setClaudeValidating(false)
    }
    setClaudeKey(localClaudeKey)
  }

  const handleSaveGemini = () => {
    const validationError = getApiKeyValidationError(localGeminiKey, ANALYSIS_PROVIDER_GEMINI)
    if (validationError) {
      setGeminiError(validationError)
      return
    }
    setGeminiError(null)
    setGeminiKey(localGeminiKey)
    setGeminiSaved(true)
    window.setTimeout(() => setGeminiSaved(false), 2500)
  }

  const handleAdsLogin = async () => {
    setAdsError(null)
    try {
      await loginAds(adsPassword)
      setAdsPassword('')
    } catch (e) {
      setAdsError(e.message)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-settings-title"
        className="bg-surface-container-lowest rounded-xl shadow-lg w-[520px] max-h-[90vh] overflow-y-auto p-8 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 id="key-settings-title" className="text-xl font-bold japanese-text">API キー設定</h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-primary" aria-label="閉じる">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Gemini Key */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-on-surface-variant japanese-text">Gemini API キー（推奨・分析用）</label>
          <p className="text-xs text-on-surface-variant">設定されている場合は競合LP分析・競合発見・バナーレビューで Gemini を優先します</p>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-secondary hover:text-secondary/80 underline underline-offset-2 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            Google AI Studio で API キーを取得
          </a>
          <input
            type="password"
            className="w-full bg-surface-container-low rounded-xl py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            placeholder="AIza..."
            value={localGeminiKey}
            onChange={(e) => {
              setLocalGeminiKey(e.target.value)
              setGeminiError(null)
              setGeminiSaved(false)
            }}
          />
          <button
            onClick={handleSaveGemini}
            className="px-5 py-2 bg-primary-container text-on-primary rounded-xl font-bold text-sm hover:opacity-88 transition-all"
          >
            保存
          </button>
          {geminiError && <p className="text-xs text-error">{geminiError}</p>}
          {geminiSaved && <p className="text-xs text-emerald-700 dark:text-on-success-container">Gemini API キーを保存しました。</p>}
        </div>

        <hr className="border-surface-container" />

        {/* Claude Key */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-on-surface-variant japanese-text">Claude API キー（フォールバック）</label>
          <p className="text-xs text-on-surface-variant">Gemini キー未設定時の分析用フォールバックとして使用します</p>
          <a
            href="https://console.anthropic.com/settings/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-secondary hover:text-secondary/80 underline underline-offset-2 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">open_in_new</span>
            Anthropic Console でAPIキーを取得
          </a>
          <input
            type="password"
            className="w-full bg-surface-container-low rounded-xl py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            placeholder="sk-ant-..."
            value={localClaudeKey}
            onChange={(e) => {
              setLocalClaudeKey(e.target.value)
              setClaudeError(null)
              setClaudeWarning(null)
            }}
          />
          <button
            onClick={handleSaveClaude}
            disabled={claudeValidating}
            className="px-5 py-2 bg-primary-container text-on-primary rounded-xl font-bold text-sm hover:opacity-88 transition-all disabled:opacity-50"
          >
            {claudeValidating ? '検証中...' : '保存'}
          </button>
          {claudeError && <p className="text-xs text-error">{claudeError}</p>}
          {claudeWarning && <p className="text-xs text-amber-600 dark:text-warning">{claudeWarning}</p>}
        </div>

        <hr className="border-surface-container" />

        {/* Ads Insights Auth */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-on-surface-variant japanese-text">考察スタジオ 認証</label>
          {isAdsAuthenticated ? (
            <div className="flex items-center justify-between bg-emerald-50 dark:bg-success-container rounded-xl px-4 py-3">
              <span className="text-sm text-emerald-700 dark:text-on-success-container font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-success" />
                認証済み
              </span>
              <button onClick={logoutAds} className="text-sm text-error font-bold hover:underline">
                ログアウト
              </button>
            </div>
          ) : (
            <>
              <input
                type="password"
                className="w-full bg-surface-container-low rounded-xl py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                placeholder="パスワードを入力"
                value={adsPassword}
                onChange={(e) => setAdsPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdsLogin()}
              />
              {adsError && <p className="text-xs text-error">{adsError}</p>}
              <button
                onClick={handleAdsLogin}
                disabled={loading}
                className="px-5 py-2 bg-secondary text-on-secondary rounded-xl font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50"
              >
                {loading ? 'ログイン中...' : 'ログイン'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const RUN_KIND_LABELS = {
  compare: 'LP比較分析',
  discovery: '競合発見',
  'creative-review': 'クリエイティブレビュー',
}

function BackgroundIndicator() {
  const { getRunningKinds } = useAnalysisRuns()
  const runningKinds = getRunningKinds()
  if (runningKinds.length === 0) return null

  return (
    <div className="px-6 mb-3">
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
          <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
          バックグラウンド実行中
        </div>
        {runningKinds.map((kind) => (
          <div key={kind} className="flex items-center gap-2 text-xs text-amber-300/70">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {RUN_KIND_LABELS[kind] || kind}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Layout() {
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [showGuide, setShowGuide] = useState(() => (
    window.location.pathname === '/' && localStorage.getItem('insight-studio-guide-seen') !== '1'
  ))
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [selectedCase, setSelectedCase] = useState(null)
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)
  const location = useLocation()
  const { hasAnalysisKey, analysisProvider, isAdsAuthenticated, logoutAds, user: authUser } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const { isSetupComplete, setupState, resetSetup, authenticateCase, clearCase, selectCase } = useAdsSetup()
  const { displayName, avatarInitial } = useUserProfile()
  const { canManageProjects, isCaseUser } = useRbac()
  const navigate = useNavigate()

  // Pre-warm backends (fire-and-forget) to avoid cold-start delays
  useEffect(() => {
    void warmMarketLensBackend()
    void warmAdsInsightsBackend()
  }, [])

  // Auth guard in App.jsx handles login redirect for all roles
  const disabledPaths = isAdsAuthenticated && isSetupComplete ? [] : SETUP_GATED_PATHS

  const handleCaseSelect = useCallback((caseInfo) => {
    if (caseInfo === null) {
      clearCase()
      return
    }
    if (canManageProjects) {
      selectCase({
        case_id: caseInfo.case_id || caseInfo.id,
        name: caseInfo.name,
        dataset_id: caseInfo.dataset_id,
      })
    } else {
      setSelectedCase(caseInfo)
      setShowAuthModal(true)
    }
  }, [clearCase, canManageProjects, selectCase])

  const handleCaseAuthenticate = useCallback(async (caseId, password, options = {}) => {
    return authenticateCase(caseId, password, options)
  }, [authenticateCase])

  const handleAuthModalClose = useCallback(() => {
    setShowAuthModal(false)
    setSelectedCase(null)
  }, [])

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('insight-studio-sidebar-width')
    return saved ? Math.max(200, Math.min(400, Number(saved))) : 240
  })
  const isResizing = useRef(false)

  const handleMouseMove = useCallback((e) => {
    if (!isResizing.current) return
    const newWidth = Math.max(200, Math.min(400, e.clientX))
    setSidebarWidth(newWidth)
  }, [])

  const handleMouseUp = useCallback(() => {
    isResizing.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem('insight-studio-sidebar-width', String(sidebarWidth))
  }, [sidebarWidth])

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  const startResize = () => {
    isResizing.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const handleResizeKeyDown = useCallback((e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setSidebarWidth((w) => Math.max(200, w - 10))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setSidebarWidth((w) => Math.min(400, w + 10))
    }
  }, [])

  const profileCaption = isAdsAuthenticated ? '考察スタジオ接続済' : 'ローカルプロフィール'
  const aiInsightProviderLabel = getAnalysisProviderLabel(analysisProvider)
  const coreAnalysisStatusLabel = hasAnalysisKey ? `${aiInsightProviderLabel} で利用可` : '分析キー未設定'
  const adsAiReady = hasAnalysisKey && isAdsAuthenticated && isSetupComplete
  const adsAiStatusLabel = !hasAnalysisKey
    ? '分析キー未設定'
    : !isAdsAuthenticated
      ? '要認証'
      : !isSetupComplete
        ? '要セットアップ'
        : `${aiInsightProviderLabel} で利用可`
  const adsAiTone = adsAiReady ? 'text-emerald-400' : hasAnalysisKey || isAdsAuthenticated ? 'text-amber-400' : 'text-white/40'
  const adsAiDot = adsAiReady ? 'bg-emerald-400' : hasAnalysisKey || isAdsAuthenticated ? 'bg-amber-400' : 'bg-white/20'
  const showKeyAttention = !hasAnalysisKey || !isAdsAuthenticated
  const mobileNavItems = [
    { to: '/', icon: 'home', label: 'ホーム' },
    { to: '/ads/wizard', icon: 'tune', label: '設定' },
    { to: '/ads/graphs', icon: 'monitoring', label: 'グラフ', requiresSetup: true },
    { to: AI_EXPLORER_PATH, icon: 'auto_awesome', label: 'AI', requiresSetup: true },
    { to: '/settings', icon: 'settings', label: '管理' },
  ]

  return (
    <div className="min-h-screen bg-surface lg:flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:px-4 focus:py-2 focus:bg-primary focus:text-on-primary focus:rounded-lg focus:font-bold focus:text-sm focus:shadow-lg"
      >
        メインコンテンツへスキップ
      </a>
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-full flex-col overflow-hidden py-6 text-sm tracking-wide lg:flex" style={{ width: sidebarWidth, background: 'linear-gradient(135deg, #0f5238 0%, #002114 100%)' }}>
        {/* Logo */}
        <div className="px-6 mb-8 flex shrink-0 items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: '#f4fff8' }}>
            <span className="material-symbols-outlined text-2xl">eco</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tighter leading-tight">
              Insight Studio
            </h1>
            <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold">
              広告運用分析
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pb-4">
          {NAV_ITEMS
            .filter((item) => !item.adminOnly || canManageProjects)
            .map((item) => item.children ? (
              <SidebarGroup
                key={item.label}
                item={item}
                disabledPaths={disabledPaths}
              />
            ) : (
              <SidebarLink
                key={item.to}
                to={item.to}
                icon={item.icon}
                label={item.label}
                disabled={disabledPaths?.includes(item.to)}
                badge={disabledPaths?.includes(item.to) && item.requiresSetup ? '要設定' : item.badge}
              />
            ))}
        </nav>

        <div className="shrink-0 border-t border-white/10 pt-3">
          {/* Background Running Indicator */}
          <BackgroundIndicator />

          {/* Connection Status */}
          <div className="px-6 mb-3">
            <div className="bg-white/5 rounded-xl p-3 space-y-2 text-xs">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-white/50">競合LP分析 / 競合発見</span>
                <span className={`flex shrink-0 items-center gap-1 font-bold ${hasAnalysisKey ? 'text-emerald-400' : 'text-white/40'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${hasAnalysisKey ? 'bg-emerald-400' : 'bg-white/20'}`} />
                  {coreAnalysisStatusLabel}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-white/50">クリエイティブレビュー</span>
                <span className={`flex shrink-0 items-center gap-1 font-bold ${hasAnalysisKey ? 'text-emerald-400' : 'text-white/40'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${hasAnalysisKey ? 'bg-emerald-400' : 'bg-white/20'}`} />
                  {coreAnalysisStatusLabel}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-white/50">分析API</span>
                <span className={`flex shrink-0 items-center gap-1 font-bold ${hasAnalysisKey ? 'text-emerald-400' : 'text-white/40'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${hasAnalysisKey ? 'bg-emerald-400' : 'bg-white/20'}`} />
                  {hasAnalysisKey ? `${aiInsightProviderLabel} 設定済` : '未設定'}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-white/50">考察スタジオ</span>
                <span className={`flex shrink-0 items-center gap-1 font-bold ${isAdsAuthenticated ? 'text-emerald-400' : 'text-white/40'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isAdsAuthenticated ? 'bg-emerald-400' : 'bg-white/20'}`} />
                  {isAdsAuthenticated ? '接続済' : '未接続'}
                </span>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-white/50">AI考察</span>
                <span className={`flex shrink-0 items-center gap-1 font-bold ${adsAiTone}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${adsAiDot}`} />
                  {adsAiStatusLabel}
                </span>
              </div>
              {isSetupComplete && setupState?.completedAt && (
                <div className="flex min-w-0 items-center justify-between gap-2 text-[10px]">
                  <span className="min-w-0 truncate text-white/40">最終セットアップ</span>
                  <span className="shrink-0 text-white/40 tabular-nums">
                    {new Date(setupState.completedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* New Setup Button */}
          <div className="px-6 mt-2">
            <button
              onClick={() => {
                resetSetup()
                navigate('/ads/wizard', { state: { resetAt: Date.now() } })
              }}
              className="w-full py-2.5 bg-white/10 text-white rounded-full font-bold flex items-center justify-center gap-2 hover:bg-white/20 transition-colors text-xs focus-ring"
            >
              <span className="material-symbols-outlined text-base">add</span>
              <span>新規レポート</span>
            </button>
          </div>
        </div>
        <div
          onMouseDown={startResize}
          onKeyDown={handleResizeKeyDown}
          role="separator"
          aria-label="サイドバーの幅を変更"
          tabIndex={0}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-white/20 active:bg-white/30 transition-colors focus-ring"
        />
      </aside>

      {/* Main Content */}
      <main
        id="main-content"
        className="flex min-h-screen min-w-0 flex-1 flex-col pb-20 lg:ml-[var(--sidebar-width)] lg:pb-0"
        style={{ '--sidebar-width': `${sidebarWidth}px` }}
      >
        {/* Top Header */}
        <header className="sticky top-0 z-50 flex min-h-16 w-full flex-wrap items-center justify-between gap-3 border-b border-outline-variant/10 bg-surface/90 px-4 py-3 backdrop-blur-md lg:h-16 lg:flex-nowrap lg:px-8 lg:py-0">
          <div className="min-w-0 flex-1">
            {isCaseUser ? (
              <div className="flex items-center gap-2 text-on-surface font-bold">
                <span className="material-symbols-outlined text-secondary">folder</span>
                {authUser?.display_name || '案件'}
              </div>
            ) : (
              <CaseSelector onCaseSelect={handleCaseSelect} />
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 lg:gap-6">
            <div className="flex items-center gap-2">
              {/* Report History Drawer Trigger */}
              <button
                onClick={() => {
                  if (location.pathname !== AI_EXPLORER_PATH) navigate(AI_EXPLORER_PATH)
                  setShowHistoryDrawer(true)
                }}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
                title="レポート履歴"
                aria-label="レポート履歴を開く"
              >
                <span className="material-symbols-outlined">history</span>
              </button>
              {/* API Key Settings */}
              <button
                onClick={() => setShowKeyModal(true)}
                className={`w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors relative ${
                  !showKeyAttention ? 'text-emerald-600 dark:text-success' : 'text-secondary'
                }`}
                title="API キー・接続設定"
                aria-label="API キー・接続設定"
              >
                <span className="material-symbols-outlined">key</span>
                {showKeyAttention && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-secondary rounded-full" />
                )}
              </button>
              <button
                onClick={() => setShowGuide(true)}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
                title="使い方ガイド"
                aria-label="使い方ガイドを開く"
              >
                <span className="material-symbols-outlined">menu_book</span>
              </button>
              <button
                onClick={toggleTheme}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
                title={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
                aria-label={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
              >
                <span className="material-symbols-outlined">{isDark ? 'light_mode' : 'dark_mode'}</span>
              </button>
            </div>
            <div className="flex items-center gap-2 border-l border-outline-variant/30 pl-2 lg:gap-3 lg:pl-6">
              <div className="hidden max-w-[160px] text-right sm:block">
                <p className="text-sm font-bold text-on-surface truncate" title={displayName}>{displayName}</p>
                <p className="text-[10px] text-on-surface-variant">{profileCaption}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-sm font-bold text-on-secondary-container">
                {avatarInitial}
              </div>
              <button
                onClick={logoutAds}
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
                title="ログアウト"
                aria-label="ログアウト"
              >
                <span className="material-symbols-outlined">logout</span>
              </button>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1">
          <Outlet />
        </div>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 gap-1 border-t border-outline-variant/15 bg-surface-container-lowest/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-2 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] backdrop-blur-md lg:hidden"
        aria-label="モバイル主要ナビゲーション"
      >
        {mobileNavItems.map((item) => (
          <MobileNavLink
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={item.label}
            disabled={item.requiresSetup && disabledPaths?.includes(item.to)}
          />
        ))}
      </nav>

      {/* Key Settings Modal */}
      {showKeyModal && <KeySettingsModal onClose={() => setShowKeyModal(false)} />}
      {/* Case Auth Modal */}
      {showAuthModal && selectedCase && (
        <CaseAuthModal
          caseInfo={selectedCase}
          onClose={handleAuthModalClose}
          onAuthenticate={handleCaseAuthenticate}
        />
      )}
      {/* Guide Modal */}
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
      {/* Report History Drawer */}
      <ReportHistoryDrawer open={showHistoryDrawer} onClose={() => setShowHistoryDrawer(false)} />
    </div>
  )
}
