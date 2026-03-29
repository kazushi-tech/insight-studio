import { useEffect, useMemo, useState } from 'react'
import { AUTH_EXPIRED_MESSAGE } from '../api/adsInsights'
import ChartGroupCard from '../components/ads/ChartGroupCard'
import { LoadingSpinner, SkeletonBlock, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import {
  getChartPeriodTags,
  getDisplayChartGroups,
  regenerateAdsReportBundle,
} from '../utils/adsReports'
import { resolveChartType, CHART_TYPE_LABELS } from '../utils/chartTypeInference'

export default function AnalysisGraphs() {
  const { isAdsAuthenticated } = useAuth()
  const { setupState, reportBundle, setReportBundle } = useAdsSetup()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [periodFilter, setPeriodFilter] = useState('latest')
  const [chartTypeFilter, setChartTypeFilter] = useState('all')

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
        if (!cancelled) {
          setError(
            e.isAuthError
              ? AUTH_EXPIRED_MESSAGE
              : e.message,
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAdsAuthenticated, reportBundle?.source, setReportBundle, setupState])

  const chartGroups = useMemo(() => reportBundle?.chartGroups ?? [], [reportBundle?.chartGroups])
  const periodTags = useMemo(() => getChartPeriodTags(chartGroups), [chartGroups])

  useEffect(() => {
    if (periodTags.length === 0) {
      setPeriodFilter('latest')
      return
    }

    if (periodFilter === 'all' || periodFilter === 'latest') return
    if (!periodTags.includes(periodFilter)) setPeriodFilter('latest')
  }, [periodFilter, periodTags])

  const periodFilteredGroups = useMemo(
    () => getDisplayChartGroups(chartGroups, periodFilter),
    [chartGroups, periodFilter],
  )

  const availableChartTypes = useMemo(() => {
    const types = new Set()
    for (const group of periodFilteredGroups) {
      types.add(resolveChartType(group))
    }
    return ['all', ...['line', 'area', 'bar_horizontal', 'doughnut'].filter((t) => types.has(t))]
  }, [periodFilteredGroups])

  useEffect(() => {
    if (chartTypeFilter !== 'all' && !availableChartTypes.includes(chartTypeFilter)) {
      setChartTypeFilter('all')
    }
  }, [availableChartTypes, chartTypeFilter])

  const filteredGroups = useMemo(() => {
    if (chartTypeFilter === 'all') return periodFilteredGroups
    return periodFilteredGroups.filter((group) => resolveChartType(group) === chartTypeFilter)
  }, [periodFilteredGroups, chartTypeFilter])

  const summary = useMemo(() => {
    const datasetCount = periodFilteredGroups.reduce(
      (sum, group) => sum + (Array.isArray(group?.datasets) ? group.datasets.length : 0),
      0,
    )
    const typeCounts = {}
    for (const group of periodFilteredGroups) {
      const etype = resolveChartType(group)
      typeCounts[etype] = (typeCounts[etype] || 0) + 1
    }
    const orderedTypes = ['line', 'area', 'bar_horizontal', 'doughnut']
    const mixLabel = orderedTypes
      .filter((type) => typeCounts[type] > 0)
      .map((type) => `${typeCounts[type]} ${CHART_TYPE_LABELS[type]}`)
      .join(' / ')

    return {
      groupCount: periodFilteredGroups.length,
      datasetCount,
      mixLabel: mixLabel || '-',
    }
  }, [periodFilteredGroups])

  const activeScopeLabel =
    periodFilter === 'all'
      ? '全期間まとめ'
      : periodFilter === 'latest'
      ? `最新期間: ${periodTags[periodTags.length - 1] ?? '-'}`
      : `対象期間: ${periodFilter}`

  async function handleRefresh() {
    if (!setupState || !isAdsAuthenticated || loading) return

    setLoading(true)
    setError(null)
    try {
      const nextBundle = await regenerateAdsReportBundle(setupState)
      setReportBundle(nextBundle)
    } catch (e) {
      setError(
        e.isAuthError
          ? AUTH_EXPIRED_MESSAGE
          : e.message,
      )
    } finally {
      setLoading(false)
    }
  }

  const CHART_TYPE_FILTER_LABELS = {
    all: 'All Graphs',
    line: 'Line Analysis',
    area: 'Area Trend',
    bar_horizontal: 'Bar Comparison',
    doughnut: 'Distribution',
  }

  return (
    <div className="p-8 max-w-[1600px] mx-auto space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-extrabold text-on-surface tracking-tight japanese-text">広告考察：グラフ</h2>
          <p className="text-on-surface-variant mt-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-sm">calendar_today</span>
            {activeScopeLabel}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading || !isAdsAuthenticated || !setupState}
          className="px-6 py-3 bg-gold hover:opacity-90 text-primary-container rounded-[0.75rem] font-bold text-sm flex items-center gap-2 transition-all disabled:opacity-50 active:scale-95"
        >
          {loading ? <LoadingSpinner size="sm" /> : <span className="material-symbols-outlined text-base">refresh</span>}
          Update
        </button>
      </div>

      {/* Summary Metrics — folder (12) bento style */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <section className="bg-surface-container-lowest p-6 rounded-[0.75rem] border border-outline-variant/10 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex justify-between items-start mb-4">
            <span className="material-symbols-outlined p-2 bg-gold/10 text-gold rounded-lg">date_range</span>
          </div>
          <p className="text-xs font-medium text-on-surface-variant/70 mb-1">Target Period</p>
          <h3 className="text-2xl font-bold text-on-surface japanese-text truncate">{activeScopeLabel}</h3>
        </section>
        <section className="bg-surface-container-lowest p-6 rounded-[0.75rem] border border-outline-variant/10 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex justify-between items-start mb-4">
            <span className="material-symbols-outlined p-2 bg-gold/10 text-gold rounded-lg">bar_chart</span>
          </div>
          <p className="text-xs font-medium text-on-surface-variant/70 mb-1">Total Charts</p>
          <h3 className="text-2xl font-bold text-on-surface tabular-nums">{summary.groupCount} Units</h3>
        </section>
        <section className="bg-surface-container-lowest p-6 rounded-[0.75rem] border border-outline-variant/10 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex justify-between items-start mb-4">
            <span className="material-symbols-outlined p-2 bg-gold/10 text-gold rounded-lg">layers</span>
          </div>
          <p className="text-xs font-medium text-on-surface-variant/70 mb-1">Data Series</p>
          <h3 className="text-2xl font-bold text-on-surface tabular-nums">{summary.datasetCount} sets</h3>
        </section>
        <section className="bg-surface-container-lowest p-6 rounded-[0.75rem] border border-outline-variant/10 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
          <div className="flex justify-between items-start mb-4">
            <span className="material-symbols-outlined p-2 bg-gold/10 text-gold rounded-lg">donut_small</span>
          </div>
          <p className="text-xs font-medium text-on-surface-variant/70 mb-1">Type Breakdown</p>
          <h3 className="text-lg font-bold text-on-surface">{summary.mixLabel}</h3>
        </section>
      </div>

      {/* Filter Bar — folder (12) style with real filter */}
      <div className="bg-surface-container-low p-3 rounded-2xl flex items-center gap-4 overflow-hidden">
        <div className="flex items-center bg-surface-container-lowest border border-outline-variant/10 rounded-[0.75rem] px-4 py-2 shrink-0">
          <span className="material-symbols-outlined text-on-surface-variant mr-2 text-sm">filter_alt</span>
          <label htmlFor="graph-period-filter" className="text-sm font-bold text-on-surface mr-3">Period</label>
          <select
            id="graph-period-filter"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="text-sm text-on-surface-variant bg-transparent border-none outline-none cursor-pointer"
          >
            <option value="latest">最新期間</option>
            <option value="all">全期間まとめ</option>
            {periodTags.map((period) => (
              <option key={period} value={period}>{period}</option>
            ))}
          </select>
        </div>
        <div className="w-px h-8 bg-outline-variant/20 mx-1 shrink-0" />
        <div className="flex-1 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {availableChartTypes.map((type) => (
            <button
              key={type}
              onClick={() => setChartTypeFilter(type)}
              className={`px-5 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                chartTypeFilter === type
                  ? 'bg-gold text-primary-container'
                  : 'bg-surface-container-lowest hover:bg-white border border-outline-variant/10 text-on-surface-variant'
              }`}
            >
              {CHART_TYPE_FILTER_LABELS[type] ?? type}
            </button>
          ))}
        </div>
        {/* Passive metadata */}
        <div className="hidden lg:flex flex-wrap gap-2 text-xs shrink-0">
          {setupState?.queryTypes?.map((qt) => (
            <span key={qt} className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-medium">
              {qt}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <ErrorBanner message={error} onRetry={handleRefresh} />
      )}

      {loading && chartGroups.length === 0 && (
        <div className="bg-surface-container-lowest rounded-[0.75rem] border border-outline-variant/10 p-8 space-y-6">
          <LoadingSpinner size="md" label="BQ グラフデータを再取得中…" />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
            <SkeletonBlock variant="card" />
            <SkeletonBlock variant="card" />
          </div>
        </div>
      )}

      {!loading && !error && filteredGroups.length === 0 && (
        <div className="bg-surface-container-lowest rounded-[0.75rem] border border-outline-variant/10 p-8 text-center space-y-3">
          <span className="material-symbols-outlined text-5xl text-outline-variant">bar_chart</span>
          <h3 className="text-xl font-bold japanese-text">グラフデータがまだありません</h3>
          <p className="text-sm text-on-surface-variant japanese-text">
            セットアップウィザードを完了するか、上の「Update」ボタンを押してデータを読み込んでください。
          </p>
        </div>
      )}

      {filteredGroups.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
          {filteredGroups.map((group, groupIndex) => (
            <ChartGroupCard
              key={`${group.title ?? 'group'}-${group._periodTag ?? 'merged'}-${groupIndex}`}
              group={group}
            />
          ))}
        </div>
      )}
    </div>
  )
}
