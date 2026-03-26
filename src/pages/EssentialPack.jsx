import { useEffect, useMemo, useState } from 'react'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { extractMarkdownHeadings, extractMarkdownSummary, regenerateAdsReportBundle } from '../utils/adsReports'

export default function EssentialPack() {
  const { isAdsAuthenticated } = useAuth()
  const { setupState, reportBundle, setReportBundle } = useAdsSetup()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedPeriod, setSelectedPeriod] = useState('all')

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

  const periodReports = useMemo(() => reportBundle?.periodReports ?? [], [reportBundle?.periodReports])

  useEffect(() => {
    if (periodReports.length <= 1) {
      setSelectedPeriod('all')
      return
    }

    if (!periodReports.some((report) => report.periodTag === selectedPeriod)) {
      setSelectedPeriod(periodReports[periodReports.length - 1]?.periodTag ?? 'all')
    }
  }, [periodReports, selectedPeriod])

  const currentReport = useMemo(() => {
    if (selectedPeriod === 'all') return reportBundle?.reportMd ?? ''
    return periodReports.find((item) => item.periodTag === selectedPeriod)?.reportMd ?? ''
  }, [periodReports, reportBundle?.reportMd, selectedPeriod])

  const reportHeadings = useMemo(() => extractMarkdownHeadings(currentReport), [currentReport])
  const insightSummary = useMemo(() => extractMarkdownSummary(currentReport), [currentReport])

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
    <div className="flex min-h-[calc(100vh-4rem)]">
      <div className="w-[300px] bg-surface-container-lowest border-r border-surface-container p-6 space-y-6">
        <div>
          <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">分析期間</label>
          <div className="mt-2 space-y-1">
            {setupState?.periods?.length > 0 ? (
              setupState.periods.map((period) => (
                <div key={period} className="flex items-center gap-2 px-4 py-2 bg-surface-container rounded-xl text-sm">
                  <span className="material-symbols-outlined text-sm text-secondary">calendar_today</span>
                  <span>{period}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-on-surface-variant px-4 py-2">セットアップ未完了</p>
            )}
          </div>
        </div>

        {setupState && (
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">分析条件</label>
            <div className="mt-2 space-y-1 text-xs text-on-surface-variant">
              <p>粒度: {setupState.granularity === 'monthly' ? '月別' : setupState.granularity === 'weekly' ? '週別' : '日別'}</p>
              <p>クエリ: {setupState.queryTypes?.join(', ')}</p>
              <p>dataset: {setupState.datasetId}</p>
            </div>
          </div>
        )}

        {periodReports.length > 1 && (
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">表示期間</label>
            <div className="mt-2 flex flex-col gap-1">
              <button
                onClick={() => setSelectedPeriod('all')}
                className={`px-4 py-3 rounded-xl text-sm text-left transition-all ${
                  selectedPeriod === 'all'
                    ? 'bg-secondary/10 text-secondary font-bold'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                すべて結合
              </button>
              {periodReports.map((report) => (
                <button
                  key={report.periodTag}
                  onClick={() => setSelectedPeriod(report.periodTag)}
                  className={`px-4 py-3 rounded-xl text-sm text-left transition-all ${
                    selectedPeriod === report.periodTag
                      ? 'bg-secondary/10 text-secondary font-bold'
                      : 'text-on-surface-variant hover:bg-surface-container'
                  }`}
                >
                  {report.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <h4 className="text-sm font-bold text-[#1A1A2E] mb-3 japanese-text">レポート構成</h4>
          {reportHeadings.length > 0 ? (
            <div className="space-y-2">
              {reportHeadings.map((heading) => (
                <div
                  key={heading.id}
                  className={`rounded-xl px-4 py-3 text-sm ${
                    heading.level === 1 ? 'bg-surface-container text-on-surface font-bold' : 'text-on-surface-variant'
                  }`}
                >
                  {heading.title}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-on-surface-variant">見出しはまだありません。</p>
          )}
        </div>

        {!isAdsAuthenticated && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
            <span className="material-symbols-outlined text-sm align-middle mr-1">warning</span>
            考察スタジオへのログインが必要です
          </div>
        )}

        <button
          onClick={handleRefresh}
          disabled={loading || !isAdsAuthenticated || !setupState}
          className="w-full py-3 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              取得中…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-sm">sync</span>
              レポートを再取得
            </>
          )}
        </button>

        {insightSummary && (
          <div className="bg-secondary p-5 rounded-2xl text-on-secondary">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined">description</span>
              <span className="font-bold text-sm">REPORT SUMMARY</span>
            </div>
            <p className="text-sm leading-relaxed">{insightSummary}</p>
          </div>
        )}
      </div>

      <div className="flex-1 p-8 space-y-8 overflow-y-auto">
        {error && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700">
            <span className="material-symbols-outlined text-lg">error</span>
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-extrabold text-[#1A1A2E] japanese-text">広告考察レポート</h2>
            <p className="text-sm text-on-surface-variant mt-1">`ads-insights` の `/api/bq/generate_batch` が返した `report_md` を表示しています。</p>
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 bg-white border border-outline-variant/50 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-surface-container transition-all">
              <span className="material-symbols-outlined text-lg">download</span>
              レポート出力
            </button>
            <button className="px-4 py-2 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all">
              <span className="material-symbols-outlined text-lg">share</span>
              共有
            </button>
          </div>
        </div>

        {loading && !currentReport && (
          <div className="flex items-center justify-center py-16 gap-3 text-on-surface-variant bg-surface-container-lowest rounded-2xl">
            <span className="material-symbols-outlined text-2xl animate-spin">progress_activity</span>
            <span className="text-sm japanese-text">BigQuery バッチレポートを再取得中…</span>
          </div>
        )}

        {!loading && !error && !currentReport && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-outline-variant">description</span>
            <h3 className="text-xl font-bold japanese-text">レポート本文がまだありません</h3>
            <p className="text-sm text-on-surface-variant japanese-text">
              `ads-insights` repo の BQ flow に合わせて、Wizard の `generate_batch` 結果をここに表示します。必要なら左のボタンで再取得してください。
            </p>
          </div>
        )}

        {currentReport && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 space-y-6">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary">article</span>
              <div>
                <h3 className="text-xl font-bold japanese-text">
                  {selectedPeriod === 'all' ? '統合レポート' : `${selectedPeriod} レポート`}
                </h3>
                <p className="text-sm text-on-surface-variant">report_md を markdown として描画しています</p>
              </div>
            </div>
            <MarkdownRenderer content={currentReport} />
          </div>
        )}
      </div>
    </div>
  )
}
