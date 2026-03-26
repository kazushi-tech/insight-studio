import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { regenerateAdsReportBundle } from '../utils/adsReports'

function renderValue(value) {
  if (value == null) return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function buildRows(group) {
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []

  return labels.map((label, index) => ({
    label,
    values: datasets.map((dataset) => dataset?.data?.[index]),
  }))
}

export default function AnalysisGraphs() {
  const { isAdsAuthenticated } = useAuth()
  const { setupState, reportBundle, setReportBundle } = useAdsSetup()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [periodFilter, setPeriodFilter] = useState('all')

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
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isAdsAuthenticated, reportBundle?.source, setReportBundle, setupState])

  const chartGroups = useMemo(() => reportBundle?.chartGroups ?? [], [reportBundle?.chartGroups])
  const periodTags = useMemo(
    () => [...new Set(chartGroups.map((group) => group._periodTag).filter(Boolean))],
    [chartGroups],
  )

  useEffect(() => {
    if (periodTags.length === 0) {
      setPeriodFilter('all')
      return
    }

    if (periodFilter !== 'all' && !periodTags.includes(periodFilter)) {
      setPeriodFilter(periodTags[periodTags.length - 1])
    }
  }, [periodFilter, periodTags])

  const filteredGroups = useMemo(() => {
    if (periodFilter === 'all') return chartGroups
    return chartGroups.filter((group) => group._periodTag === periodFilter)
  }, [chartGroups, periodFilter])

  async function handleRefresh() {
    if (!setupState || !isAdsAuthenticated || loading) return

    setLoading(true)
    setError(null)
    try {
      const nextBundle = await regenerateAdsReportBundle(setupState)
      setReportBundle(nextBundle)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-10 max-w-[1400px] mx-auto space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-extrabold text-[#1A1A2E] tracking-tight japanese-text">広告パフォーマンス分析グラフ</h2>
          <p className="text-sm text-on-surface-variant mt-1">`ads-insights` の `/api/bq/generate_batch` が返した `chart_data.groups` を表示しています。</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading || !isAdsAuthenticated || !setupState}
          className="px-5 py-3 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-base ${loading ? 'animate-spin' : ''}`}>
            {loading ? 'progress_activity' : 'sync'}
          </span>
          再取得
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        {setupState?.periods?.map((period) => (
          <span key={period} className="px-4 py-2 bg-surface-container-lowest rounded-xl border border-outline-variant/30">
            期間: {period}
          </span>
        ))}
        {setupState?.queryTypes?.map((queryType) => (
          <span key={queryType} className="px-4 py-2 bg-surface-container-lowest rounded-xl border border-outline-variant/30">
            クエリ: {queryType}
          </span>
        ))}
      </div>

      {periodTags.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setPeriodFilter('all')}
            className={`px-4 py-2 rounded-full text-sm font-bold ${
              periodFilter === 'all'
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container-lowest text-on-surface-variant'
            }`}
          >
            全期間
          </button>
          {periodTags.map((period) => (
            <button
              key={period}
              onClick={() => setPeriodFilter(period)}
              className={`px-4 py-2 rounded-full text-sm font-bold ${
                periodFilter === period
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-lowest text-on-surface-variant'
              }`}
            >
              {period}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
          <span className="material-symbols-outlined text-lg">error</span>
          <span>{error}</span>
        </div>
      )}

      {loading && chartGroups.length === 0 && (
        <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant bg-surface-container-lowest rounded-2xl">
          <span className="material-symbols-outlined text-2xl animate-spin">progress_activity</span>
          <span className="text-sm japanese-text">BQ グラフデータを再取得中…</span>
        </div>
      )}

      {!loading && !error && filteredGroups.length === 0 && (
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 text-center space-y-3">
          <span className="material-symbols-outlined text-5xl text-outline-variant">bar_chart</span>
          <h3 className="text-xl font-bold japanese-text">グラフデータがまだありません</h3>
          <p className="text-sm text-on-surface-variant japanese-text">
            reference app と同じく Wizard の `chart_data.groups` を使います。まずセットアップを完了するか、上の再取得を試してください。
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {filteredGroups.map((group, groupIndex) => {
          const datasets = Array.isArray(group.datasets) ? group.datasets : []
          const rows = buildRows(group).slice(0, 12)

          return (
            <div key={`${group.title ?? 'group'}-${groupIndex}`} className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold japanese-text">{group.title ?? `グラフ ${groupIndex + 1}`}</h3>
                  <p className="text-xs text-on-surface-variant">
                    type: {group.chartType ?? 'unknown'}
                    {group._periodTag ? ` / period: ${group._periodTag}` : ''}
                  </p>
                </div>
              </div>

              {datasets.length > 0 && rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-on-surface-variant border-b border-surface-container">
                        <th className="py-3 text-left font-bold">label</th>
                        {datasets.slice(0, 4).map((dataset, datasetIndex) => (
                          <th key={`${dataset.label ?? 'dataset'}-${datasetIndex}`} className="py-3 text-left font-bold">
                            {dataset.label ?? `dataset ${datasetIndex + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, rowIndex) => (
                        <tr key={`${row.label}-${rowIndex}`} className="border-b border-surface-container/50">
                          <td className="py-3 align-top font-medium">{renderValue(row.label)}</td>
                          {row.values.slice(0, 4).map((value, valueIndex) => (
                            <td key={`${row.label}-${valueIndex}`} className="py-3 align-top">
                              {renderValue(value)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <pre className="text-xs text-on-surface-variant whitespace-pre-wrap break-all overflow-x-auto">
                  {JSON.stringify(group, null, 2)}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
