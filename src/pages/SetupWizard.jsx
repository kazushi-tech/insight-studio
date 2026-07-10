import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { bqPeriods } from '../api/adsInsights'
import { LoadingSpinner, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { buildAdsReportBundle, generateBatchWithRetry } from '../utils/adsReports'
import { latestPeriodValue } from '../utils/wizardPeriods'

const QUERY_TYPES = [
  { id: 'pv', icon: 'trending_up', label: '見られた回数', term: 'ページビュー数（PV）・ユーザー数・セッション数', desc: 'サイトがどれくらい見られたか、日ごとの変化を確認します。', color: 'text-orange-600' },
  { id: 'traffic', icon: 'input', label: 'どこから来たか', term: '流入元／参照元・メディア', desc: '検索、広告、ほかのサイトなど、主な来訪元を確認します。', color: 'text-blue-600' },
  { id: 'cv', icon: 'target', label: '問い合わせ・予約・購入', term: 'キーイベント／コンバージョン（CV）', desc: '成果として計測できた動きがあるかを確認します。', color: 'text-emerald-600' },
  { id: 'search', icon: 'search', label: 'サイト内で検索された言葉', term: 'サイト内検索クエリ', desc: '訪問した人がサイト内で探した言葉を確認します。', color: 'text-purple-600' },
  { id: 'anomaly', icon: 'warning', label: '急に変わった日', term: '日別異常検知（Zスコア）', desc: '普段と大きく違う動きがあった日を確認します。', color: 'text-red-600' },
  { id: 'landing', icon: 'web', label: '入口になったページ', term: 'ランディングページ（LP）', desc: '最初に見られたページと、改善候補を確認します。', color: 'text-cyan-700' },
  { id: 'device', icon: 'devices', label: 'スマホ・パソコン', term: 'デバイスカテゴリ・OS', desc: '使われた端末による違いを確認します。', color: 'text-indigo-600' },
  { id: 'hourly', icon: 'schedule', label: '見られた時間帯', term: '時間帯別分析', desc: '訪問や成果が多い時間帯を確認します。', color: 'text-amber-700' },
  { id: 'user_attr', icon: 'group', label: '初めて・再訪した人と地域', term: '新規／リピーター・地域別分析', desc: '取得できる範囲で、新規・再訪と国・地域の傾向を確認します。', color: 'text-pink-600' },
  { id: 'engagement', icon: 'timer', label: 'ちゃんと読まれたか', term: 'エンゲージメント時間', desc: 'ページを見た時間や、内容への反応を確認します。', color: 'text-teal-700' },
  { id: 'auction_proxy', icon: 'stacked_bar_chart', label: '有料流入への偏り', term: '流入チャネル構成比（GA4推定）', desc: '来訪元の構成から、有料流入への偏りを確認します。', color: 'text-rose-600' },
]

const BASIC_QUERY_IDS = new Set(['pv', 'traffic', 'cv', 'landing'])

function recommendedSelection() {
  return new Set(
    QUERY_TYPES.map((queryType, index) => BASIC_QUERY_IDS.has(queryType.id) ? index : null).filter((index) => index != null),
  )
}

function periodValue(period) {
  return typeof period === 'string' ? period : period?.period_tag ?? period?.value ?? period?.period ?? period
}

const STEPS = ['見る内容', '期間', '完了']

const GRANULARITIES = [
  { value: 'monthly', label: '月別', icon: 'calendar_month' },
  { value: 'weekly', label: '週別', icon: 'date_range' },
  { value: 'daily', label: '日別', icon: 'today' },
]

function extractPeriods(data) {
  if (Array.isArray(data?.periods) && data.periods.length > 0) return data.periods
  if (Array.isArray(data?.results)) return data.results
  if (Array.isArray(data?.available_periods)) return data.available_periods
  if (Array.isArray(data)) return data
  return []
}

function QueryOption({ queryType, index, selected, onToggle }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(index)}
      className={`relative min-h-32 overflow-hidden rounded-2xl p-5 pl-7 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
        selected
          ? 'bg-primary/[0.055] ring-2 ring-primary/25'
          : 'bg-surface-container-lowest ring-1 ring-outline-variant/20 hover:bg-surface-container-low'
      }`}
    >
      <span className={`absolute inset-y-0 left-0 w-1.5 ${queryType.color.replace('text-', 'bg-')}`} aria-hidden="true" />
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className={`material-symbols-outlined shrink-0 text-2xl ${queryType.color}`} aria-hidden="true">{queryType.icon}</span>
          <strong className="text-sm leading-6 text-on-surface japanese-text">{queryType.label}</strong>
        </span>
        <span className={`material-symbols-outlined shrink-0 ${selected ? 'text-primary' : 'text-outline-variant'}`} aria-hidden="true">
          {selected ? 'check_circle' : 'circle'}
        </span>
      </span>
      <span className="mt-2 block text-xs font-black leading-5 text-primary/80 japanese-text">
        （{queryType.term}）
      </span>
      <span className="mt-3 block text-xs font-bold leading-6 text-on-surface-variant japanese-text">{queryType.desc}</span>
    </button>
  )
}

