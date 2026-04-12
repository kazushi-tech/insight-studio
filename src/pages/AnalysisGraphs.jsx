import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { resolveChartType } from '../utils/chartTypeInference'
import {
  groupChartsByTheme,
  extractTopInsights,
  computeThemeSummary,
  THEME_DEFINITIONS,
} from '../utils/chartThemeClassifier'

/* ── Evidence Type スタイル ── */
const EVIDENCE_STYLES = {
  observed: { text: 'text-primary', bg: 'bg-primary/5', border: 'border-primary/20', label: 'Observed' },
  derived:  { text: 'text-secondary', bg: 'bg-secondary/5', border: 'border-secondary/20', label: 'Derived' },
  proxy:    { text: 'text-accent-gold', bg: 'bg-accent-gold/10', border: 'border-accent-gold/20', label: 'Proxy' },
  inferred: { text: 'text-tertiary', bg: 'bg-tertiary/5', border: 'border-tertiary/20', label: 'Inferred' },
}

/* ── Top Insight Card ── */
function TopInsightCard({ insight }) {
  const style = EVIDENCE_STYLES[insight.evidenceType] || EVIDENCE_STYLES.observed
  const borderColor = insight.isAnomaly
    ? 'border-l-tertiary'
    : insight.evidenceType === 'proxy'
    ? 'border-l-accent-gold'
    : 'border-l-primary-container'

  return (
    <a
      href={`#theme-section-${insight.evidenceType}`}
      className={`bg-surface-container-lowest p-6 rounded-xl border-l-4 ${borderColor} shadow-sm flex flex-col gap-4 hover:shadow-md transition-shadow cursor-pointer`}
    >
      <div className="flex justify-between items-start">
        <span className="text-xs font-bold text-on-surface-variant bg-surface-container-low px-2 py-1 rounded uppercase tracking-wider">
          [{style.label}] [{insight.evidenceId}]
        </span>
        {insight.delta && (
          <span className={`font-bold text-sm flex items-center gap-0.5 ${insight.deltaPositive ? 'text-success' : 'text-error'}`}>
            <span className="material-symbols-outlined text-sm">
              {insight.isAnomaly ? 'warning' : insight.deltaPositive ? 'trending_up' : 'trending_down'}
            </span>
            {insight.isAnomaly ? 'High Alert' : insight.delta}
          </span>
        )}
      </div>
      <div>
        <p className="text-3xl font-black text-on-surface">{insight.value}</p>
        <p className="text-sm font-bold text-on-surface mt-1 japanese-text">{insight.title}</p>
        {insight.takeaway && (
          <p className="text-on-surface-variant text-sm mt-2 leading-relaxed japanese-text line-clamp-2">
            {insight.takeaway}
          </p>
        )}
        {insight.evidenceType === 'proxy' && (
          <div className="mt-3 pt-3 border-t border-outline-variant/20">
            <p className="text-[10px] text-on-surface-variant/80 italic">算出根拠: 推定値 (Proxy)</p>
          </div>
        )}
      </div>
    </a>
  )
}

