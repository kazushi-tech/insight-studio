import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

const NAV_ITEMS = [
  { to: '/', icon: 'dashboard', label: 'ダッシュボード' },
  {
    label: '競合LP分析',
    icon: 'analytics',
    children: [
      { to: '/compare', label: 'LP比較分析' },
      { to: '/discovery', label: '競合発見' },
      { to: '/creative-review', label: 'クリエイティブ診断' },
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

function SidebarLink({ to, icon, label, isChild }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-6 py-2.5 transition-colors text-sm ${
          isChild ? 'pl-14' : ''
        } ${
          isActive
            ? 'text-gold border-l-4 border-gold bg-white font-bold'
            : 'text-[#1A1A2E] hover:bg-slate-100 border-l-4 border-transparent'
        }`
      }
    >
      {icon && <span className="material-symbols-outlined text-[20px]">{icon}</span>}
      <span className="japanese-text">{label}</span>
    </NavLink>
  )
}

function SidebarGroup({ item }) {
  const location = useLocation()
  const isGroupActive = item.children?.some((c) => location.pathname === c.to)
  const [open, setOpen] = useState(isGroupActive)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center gap-3 px-6 py-2.5 text-sm transition-colors border-l-4 ${
          isGroupActive
            ? 'text-gold border-gold bg-white font-bold'
            : 'text-[#1A1A2E] hover:bg-slate-100 border-transparent'
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
            <SidebarLink key={child.to} to={child.to} label={child.label} isChild />
          ))}
        </div>
      )}
    </div>
  )
}

function KeySettingsModal({ onClose }) {
  const { geminiKey, setGeminiKey, loginAds, isAdsAuthenticated, logoutAds, loading, error } = useAuth()
  const [localGeminiKey, setLocalGeminiKey] = useState(geminiKey)
  const [adsPassword, setAdsPassword] = useState('')
  const [adsError, setAdsError] = useState(null)

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
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] p-8 space-y-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold japanese-text">API キー設定</h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-primary">
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

  return (
    <div className="flex min-h-screen bg-surface">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full z-40 py-6 w-[240px] bg-slate-50 text-sm tracking-wide flex flex-col">
        {/* Logo */}
        <div className="px-6 mb-8 flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-container rounded-xl flex items-center justify-center text-gold">
            <span className="material-symbols-outlined text-2xl">insights</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#1A1A2E] tracking-tighter leading-tight">
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
              <SidebarGroup key={item.label} item={item} />
            ) : (
              <SidebarLink key={item.to} to={item.to} icon={item.icon} label={item.label} />
            )
          )}
        </nav>

        {/* Connection Status */}
        <div className="px-6 mb-3">
          <div className="bg-white rounded-xl p-3 space-y-2 text-xs">
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
                {isAdsAuthenticated ? '接続中' : '未接続'}
              </span>
            </div>
          </div>
        </div>

        {/* New Project Button */}
        <div className="px-6 mt-2">
          <button className="w-full py-3.5 bg-secondary text-on-secondary rounded-xl font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-secondary/20 text-sm">
            <span className="material-symbols-outlined text-lg">add_circle</span>
            <span>新規プロジェクト</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-[240px] flex-1 min-h-screen flex flex-col">
        {/* Top Header */}
        <header className="h-16 w-full sticky top-0 flex justify-between items-center px-8 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-md group">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-secondary transition-colors">
                search
              </span>
              <input
                className="w-full bg-surface-container-low border-none rounded-full py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-secondary/40 transition-all outline-none"
                placeholder="分析データを検索..."
                type="text"
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              {/* API Key Settings */}
              <button
                onClick={() => setShowKeyModal(true)}
                className={`w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors relative ${
                  hasGeminiKey && isAdsAuthenticated ? 'text-emerald-600' : 'text-secondary'
                }`}
                title="API キー設定"
              >
                <span className="material-symbols-outlined">key</span>
                {(!hasGeminiKey || !isAdsAuthenticated) && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-secondary rounded-full" />
                )}
              </button>
              <button className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant">
                <span className="material-symbols-outlined">light_mode</span>
              </button>
              <button className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-container transition-colors text-on-surface-variant relative">
                <span className="material-symbols-outlined">notifications</span>
                <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full"></span>
              </button>
            </div>
            <div className="flex items-center gap-3 pl-6 border-l border-outline-variant/30">
              <div className="text-right">
                <p className="text-sm font-bold text-[#1A1A2E]">田中 一郎</p>
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
