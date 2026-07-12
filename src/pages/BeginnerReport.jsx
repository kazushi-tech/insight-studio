import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AUTH_EXPIRED_MESSAGE } from '../api/adsInsights'
import DataStatePanel from '../components/DataStatePanel'
import ReportOutputActions from '../components/reporting/ReportOutputActions'
import ReportQuestionPanel from '../components/reporting/ReportQuestionPanel'
import { reportEvidenceDomId } from '../components/reporting/reportQuestionContract'
import { LoadingSpinner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { useReportHistory } from '../contexts/ReportHistoryContext'
import MotionReveal from '../motion/MotionReveal'
import {
  buildBeginnerReportFromCharts,
  getChartPeriodTags,
  getDisplayChartGroups,
  regenerateAdsReportBundle,
} from '../utils/adsReports'
import {
  buildCustomerReportViewModel,
  getCustomerReportGaps,
  normalizeCustomerReportContract,
} from '../utils/customerReport'
import { shouldShowDemoMode } from '../utils/demoMode'
import { findPersistedReportId } from '../utils/reportSharing'
import { latestPeriodValue, periodRangeLabel } from '../utils/wizardPeriods'
import { normalizeCustomerError } from '../utils/customerErrors'

const CONCLUSION_STYLES = {
  positive: { icon: 'trending_up', surface: 'bg-primary/[0.055]', iconSurface: 'bg-primary/10 text-primary' },
  neutral: { icon: 'horizontal_rule', surface: 'bg-surface-container-lowest', iconSurface: 'bg-surface-container text-primary' },
  warning: { icon: 'priority_high', surface: 'bg-warning-container/70', iconSurface: 'bg-warning/10 text-warning' },
  critical: { icon: 'error', surface: 'bg-error-container/70', iconSurface: 'bg-error/10 text-error' },
}

const PRIORITY_LABELS = {
  P1: '最優先',
  P2: '次に対応',
  P3: '継続確認',
}

function selectedPeriodReport(reportBundle, periodFilter) {
  const reports = reportBundle?.periodReports ?? []
  if (periodFilter === 'all') return null
  if (periodFilter === 'latest') {
    const latestPeriod = latestPeriodValue(reports.map((report) => report.periodTag))
    return reports.find((report) => report.periodTag === latestPeriod) ?? null
  }
  return reports.find((report) => report.periodTag === periodFilter) ?? null
}

function formatObservedAt(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '確認中'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

function graphHref(item, period) {
  const params = new URLSearchParams({
    period: period || 'latest',
    theme: item.theme || 'all',
    view: 'summary',
  })
  return `/ads/graphs?${params.toString()}`
}

function ConclusionCard({ item, index }) {
  const style = CONCLUSION_STYLES[item.severity] ?? CONCLUSION_STYLES.neutral
  return (
    <MotionReveal index={index} maximumItems={3}>
      <article className={`h-full rounded-2xl p-5 shadow-sm ${style.surface}`}>
        <span className={`material-symbols-outlined grid size-11 place-items-center rounded-xl text-[22px] ${style.iconSurface}`} aria-hidden="true">
          {style.icon}
        </span>
        <p className="mt-4 text-[11px] font-black uppercase tracking-[0.12em] text-on-surface-variant">
          結論 {index + 1}
        </p>
        <h3 className="mt-2 text-lg font-extrabold leading-7 text-on-surface japanese-text">{item.title}</h3>
        {item.body && <p className="mt-2 text-sm font-semibold leading-7 text-on-surface-variant japanese-text">{item.body}</p>}
      </article>
    </MotionReveal>
  )
}

function ActionList({ actions }) {
  return (
    <section className="rounded-2xl bg-primary p-5 text-on-primary shadow-sm" aria-labelledby="report-actions-title">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-2xl" aria-hidden="true">assignment_turned_in</span>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-white/70">Next</p>
          <h2 id="report-actions-title" className="text-lg font-extrabold japanese-text">次にやること</h2>
        </div>
      </div>
      <ol className="mt-4 space-y-3">
        {actions.map((action, index) => (
          <li key={action.key ?? `${action.priority}-${index}`}>
            <MotionReveal index={index} maximumItems={3} className="rounded-xl bg-white/10 p-4">
              <div className="flex items-start gap-3">
                <span className="shrink-0 rounded-full bg-white/15 px-2 py-1 text-[11px] font-black">
                  {PRIORITY_LABELS[action.priority] ?? action.priority}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-black leading-6 japanese-text">{action.title}</h3>
                  {action.reason && <p className="mt-1 text-xs font-semibold leading-6 text-white/80 japanese-text">{action.reason}</p>}
                  {action.success_metric && (
                    <p className="mt-2 text-[11px] font-bold text-white/70 japanese-text">確認する数字: {action.success_metric}</p>
                  )}
                </div>
              </div>
            </MotionReveal>
          </li>
        ))}
      </ol>
    </section>
  )
}

function HoldPanel({ gaps }) {
  return (
    <section className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm" aria-labelledby="report-holds-title">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined grid size-11 place-items-center rounded-xl bg-warning-container text-on-warning-container" aria-hidden="true">rule</span>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-on-surface-variant">Hold</p>
          <h2 id="report-holds-title" className="text-base font-extrabold text-on-surface japanese-text">まだ判断できないこと</h2>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {gaps.length > 0 ? gaps.map((gap) => (
          <article key={gap.key} className="rounded-xl bg-surface-container-low px-4 py-3">
            <h3 className="text-sm font-black text-on-surface japanese-text">{gap.title}</h3>
            {gap.body && <p className="mt-1 text-xs font-bold leading-6 text-on-surface-variant japanese-text">{gap.body}</p>}
            {gap.next_step && <p className="mt-2 text-[11px] font-black text-primary japanese-text">次の確認: {gap.next_step}</p>}
          </article>
        )) : (
          <p className="rounded-xl bg-surface-container-low px-4 py-3 text-sm font-bold leading-6 text-on-surface-variant japanese-text">
            今回の数字から保留すべき事項は追加されていません。根拠を確認してから行動してください。
          </p>
        )}
      </div>
    </section>
  )
}

function EvidenceLinks({ evidence, period }) {
  return (
    <section className="rounded-2xl bg-surface-container-lowest p-5 shadow-sm" aria-labelledby="report-evidence-title">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-primary">Evidence</p>
          <h2 id="report-evidence-title" className="mt-1 text-lg font-extrabold text-on-surface japanese-text">数字の根拠</h2>
        </div>
        <Link to="/ads/graphs" className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-black text-primary hover:bg-primary/[0.05]">
          すべて見る
        </Link>
      </div>
      {evidence.length > 0 ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {evidence.map((item, index) => (
            <li
              key={item.key}
              id={reportEvidenceDomId(index)}
              className="scroll-mt-24"
            >
              <Link
                to={graphHref(item, period)}
                className="flex min-h-14 items-center justify-between gap-3 rounded-xl bg-surface-container-low px-4 py-3 text-sm font-black text-on-surface hover:bg-primary/[0.07] focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="min-w-0 japanese-text">{item.title}</span>
                <span className="material-symbols-outlined shrink-0 text-lg text-primary" aria-hidden="true">arrow_forward</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl bg-surface-container-low px-4 py-3 text-sm font-bold text-on-surface-variant japanese-text">
          表示できる根拠がまだありません。期間を変えて再取得してください。
        </p>
      )}
    </section>
  )
}

function stateForAvailability(state) {
  if (state === 'ready') return 'full'
  if (state === 'partial') return 'partial'
  if (state === 'error') return 'error'
  return 'empty'
}

export default function BeginnerReport() {
  const navigate = useNavigate()
  const { isAdsAuthenticated, user: authUser } = useAuth()
  const { setupState, reportBundle, setReportBundle, resetSetup, currentCase } = useAdsSetup()
  const {
    history: reportHistory,
    projectRef: historyProjectRef,
    addEntry: addReportHistoryEntry,
    historyState,
  } = useReportHistory()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [periodFilter, setPeriodFilter] = useState('latest')
  const [questionOpen, setQuestionOpen] = useState(false)
  const isDemo = shouldShowDemoMode({ isAdsAuthenticated, user: authUser, currentCase })

  useEffect(() => {
    if (!setupState || !isAdsAuthenticated) return
    if (reportBundle?.source === 'bq_generate_batch') return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const nextBundle = await regenerateAdsReportBundle(setupState)
        if (!cancelled) setReportBundle(nextBundle)
      } catch (nextError) {
        if (!cancelled) setError(nextError.isAuthError ? AUTH_EXPIRED_MESSAGE : normalizeCustomerError(nextError, { role: authUser?.role }).body)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [authUser?.role, isAdsAuthenticated, reportBundle?.source, setReportBundle, setupState])

  const chartGroups = useMemo(() => reportBundle?.chartGroups ?? [], [reportBundle?.chartGroups])
  const periodTags = useMemo(() => getChartPeriodTags(chartGroups), [chartGroups])
  const selectedReport = useMemo(() => selectedPeriodReport(reportBundle, periodFilter), [periodFilter, reportBundle])
  const displayGroups = useMemo(() => getDisplayChartGroups(chartGroups, periodFilter), [chartGroups, periodFilter])
  const executionSummary = selectedReport?.executionSummary ?? reportBundle?.executionSummary ?? []
  const legacyReport = selectedReport?.beginnerReport || reportBundle?.beginnerReport ||
    buildBeginnerReportFromCharts(displayGroups, executionSummary)
  const canonicalReport = selectedReport?.reportV2 ?? selectedReport?.raw?.report_v2 ?? reportBundle?.reportV2 ?? null
  const canonicalResult = useMemo(
    () => canonicalReport ? normalizeCustomerReportContract(canonicalReport) : null,
    [canonicalReport],
  )
  const reportView = useMemo(() => {
    const source = canonicalResult
      ? canonicalResult.valid ? canonicalResult : null
      : legacyReport
    if (!source) return null
    return buildCustomerReportViewModel(source, {
      chartGroups: displayGroups,
      period: selectedReport?.periodTag ?? periodFilter,
      periodLabel: selectedReport?.label,
      generatedAt: reportBundle?.generatedAt,
      site: reportBundle?.site,
    })
  }, [canonicalResult, displayGroups, legacyReport, periodFilter, reportBundle?.generatedAt, reportBundle?.site, selectedReport])
  const gaps = useMemo(() => getCustomerReportGaps(reportView), [reportView])
  const dateRange = periodRangeLabel(setupState?.periods ?? [])
  const activeScopeLabel = periodFilter === 'all'
    ? '全期間'
    : periodFilter === 'latest'
      ? `最新期間: ${latestPeriodValue(periodTags) ?? '-'}`
      : periodFilter
  const freshness = reportView?.source_schema === 'report.v2'
    ? reportView.generated_at
    : reportBundle?.generatedAt
  const persistedReportId = useMemo(
    () => canonicalResult?.valid
      ? findPersistedReportId(reportHistory, canonicalResult.report)
      : null,
    [canonicalResult, reportHistory],
  )

  async function handleRefresh() {
    if (!setupState || !isAdsAuthenticated || loading) return
    setLoading(true)
    setError(null)
    try {
      setReportBundle(await regenerateAdsReportBundle(setupState))
    } catch (nextError) {
      setError(nextError.isAuthError ? AUTH_EXPIRED_MESSAGE : normalizeCustomerError(nextError, { role: authUser?.role }).body)
    } finally {
      setLoading(false)
    }
  }

  function handleChangeSetup() {
    resetSetup()
    navigate('/ads/wizard', { state: { resetAt: Date.now() } })
  }

  function handleOpenQuestion() {
    setQuestionOpen(true)
    globalThis.requestAnimationFrame?.(() => {
      const panel = document.getElementById('report-question-panel')
      panel?.scrollIntoView?.({ block: 'center' })
      panel?.querySelector?.('textarea, input, button')?.focus?.()
    })
  }

  const contractError = canonicalResult && !canonicalResult.valid
  const state = stateForAvailability(reportView?.availability?.state)

  return (
    <div className="min-w-0 flex-1 overflow-x-hidden">
      <div className="mx-auto max-w-[1200px] space-y-7 px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary-container px-3 py-1 text-[11px] font-black text-on-primary-container">
                {isDemo ? 'デモデータ' : '実データを反映'}
              </span>
              <span className="rounded-full bg-surface-container px-3 py-1 text-[11px] font-black text-on-surface-variant">{activeScopeLabel}</span>
            </div>
            <h1 id="beginner-report-title" className="mt-4 text-2xl font-extrabold tracking-tight text-primary japanese-text sm:text-3xl">
              Web成果レポート
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-on-surface-variant japanese-text">
              今回の結論、次にやること、まだ判断できないことを、根拠と一緒に確認できます。
            </p>
            <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-bold text-on-surface-variant">
              {reportBundle?.site?.name && <div><dt className="sr-only">対象</dt><dd>対象: {reportBundle.site.name}</dd></div>}
              {dateRange && <div><dt className="sr-only">期間</dt><dd>期間: {dateRange}</dd></div>}
              <div><dt className="sr-only">データ最終確認</dt><dd>データ最終確認: {formatObservedAt(freshness)}</dd></div>
            </dl>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto lg:justify-end">
            {periodTags.length > 0 && (
              <select
                value={periodFilter}
                onChange={(event) => setPeriodFilter(event.target.value)}
                className="min-h-11 rounded-xl bg-surface-container-low px-3 py-2 text-sm font-bold text-on-surface-variant focus-visible:outline-2 focus-visible:outline-primary"
                aria-label="表示期間"
              >
                <option value="latest">最新期間</option>
                <option value="all">全期間</option>
                {periodTags.map((period) => <option key={period} value={period}>{period}</option>)}
              </select>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || !isAdsAuthenticated || !setupState}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <LoadingSpinner size="sm" /> : <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>}
              最新データを確認
            </button>
            <button
              type="button"
              onClick={handleOpenQuestion}
              aria-expanded={questionOpen}
              aria-controls="report-question-panel"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-surface-container-lowest px-4 py-2 text-sm font-black text-primary shadow-sm hover:bg-primary/[0.05] focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">auto_awesome</span>
              この結果をAIに聞く
            </button>
          </div>
        </header>

        {error && <DataStatePanel state="error" message={error} onRetry={handleRefresh} />}
        {contractError && !error && (
          <DataStatePanel
            state="error"
            message="安全に表示できるレポート形式を確認できませんでした。再取得してください。"
            onRetry={handleRefresh}
          />
        )}
        {loading && !reportBundle && <DataStatePanel state="loading" message="レポートを準備しています。" />}
        {!loading && !error && !setupState && (
          <DataStatePanel
            state="empty"
            title="最初に分析する期間を選びます"
            message="目的と期間を選ぶと、Web成果レポートを作れます。"
          >
            <button type="button" onClick={handleChangeSetup} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-black text-on-primary">
              レポート作成を始める
            </button>
          </DataStatePanel>
        )}

        {reportView && !error && !contractError && (
          <>
            {state !== 'full' && (
              <DataStatePanel state={state} message={reportView.availability?.message} onRetry={state === 'error' ? handleRefresh : undefined} />
            )}

            {canonicalResult?.valid && (
              <ReportOutputActions
                projectRef={historyProjectRef}
                report={canonicalResult.report}
                historyEntries={reportHistory}
                historyState={historyState}
                user={authUser}
                onSaveReport={() => addReportHistoryEntry({
                  setupState,
                  reportBundle,
                  messages: [],
                  contextMode: 'ads-only',
                })}
              />
            )}

            <section aria-labelledby="report-conclusions-title">
              <div className="mb-4">
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-primary">Summary</p>
                <h2 id="report-conclusions-title" className="mt-1 text-xl font-extrabold text-on-surface japanese-text">今回の結論</h2>
              </div>
              {reportView.conclusions.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {reportView.conclusions.slice(0, 3).map((item, index) => (
                    <ConclusionCard key={item.key} item={item} index={index} />
                  ))}
                </div>
              ) : (
                <DataStatePanel state="empty" title="結論はまだ保留です" message="このデータだけでは判断できません。期間または計測状態を確認してください。" />
              )}
            </section>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
              <div className="space-y-5">
                {reportView.actions.length > 0 ? (
                  <ActionList actions={reportView.actions.slice(0, 3)} />
                ) : (
                  <DataStatePanel state="empty" title="次の行動はまだ決めません" message="根拠を確認できるまで、行動の提案を保留します。" />
                )}
                <EvidenceLinks evidence={reportView.evidence} period={selectedReport?.periodTag ?? periodFilter} />
              </div>
              <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
                <HoldPanel gaps={gaps} />
                <ReportQuestionPanel
                  projectRef={historyProjectRef}
                  reportId={persistedReportId}
                  evidence={reportView.evidence}
                  open={questionOpen}
                  onOpenChange={setQuestionOpen}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
