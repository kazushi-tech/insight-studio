import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AUTH_EXPIRED_MESSAGE } from '../api/adsInsights'
import ChartGroupCard from '../components/ads/ChartGroupCard'
import SourceBadge from '../components/ads/SourceBadge'
import { ErrorBanner, LoadingSpinner, SkeletonBlock } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import {
  buildBeginnerReportFromCharts,
  getChartPeriodTags,
  getDisplayChartGroups,
  regenerateAdsReportBundle,
} from '../utils/adsReports'

const CARD_META = {
  what_happened: { label: '何が起きた', icon: 'monitoring', tone: 'bg-primary/[0.06] text-primary' },
  so_what: { label: 'どう見るか', icon: 'psychology_alt', tone: 'bg-secondary-container/45 text-primary' },
  check_first: { label: 'まず見る', icon: 'visibility', tone: 'bg-info-container text-on-info-container' },
  data_gap: { label: '判断保留', icon: 'error', tone: 'bg-warning-container text-on-warning-container' },
  next_action: { label: '次の一手', icon: 'task_alt', tone: 'bg-success-container text-on-success-container' },
}

const SEVERITY_STYLES = {
  positive: 'border-primary/20 bg-primary/[0.035]',
  neutral: 'border-outline-variant/20 bg-surface-container-lowest',
  warning: 'border-warning/30 bg-warning-container',
  critical: 'border-error/30 bg-error-container',
}

function uniqueValues(values = []) {
  return values.filter(Boolean).filter((item, index, array) => array.indexOf(item) === index)
}

function chartIdToIndex(chartId) {
  const match = String(chartId || '').match(/chart_(\d+)/)
  return match ? Number(match[1]) - 1 : -1
}

function selectEvidenceGroups(beginnerReport, chartGroups) {
  const explicitIds = uniqueValues([
    ...(beginnerReport?.recommended_charts ?? []),
    ...((beginnerReport?.summary_cards ?? []).flatMap((card) => card.evidence_chart_ids ?? [])),
  ]).slice(0, 3)
  const groups = explicitIds
    .map((chartId) => chartGroups[chartIdToIndex(chartId)])
    .filter(Boolean)

  return groups.length > 0 ? groups : chartGroups.slice(0, 3)
}

function selectedPeriodReport(reportBundle, periodFilter) {
  const reports = reportBundle?.periodReports ?? []
  if (periodFilter === 'all') return null
  if (periodFilter === 'latest') return reports[reports.length - 1] ?? null
  return reports.find((report) => report.periodTag === periodFilter) ?? null
}

