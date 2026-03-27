import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'

const SETUP_GATED_PATHS = ['/ads/pack', '/ads/graphs', '/ads/ai']

const NAV_ITEMS = [
  { to: '/', icon: 'dashboard', label: 'ダッシュボード' },
  {
    label: '競合LP分析',
    icon: 'analytics',
    children: [
      { to: '/compare', label: 'LP比較分析' },
      { to: '/discovery', label: '競合発見' },
      { to: '/creative-review', label: 'クリエイティブ診断', badge: '停止中' },
    ],
  },
  {
    label: '広告考察',
    icon: 'insights',
    children: [
      { to: '/ads/wizard', label: 'セットアップ' },
      { to: '/ads/pack', label: '要点パック' },
      { to: '/ads/graphs', label: 'グラフ' },
      { to: '/ads/ai', label: 'AI考察' },
    ],
  },
  { to: '/settings', icon: 'settings', label: '設定' },
]

function SidebarLink({ to, icon, label, isChild, disabled, badge }) {
  if (disabled) {
    return (
      <a
        href="#"
        aria-disabled="true"
        tabIndex={-1}
        onClick={(e) => e.preventDefault()}
        className={`flex items-center gap-3 px-6 py-2.5 text-[15px] opacity-40 cursor-not-allowed border-l-4 border-transparent ${
          isChild ? 'pl-14' : ''
        }`}
        title="セットアップを完了してください"
      >
        {icon && <span className="material-symbols-outlined text-[20px]">{icon}</span>}
        <span className="japanese-text">{label}</span>
        <span className="material-symbols-outlined text-[14px] ml-auto">lock</span>
      </a>
    )
  }
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-6 py-2.5 transition-colors text-[15px] ${
          isChild ? 'pl-14' : ''
        } ${
          isActive
            ? 'text-gold border-l-4 border-gold bg-surface-container-lowest font-bold'
            : 'text-on-surface hover:bg-surface-container border-l-4 border-transparent'
        }`
      }
    >
      {icon && <span className="material-symbols-outlined text-[20px]">{icon}</span>}
      <span className="japanese-text">{label}</span>
      {badge && <span className="ml-auto text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">{badge}</span>}
    </NavLink>
  )
}

function SidebarGroup({ item, disabledPaths }) {
  const location = useLocation()
  const isGroupActive = item.children?.some((c) => location.pathname === c.to)
  const [open, setOpen] = useState(isGroupActive)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 px-6 py-2.5 text-[15px] transition-colors border-l-4 ${
          isGroupActive
            ? 'text-gold border-gold bg-surface-container-lowest font-bold'
            : 'text-on-surface hover:bg-surface-container border-transparent'
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
        <span className="japanese-text flex-1 text-left">{item.label}</span>
        <span className={`material-symbols-outlined text-[16px] transition-transform ${open ? 'rotate-180' : ''}`}>
          expand_more
        </span>
      </button>
      {open && (
        <div className="flex flex-col">
          {item.children.map((child) => (
            <SidebarLink
              key={child.to}
              to={child.to}
              label={child.label}
              isChild
              disabled={disabledPaths?.includes(child.to)}
              badge={child.badge}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function KeySettingsModal({ onClose }) {
  const { geminiKey, setGeminiKey, loginAds, isAdsAuthenticated, logoutAds, loading } = useAuth()
  const [localGeminiKey, setLocalGeminiKey] = useState(geminiKey)
  const [adsPassword, setAdsPassword] = useState('')
  const [adsError, setAdsError] = useState(null)
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

  const handleSaveGemini = () => {
    setGeminiKey(localGeminiKey)
    onClose()
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
        className="bg-surface-container-lowest rounded-2xl shadow-2xl w-[480px] p-8 space-y-6"
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
          <label className="text-sm font-bold text-on-surface-variant japanese-text">Gemini API キー（BYOK）</label>
          <p className="text-xs text-on-surface-variant">Market Lens AI の分析機能に必要です</p>
          <input
            type="password"
            className="w-full bg-surface-container-low rounded-xl py-3 px-4 text-sm outline-none focus:ring-2 focus:ring-secondary/40"
            placeholder="AIza..."
            value={localGeminiKey}
            onChange={(e) => setLocalGeminiKey(e.target.value)}
          />
          <button
            onClick={handleSaveGemini}
            className="px-5 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm hover:opacity-90 transition-all"
          >
            保存
          </button>
        </div>

        <hr className="border-surface-container" />

        {/* Ads Insights Auth */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-on-surface-variant japanese-text">考察スタジオ 認証</label>
          {isAdsAuthenticated ? (
            <div className="flex items-center justify-between bg-emerald-50 rounded-xl px-4 py-3">
              <span className="text-sm text-emerald-700 font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
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
                className="w-full bg-surface-container-low rounded-xl py-3 px-4 text-sm outline-none focus:ring-2 focus:ring-secondary/40"
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

export default function Layout() {
  const [showKeyModal, setShowKeyModal] = useState(false)
  const { hasGeminiKey, isAdsAuthenticated } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const { isSetupComplete, resetSetup } = useAdsSetup()
  const navigate = useNavigate()
  const disabledPaths = isAdsAuthenticated && isSetupComplete ? [] : SETUP_GATED_PATHS

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('insight-studio-sidebar-width')
    return saved ? Math.max(200, Math.min(400, Number(saved))) : 260
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

  return (
    <div className="flex min-h-screen bg-surface">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:px-4 focus:py-2 focus:bg-primary focus:text-on-primary focus:rounded-lg focus:font-bold focus:text-sm focus:shadow-lg"
      >
        メインコンテンツへスキップ
      </a>
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full z-40 py-6 bg-surface text-sm tracking-wide flex flex-col" style={{ width: sidebarWidth }}>
        {/* Logo */}
        <div className="px-6 mb-8 flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-container rounded-xl flex items-center justify-center text-gold">
            <span className="material-symbols-outlined text-2xl">insights</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-on-surface tracking-tighter leading-tight">
              Insight Studio
            </h1>
            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">
              Ad Ops &amp; Analysis
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-0.5 flex-1">
          {NAV_ITEMS.map((item) =>
            item.children ? (
              <SidebarGroup key={item.label} item={item} disabledPaths={disabledPaths} />
            ) : (
              <SidebarLink key={item.to} to={item.to} icon={item.icon} label={item.label} />
            )
          )}
        </nav>

        {/* Connection Status */}
        <div className="px-6 mb-3">
          <div className="bg-surface-container-lowest rounded-xl p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">Gemini API</span>
              <span className={`flex items-center gap-1 font-bold ${hasGeminiKey ? 'text-emerald-600' : 'text-on-surface-variant'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasGeminiKey ? 'bg-emerald-500' : 'bg-outline-variant'}`} />
                {hasGeminiKey ? '設定済' : '未設定'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-on-surface-variant">考察スタジオ</span>
              <span className={`flex items-center gap-1 font-bold ${isAdsAuthenticated ? 'text-emerald-600' : 'text-on-surface-variant'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isAdsAuthenticated ? 'bg-emerald-500' : 'bg-outline-variant'}`} />
                {isAdsAuthenticated ? '接続済' : '未接続'}
              </span>
            </div>
          </div>
        </div>

        {/* New Setup Button */}
        <div className="px-6 mt-2">
          <button
            onClick={() => {
              resetSetup()
              navigate('/ads/wizard', { state: { resetAt: Date.now() } })
            }}
            className="w-full py-3.5 bg-secondary text-on-secondary rounded-xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-secondary/20 text-sm"
          >
            <span className="material-symbols-outlined text-lg">replay</span>
            <span>新しいセットアップ</span>
          </button>
        </div>
        <div
          onMouseDown={startResize}
          onKeyDown={handleResizeKeyDown}
          role="separator"
          aria-label="サイドバーの幅を変更"
          tabIndex={0}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-secondary/30 active:bg-secondary/50 transition-colors focus:bg-secondary/40 focus:outline-none"
        />
      </aside>

      {/* Main Content */}
      <main id="main-content" className="flex-1 min-h-screen flex flex-col" style={{ marginLeft: sidebarWidth }}>
        {/* Top Header */}
        <header className="h-16 w-full sticky top-0 flex justify-between items-center px-8 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100">
          <div className="flex-1" />
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              {/* API Key Settings */}
              <button
                onClick={() => setShowKeyModal(true)}
                className={`w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors relative ${
                  hasGeminiKey && isAdsAuthenticated ? 'text-emerald-600' : 'text-secondary'
                }`}
                title="API キー設定"
                aria-label="API キー設定"
              >
                <span className="material-symbols-outlined">key</span>
                {(!hasGeminiKey || !isAdsAuthenticated) && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-secondary rounded-full" />
                )}
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
            <div className="flex items-center gap-3 pl-6 border-l border-outline-variant/30">
              <div className="text-right">
                <p className="text-sm font-bold text-on-surface">田中 一郎</p>
                <p className="text-[10px] text-on-surface-variant">管理者</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-sm font-bold text-on-secondary-container">
                田
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1">
          <Outlet />
        </div>
      </main>

      {/* Key Settings Modal */}
      {showKeyModal && <KeySettingsModal onClose={() => setShowKeyModal(false)} />}
    </div>
  )
}
