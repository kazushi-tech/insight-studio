import { useEffect, useState } from 'react'
import { ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useUserProfile } from '../contexts/UserProfileContext'

function SettingsCard({ icon, title, description, children }) {
  return (
    <section className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-6 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">{icon}</span>
          <h3 className="text-lg font-bold japanese-text">{title}</h3>
        </div>
        {description && <p className="text-sm text-on-surface-variant japanese-text">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Toggle({ checked, onChange, label }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`w-12 h-7 rounded-full flex items-center px-1 transition-colors focus-ring ${
        checked ? 'bg-secondary' : 'bg-outline-variant'
      }`}
    >
      <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

function maskSecret(secret) {
  if (!secret) return '未設定'
  if (secret.length <= 8) return `${secret.slice(0, 2)}${'•'.repeat(Math.max(secret.length - 2, 1))}`
  return `${secret.slice(0, 4)}${'•'.repeat(6)}${secret.slice(-4)}`
}

function InlineNotice({ tone = 'success', children }) {
  const toneClass = tone === 'error'
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-emerald-50 border-emerald-200 text-emerald-700'

  const icon = tone === 'error' ? 'error' : 'check_circle'

  return (
    <div className={`flex items-center gap-3 rounded-[0.75rem] border px-4 py-3 text-sm ${toneClass}`}>
      <span className="material-symbols-outlined text-lg">{icon}</span>
      <span className="japanese-text">{children}</span>
    </div>
  )
}

export default function Settings() {
  const { displayName, setDisplayName } = useUserProfile()
  const {
    geminiKey,
    setGeminiKey,
    hasGeminiKey,
    isAdsAuthenticated,
    loginAds,
    logoutAds,
    loading,
  } = useAuth()
  const { isDark, toggleTheme } = useTheme()

  const [localDisplayName, setLocalDisplayName] = useState(displayName)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState(null)

  const [geminiInput, setGeminiInput] = useState(geminiKey)
  const [editingGemini, setEditingGemini] = useState(!hasGeminiKey)
  const [geminiSaved, setGeminiSaved] = useState(false)
  const [geminiError, setGeminiError] = useState(null)

  const [adsPassword, setAdsPassword] = useState('')
  const [authError, setAuthError] = useState(null)
  const [authNotice, setAuthNotice] = useState('')

  useEffect(() => {
    setLocalDisplayName(displayName)
  }, [displayName])

  useEffect(() => {
    setGeminiInput(geminiKey)
    setEditingGemini(!hasGeminiKey)
  }, [geminiKey, hasGeminiKey])

  useEffect(() => {
    if (!profileSaved) return undefined
    const id = setTimeout(() => setProfileSaved(false), 3000)
    return () => clearTimeout(id)
  }, [profileSaved])

  useEffect(() => {
    if (!geminiSaved) return undefined
    const id = setTimeout(() => setGeminiSaved(false), 3000)
    return () => clearTimeout(id)
  }, [geminiSaved])

  useEffect(() => {
    if (!authNotice) return undefined
    const id = setTimeout(() => setAuthNotice(''), 3000)
    return () => clearTimeout(id)
  }, [authNotice])

  function handleProfileSave() {
    setProfileError(null)
    const trimmed = localDisplayName.trim()
    if (trimmed.length > 20) {
      setProfileError('表示名は20文字以内にしてください。')
      return
    }

    setDisplayName(trimmed)
    setProfileSaved(true)
  }

  function handleGeminiSave() {
    setGeminiError(null)
    const trimmed = geminiInput.trim()
    if (!trimmed) {
      setGeminiError('Gemini API キーを入力してください。')
      return
    }

    setGeminiKey(trimmed)
    setEditingGemini(false)
    setGeminiSaved(true)
  }

  function handleGeminiDelete() {
    if (!window.confirm('保存済みの Gemini API キーを削除しますか？')) return
    setGeminiKey('')
    setGeminiInput('')
    setEditingGemini(true)
    setGeminiError(null)
    setGeminiSaved(false)
  }

  async function handleAdsLogin() {
    setAuthError(null)
    setAuthNotice('')

    try {
      await loginAds(adsPassword)
      setAdsPassword('')
      setAuthNotice('考察スタジオに接続しました。')
    } catch (e) {
      setAuthError(e.message)
    }
  }

  function handleAdsLogout() {
    if (!window.confirm('考察スタジオとの接続を解除しますか？')) return
    logoutAds()
    setAuthError(null)
    setAuthNotice('考察スタジオとの接続を解除しました。')
  }

  return (
    <div className="p-10 max-w-[920px] mx-auto space-y-8">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold text-on-surface tracking-tight japanese-text">設定</h2>
        <p className="text-on-surface-variant text-sm japanese-text">プロフィールや接続設定を管理できます。不要なダミー設定は表示していません。</p>
      </div>

      <SettingsCard
        icon="person"
        title="プロフィール"
        description="右上の表示名とアバター初期文字に反映されます。ブラウザごとに保存されます。"
      >
        <div className="space-y-3">
          <label className="text-sm font-bold text-on-surface-variant japanese-text" htmlFor="display-name">
            表示名
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="display-name"
              className="flex-1 bg-surface-container-low rounded-[0.75rem] py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              value={localDisplayName}
              maxLength={20}
              onChange={(e) => setLocalDisplayName(e.target.value)}
              placeholder="オペレーター"
            />
            <button
              onClick={handleProfileSave}
              className="px-6 py-3 bg-gold text-primary-container rounded-xl font-bold text-sm hover:opacity-88 transition-all"
            >
              保存
            </button>
          </div>
          <p className="text-xs text-on-surface-variant">20文字まで。空欄で保存した場合は「オペレーター」になります。</p>
          {profileError && <ErrorBanner message={profileError} />}
          {profileSaved && <InlineNotice>表示名を保存しました。</InlineNotice>}
        </div>
      </SettingsCard>

      <SettingsCard
        icon="key"
        title="API設定"
        description="Market Lens の分析に使う Gemini API キーです。ブラウザのローカルストレージに保存されます。"
      >
        <div className="space-y-4">
          {hasGeminiKey && !editingGemini ? (
            <>
              <div className="rounded-[0.75rem] bg-surface-container px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-1">Saved Key</p>
                <p className="font-mono text-sm text-on-surface">{maskSecret(geminiKey)}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    setEditingGemini(true)
                    setGeminiError(null)
                  }}
                  className="px-5 py-2.5 bg-gold text-primary-container rounded-xl font-bold text-sm hover:opacity-88 transition-all"
                >
                  変更
                </button>
                <button
                  onClick={handleGeminiDelete}
                  className="px-5 py-2.5 bg-error-container/40 text-error rounded-[0.75rem] font-bold text-sm hover:bg-error-container/60 transition-colors"
                >
                  削除
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <input
                type="password"
                className="w-full bg-surface-container-low rounded-[0.75rem] py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                placeholder="AIza..."
                value={geminiInput}
                onChange={(e) => setGeminiInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGeminiSave()}
              />
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleGeminiSave}
                  className="px-5 py-2.5 bg-gold text-primary-container rounded-xl font-bold text-sm hover:opacity-88 transition-all"
                >
                  保存
                </button>
                {hasGeminiKey && (
                  <button
                    onClick={() => {
                      setEditingGemini(false)
                      setGeminiInput(geminiKey)
                      setGeminiError(null)
                    }}
                    className="px-5 py-2.5 bg-surface-container text-on-surface rounded-[0.75rem] font-bold text-sm hover:bg-surface-container-high transition-all"
                  >
                    キャンセル
                  </button>
                )}
              </div>
            </div>
          )}
          {geminiError && <ErrorBanner message={geminiError} />}
          {geminiSaved && <InlineNotice>Gemini API キーを更新しました。</InlineNotice>}
        </div>
      </SettingsCard>

      <SettingsCard
        icon="cloud"
        title="接続管理"
        description="考察スタジオとの接続を管理します。ログイン状態はこのブラウザに保持されます。"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-[0.75rem] bg-surface-container px-4 py-3">
            <div>
              <p className="text-sm font-bold japanese-text">考察スタジオ</p>
              <p className="text-xs text-on-surface-variant">{isAdsAuthenticated ? '現在接続中です。' : '現在は未接続です。'}</p>
            </div>
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${
              isAdsAuthenticated ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isAdsAuthenticated ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {isAdsAuthenticated ? '接続済' : '未接続'}
            </span>
          </div>

          {isAdsAuthenticated ? (
            <button
              onClick={handleAdsLogout}
              className="px-5 py-2.5 bg-error-container/40 text-error rounded-[0.75rem] font-bold text-sm hover:bg-error-container/60 transition-colors"
            >
              切断する
            </button>
          ) : (
            <div className="space-y-3">
              <input
                type="password"
                className="w-full bg-surface-container-low rounded-[0.75rem] py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                placeholder="パスワードを入力"
                value={adsPassword}
                onChange={(e) => setAdsPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdsLogin()}
              />
              <button
                onClick={handleAdsLogin}
                disabled={loading || !adsPassword.trim()}
                className="px-5 py-2.5 bg-secondary text-on-secondary rounded-[0.75rem] font-bold text-sm hover:opacity-90 transition-all disabled:opacity-50"
              >
                {loading ? 'ログイン中…' : 'ログイン'}
              </button>
            </div>
          )}

          {authError && <ErrorBanner message={authError} />}
          {authNotice && <InlineNotice>{authNotice}</InlineNotice>}
        </div>
      </SettingsCard>

      <SettingsCard
        icon="palette"
        title="テーマ"
        description="画面全体の配色を切り替えます。"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold japanese-text">ダークモード</p>
            <p className="text-xs text-on-surface-variant">{isDark ? '現在はダークテーマです。' : '現在はライトテーマです。'}</p>
          </div>
          <Toggle checked={isDark} onChange={toggleTheme} label="ダークモード" />
        </div>
      </SettingsCard>
    </div>
  )
}