function BeginnerCard({ card }) {
  const meta = CARD_META[card.type] ?? CARD_META.what_happened
  return (
    <article className={`rounded-2xl border p-5 shadow-sm ${SEVERITY_STYLES[card.severity] ?? SEVERITY_STYLES.neutral}`}>
      <div className="flex items-start gap-3">
        <span className={`material-symbols-outlined rounded-xl p-2 text-[22px] ${meta.tone}`} aria-hidden="true">
          {meta.icon}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-on-surface-variant">{meta.label}</p>
          <h2 className="mt-2 text-lg font-extrabold leading-7 text-on-surface japanese-text">{card.title}</h2>
          <p className="mt-2 text-sm font-medium leading-7 text-on-surface-variant japanese-text">{card.body}</p>
          {card.evidence_chart_ids?.length > 0 && (
            <p className="mt-3 text-[11px] font-black text-primary">
              根拠: {card.evidence_chart_ids.join(' / ')}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

function NextActionList({ actions }) {
  return (
    <section className="rounded-2xl bg-primary p-5 text-on-primary shadow-sm">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-2xl" aria-hidden="true">assignment_turned_in</span>
        <h2 className="text-lg font-extrabold japanese-text">次にやること</h2>
      </div>
      <div className="mt-4 space-y-3">
        {actions.map((action, index) => (
          <div key={`${action.priority}-${index}`} className="rounded-xl bg-white/10 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-full bg-white/15 px-2 py-1 text-[11px] font-black">{action.priority}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-black leading-6 japanese-text">{action.title}</h3>
                {action.reason && <p className="mt-1 text-xs font-semibold leading-6 text-white/80 japanese-text">{action.reason}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function DataGapPanel({ gaps }) {
  return (
    <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined rounded-xl bg-warning-container p-2 text-warning" aria-hidden="true">rule</span>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-on-surface-variant">Hold</p>
          <h2 className="text-base font-extrabold text-on-surface japanese-text">判断できないこと</h2>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {gaps.length > 0 ? gaps.map((gap) => (
          <div key={gap.key} className="rounded-xl bg-surface-container-low px-4 py-3">
            <p className="text-sm font-black text-on-surface japanese-text">{gap.label}</p>
            {gap.impact && <p className="mt-1 text-xs font-bold leading-5 text-on-surface-variant japanese-text">{gap.impact}</p>}
          </div>
        )) : (
          <p className="rounded-xl bg-surface-container-low px-4 py-3 text-sm font-bold text-on-surface-variant japanese-text">
            主要な未取得項目はありません。根拠グラフの数値を確認してから判断します。
          </p>
        )}
      </div>
    </section>
  )
}

function EvidenceCharts({ groups }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-primary">Evidence</p>
          <h2 className="mt-1 text-xl font-extrabold text-on-surface japanese-text">根拠グラフ</h2>
        </div>
        <Link
          to="/ads/graphs"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/20 bg-surface-container-lowest px-4 py-3 text-sm font-black text-primary hover:bg-primary/[0.05] focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span className="material-symbols-outlined text-base" aria-hidden="true">bar_chart</span>
          詳細グラフを見る
        </Link>
      </div>

      {groups.length > 0 ? (
        <div className="space-y-4">
          {groups.map((group, index) => (
            <details key={`${group.title ?? 'chart'}-${index}`} className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-3 shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-2 py-2 text-sm font-black text-primary japanese-text">
                <span className="min-w-0 truncate">{group.title ?? `根拠グラフ ${index + 1}`}</span>
                <span className="material-symbols-outlined text-base" aria-hidden="true">expand_more</span>
              </summary>
              <div className="pt-3">
                <ChartGroupCard group={{ ...group, defaultCollapsed: false }} featured />
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-outline-variant" aria-hidden="true">bar_chart</span>
          <h3 className="mt-3 text-lg font-extrabold text-on-surface japanese-text">根拠グラフがまだありません</h3>
          <p className="mt-2 text-sm font-medium text-on-surface-variant japanese-text">セットアップ条件を確認し、BigQueryから再取得してください。</p>
        </div>
      )}
    </section>
  )
}

export default function BeginnerReport() {
  const navigate = useNavigate()
  const { isAdsAuthenticated } = useAuth()
  const { setupState, reportBundle, setReportBundle, resetSetup } = useAdsSetup()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [periodFilter, setPeriodFilter] = useState('latest')

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
      } catch (e) {
        if (!cancelled) setError(e.isAuthError ? AUTH_EXPIRED_MESSAGE : e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [isAdsAuthenticated, reportBundle?.source, setReportBundle, setupState])

  const chartGroups = useMemo(() => reportBundle?.chartGroups ?? [], [reportBundle?.chartGroups])
  const periodTags = useMemo(() => getChartPeriodTags(chartGroups), [chartGroups])
  const selectedReport = useMemo(() => selectedPeriodReport(reportBundle, periodFilter), [periodFilter, reportBundle])
  const displayGroups = useMemo(() => getDisplayChartGroups(chartGroups, periodFilter), [chartGroups, periodFilter])
  const executionSummary = useMemo(
    () => selectedReport?.executionSummary ?? reportBundle?.executionSummary ?? [],
    [reportBundle?.executionSummary, selectedReport?.executionSummary],
  )
  const beginnerReport = useMemo(() => {
    return selectedReport?.beginnerReport ||
      reportBundle?.beginnerReport ||
      buildBeginnerReportFromCharts(displayGroups, executionSummary)
  }, [displayGroups, executionSummary, reportBundle?.beginnerReport, selectedReport?.beginnerReport])
  const evidenceGroups = useMemo(() => selectEvidenceGroups(beginnerReport, displayGroups), [beginnerReport, displayGroups])
  const periods = setupState?.periods ?? []
  const dateRange = periods.length > 0
    ? periods.length === 1 ? periods[0] : `${periods[0]} 〜 ${periods[periods.length - 1]}`
    : null
  const activeScopeLabel =
    periodFilter === 'all' ? '全期間'
      : periodFilter === 'latest' ? `最新期間: ${periodTags[periodTags.length - 1] ?? '-'}`
        : periodFilter

  async function handleRefresh() {
    if (!setupState || !isAdsAuthenticated || loading) return
    setLoading(true)
    setError(null)
    try {
      const nextBundle = await regenerateAdsReportBundle(setupState)
      setReportBundle(nextBundle)
    } catch (e) {
      setError(e.isAuthError ? AUTH_EXPIRED_MESSAGE : e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleChangeSetup() {
    resetSetup()
    navigate('/ads/wizard', { state: { resetAt: Date.now() } })
  }

  return (
    <main className="min-w-0 flex-1 overflow-x-hidden" aria-labelledby="beginner-report-title">
      <div className="mx-auto max-w-[1440px] space-y-7 px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:py-8">
        <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary-container px-3 py-1 text-[11px] font-black text-on-primary-container">GA4 / BIGQUERY</span>
              <span className="rounded-full bg-surface-container px-3 py-1 text-[11px] font-black text-on-surface-variant">{activeScopeLabel}</span>
            </div>
            <h1 id="beginner-report-title" className="mt-4 text-2xl font-extrabold tracking-tight text-primary japanese-text sm:text-3xl">
              初心者向け分析レポート
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-7 text-on-surface-variant japanese-text">
              結論、保留すべき判断、次に見るグラフだけに絞って表示します。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-on-surface-variant">
              {setupState?.datasetId && <span className="truncate">保存先: {setupState.datasetId}</span>}
              {dateRange && <span>期間: {dateRange}</span>}
              {reportBundle?.generatedAt && <span>最終更新: {new Date(reportBundle.generatedAt).toLocaleString('ja-JP')}</span>}
            </div>
            <div className="mt-3 flex gap-2">
              <SourceBadge source="ga4" />
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto lg:justify-end">
            {periodTags.length > 0 && (
              <select
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                className="min-h-11 rounded-xl border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm font-bold text-on-surface-variant focus-visible:outline-2 focus-visible:outline-primary"
                aria-label="表示期間"
              >
                <option value="latest">最新期間</option>
                <option value="all">全期間</option>
                {periodTags.map((period) => (
                  <option key={period} value={period}>{period}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading || !isAdsAuthenticated || !setupState}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <LoadingSpinner size="sm" /> : <span className="material-symbols-outlined text-base" aria-hidden="true">refresh</span>}
              再取得
            </button>
            <Link
              to="/insights/ai"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary/20 bg-surface-container-lowest px-4 py-2 text-sm font-black text-primary hover:bg-primary/[0.05] focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">auto_awesome</span>
              AIに聞く
            </Link>
          </div>
        </section>

        {error && <ErrorBanner message={error} onRetry={handleRefresh} />}

        {loading && !reportBundle && (
          <section className="rounded-2xl bg-surface-container-lowest p-8">
            <LoadingSpinner size="md" label="初心者向けレポートを作成中..." />
            <div className="mt-6">
              <SkeletonBlock variant="text" lines={6} />
            </div>
          </section>
        )}

        {!loading && !error && !setupState && (
          <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-8 text-center">
            <span className="material-symbols-outlined text-5xl text-outline-variant" aria-hidden="true">settings_suggest</span>
            <h2 className="mt-3 text-xl font-extrabold text-on-surface japanese-text">セットアップが必要です</h2>
            <p className="mt-2 text-sm font-bold text-on-surface-variant japanese-text">期間とクエリを選ぶと、初心者向けレポートを作れます。</p>
            <button
              type="button"
              onClick={handleChangeSetup}
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-on-primary"
            >
              <span className="material-symbols-outlined text-base" aria-hidden="true">tune</span>
              セットアップへ
            </button>
          </section>
        )}

        {beginnerReport && (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {beginnerReport.summary_cards.map((card, index) => (
                <BeginnerCard key={`${card.type}-${index}`} card={card} />
              ))}
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="space-y-5">
                <NextActionList actions={beginnerReport.next_actions} />
                <EvidenceCharts groups={evidenceGroups} />
              </div>
              <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
                <DataGapPanel gaps={beginnerReport.data_gaps} />
                <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined rounded-xl bg-primary/[0.06] p-2 text-primary" aria-hidden="true">route</span>
                    <h2 className="text-base font-extrabold text-on-surface japanese-text">読む順番</h2>
                  </div>
                  <ol className="mt-4 space-y-3 text-sm font-bold leading-6 text-on-surface-variant japanese-text">
                    <li>1. 結論カードを見る</li>
                    <li>2. 判断保留を外さない</li>
                    <li>3. 根拠グラフを3つだけ開く</li>
                    <li>4. 必要な時だけAIに聞く</li>
                  </ol>
                </section>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