export default function SetupWizard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdsAuthenticated, authExpiredMessage, clearAuthExpiredMessage } = useAuth()
  const { completeSetup, getCurrentDatasetId, currentCase } = useAdsSetup()
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState(recommendedSelection)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [periods, setPeriods] = useState([])
  const [selectedPeriods, setSelectedPeriods] = useState(new Set())
  const [generatedPeriods, setGeneratedPeriods] = useState(new Set())
  const [generatedResults, setGeneratedResults] = useState(new Map())
  const [loadResult, setLoadResult] = useState(null)
  const [granularity, setGranularity] = useState('monthly')
  const [loadingLabel, setLoadingLabel] = useState('処理中…')
  const [periodDiagnostics, setPeriodDiagnostics] = useState(null)

  useEffect(() => {
    if (!location.state?.resetAt) return
    setStep(0)
    setSelected(recommendedSelection())
    setShowAdvanced(false)
    setError(null)
    setLoading(false)
    setPeriods([])
    setSelectedPeriods(new Set())
    setGeneratedPeriods(new Set())
    setGeneratedResults(new Map())
    setLoadResult(null)
    setGranularity('monthly')
    setLoadingLabel('処理中…')
    setPeriodDiagnostics(null)
  }, [location.state?.resetAt])

  useEffect(() => {
    if (isAdsAuthenticated) return
    setStep(0)
    setSelected(recommendedSelection())
    setShowAdvanced(false)
    setError(null)
    setLoading(false)
    setPeriods([])
    setSelectedPeriods(new Set())
    setGeneratedPeriods(new Set())
    setGeneratedResults(new Map())
    setLoadResult(null)
    setGranularity('monthly')
    setLoadingLabel('処理中…')
    setPeriodDiagnostics(null)
  }, [isAdsAuthenticated])

  const toggle = (index) => {
    const next = new Set(selected)
    next.has(index) ? next.delete(index) : next.add(index)
    setSelected(next)
    setGeneratedPeriods(new Set())
    setGeneratedResults(new Map())
    setLoadResult(null)
  }

  const togglePeriod = (value) => {
    const next = new Set(selectedPeriods)
    next.has(value) ? next.delete(value) : next.add(value)
    setSelectedPeriods(next)
    setGeneratedPeriods(new Set())
    setGeneratedResults(new Map())
    setLoadResult(null)
  }

  async function fetchPeriods(gran) {
    const data = await bqPeriods({ granularity: gran, dataset_id: getCurrentDatasetId() })
    const datasetId = getCurrentDatasetId()
    const diagnostics = {
      dataset_id: data?.dataset_id ?? datasetId,
      granularity: data?.granularity ?? gran,
      table_count: data?.table_count ?? null,
      method: data?.method ?? 'period_api',
      message: data?.message ?? '',
      raw: data,
    }
    return { items: extractPeriods(data), diagnostics }
  }

  async function handleGranularityChange(gran) {
    setGranularity(gran)
    setSelectedPeriods(new Set())
    setGeneratedPeriods(new Set())
    setGeneratedResults(new Map())
    setError(null)
    setLoadResult(null)
    setPeriodDiagnostics(null)
    setLoading(true)
    setLoadingLabel('期間を取得中…')
    try {
      const { items, diagnostics } = await fetchPeriods(gran)
      setPeriodDiagnostics(diagnostics)
      if (items.length === 0) {
        setPeriods([])
        setSelectedPeriods(new Set())
        setError(diagnostics?.message || 'この粒度では利用可能な分析期間が見つかりませんでした。')
      } else {
        setPeriods(items)
        const latestPeriod = latestPeriodValue(items)
        setSelectedPeriods(latestPeriod ? new Set([latestPeriod]) : new Set())
      }
    } catch (e) {
      setError(e.message)
      setPeriods([])
    } finally {
      setLoading(false)
    }
  }

  async function handleNext() {
    setError(null)

    if (step === 0) {
      if (selected.size === 0) return
      setLoading(true)
      setLoadingLabel('期間を取得中…')

      try {
        const { items, diagnostics } = await fetchPeriods(granularity)
        setPeriodDiagnostics(diagnostics)

        if (items.length === 0) {
          setPeriods([])
          setSelectedPeriods(new Set())
          setGeneratedPeriods(new Set())
          setGeneratedResults(new Map())
          setLoadResult(null)
          setError(diagnostics?.message || 'BigQueryデータセットに利用可能な分析期間が見つかりませんでした。')
          setStep(1)
          return
        }

        setPeriods(items)
        const latestPeriod = latestPeriodValue(items)
        setSelectedPeriods(latestPeriod ? new Set([latestPeriod]) : new Set())
        setGeneratedPeriods(new Set())
        setGeneratedResults(new Map())
        setLoadResult(null)
        setStep(1)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }

      return
    }

    if (step === 1) {
      if (selectedPeriods.size === 0) return
      setLoading(true)
      setLoadingLabel('レポートを生成中…')
      let completedCount = generatedResults.size

      try {
        const selectedTypes = [...selected].map((index) => QUERY_TYPES[index])
        const queryTypeIds = selectedTypes.map((t) => t.id).filter(Boolean)
        const periodsArray = [...selectedPeriods]
        const currentResults = new Map(generatedResults)
        const pendingPeriods = periodsArray.filter((period) => !currentResults.has(period))
        setLoadingLabel(`レポートを生成中… (0/${periodsArray.length})`)

        for (const period of pendingPeriods) {
          setLoadingLabel(`レポートを生成中… (${currentResults.size}/${periodsArray.length})`)
          const data = await generateBatchWithRetry({
            query_types: queryTypeIds,
            dataset_id: getCurrentDatasetId(),
            period,
          })
          currentResults.set(period, { ...data, period })
          completedCount = currentResults.size
          setGeneratedResults(new Map(currentResults))
          setGeneratedPeriods(new Set(currentResults.keys()))
          setLoadingLabel(`レポートを生成中… (${currentResults.size}/${periodsArray.length})`)
        }
        const results = periodsArray.map((period) => currentResults.get(period)).filter(Boolean)
        const reportBundle = buildAdsReportBundle({
          setupState: {
            queryTypes: queryTypeIds,
            periods: periodsArray,
            granularity,
            datasetId: getCurrentDatasetId(),
          },
          results,
        })
        setLoadResult(results.length === 1 ? results[0] : { ok: true, results, report_md: reportBundle.reportMd })
        completeSetup(
          {
            queryTypes: queryTypeIds,
            periods: periodsArray,
            granularity,
            datasetId: getCurrentDatasetId(),
          },
          reportBundle,
        )
        setStep(2)
      } catch (e) {
        const progressMessage =
          completedCount > 0
            ? `${e.message} ${completedCount}/${selectedPeriods.size} 期間は生成済みです。次の再試行では未完了分のみ送信します。`
            : e.message
        setError(progressMessage)
      } finally {
        setLoading(false)
        setLoadingLabel('処理中…')
      }

      return
    }

    navigate('/ads/report')
  }

  function handleBack() {
    if (step === 0) return
    if (step === 1) {
      setSelectedPeriods(new Set())
      setGeneratedPeriods(new Set())
      setGeneratedResults(new Map())
      setLoadResult(null)
    }
    setStep((current) => current - 1)
  }

  return (
    <main className="mx-auto max-w-[1100px] space-y-8 px-4 py-6 pb-24 sm:px-6 lg:px-8 lg:py-10" aria-labelledby="setup-wizard-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary">3ステップで完了</p>
          <h1 id="setup-wizard-title" className="mt-2 text-3xl font-extrabold tracking-tight text-on-surface japanese-text">サイト分析の準備</h1>
          <p className="mt-2 max-w-2xl text-sm font-bold leading-7 text-on-surface-variant japanese-text">
            まずはおすすめの4項目だけで十分です。専門的な項目は、必要になってから追加できます。
          </p>
        </div>
        <div className="rounded-2xl bg-primary/[0.055] px-4 py-3 text-sm">
          <p className="text-[10px] font-black text-on-surface-variant">現在の計測データ</p>
          <p className="mt-1 max-w-[280px] truncate font-extrabold text-primary japanese-text">{currentCase?.name || '接続先を選んでください'}</p>
        </div>
      </div>

      {authExpiredMessage && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-error-container border border-red-200 dark:border-error/30 rounded-[0.75rem] px-5 py-3 text-sm text-red-800 dark:text-on-error-container">
          <span className="material-symbols-outlined text-lg">error</span>
          <span className="japanese-text flex-1">{authExpiredMessage}</span>
          <button onClick={clearAuthExpiredMessage} className="text-red-600 dark:text-error hover:text-red-800 shrink-0">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}

      {!isAdsAuthenticated && !authExpiredMessage && (
        <div className="flex items-center gap-3 bg-amber-50 dark:bg-warning-container border border-amber-200 dark:border-warning/30 rounded-[0.75rem] px-5 py-3 text-sm text-amber-800 dark:text-on-warning-container">
          <span className="material-symbols-outlined text-lg">warning</span>
          <span className="japanese-text">Webサイト分析への接続が必要です。ヘッダーの鍵アイコンから認証してください。</span>
        </div>
      )}

      {!currentCase && (
        <div className="flex items-center gap-3 bg-blue-50 dark:bg-info-container border border-blue-200 dark:border-info/30 rounded-[0.75rem] px-5 py-3 text-sm text-blue-800 dark:text-on-info-container">
          <span className="material-symbols-outlined text-lg">info</span>
          <span className="japanese-text">案件を選択してください。ヘッダーの案件セレクターから対象案件を選べます。</span>
        </div>
      )}

      <ol className="mx-auto grid max-w-2xl grid-cols-3 gap-2" aria-label="セットアップの進み具合">
        {STEPS.map((stepLabel, index) => (
          <li key={stepLabel} className="flex min-w-0 flex-col items-center gap-2 text-center">
            <div
              className={`flex size-10 items-center justify-center rounded-full border-2 text-sm font-bold ${
                index === step
                  ? 'bg-secondary text-on-secondary border-secondary'
                  : index < step
                  ? 'bg-primary text-on-primary border-primary'
                  : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant'
              }`}
            >
              {index < step ? <span className="material-symbols-outlined text-sm">check</span> : index + 1}
            </div>
            <span className={`text-sm font-bold ${index === step ? 'text-on-surface' : 'text-on-surface-variant'}`}>
              {stepLabel}
            </span>
          </li>
        ))}
      </ol>

      {error && (
        <ErrorBanner message={error} />
      )}

      {step === 0 && (
        <section aria-labelledby="query-selection-title" className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="query-selection-title" className="text-2xl font-extrabold text-on-surface japanese-text">何を知りたいですか？</h2>
              <p className="mt-1 text-sm font-bold text-on-surface-variant japanese-text">おすすめは最初から選択済みです。そのまま「次へ」で進めます。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setSelected(recommendedSelection())} className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                おすすめに戻す
              </button>
            </div>
          </div>

          <div className="rounded-2xl bg-primary/[0.045] p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary text-on-primary" aria-hidden="true">
                <span className="material-symbols-outlined">auto_awesome</span>
              </span>
              <div>
                <h3 className="font-extrabold text-primary japanese-text">おまかせ分析</h3>
                <p className="text-xs font-bold text-on-surface-variant japanese-text">アクセス・来訪元・成果・入口ページの4つを確認します。</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {QUERY_TYPES.map((queryType, index) => ({ queryType, index }))
                .filter(({ queryType }) => BASIC_QUERY_IDS.has(queryType.id))
                .map(({ queryType, index }) => (
                  <QueryOption key={queryType.id} queryType={queryType} index={index} selected={selected.has(index)} onToggle={toggle} />
                ))}
            </div>
          </div>

          <div className="rounded-2xl bg-surface-container-lowest ring-1 ring-outline-variant/20">
            <button
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((value) => !value)}
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-5 py-3 text-left font-extrabold text-on-surface hover:bg-surface-container-low focus-visible:outline-2 focus-visible:outline-primary japanese-text"
            >
              <span>詳しい分析項目を選ぶ</span>
              <span className={`material-symbols-outlined transition-transform ${showAdvanced ? 'rotate-180' : ''}`} aria-hidden="true">expand_more</span>
            </button>
            {showAdvanced && (
              <div className="grid gap-3 border-t border-outline-variant/15 p-4 md:grid-cols-2 lg:grid-cols-3">
                {QUERY_TYPES.map((queryType, index) => ({ queryType, index }))
                  .filter(({ queryType }) => !BASIC_QUERY_IDS.has(queryType.id))
                  .map(({ queryType, index }) => (
                    <QueryOption key={queryType.id} queryType={queryType} index={index} selected={selected.has(index)} onToggle={toggle} />
                  ))}
              </div>
            )}
          </div>
        </section>
      )}

      {step === 1 && (
        <section aria-labelledby="period-selection-title" className="space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="period-selection-title" className="text-2xl font-extrabold text-on-surface japanese-text">いつの結果を見ますか？</h2>
              <p className="mt-1 text-sm font-bold text-on-surface-variant japanese-text">
                {selectedPeriods.size > 0
                  ? `${selectedPeriods.size}期間を選択中。最新期間は自動で選んであります。`
                  : periods.length > 0 ? '1期間以上選んでください' : '利用できる期間を確認できませんでした'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const latest = latestPeriodValue(periods)
                  setSelectedPeriods(latest ? new Set([latest]) : new Set())
                  setGeneratedPeriods(new Set())
                  setGeneratedResults(new Map())
                }}
                disabled={loading || periods.length === 0}
                className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary disabled:opacity-50"
              >
                最新だけ見る
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedPeriods(new Set(periods.map(periodValue).filter(Boolean)))
                  setGeneratedPeriods(new Set())
                  setGeneratedResults(new Map())
                }}
                disabled={loading || periods.length === 0}
                className="min-h-11 rounded-xl border border-primary/20 bg-surface-container-lowest px-4 py-2 text-sm font-black text-primary disabled:opacity-50"
              >
                すべて比べる
              </button>
            </div>
          </div>

          <details className="rounded-2xl bg-surface-container-lowest ring-1 ring-outline-variant/20">
            <summary className="cursor-pointer px-5 py-4 text-sm font-extrabold text-on-surface japanese-text">期間のまとめ方を変更する</summary>
            <div className="flex flex-wrap gap-2 border-t border-outline-variant/15 p-4">
              {GRANULARITIES.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => handleGranularityChange(g.value)}
                  disabled={loading}
                  className={`flex min-h-11 items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
                    granularity === g.value
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  <span className="material-symbols-outlined text-base" aria-hidden="true">{g.icon}</span>
                  {g.label}{g.value === 'monthly' ? '（おすすめ）' : ''}
                </button>
              ))}
            </div>
          </details>

          {loading ? (
            <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant">
              <LoadingSpinner size="md" label={loadingLabel} />
            </div>
          ) : periods.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-amber-700" aria-hidden="true">database_off</span>
                <div>
                  <p className="text-sm font-black text-amber-900 japanese-text">表示できる期間を確認できませんでした</p>
                  <p className="mt-1 text-sm leading-6 text-on-surface-variant japanese-text">
                    データの接続先と計測状況を確認してから、もう一度お試しください。
                  </p>
                  {periodDiagnostics && (
                    <details className="mt-4 rounded-xl bg-surface-container-lowest px-4 py-3 text-xs">
                      <summary className="cursor-pointer font-black text-on-surface-variant">接続の診断情報</summary>
                      <dl className="mt-3 grid gap-2 md:grid-cols-2">
                        {[
                          ['保存先ID', periodDiagnostics.dataset_id],
                          ['まとめ方', periodDiagnostics.granularity],
                          ['確認できた表', periodDiagnostics.table_count],
                          ['確認方法', periodDiagnostics.method],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-lg border border-amber-200 px-3 py-2">
                            <dt className="font-black text-on-surface-variant">{label}</dt>
                            <dd className="mt-1 break-all font-bold text-on-surface">{value ?? '-'}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {generatedPeriods.size > 0 && (
                <div className="flex items-center gap-3 bg-amber-50 dark:bg-warning-container border border-amber-200 dark:border-warning/30 rounded-[0.75rem] px-5 py-3 text-sm text-amber-800 dark:text-on-warning-container">
                  <span className="material-symbols-outlined text-lg">info</span>
                  <span className="japanese-text">
                    前回の処理で {generatedPeriods.size} 期間は生成済みです。再試行すると未完了分のみ送信します。
                  </span>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {periods.map((period, index) => {
                  const label = typeof period === 'string'
                    ? period
                    : period.period_tag ?? period.label ?? period.period ?? `期間 ${index + 1}`
                  const value = typeof period === 'string'
                    ? period
                    : period.period_tag ?? period.value ?? period.period ?? period

                  return (
                    <button
                      key={index}
                      type="button"
                      aria-pressed={selectedPeriods.has(value)}
                      onClick={() => togglePeriod(value)}
                      className={`min-h-24 rounded-2xl p-5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                        selectedPeriods.has(value)
                          ? 'bg-primary/[0.055] ring-2 ring-primary/25'
                          : 'bg-surface-container-lowest ring-1 ring-outline-variant/20 hover:bg-surface-container-low'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="material-symbols-outlined text-secondary">calendar_today</span>
                          <span className="font-bold text-on-surface japanese-text">{label}</span>
                        </div>
                        {selectedPeriods.has(value) && <span className="material-symbols-outlined text-secondary">check_circle</span>}
                      </div>
                      {period.period_type && (
                        <p className="text-xs text-on-surface-variant mt-1 ml-9">{period.period_type}</p>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-6xl text-secondary mb-4 block">check_circle</span>
          <h2 className="text-2xl font-extrabold text-on-surface japanese-text">最初のレポートができました</h2>
          <p className="text-on-surface-variant mt-2 japanese-text">
            {selectedPeriods.size}期間 × {selected.size}項目を確認しました。「レポートを見る」から結果へ進めます。
          </p>
          {loadResult?.summary && (
            <p className="text-sm text-on-surface-variant mt-4 japanese-text">{loadResult.summary}</p>
          )}
        </div>
      )}

      <div className="flex justify-center gap-4 pt-10 border-t border-outline-variant/20">
        <button
          onClick={handleBack}
          disabled={step === 0}
          className="px-10 py-3 border border-outline-variant/50 rounded-[0.75rem] font-bold text-sm hover:bg-surface-container transition-all disabled:opacity-50"
        >
          戻る
        </button>
        <button
          onClick={handleNext}
          disabled={loading || (step === 0 && selected.size === 0) || (step === 1 && selectedPeriods.size === 0) || !isAdsAuthenticated}
          className="px-10 py-3 bg-primary-container text-on-primary rounded-[0.75rem] font-bold text-sm flex items-center gap-2 hover:opacity-88 transition-opacity disabled:opacity-45 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <LoadingSpinner size="sm" />
              <span>処理中…</span>
            </>
          ) : (
            <>
              {step === 2 ? 'レポートを見る' : '次へ'}
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </>
          )}
        </button>
      </div>
    </main>
  )
}
