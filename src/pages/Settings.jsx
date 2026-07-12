import { useEffect, useState } from 'react'
import { ErrorBanner } from '../components/ui'
import { getAdsGeminiBudget, runAdsGeminiBudgetSmokeTest } from '../api/adsInsights'
import { getMarketLensGeminiBudget } from '../api/marketLens'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useUserProfile } from '../contexts/UserProfileContext'
import { ANALYSIS_PROVIDER_ANTHROPIC, ANALYSIS_PROVIDER_GEMINI } from '../utils/analysisProvider'
import { getApiKeyValidationError, validateClaudeKeyRemote } from '../utils/apiKeys'
import BillingSettingsCard from '../components/BillingSettingsCard'
import LegalPrivacySettingsCard from '../components/LegalPrivacySettingsCard'

function SettingsCard({ icon, title, description, children, className = '' }) {
  return (
    <section className={`space-y-6 rounded-[0.75rem] bg-surface-container-lowest p-5 panel-card-hover sm:p-6 ${className}`}>
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
    <div role={tone === 'error' ? 'alert' : 'status'} aria-live="polite" className={`flex items-center gap-3 rounded-[0.75rem] border px-4 py-3 text-sm ${toneClass}`}>
      <span className="material-symbols-outlined text-lg" aria-hidden="true">{icon}</span>
      <span className="japanese-text">{children}</span>
    </div>
  )
}

function formatUsd(value) {
  const num = Number(value || 0)
  if (num > 0 && num < 0.01) return `$${num.toFixed(6)}`
  return `$${num.toFixed(num >= 10 ? 2 : 4)}`
}

function formatUsagePercent(ratio) {
  const pct = Number(ratio || 0) * 100
  if (pct <= 0) return '0%'
  if (pct < 1) return `${pct.toFixed(4)}%`
  return `${Math.round(pct)}%`
}

function BudgetMeter({ label, budget }) {
  const ratio = Math.min(1, Math.max(0, Number(budget?.usage_ratio || 0)))
  const percent = formatUsagePercent(ratio)
  const barWidth = ratio > 0 ? `${Math.max(0.5, ratio * 100)}%` : '0%'
  const status = budget?.status || 'unknown'
  const tone = status === 'exceeded' || status === 'danger' || status === 'unknown'
    ? 'text-red-700 bg-red-50 border-red-200'
    : status === 'warning'
      ? 'text-amber-800 bg-amber-50 border-amber-200'
      : 'text-emerald-700 bg-emerald-50 border-emerald-200'
  const bar = status === 'exceeded' || status === 'danger' || status === 'unknown'
    ? 'bg-red-500'
    : status === 'warning'
      ? 'bg-amber-500'
      : 'bg-emerald-500'

  return (
    <div className="space-y-3 rounded-[0.75rem] bg-surface-container px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold japanese-text">{label}</p>
          <p className="text-xs text-on-surface-variant">
            {budget?.month || '----'} / {formatUsd(budget?.used_usd)} 使用
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}>
          {status === 'unknown' ? '確認不可' : percent}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-container-high">
        <div className={`h-full rounded-full ${bar}`} style={{ width: barWidth }} />
      </div>
      <div className="flex items-center justify-between text-xs text-on-surface-variant">
        <span>残り {formatUsd(budget?.remaining_usd)}</span>
        <span>上限 {formatUsd(budget?.budget_usd)} / 約{Number(budget?.budget_jpy_estimate || 0).toLocaleString('ja-JP')}円</span>
      </div>
      {budget?.storage_status === 'corrupt' && (
        <p className="text-xs font-bold text-red-700 japanese-text">使用量ファイルを読めないため、Gemini実行は停止されます。</p>
      )}
    </div>
  )
}

