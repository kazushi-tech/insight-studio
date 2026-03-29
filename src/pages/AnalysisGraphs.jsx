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

  const filteredGroups = useMemo(
    () => getDisplayChartGroups(chartGroups, periodFilter),
    [chartGroups, periodFilter],
  )

  const summary = useMemo(() => {
    const datasetCount = filteredGroups.reduce(
      (sum, group) => sum + (Array.isArray(group?.datasets) ? group.datasets.length : 0),
      0,
    )
    // Summary counts use rendered (effective) type, not raw backend type
    const typeCounts = {}
    for (const group of filteredGroups) {
      const etype = resolveChartType(group)
      typeCounts[etype] = (typeCounts[etype] || 0) + 1
    }
    const orderedTypes = ['line', 'area', 'bar_horizontal', 'doughnut']
    const mixLabel = orderedTypes
      .filter((type) => typeCounts[type] > 0)
      .map((type) => `${typeCounts[type]} ${CHART_TYPE_LABELS[type]}`)
      .join(' / ')

    return {
      groupCount: filteredGroups.length,
      datasetCount,
      mixLabel: mixLabel || '-',
    }
  }, [filteredGroups])

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

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-2">
          <h2 className="text-3xl font-extrabold text-on-surface tracking-tight japanese-text">広告考察：グラフ</h2>
          <p className="text-sm text-on-surface-variant max-w-3xl japanese-text">
            選択した期間・クエリタイプごとのパフォーマンスをグラフで可視化します。全期間まとめでは同一指標を期間横断で比較できます。
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading || !isAdsAuthenticated || !setupState}
          className="px-5 py-3 bg-secondary text-on-secondary rounded-[0.75rem] font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
        >
          {loading ? <LoadingSpinner size="sm" /> : <span className="material-symbols-outlined text-base">sync</span>}
          再取得
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <section className="rounded-[0.75rem] bg-surface-container-lowest ghost-border p-5 panel-card-hover flex items-start gap-4">
          <span className="w-10 h-10 rounded-lg bg-gold/10 text-gold flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-xl">date_range</span>
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-on-surface-variant">対象期間</p>
            <p className="mt-1 text-lg font-bold text-on-surface japanese-text truncate">{activeScopeLabel}</p>
          </div>
        </section>
        <section className="rounded-[0.75rem] bg-surface-container-lowest ghost-border p-5 panel-card-hover flex items-start gap-4">
          <span className="w-10 h-10 rounded-lg bg-gold/10 text-gold flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-xl">bar_chart</span>
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-on-surface-variant">グラフ数</p>
            <p className="mt-1 text-3xl font-extrabold text-on-surface tabular-nums">{summary.groupCount}</p>
          </div>
        </section>
        <section className="rounded-[0.75rem] bg-surface-container-lowest ghost-border p-5 panel-card-hover flex items-start gap-4">
          <span className="w-10 h-10 rounded-lg bg-gold/10 text-gold flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-xl">stacked_line_chart</span>
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-on-surface-variant">データ系列</p>
            <p className="mt-1 text-3xl font-extrabold text-on-surface tabular-nums">{summary.datasetCount}</p>
          </div>
        </section>
        <section className="rounded-[0.75rem] bg-surface-container-lowest ghost-border p-5 panel-card-hover flex items-start gap-4">
          <span className="w-10 h-10 rounded-lg bg-gold/10 text-gold flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-xl">donut_small</span>
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-on-surface-variant">タイプ内訳</p>
            <p className="mt-1 text-lg font-bold text-on-surface">{summary.mixLabel}</p>
          </div>
        </section>
      </div>

      <div className="rounded-[0.75rem] bg-surface-container-lowest ghost-border p-5 panel-card-hover space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="graph-period-filter" className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">
            Display Period
          </label>
          <select
            id="graph-period-filter"
            value={periodFilter}
            onChange={(e) => setPeriodFilter(e.target.value)}
            className="min-w-[220px] select-surface"
          >
            <option value="latest">最新期間</option>
            <option value="all">全期間まとめ</option>
            {periodTags.map((period) => (
              <option key={period} value={period}>
                {period}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2 text-xs">
            {setupState?.periods?.map((period) => (
              <span key={period} className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-semibold">
                期間: {period}
              </span>
            ))}
            {setupState?.queryTypes?.map((queryType) => (
              <span key={queryType} className="px-3 py-1 rounded-full bg-surface-container text-on-surface-variant font-semibold">
                クエリ: {queryType}
              </span>
            ))}
          </div>
        </div>

        {periodFilter === 'all' && periodTags.length > 1 && (
          <p className="text-sm text-on-surface-variant japanese-text">
            同一指標のグラフを期間ごとに並べて比較表示しています。
          </p>
        )}
        {periodFilter === 'latest' && periodTags.length > 0 && (
          <p className="text-sm text-on-surface-variant japanese-text">
            最新期間 <span className="font-bold text-on-surface">{periodTags[periodTags.length - 1]}</span> を表示中です。
          </p>
        )}
      </div>

      {error && (
        <ErrorBanner message={error} onRetry={handleRefresh} />
      )}

      {loading && chartGroups.length === 0 && (
        <div className="bg-surface-container-lowest rounded-[0.75rem] p-8 space-y-6">
          <LoadingSpinner size="md" label="BQ グラフデータを再取得中…" />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <SkeletonBlock variant="card" />
            <SkeletonBlock variant="card" />
          </div>
        </div>
      )}

      {!loading && !error && filteredGroups.length === 0 && (
        <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-8 text-center space-y-3">
          <span className="material-symbols-outlined text-5xl text-outline-variant">bar_chart</span>
          <h3 className="text-xl font-bold japanese-text">グラフデータがまだありません</h3>
          <p className="text-sm text-on-surface-variant japanese-text">
            セットアップウィザードを完了するか、上の「再取得」ボタンを押してデータを読み込んでください。
          </p>
        </div>
      )}

      {filteredGroups.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
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