/* ── Theme Tab ── */
function ThemeTabs({ activeTheme, onThemeChange, themes }) {
  const allTabs = [
    { id: 'all', label: '全件', icon: 'select_all' },
    ...THEME_DEFINITIONS,
  ]

  return (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 border-b border-outline-variant/20">
      {allTabs.map((tab) => {
        const hasData = tab.id === 'all' || themes.some((t) => t.id === tab.id)
        return (
          <button
            key={tab.id}
            onClick={() => onThemeChange(tab.id)}
            disabled={!hasData}
            className={`whitespace-nowrap px-6 py-2 rounded-full text-sm font-bold transition-colors ${
              activeTheme === tab.id
                ? 'bg-primary text-on-primary shadow-sm'
                : hasData
                ? 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                : 'bg-surface-container-low text-on-surface-variant/30 cursor-not-allowed'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

/* ── Graph Section (Accordion) ── */
function GraphSection({ theme, isOpen, onToggle, viewMode }) {
  const summary = useMemo(() => computeThemeSummary(theme.groups), [theme.groups])

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/20">
      {/* Section Header */}
      <button
        onClick={onToggle}
        className="w-full p-5 flex items-center justify-between cursor-pointer hover:bg-surface-container-low transition-colors border-b border-outline-variant/10 text-left"
      >
        <div className="flex items-center gap-6">
          <span className={`material-symbols-outlined ${isOpen ? 'text-primary' : 'text-on-surface-variant'}`}>
            {isOpen ? 'expand_more' : 'chevron_right'}
          </span>
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-lg japanese-text">{theme.label}</h3>
            <div className="flex gap-2">
              <span className="text-[10px] font-bold bg-surface-container-highest px-2 py-0.5 rounded uppercase">
                {summary.chartCount} charts
              </span>
              {summary.criticalShifts > 0 && (
                <span className="text-[10px] font-bold bg-primary-container text-on-primary px-2 py-0.5 rounded uppercase">
                  {summary.criticalShifts} critical shift{summary.criticalShifts > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-8 text-sm font-medium text-on-surface-variant">
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${summary.criticalShifts > 0 ? 'bg-accent-gold' : 'bg-primary'}`} />
            品質: {summary.criticalShifts > 0 ? '注意' : '良好'}
          </div>
        </div>
      </button>

      {/* Section Content */}
      {isOpen && (
        <div className="p-8">
          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {theme.groups.map((group, groupIndex) => (
              <ChartGroupCard
                key={`${group.title ?? 'group'}-${group._periodTag ?? 'merged'}-${groupIndex}`}
                group={group}
              />
            ))}
          </div>

          {/* Analyst View: Raw Data Table */}
          {viewMode === 'analyst' && theme.groups.length > 0 && (
            <div className="mt-8">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-bold text-xs text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">table_chart</span>
                  詳細データ分析テーブル (ANALYST VIEW)
                </h4>
              </div>
              <div className="overflow-x-auto rounded-lg border border-outline-variant/30 shadow-sm">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="bg-surface-container-high text-on-surface-variant font-bold text-xs">
                    <tr>
                      <th className="px-6 py-4">グラフ名</th>
                      <th className="px-6 py-4 text-right">データ系列</th>
                      <th className="px-6 py-4 text-right">データ点数</th>
                      <th className="px-6 py-4 text-right">チャートタイプ</th>
                      <th className="px-6 py-4 text-right">期間</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10 text-on-surface bg-surface-container-lowest">
                    {theme.groups.map((group, idx) => (
                      <tr key={idx} className="hover:bg-surface-container-low transition-colors">
                        <td className="px-6 py-4 font-semibold japanese-text">{group.title ?? '無題'}</td>
                        <td className="px-6 py-4 text-right font-medium tabular-nums">
                          {Array.isArray(group.datasets) ? group.datasets.length : 0}
                        </td>
                        <td className="px-6 py-4 text-right font-medium tabular-nums">
                          {Array.isArray(group.labels) ? group.labels.length : 0}
                        </td>
                        <td className="px-6 py-4 text-right font-medium">{resolveChartType(group)}</td>
                        <td className="px-6 py-4 text-right font-medium text-on-surface-variant">
                          {group._periodTag || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Anomaly Detection Section ── */
function AnomalySection({ chartGroups, viewMode }) {
  // 異常値を持つデータを検出
  const anomalies = useMemo(() => {
    const detected = []
    for (const group of chartGroups) {
      const datasets = Array.isArray(group?.datasets) ? group.datasets : []
      const labels = Array.isArray(group?.labels) ? group.labels : []

      for (const ds of datasets) {
        const data = (Array.isArray(ds?.data) ? ds.data : []).map((v) => {
          if (v == null) return null
          const n = typeof v === 'string' ? Number(v.replace(/,/g, '').replace(/[%％]$/, '')) : Number(v)
          return Number.isFinite(n) ? n : null
        })

        const validData = data.filter((v) => v !== null)
        if (validData.length < 3) continue

        // 平均と標準偏差を計算
        const mean = validData.reduce((s, v) => s + v, 0) / validData.length
        const variance = validData.reduce((s, v) => s + (v - mean) ** 2, 0) / validData.length
        const stdDev = Math.sqrt(variance)

        if (stdDev === 0) continue

        // 2σ以上の逸脱を検出
        for (let i = 0; i < data.length; i++) {
          if (data[i] === null) continue
          const zScore = Math.abs((data[i] - mean) / stdDev)
          if (zScore >= 2) {
            detected.push({
              chartTitle: group.title ?? '無題',
              date: labels[i] ?? `point-${i}`,
              actual: data[i],
              expected: mean,
              expectedRange: [mean - stdDev, mean + stdDev],
              zScore: zScore.toFixed(1),
              direction: data[i] < mean ? 'down' : 'up',
              seriesLabel: ds.label ?? '',
            })
          }
        }
      }
    }
    return detected.slice(0, 5)
  }, [chartGroups])

  if (anomalies.length === 0) return null

  return (
    <div className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/20">
      <div className="p-5 flex items-center justify-between border-b border-outline-variant/10 bg-tertiary/[0.02]">
        <div className="flex items-center gap-6">
          <span className="material-symbols-outlined text-tertiary">warning</span>
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-lg japanese-text">異常検知</h3>
            <span className="text-[10px] font-bold bg-tertiary-container text-on-tertiary px-2 py-0.5 rounded uppercase">
              {anomalies.length} detected
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-medium text-on-surface-variant">
          <span className="w-2.5 h-2.5 rounded-full bg-accent-gold" />
          品質: 注意
        </div>
      </div>

      <div className="p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Anomaly List */}
        <div className="lg:col-span-2 space-y-4">
          {anomalies.map((anomaly, idx) => (
            <div key={idx} className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/10 flex items-start gap-4">
              <span className={`material-symbols-outlined text-lg ${anomaly.direction === 'down' ? 'text-error' : 'text-accent-gold'}`}>
                {anomaly.direction === 'down' ? 'trending_down' : 'trending_up'}
              </span>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-on-surface japanese-text">{anomaly.chartTitle}</p>
                  <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">
                    {anomaly.date}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mt-1">
                  実測: <span className="font-bold text-error">{anomaly.actual.toLocaleString('ja-JP')}</span>
                  {' / '}期待帯域: <span className="font-bold">{anomaly.expectedRange[0].toFixed(0).toLocaleString('ja-JP')} - {anomaly.expectedRange[1].toFixed(0).toLocaleString('ja-JP')}</span>
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Anomaly Detail Card */}
        {anomalies[0] && (
          <div className="bg-surface-container-low p-6 rounded-xl flex flex-col gap-6 border border-outline-variant/20">
            <h4 className="font-bold text-xs text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm">assignment</span>
              異常詳細スコア
            </h4>
            <div className="flex flex-col gap-4">
              <div className="flex justify-between border-b border-outline-variant/30 pb-2">
                <span className="text-xs text-on-surface-variant font-medium">検出日</span>
                <span className="text-xs text-on-surface font-bold">{anomalies[0].date}</span>
              </div>
              <div className="flex justify-between border-b border-outline-variant/30 pb-2">
                <span className="text-xs text-on-surface-variant font-medium">実測値</span>
                <span className="text-xs text-error font-bold">{anomalies[0].actual.toLocaleString('ja-JP')}</span>
              </div>
              <div className="flex justify-between border-b border-outline-variant/30 pb-2">
                <span className="text-xs text-on-surface-variant font-medium">期待帯域</span>
                <span className="text-xs text-on-surface font-bold">
                  {anomalies[0].expectedRange[0].toFixed(0)} - {anomalies[0].expectedRange[1].toFixed(0)}
                </span>
              </div>
              <div className="flex justify-between border-b border-outline-variant/30 pb-2">
                <span className="text-xs text-on-surface-variant font-medium">判定根拠</span>
                <span className="text-xs text-error font-bold">{anomalies[0].zScore}σ 逸脱</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-xs text-on-surface-variant font-medium">監視優先度</span>
                <span className="bg-tertiary-container text-on-tertiary px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm">
                  {Number(anomalies[0].zScore) >= 3 ? 'High Priority' : 'Medium Priority'}
                </span>
              </div>
            </div>

            <div className="mt-auto bg-surface-container-lowest p-4 rounded-lg border-l-4 border-error/40 shadow-sm">
              <p className="text-[10px] font-bold text-tertiary uppercase mb-2 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">verified</span>
                確認事項
              </p>
              <p className="text-xs text-on-surface leading-normal font-medium japanese-text">
                {anomalies[0].direction === 'down'
                  ? '有意な下方乖離を検出しました。データソースの異常やシステム変更の有無を確認してください。'
                  : '有意な上方乖離を検出しました。外部要因やキャンペーン施策の影響を確認してください。'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Main Component ── */
export default function AnalysisGraphs() {
  const { isAdsAuthenticated } = useAuth()
  const { setupState, reportBundle, setReportBundle } = useAdsSetup()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [periodFilter, setPeriodFilter] = useState('latest')
  const [activeTheme, setActiveTheme] = useState('all')
  const [viewMode, setViewMode] = useState('analyst')
  const [openSections, setOpenSections] = useState({})

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

  /* ── テーマ別グルーピング ── */
  const themes = useMemo(() => groupChartsByTheme(filteredGroups), [filteredGroups])
  const displayThemes = useMemo(() => {
    if (activeTheme === 'all') return themes
    return themes.filter((t) => t.id === activeTheme)
  }, [themes, activeTheme])

  /* ── Top Insight Cards ── */
  const topInsights = useMemo(() => extractTopInsights(filteredGroups), [filteredGroups])

  /* ── Accordion state ── */
  useEffect(() => {
    const init = {}
    for (const theme of themes) {
      init[theme.id] = true // デフォルトで全て開く
    }
    setOpenSections(init)
  }, [themes])

  const toggleSection = useCallback((themeId) => {
    setOpenSections((prev) => ({ ...prev, [themeId]: !prev[themeId] }))
  }, [])

  /* ── Summary ── */
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
    <div className="flex-1 min-w-0 overflow-y-auto">
      {/* ── 1. Header Section ── */}
      <header className="sticky top-0 z-40 px-8 py-6 flex flex-col gap-4 bg-background/80 backdrop-blur-md border-b border-outline-variant/15">
        <div className="flex justify-between items-start">
          <div className="flex flex-col gap-1">
            <h2 className="text-3xl font-extrabold tracking-tight text-primary japanese-text">広告考察：グラフ</h2>
            <div className="flex items-center gap-4 text-on-surface-variant text-sm font-medium whitespace-nowrap flex-wrap">
              {setupState?.datasetId && <span>{setupState.datasetId}</span>}
              <span className="w-1.5 h-1.5 rounded-full bg-outline-variant" />
              <span className="font-bold text-on-surface">{activeScopeLabel}</span>

              {/* 期間フィルター */}
              <select
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                className="text-sm text-on-surface-variant bg-surface-container-low border border-outline-variant/30 rounded-lg px-3 py-1 cursor-pointer"
              >
                <option value="latest">最新期間</option>
                <option value="all">全期間まとめ</option>
                {periodTags.map((period) => (
                  <option key={period} value={period}>{period}</option>
                ))}
              </select>

              {/* Data Quality */}
              <div className="flex items-center gap-1.5 bg-secondary-container text-on-secondary-container px-3 py-1 rounded-full text-xs font-bold">
                <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                データ品質: {filteredGroups.length > 0 ? '良好' : '確認中'}
              </div>
            </div>
          </div>

          {/* View Toggle + Refresh */}
          <div className="flex items-center gap-4">
            <div className="flex bg-surface-container-high p-1 rounded-xl">
              <button
                onClick={() => setViewMode('exec')}
                className={`px-5 py-2 text-sm font-bold rounded-lg whitespace-nowrap transition-all ${
                  viewMode === 'exec'
                    ? 'bg-surface-container-lowest shadow-sm text-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Exec View
              </button>
              <button
                onClick={() => setViewMode('analyst')}
                className={`px-5 py-2 text-sm font-bold rounded-lg whitespace-nowrap transition-all ${
                  viewMode === 'analyst'
                    ? 'bg-surface-container-lowest shadow-sm text-primary'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                Analyst View
              </button>
            </div>
            <button
              onClick={handleRefresh}
              disabled={loading || !isAdsAuthenticated || !setupState}
              className="px-5 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
            >
              {loading ? <LoadingSpinner size="sm" /> : <span className="material-symbols-outlined text-base">refresh</span>}
              再取得
            </button>
          </div>
        </div>
      </header>

      <div className="px-8 pb-12 flex flex-col gap-8">
        {error && <ErrorBanner message={error} onRetry={handleRefresh} />}

        {/* ── Loading ── */}
        {loading && chartGroups.length === 0 && (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/15 p-8 space-y-6 mt-8">
            <LoadingSpinner size="md" label="BQ グラフデータを再取得中…" />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
              <SkeletonBlock variant="card" />
              <SkeletonBlock variant="card" />
            </div>
          </div>
        )}

        {/* ── Empty ── */}
        {!loading && !error && filteredGroups.length === 0 && (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/15 p-8 text-center space-y-3 mt-8">
            <span className="material-symbols-outlined text-5xl text-outline-variant">bar_chart</span>
            <h3 className="text-xl font-bold japanese-text">グラフデータがまだありません</h3>
            <p className="text-sm text-on-surface-variant japanese-text">
              セットアップウィザードを完了するか、上の「再取得」ボタンを押してデータを読み込んでください。
            </p>
          </div>
        )}

        {filteredGroups.length > 0 && (
          <>
            {/* ── 2. Top Insight Cards ── */}
            {topInsights.length > 0 && (
              <section className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch mt-4">
                {topInsights.map((insight, i) => (
                  <TopInsightCard key={insight.evidenceId} insight={insight} />
                ))}
              </section>
            )}

            {/* ── 3. Theme Tabs ── */}
            <section className="flex flex-col gap-4">
              <ThemeTabs
                activeTheme={activeTheme}
                onThemeChange={setActiveTheme}
                themes={themes}
              />
              {/* Summary message */}
              <div className="flex items-center gap-2 bg-primary-fixed/30 p-3 rounded-lg border border-primary/10">
                <span className="material-symbols-outlined text-primary text-xl">info</span>
                <p className="text-sm font-semibold text-on-surface japanese-text">
                  {activeTheme === 'all'
                    ? `${themes.length}テーマ、合計${filteredGroups.length}グラフを表示中`
                    : `${displayThemes[0]?.label ?? ''}: ${displayThemes[0]?.groups.length ?? 0}グラフ`
                  }
                </p>
              </div>
            </section>

            {/* ── 4. Chart Sections (Accordion per theme) ── */}
            <section className="flex flex-col gap-6">
              {displayThemes.map((theme) => (
                <GraphSection
                  key={theme.id}
                  theme={theme}
                  isOpen={openSections[theme.id] ?? true}
                  onToggle={() => toggleSection(theme.id)}
                  viewMode={viewMode}
                />
              ))}

              {/* ── 5. Anomaly Detection Section ── */}
              {(activeTheme === 'all' || activeTheme === 'anomaly') && (
                <AnomalySection chartGroups={filteredGroups} viewMode={viewMode} />
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