function GeminiBudgetCard({ geminiKey, hasGeminiKey }) {
  const [budgets, setBudgets] = useState({ ml: null, ads: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  async function loadBudgets() {
    setLoading(true)
    setError(null)
    const [ml, ads] = await Promise.allSettled([
      getMarketLensGeminiBudget(),
      getAdsGeminiBudget(),
    ])
    setBudgets({
      ml: ml.status === 'fulfilled' ? ml.value : null,
      ads: ads.status === 'fulfilled' ? ads.value : null,
    })
    if (ml.status === 'rejected' && ads.status === 'rejected') {
      setError('Gemini利用上限を取得できませんでした。')
    }
    setLoading(false)
  }

  useEffect(() => {
    let alive = true
    async function loadBudgetsWhenAlive() {
      const [ml, ads] = await Promise.allSettled([
        getMarketLensGeminiBudget(),
        getAdsGeminiBudget(),
      ])
      if (!alive) return
      setBudgets({
        ml: ml.status === 'fulfilled' ? ml.value : null,
        ads: ads.status === 'fulfilled' ? ads.value : null,
      })
      if (ml.status === 'rejected' && ads.status === 'rejected') {
        setError('Gemini利用上限を取得できませんでした。')
      }
      setLoading(false)
    }
    loadBudgetsWhenAlive()
    return () => { alive = false }
  }, [])

  const totalUsed = Number(budgets.ml?.used_usd || 0) + Number(budgets.ads?.used_usd || 0)
  const totalBudget = Number(budgets.ml?.budget_usd || 0) + Number(budgets.ads?.budget_usd || 0)
  const availableSources = [
    budgets.ml ? '競合・LP分析' : null,
    budgets.ads ? 'Webサイト分析AI' : null,
  ].filter(Boolean).join(' / ')
  const anyStopped = [budgets.ml, budgets.ads].some((b) => b?.status === 'exceeded' || b?.storage_status === 'corrupt')

  async function handleSmokeTest() {
    if (!hasGeminiKey || !geminiKey) {
      setTestResult({ tone: 'error', message: 'Gemini APIキーを保存してから疎通テストを実行してください。' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await runAdsGeminiBudgetSmokeTest(geminiKey)
      setBudgets((prev) => ({
        ...prev,
        ads: result.after || prev.ads,
        ml: result.after || prev.ml,
      }))
      setTestResult({
        tone: 'success',
        message: `Gemini接続OK。今回の記録額は ${formatUsd(result.delta_usd)} です。`,
      })
      await loadBudgets()
    } catch (e) {
      const body = e?.body || {}
      setTestResult({
        tone: 'error',
        message: body.detail || e?.message || 'Gemini疎通テストに失敗しました。',
      })
      await loadBudgets()
    } finally {
      setTesting(false)
    }
  }

  return (
    <SettingsCard
      icon="data_usage"
      title="Gemini 利用状況（機能別）"
      description="競合・LP分析とWebサイト分析AIは別々に上限を管理します。Google側の請求アラートも必ず併用してください。"
    >
      {loading ? (
        <div className="rounded-[0.75rem] bg-surface-container px-4 py-3 text-sm text-on-surface-variant japanese-text">
          利用状況を確認中…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-[0.75rem] bg-primary/[0.06] px-4 py-3">
            <div>
              <p className="text-sm font-bold text-primary japanese-text">合計使用額</p>
              <p className="text-xs text-on-surface-variant japanese-text">取得できた各分析機能の記録を合算しています。</p>
            </div>
            <span className="text-right text-lg font-black text-primary">
              {formatUsd(totalUsed)}
              {totalBudget > 0 && <small className="block text-[10px] font-medium text-on-surface-variant">確認できた上限 {formatUsd(totalBudget)}</small>}
            </span>
          </div>
          {budgets.ml && <BudgetMeter label="競合・LP・クリエイティブ分析" budget={budgets.ml} />}
          {budgets.ads && <BudgetMeter label="Webサイト分析AI" budget={budgets.ads} />}
          {availableSources && (
            <p className="text-xs text-on-surface-variant japanese-text">取得元: {availableSources}</p>
          )}
          <div className="flex flex-col gap-3 rounded-[0.75rem] bg-surface-container px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold japanese-text">Webサイト分析側の接続テスト</p>
              <p className="text-xs text-on-surface-variant japanese-text">保存済みキーで短い1回だけ実行します。少額のAPI利用が発生します。</p>
            </div>
            <button
              onClick={handleSmokeTest}
              disabled={testing || !hasGeminiKey || anyStopped}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[0.75rem] bg-primary-container px-4 py-2.5 text-sm font-bold text-on-primary transition-opacity hover:opacity-88 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">{testing ? 'progress_activity' : 'bolt'}</span>
              {testing ? '確認中…' : '少額テストを実行'}
            </button>
          </div>
          {!hasGeminiKey && (
            <p className="text-xs text-on-surface-variant japanese-text">Gemini APIキーを保存すると、ここから実使用額の増加を確認できます。</p>
          )}
          {testResult && (
            <InlineNotice tone={testResult.tone}>{testResult.message}</InlineNotice>
          )}
          {error && (
            <div className="flex flex-col gap-3 rounded-[0.75rem] bg-surface-container px-4 py-3 text-sm text-on-surface-variant sm:flex-row sm:items-center sm:justify-between">
              <span className="japanese-text">利用額を取得できませんでした。分析機能そのものは、接続状態に応じて利用できます。</span>
              <button onClick={loadBudgets} className="min-h-11 shrink-0 rounded-xl px-4 font-bold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary">再取得</button>
            </div>
          )}
          {anyStopped && (
            <InlineNotice tone="error">
              Geminiは月間上限に達したため停止中です。Claude fallbackを使うか、翌月まで待ってください。
            </InlineNotice>
          )}
        </div>
      )}
    </SettingsCard>
  )
}

export default function Settings() {
  const { displayName, setDisplayName } = useUserProfile()
  const {
    claudeKey,
    setClaudeKey,
    hasClaudeKey,
    geminiKey,
    setGeminiKey,
    hasGeminiKey,
    isAdsAuthenticated,
    logoutAds,
    user,
  } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const canConfigureAdvanced = user?.role === 'admin'

  const [localDisplayName, setLocalDisplayName] = useState(displayName)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState(null)

  const [claudeInput, setClaudeInput] = useState(claudeKey)
  const [editingClaude, setEditingClaude] = useState(!hasClaudeKey)
  const [claudeSaved, setClaudeSaved] = useState(false)
  const [claudeError, setClaudeError] = useState(null)
  const [claudeValidating, setClaudeValidating] = useState(false)

  const [geminiInput, setGeminiInput] = useState(geminiKey)
  const [editingGemini, setEditingGemini] = useState(!hasGeminiKey)
  const [geminiSaved, setGeminiSaved] = useState(false)
  const [geminiError, setGeminiError] = useState(null)

  const [authError, setAuthError] = useState(null)
  const [authNotice, setAuthNotice] = useState('')

  const [toast, setToast] = useState(null)

  useEffect(() => {
    setLocalDisplayName(displayName)
  }, [displayName])

  useEffect(() => {
    setClaudeInput(claudeKey)
    setEditingClaude(!hasClaudeKey)
  }, [claudeKey, hasClaudeKey])

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
    if (!claudeSaved) return undefined
    const id = setTimeout(() => setClaudeSaved(false), 3000)
    return () => clearTimeout(id)
  }, [claudeSaved])

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

  useEffect(() => {
    if (!toast) return undefined
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

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

  async function handleClaudeSave() {
    setClaudeError(null)
    const trimmed = claudeInput.trim()
    if (!trimmed) {
      setClaudeError('Claude API キーを入力してください。')
      return
    }
    const validationError = getApiKeyValidationError(trimmed, ANALYSIS_PROVIDER_ANTHROPIC)
    if (validationError) {
      setClaudeError(validationError)
      return
    }

    setClaudeValidating(true)
    try {
      const result = await validateClaudeKeyRemote(trimmed)
      if (result.error) {
        setClaudeError(result.error)
        return
      }
      if (result.warning) {
        setToast({ message: result.warning, tone: 'neutral' })
      }
    } finally {
      setClaudeValidating(false)
    }

    setClaudeKey(trimmed)
    setEditingClaude(false)
    setClaudeSaved(true)
  }

  function handleClaudeDelete() {
    if (!window.confirm('保存済みの Claude API キーを削除しますか？')) return
    setClaudeKey('')
    setClaudeInput('')
    setEditingClaude(true)
    setClaudeError(null)
    setClaudeSaved(false)
  }

  function handleGeminiSave() {
    setGeminiError(null)
    const trimmed = geminiInput.trim()
    if (!trimmed) {
      setGeminiError('Gemini API キーを入力してください。')
      return
    }
    const validationError = getApiKeyValidationError(trimmed, ANALYSIS_PROVIDER_GEMINI)
    if (validationError) {
      setGeminiError(validationError)
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

  function handleAdsLogout() {
    if (!window.confirm('Webサイト分析との接続を解除しますか？')) return
    logoutAds()
    setAuthError(null)
    setAuthNotice('Webサイト分析との接続を解除しました。')
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:space-y-8 lg:p-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-on-surface japanese-text">データ連携・設定</h1>
        <p className="text-sm text-on-surface-variant japanese-text">Webサイトの実データ接続と、必要な場合だけ使うAIキーを管理します。</p>
      </div>

      <section className="grid gap-3 rounded-2xl bg-primary p-4 text-on-primary sm:grid-cols-3 sm:p-5" aria-labelledby="availability-title">
        <h2 id="availability-title" className="sr-only">機能ごとの利用条件</h2>
        <div className="rounded-xl bg-white/10 p-4"><strong className="block">基本レポート・グラフ</strong><span className="text-sm text-white/75">AIキー不要</span></div>
        <div className="rounded-xl bg-white/10 p-4"><strong className="block">競合・LP・画像分析</strong><span className="text-sm text-white/75">{canConfigureAdvanced ? (hasGeminiKey || hasClaudeKey ? '追加分析を利用できます' : '管理者が有効化できます') : '導入担当者が安全に実行します'}</span></div>
        <div className="rounded-xl bg-white/10 p-4"><strong className="block">Webサイト実データ</strong><span className="text-sm text-white/75">{isAdsAuthenticated ? '分析データ接続済み' : 'Google接続と案件認証が必要'}</span></div>
      </section>

      <div className="grid grid-cols-1 items-start gap-6 xl:gap-8">
      <div className="flex flex-col gap-6 xl:gap-8">

      {canConfigureAdvanced && (<>
      <SettingsCard
        icon="smart_toy"
        title="Gemini API キー（推奨）"
        description="競合・LP・画像の詳細分析に使います。Google側でAPI利用料が発生し、Claudeより優先されます。"
      >
        <div className="space-y-4">
          {hasGeminiKey && !editingGemini ? (
            <>
              <div className="rounded-[0.75rem] bg-surface-container px-4 py-3">
                <p className="mb-1 text-xs font-bold text-on-surface-variant">このタブで利用中のキー</p>
                <p className="font-mono text-sm text-on-surface">{maskSecret(geminiKey)}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => { setEditingGemini(true); setGeminiError(null) }}
                  className="min-h-11 rounded-[0.75rem] bg-primary-container px-5 py-2.5 text-sm font-bold text-on-primary transition-opacity hover:opacity-88"
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
              <label htmlFor="settings-gemini-key" className="text-sm font-bold text-on-surface japanese-text">Gemini APIキー</label>
              <input
                id="settings-gemini-key"
                name="gemini-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="settings-gemini-help"
                className="w-full bg-surface-container-low rounded-[0.75rem] py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                placeholder="AIza..."
                value={geminiInput}
                onChange={(e) => setGeminiInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGeminiSave()}
              />
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleGeminiSave}
                  className="min-h-11 rounded-[0.75rem] bg-primary-container px-5 py-2.5 text-sm font-bold text-on-primary transition-opacity hover:opacity-88"
                >
                  Geminiキーを保存
                </button>
                {hasGeminiKey && (
                  <button
                    onClick={() => { setEditingGemini(false); setGeminiInput(geminiKey); setGeminiError(null) }}
                    className="min-h-11 rounded-[0.75rem] bg-surface-container px-5 py-2.5 text-sm font-bold text-on-surface transition-colors hover:bg-surface-container-high"
                  >
                    キャンセル
                  </button>
                )}
              </div>
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-secondary hover:underline"
              >
                <span className="material-symbols-outlined text-sm">open_in_new</span>
                Google AI Studio で API キーを取得
              </a>
              <p id="settings-gemini-help" className="text-xs text-on-surface-variant japanese-text">キーはこのタブを閉じるまでだけ保持されます。共有端末では利用後に削除してください。</p>
            </div>
          )}
          {geminiError && <ErrorBanner message={geminiError} />}
          {geminiSaved && <InlineNotice>Gemini API キーを更新しました。</InlineNotice>}
        </div>
      </SettingsCard>

      <SettingsCard
        icon="smart_toy"
        title="Claude API キー（予備）"
        description="Gemini未設定時の予備として、競合・LP・クリエイティブ分析で利用できます。"
      >
        <div className="space-y-4">
          {hasClaudeKey && !editingClaude ? (
            <>
              <div className="rounded-[0.75rem] bg-surface-container px-4 py-3">
                <p className="mb-1 text-xs font-bold text-on-surface-variant">このタブで利用中のキー</p>
                <p className="font-mono text-sm text-on-surface">{maskSecret(claudeKey)}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    setEditingClaude(true)
                    setClaudeError(null)
                  }}
                  className="min-h-11 rounded-[0.75rem] bg-primary-container px-5 py-2.5 text-sm font-bold text-on-primary transition-opacity hover:opacity-88"
                >
                  変更
                </button>
                <button
                  onClick={handleClaudeDelete}
                  className="px-5 py-2.5 bg-error-container/40 text-error rounded-[0.75rem] font-bold text-sm hover:bg-error-container/60 transition-colors"
                >
                  削除
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <label htmlFor="settings-claude-key" className="text-sm font-bold text-on-surface japanese-text">Claude APIキー</label>
              <input
                id="settings-claude-key"
                name="claude-api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="settings-claude-help"
                className="w-full bg-surface-container-low rounded-[0.75rem] py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
                placeholder="sk-ant-..."
                value={claudeInput}
                onChange={(e) => setClaudeInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleClaudeSave()}
              />
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleClaudeSave}
                  disabled={claudeValidating}
                  className="min-h-11 rounded-[0.75rem] bg-primary-container px-5 py-2.5 text-sm font-bold text-on-primary transition-opacity hover:opacity-88 disabled:opacity-50"
                >
                  {claudeValidating ? '検証中…' : 'Claudeキーを保存'}
                </button>
                {hasClaudeKey && (
                  <button
                    onClick={() => {
                      setEditingClaude(false)
                      setClaudeInput(claudeKey)
                      setClaudeError(null)
                    }}
                    className="min-h-11 rounded-[0.75rem] bg-surface-container px-5 py-2.5 text-sm font-bold text-on-surface transition-colors hover:bg-surface-container-high"
                  >
                    キャンセル
                  </button>
                )}
              </div>
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-secondary hover:underline"
              >
                <span className="material-symbols-outlined text-sm">open_in_new</span>
                Anthropic Console でAPIキーを取得
              </a>
              <p id="settings-claude-help" className="text-xs text-on-surface-variant japanese-text">保存時に最小リクエストで確認します。キーはこのタブを閉じるまでだけ保持されます。</p>
            </div>
          )}
          {claudeError && <ErrorBanner message={claudeError} />}
          {claudeSaved && <InlineNotice>Claude API キーを更新しました。</InlineNotice>}
        </div>
      </SettingsCard>

      <GeminiBudgetCard geminiKey={geminiKey} hasGeminiKey={hasGeminiKey} />
      </>)}

      <SettingsCard
        icon="cloud"
        title="Webサイト分析 接続"
        description="GA4・BigQueryの分析データへ接続する認証状態を管理します。"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-[0.75rem] bg-surface-container px-4 py-3">
            <div>
              <p className="text-sm font-bold japanese-text">Webサイト分析データ</p>
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
            <div className="flex items-center gap-3 py-2">
              <span className="material-symbols-outlined text-amber-500">info</span>
              <p className="text-sm text-on-surface-variant japanese-text">
                ヘッダーの案件セレクターから案件を選択・認証すると自動的に接続されます。
              </p>
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

      <BillingSettingsCard user={user} enabled={isAdsAuthenticated} />

      <LegalPrivacySettingsCard user={user} enabled={isAdsAuthenticated} />

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
              name="display-name"
              autoComplete="nickname"
              className="flex-1 bg-surface-container-low rounded-[0.75rem] py-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              value={localDisplayName}
              maxLength={20}
              onChange={(e) => setLocalDisplayName(e.target.value)}
              placeholder="オペレーター"
            />
            <button
              onClick={handleProfileSave}
              className="min-h-11 rounded-[0.75rem] bg-primary-container px-6 py-3 text-sm font-bold text-on-primary transition-opacity hover:opacity-88"
            >
              表示名を保存
            </button>
          </div>
          <p className="text-xs text-on-surface-variant">20文字まで。空欄で保存した場合は「オペレーター」になります。</p>
          {profileError && <ErrorBanner message={profileError} />}
          {profileSaved && <InlineNotice>表示名を保存しました。</InlineNotice>}
        </div>
      </SettingsCard>

      </div>

      </div>

      {toast && (
        <div role={toast.tone === 'error' ? 'alert' : 'status'} aria-live="polite" className={`fixed bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-2xl px-6 py-4 text-sm font-bold shadow-lg transition-[opacity,transform] animate-[slideUp_0.3s_ease-out] lg:bottom-[calc(env(safe-area-inset-bottom)+1rem)] ${
          toast.tone === 'error'
            ? 'bg-error text-on-error'
            : toast.tone === 'neutral'
              ? 'bg-surface-container-high text-on-surface'
              : 'bg-emerald-600 text-white'
        }`}>
          <span className="material-symbols-outlined text-lg" aria-hidden="true">
            {toast.tone === 'error' ? 'error' : toast.tone === 'neutral' ? 'info' : 'check_circle'}
          </span>
          <span className="japanese-text">{toast.message}</span>
        </div>
      )}
    </div>
  )
}
