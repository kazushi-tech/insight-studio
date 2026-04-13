import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AUTH_EXPIRED_MESSAGE } from '../api/adsInsights'
import ChartGroupCard from '../components/ads/ChartGroupCard'
import SourceBadge from '../components/ads/SourceBadge'
import ExcelImportBanner from '../components/ads/ExcelImportBanner'
import ExcelImportPreview from '../components/ads/ExcelImportPreview'
import ExcelImportStatusStrip from '../components/ads/ExcelImportStatusStrip'
import ImportedAdDetails from '../components/ads/ImportedAdDetails'
import ExcelSummaryCard from '../components/ads/ExcelSummaryCard'
import { LoadingSpinner, SkeletonBlock, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import {
  getChartPeriodTags,
  getDisplayChartGroups,
  regenerateAdsReportBundle,
} from '../utils/adsReports'
import {
  groupChartsByTheme,
  extractTopInsights,
  computeThemeSummary,
  THEME_DEFINITIONS,
} from '../utils/chartThemeClassifier'
import { parseExcelFile } from '../utils/excelImporter'
import {
  extractExecutiveCards,
  computeCoverageSummary,
  extractRefinedInsights,
  extractRecommendedAction,
  extractDataQualityAlerts,
} from '../utils/executiveSummaryExtractor'

/* ── Section IDs for local nav ── */
const SECTIONS = [
  { id: 'summary', label: 'サマリー', icon: 'stars' },
  { id: 'graphs', label: 'グラフ分析', icon: 'bar_chart' },
  { id: 'creative', label: 'クリエイティブ', icon: 'palette' },
  { id: 'detail-report', label: '詳細レポート', icon: 'description' },
]

/* ── Evidence Type styles ── */
const EVIDENCE_STYLES = {
  observed: { text: 'text-primary', bg: 'bg-primary/5', border: 'border-primary/20', label: 'Observed' },
  derived:  { text: 'text-secondary', bg: 'bg-secondary/5', border: 'border-secondary/20', label: 'Derived' },
  proxy:    { text: 'text-accent-gold', bg: 'bg-accent-gold/10', border: 'border-accent-gold/20', label: 'Proxy' },
  inferred: { text: 'text-tertiary', bg: 'bg-tertiary/5', border: 'border-tertiary/20', label: 'Inferred' },
}

/* ── Summary Card (結論 / 最大機会 / 最大リスク) ── */
function SummaryCard({ card }) {
  if (!card) return null
  const style = EVIDENCE_STYLES[card.evidenceType] || EVIDENCE_STYLES.observed

  const isRisk = card.cardType === 'risk'
  const borderColor = isRisk ? 'border-l-error' : 'border-l-primary'

  return (
    <div className={`bg-surface-container-lowest p-6 rounded-xl ghost-border border-l-4 ${borderColor} hover:shadow-lg transition-shadow flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded ${isRisk ? 'bg-error/5 text-error' : 'bg-primary/5 text-primary'}`}>
          {card.cardType === 'cvr' ? 'Conclusion' : card.cardType === 'opportunity' ? 'Max Opportunity' : 'Max Risk'}
        </span>
        <span className={`material-symbols-outlined ${isRisk ? 'text-error' : 'text-primary'}`}>
          {card.cardType === 'cvr' ? 'stars' : card.cardType === 'opportunity' ? 'trending_up' : 'warning'}
        </span>
      </div>
      <div>
        <h3 className="text-sm text-on-surface-variant">
          {card.cardType === 'cvr' ? '結論' : card.cardType === 'opportunity' ? '最大機会' : '最大リスク'}
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">{card.value}</span>
        </div>
      </div>
      <p className="text-[11px] text-on-surface-variant leading-relaxed line-clamp-2">{card.label}</p>
      {card.trend && (
        <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/10">
          <span className={`material-symbols-outlined text-sm ${card.tone === 'positive' ? 'text-emerald-600' : card.tone === 'negative' ? 'text-error' : 'text-on-surface-variant'}`}>
            {card.tone === 'positive' ? 'trending_up' : card.tone === 'negative' ? 'trending_down' : 'trending_flat'}
          </span>
          <span className={`text-sm font-bold tabular-nums ${card.tone === 'positive' ? 'text-emerald-600' : card.tone === 'negative' ? 'text-error' : 'text-on-surface-variant'}`}>
            {card.trend}
          </span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase">前期間比</span>
        </div>
      )}
    </div>
  )
}

/* ── Priority Action Card ── */
function PriorityActionCard({ action }) {
  if (!action) return null
  return (
    <div className="bg-primary p-6 rounded-xl shadow-lg flex flex-col justify-between relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-10">
        <span className="material-symbols-outlined text-6xl">rocket_launch</span>
      </div>
      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-white/90 bg-white/10 px-2 py-1 rounded border border-white/20 uppercase tracking-widest">
            Priority Action
          </span>
          <span className="material-symbols-outlined text-white/80">rocket_launch</span>
        </div>
        <h3 className="text-sm text-white/80">最優先アクション</h3>
        <div className="text-xl font-bold text-white leading-tight line-clamp-2">{action.title}</div>
        {action.details?.impact && (
          <p className="text-[11px] text-white/80 leading-relaxed">{action.details.impact}</p>
        )}
      </div>
    </div>
  )
}

/* ── Creative Filter Tabs ── */
const CREATIVE_FILTERS = [
  { id: 'all', label: 'すべて' },
  { id: 'banner', label: 'バナー' },
  { id: 'text', label: 'テキスト' },
]

/* ── Text Ad Card ── */
function TextAdCard({ ref: adRef, index }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl ghost-border overflow-hidden flex flex-col">
      <div className="p-4 bg-primary/5 border-b border-outline-variant/10">
        <span className="text-[10px] font-bold text-primary tracking-widest">TEXT AD #{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="p-6 flex-1 space-y-4">
        <div className="p-3 bg-surface rounded border border-outline-variant/20">
          <p className="text-sm font-bold text-primary mb-1 underline japanese-text line-clamp-1">
            {adRef.name ?? `テキスト広告 ${index + 1}`}
          </p>
          {adRef.description && (
            <p className="text-xs text-on-surface-variant line-clamp-3 japanese-text">{adRef.description}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {adRef.kpis?.click != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">Clicks</div>
              <div className="text-sm font-bold">{adRef.kpis.click.toLocaleString('ja-JP')}</div>
            </div>
          )}
          {adRef.kpis?.cv != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CV</div>
              <div className="text-sm font-bold">{adRef.kpis.cv.toLocaleString('ja-JP')}</div>
            </div>
          )}
          {adRef.kpis?.cvr != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CVR</div>
              <div className="text-sm font-bold text-primary">{adRef.kpis.cvr.toFixed(2)}%</div>
            </div>
          )}
          {adRef.kpis?.ctr != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CTR</div>
              <div className="text-sm font-bold">{adRef.kpis.ctr.toFixed(2)}%</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Banner Ad Card ── */
function BannerAdCard({ ref: adRef, index }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl ghost-border overflow-hidden flex flex-col border border-primary/20">
      <div className="relative h-40">
        {adRef.imageUrl ? (
          <img
            src={adRef.imageUrl}
            alt={adRef.name ?? `バナー広告 ${index + 1}`}
            className="w-full h-full object-cover"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        ) : (
          <div className="w-full h-full bg-surface-container-low flex items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-outline-variant">image</span>
          </div>
        )}
        <div className="absolute top-3 left-3 px-2 py-1 bg-primary text-on-primary text-[10px] font-bold rounded">
          BANNER AD #{String(index + 1).padStart(2, '0')}
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {adRef.kpis?.click != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">Clicks</div>
              <div className="text-sm font-bold">{adRef.kpis.click.toLocaleString('ja-JP')}</div>
            </div>
          )}
          {adRef.kpis?.cv != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CV</div>
              <div className="text-sm font-bold">{adRef.kpis.cv.toLocaleString('ja-JP')}</div>
            </div>
          )}
          {adRef.kpis?.cvr != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CVR</div>
              <div className="text-sm font-bold text-primary">{adRef.kpis.cvr.toFixed(2)}%</div>
            </div>
          )}
          {adRef.kpis?.ctr != null && (
            <div className="text-center py-2 bg-surface-container-low rounded">
              <div className="text-[9px] uppercase font-bold text-on-surface-variant/60">CTR</div>
              <div className="text-sm font-bold">{adRef.kpis.ctr.toFixed(2)}%</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Key Chart Picker (pick 2 most insightful) ── */
function pickKeyCharts(chartGroups) {
  if (!chartGroups || chartGroups.length === 0) return []
  const scored = chartGroups.map((g) => {
    const title = (g.title ?? '').toLowerCase()
    let score = 0
    if (/click|cvr|cv数|cpa|ctr|コンバージョン|推移|trend/i.test(title)) score += 3
    if (/比較|ranking|campaign|キャンペーン|広告グループ/i.test(title)) score += 2
    if (Array.isArray(g.datasets) && g.datasets.length > 0) score += 1
    if (Array.isArray(g.labels) && g.labels.length >= 3) score += 1
    return { group: g, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 2).map((s) => s.group)
}

/* ── Theme Tabs (analyst supplement) ── */
function ThemeTabs({ activeTheme, onThemeChange, themes }) {
  const allTabs = [{ id: 'all', label: '全件', icon: 'select_all' }, ...THEME_DEFINITIONS]

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

/* ── Graph Section (Accordion for analyst) ── */
function GraphSection({ theme, isOpen, onToggle, viewMode }) {
  const summary = useMemo(() => computeThemeSummary(theme.groups), [theme.groups])

  return (
    <div id={`theme-section-${theme.id}`} className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/20 scroll-mt-24">
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

      {isOpen && (
        <div className="p-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {theme.groups.map((group, groupIndex) => (
              <ChartGroupCard
                key={`${group.title ?? 'group'}-${group._periodTag ?? 'merged'}-${groupIndex}`}
                group={group}
              />
            ))}
          </div>

          {viewMode === 'analyst' && theme.groups.length > 0 && (
            <div className="mt-8 space-y-6">
              <h4 className="font-bold text-xs text-on-surface-variant uppercase tracking-widest flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">table_chart</span>
                生データテーブル (RAW DATA)
              </h4>
              {theme.groups.map((group, gIdx) => {
                const labels = Array.isArray(group.labels) ? group.labels : []
                const datasets = Array.isArray(group.datasets) ? group.datasets : []
                if (labels.length === 0 || datasets.length === 0) return null

                return (
                  <div key={gIdx} className="space-y-2">
                    <div className="flex items-center gap-3">
                      <p className="text-xs font-bold text-on-surface japanese-text">{group.title ?? '無題'}</p>
                      {group._periodTag && (
                        <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">{group._periodTag}</span>
                      )}
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-outline-variant/30 shadow-sm max-h-[400px] overflow-y-auto">
                      <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-surface-container-high text-on-surface-variant font-bold text-xs sticky top-0 z-10">
                          <tr>
                            <th className="px-4 py-3 sticky left-0 bg-surface-container-high z-20 whitespace-nowrap">日付 / カテゴリ</th>
                            {datasets.map((ds, dsIdx) => (
                              <th key={dsIdx} className="px-4 py-3 text-right whitespace-nowrap">{ds.label || `系列${dsIdx + 1}`}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10 text-on-surface bg-surface-container-lowest">
                          {labels.map((label, rowIdx) => (
                            <tr key={rowIdx} className="hover:bg-surface-container-low transition-colors">
                              <td className="px-4 py-2 font-medium text-on-surface-variant sticky left-0 bg-surface-container-lowest whitespace-nowrap text-xs">{label}</td>
                              {datasets.map((ds, dsIdx) => (
                                <td key={dsIdx} className="px-4 py-2 text-right font-medium tabular-nums text-xs">
                                  {ds.data?.[rowIdx] != null ? ds.data[rowIdx] : '-'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Anomaly Detection Section ── */
function AnomalySection({ chartGroups, viewMode }) {
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

        const mean = validData.reduce((s, v) => s + v, 0) / validData.length
        const variance = validData.reduce((s, v) => s + (v - mean) ** 2, 0) / validData.length
        const stdDev = Math.sqrt(variance)
        if (stdDev === 0) continue

        const title = (group.title ?? '').toLowerCase()
        const isNonNegative = !/率|%|％|cvr|ctr|rate|ratio|share/i.test(title)

        for (let i = 0; i < data.length; i++) {
          if (data[i] === null) continue
          const zScore = Math.abs((data[i] - mean) / stdDev)
          if (zScore >= 2) {
            const lowerBound = mean - stdDev
            detected.push({
              chartTitle: group.title ?? '無題',
              date: labels[i] ?? `point-${i}`,
              actual: data[i],
              expected: mean,
              expectedRange: [isNonNegative ? Math.max(0, lowerBound) : lowerBound, mean + stdDev],
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
      </div>
      <div className="p-8 space-y-4">
        {anomalies.map((anomaly, idx) => (
          <div key={idx} className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/10 flex items-start gap-4">
            <span className={`material-symbols-outlined text-lg ${anomaly.direction === 'down' ? 'text-error' : 'text-accent-gold'}`}>
              {anomaly.direction === 'down' ? 'trending_down' : 'trending_up'}
            </span>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-on-surface japanese-text">{anomaly.chartTitle}</p>
                <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">{anomaly.date}</span>
              </div>
              <p className="text-xs text-on-surface-variant mt-1">
                実測: <span className="font-bold text-error">{anomaly.actual.toLocaleString('ja-JP')}</span>
                {' / '}期待帯域: <span className="font-bold">{anomaly.expectedRange[0].toFixed(0)} - {anomaly.expectedRange[1].toFixed(0)}</span>
                {' / '}<span className="font-bold text-error">{anomaly.zScore}σ 逸脱</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════
   Main Component: 広告分析 (Unified Analysis Surface)
   ════════════════════════════════════════════════════════ */
export default function AnalysisGraphs() {
  const { isAdsAuthenticated } = useAuth()
  const { setupState, reportBundle, setReportBundle } = useAdsSetup()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [periodFilter, setPeriodFilter] = useState('latest')
  const [activeTheme, setActiveTheme] = useState('all')
  const [viewMode, setViewMode] = useState('exec')
  const [openSections, setOpenSections] = useState({})
  const [activeSection, setActiveSection] = useState('summary')
  const [creativeFilter, setCreativeFilter] = useState('all')

  /* ── Excel import state ── */
  const [excelState, setExcelState] = useState('none')
  const [excelPreview, setExcelPreview] = useState(null)
  const [excelImport, setExcelImport] = useState(null)
  const [excelError, setExcelError] = useState(null)
  const [excelDetailOpen, setExcelDetailOpen] = useState(false)
  const [analystSupplementOpen, setAnalystSupplementOpen] = useState(false)

  /* ── Data fetch ── */
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

  /* ── Chart data ── */
  const chartGroups = useMemo(() => reportBundle?.chartGroups ?? [], [reportBundle?.chartGroups])
  const periodTags = useMemo(() => getChartPeriodTags(chartGroups), [chartGroups])

  useEffect(() => {
    if (periodTags.length === 0) { setPeriodFilter('latest'); return }
    if (periodFilter === 'all' || periodFilter === 'latest') return
    if (!periodTags.includes(periodFilter)) setPeriodFilter('latest')
  }, [periodFilter, periodTags])

  const filteredGroups = useMemo(
    () => getDisplayChartGroups(chartGroups, periodFilter),
    [chartGroups, periodFilter],
  )

  const themes = useMemo(() => groupChartsByTheme(filteredGroups), [filteredGroups])
  const displayThemes = useMemo(() => {
    if (activeTheme === 'all') return themes
    return themes.filter((t) => t.id === activeTheme)
  }, [themes, activeTheme])

  const topInsights = useMemo(() => extractTopInsights(filteredGroups), [filteredGroups])
  const keyCharts = useMemo(() => pickKeyCharts(filteredGroups), [filteredGroups])

  /* ── Summary data (from EssentialPack extractors) ── */
  const currentReport = useMemo(() => reportBundle?.reportMd ?? '', [reportBundle?.reportMd])
  const executiveCards = useMemo(
    () => extractExecutiveCards(currentReport, chartGroups),
    [currentReport, chartGroups],
  )
  const refinedInsights = useMemo(() => extractRefinedInsights(currentReport), [currentReport])
  const recommendedAction = useMemo(() => extractRecommendedAction(currentReport), [currentReport])
  const qualityAlerts = useMemo(
    () => extractDataQualityAlerts(currentReport, chartGroups),
    [currentReport, chartGroups],
  )

  /* ── Classify cards for 4-column summary ── */
  const conclusionCard = executiveCards.find((c) => c.cardType === 'cvr') ?? executiveCards[0] ?? null
  const opportunityCard = executiveCards.find((c) => c.cardType === 'opportunity') ?? executiveCards[1] ?? null
  const riskCard = executiveCards.find((c) => c.cardType === 'risk') ?? executiveCards[2] ?? null

  /* ── Creative refs ── */
  const creativeRefs = useMemo(() => excelImport?.creativeRefs ?? [], [excelImport?.creativeRefs])
  const textAds = useMemo(() => creativeRefs.filter((r) => !r.imageUrl), [creativeRefs])
  const bannerAds = useMemo(() => creativeRefs.filter((r) => r.imageUrl), [creativeRefs])
  const filteredCreatives = useMemo(() => {
    if (creativeFilter === 'text') return textAds
    if (creativeFilter === 'banner') return bannerAds
    return creativeRefs
  }, [creativeFilter, creativeRefs, textAds, bannerAds])

  /* ── Refined insights for detail report ── */
  const observations = useMemo(() => refinedInsights.filter((b) => b.type === 'observation'), [refinedInsights])
  const hypotheses = useMemo(() => refinedInsights.filter((b) => b.type === 'hypothesis'), [refinedInsights])
  const actions = useMemo(() => refinedInsights.filter((b) => b.type === 'action'), [refinedInsights])

  /* ── Accordion state for analyst themes ── */
  useEffect(() => {
    const init = {}
    for (const theme of themes) init[theme.id] = true
    setOpenSections(init)
  }, [themes])

  const toggleSection = useCallback((themeId) => {
    setOpenSections((prev) => ({ ...prev, [themeId]: !prev[themeId] }))
  }, [])

  /* ── Header data ── */
  const periods = setupState?.periods ?? []
  const dateRange = periods.length > 0
    ? periods.length === 1 ? periods[0] : `${periods[0]} 〜 ${periods[periods.length - 1]}`
    : null

  const activeScopeLabel =
    periodFilter === 'all' ? '全期間まとめ'
    : periodFilter === 'latest' ? `最新期間: ${periodTags[periodTags.length - 1] ?? '-'}`
    : `対象期間: ${periodFilter}`

  const hasSummaryData = executiveCards.length > 0 || recommendedAction
  const hasGraphData = filteredGroups.length > 0
  const hasCreativeData = creativeRefs.length > 0
  const hasDetailReport = refinedInsights.length > 0

  /* ── Handlers ── */
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

  async function handleExcelFile(file) {
    if (!file || !file.name.endsWith('.xlsx')) {
      setExcelError('対応形式は .xlsx のみです')
      return
    }
    setExcelState('uploading')
    setExcelError(null)
    try {
      const result = await parseExcelFile(file)
      setExcelPreview(result)
      setExcelState('preview')
    } catch (e) {
      setExcelError(e.message)
      setExcelState('none')
    }
  }

  function handleExcelApply() {
    if (!excelPreview) return
    setExcelImport(excelPreview)
    setExcelPreview(null)
    setExcelState('applied')
  }

  function handleExcelCancel() {
    setExcelPreview(null)
    setExcelState('none')
    setExcelError(null)
  }

  function handleExcelRemove() {
    setExcelImport(null)
    setExcelPreview(null)
    setExcelState('none')
    setExcelError(null)
  }

  function handleExcelReupload() {
    setExcelImport(null)
    setExcelPreview(null)
    setExcelState('none')
    setExcelError(null)
  }

  function scrollToSection(sectionId) {
    setActiveSection(sectionId)
    document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="px-8 py-8 max-w-[1680px] space-y-10">

        {/* ═══ 1. PAGE HEADER ═══ */}
        <section className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {reportBundle?.source && (
                <span className="px-2 py-0.5 bg-primary-container text-on-primary-container text-[10px] font-bold rounded uppercase tracking-wider">
                  {reportBundle.source === 'bq_generate_batch' ? 'Campaign Active' : 'Live'}
                </span>
              )}
              <h1 className="text-3xl font-extrabold tracking-tight text-primary japanese-text">広告分析</h1>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-on-surface-variant text-sm">
              {setupState?.datasetId && (
                <span className="font-medium flex items-center gap-1">
                  <span className="material-symbols-outlined text-base">corporate_fare</span>
                  {setupState.datasetId}
                </span>
              )}
              {dateRange && (
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-base">calendar_month</span>
                  {dateRange}
                </span>
              )}
              {reportBundle?.generatedAt && (
                <span className="flex items-center gap-1 text-[11px] opacity-60">
                  最終更新: {new Date(reportBundle.generatedAt).toLocaleString('ja-JP')}
                </span>
              )}
            </div>
            {/* Source chips */}
            <div className="flex gap-2 pt-1">
              <SourceBadge source="ga4" />
              {excelState === 'applied' && <SourceBadge source="excel" />}
            </div>
          </div>

          {/* Exec / Analyst toggle + refresh */}
          <div className="flex items-center gap-4">
            <div className="flex items-center p-1 bg-surface-container rounded-full ghost-border">
              <button
                onClick={() => setViewMode('exec')}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
                  viewMode === 'exec'
                    ? 'bg-surface-container-lowest text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                Exec View
              </button>
              <button
                onClick={() => setViewMode('analyst')}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
                  viewMode === 'analyst'
                    ? 'bg-surface-container-lowest text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
              >
                Analyst View
              </button>
            </div>

            {/* Period selector */}
            {periodTags.length > 0 && (
              <select
                value={periodFilter}
                onChange={(e) => setPeriodFilter(e.target.value)}
                className="text-sm text-on-surface-variant bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 py-2 cursor-pointer"
              >
                <option value="latest">最新期間</option>
                <option value="all">全期間まとめ</option>
                {periodTags.map((period) => (
                  <option key={period} value={period}>{period}</option>
                ))}
              </select>
            )}

            <button
              onClick={handleRefresh}
              disabled={loading || !isAdsAuthenticated || !setupState}
              className="px-5 py-2 bg-primary text-on-primary rounded-full font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
            >
              {loading ? <LoadingSpinner size="sm" /> : <span className="material-symbols-outlined text-base">refresh</span>}
              再取得
            </button>
          </div>
        </section>

        {/* ═══ 2. SOURCE / WARNING STRIP ═══ */}
        {error && <ErrorBanner message={error} onRetry={handleRefresh} />}
        {excelError && (
          <div className="bg-error/5 border border-error/20 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-error text-lg">error</span>
            <p className="text-sm text-on-surface">{excelError}</p>
            <button onClick={() => setExcelError(null)} className="ml-auto text-on-surface-variant hover:text-on-surface">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

        {qualityAlerts.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200/50 text-on-surface rounded-xl">
            <span className="material-symbols-outlined text-xl text-amber-600">info</span>
            <p className="text-sm font-medium japanese-text">{qualityAlerts[0].message}</p>
          </div>
        )}

        {excelState === 'applied' && excelImport?.warnings?.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-primary-container/5 border border-primary-container/10 rounded-xl">
            <span className="material-symbols-outlined text-primary text-lg">lightbulb</span>
            <div className="text-sm text-on-surface japanese-text">
              {excelImport.warnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          </div>
        )}

        {/* Excel import states */}
        {excelState === 'applied' && (
          <ExcelImportStatusStrip excelImport={excelImport} onReupload={handleExcelReupload} onRemove={handleExcelRemove} />
        )}
        {excelState === 'none' && (
          <ExcelImportBanner onFileSelected={handleExcelFile} disabled={loading} />
        )}
        {excelState === 'uploading' && (
          <div className="bg-surface-container-lowest rounded-xl p-8 flex items-center gap-4">
            <LoadingSpinner size="md" label="Excelファイルを解析中…" />
          </div>
        )}
        {excelState === 'preview' && (
          <ExcelImportPreview result={excelPreview} onApply={handleExcelApply} onCancel={handleExcelCancel} />
        )}

        {/* ═══ 3. LOCAL SECTION NAV ═══ */}
        <nav className="flex gap-8 border-b border-outline-variant/15 pb-2">
          {SECTIONS.map((sec) => (
            <button
              key={sec.id}
              onClick={() => scrollToSection(sec.id)}
              className={`relative py-2 text-sm font-medium transition-all ${
                activeSection === sec.id
                  ? 'text-primary font-semibold border-b-2 border-primary'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
            >
              {sec.label}
            </button>
          ))}
        </nav>

        {/* Loading state */}
        {loading && !currentReport && chartGroups.length === 0 && (
          <div className="bg-surface-container-lowest rounded-xl p-8 space-y-6">
            <LoadingSpinner size="md" label="分析データを取得中…" />
            <SkeletonBlock variant="text" lines={8} />
          </div>
        )}

        {/* ═══ 4. SUMMARY SECTION ═══ */}
        <section id="section-summary" className="scroll-mt-24 space-y-6">
          {hasSummaryData ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <SummaryCard card={conclusionCard ? { ...conclusionCard, cardType: 'cvr' } : null} />
              <SummaryCard card={opportunityCard ? { ...opportunityCard, cardType: 'opportunity' } : null} />
              <SummaryCard card={riskCard ? { ...riskCard, cardType: 'risk' } : null} />
              <PriorityActionCard action={recommendedAction} />
            </div>
          ) : excelState === 'applied' && excelImport?.summary ? (
            <ExcelSummaryCard summary={excelImport.summary} />
          ) : !loading && (
            <div className="bg-surface-container-lowest rounded-xl p-8 text-center space-y-3">
              <span className="material-symbols-outlined text-5xl text-outline-variant">summarize</span>
              <h3 className="text-xl font-bold japanese-text">サマリーデータがまだありません</h3>
              <p className="text-sm text-on-surface-variant japanese-text">
                レポート生成後にサマリーが表示されます。上の「再取得」ボタンを押してください。
              </p>
            </div>
          )}
        </section>

        {/* ═══ 5. GRAPH SECTION ═══ */}
        <section id="section-graphs" className="scroll-mt-24 space-y-6">
          {hasGraphData ? (
            <>
              {/* Key Charts (2-column, exec-level) */}
              {keyCharts.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {keyCharts.map((group, idx) => (
                    <ChartGroupCard key={`key-${group.title ?? idx}`} group={group} />
                  ))}
                </div>
              )}

              {/* Inline insight for key charts */}
              {topInsights.length > 0 && topInsights[0].takeaway && (
                <div className="p-3 bg-surface rounded-lg border-l-4 border-primary">
                  <p className="text-sm font-semibold text-primary japanese-text">{topInsights[0].takeaway}</p>
                </div>
              )}
            </>
          ) : !loading && (
            <div className="bg-surface-container-lowest rounded-xl p-8 text-center space-y-3">
              <span className="material-symbols-outlined text-5xl text-outline-variant">bar_chart</span>
              <h3 className="text-xl font-bold japanese-text">グラフデータがまだありません</h3>
              <p className="text-sm text-on-surface-variant japanese-text">
                セットアップ完了後にグラフが表示されます。
              </p>
            </div>
          )}
        </section>

        {/* ═══ 6. CREATIVE SECTION ═══ */}
        <section id="section-creative" className="scroll-mt-24 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-extrabold text-primary japanese-text">クリエイティブ分析</h2>
            {hasCreativeData && (
              <div className="flex gap-2">
                {CREATIVE_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setCreativeFilter(f.id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                      creativeFilter === f.id
                        ? 'bg-primary text-on-primary'
                        : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high border border-outline-variant/20'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {hasCreativeData ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredCreatives.slice(0, 9).map((ref, idx) =>
                ref.imageUrl
                  ? <BannerAdCard key={`banner-${idx}`} ref={ref} index={idx} />
                  : <TextAdCard key={`text-${idx}`} ref={ref} index={idx} />
              )}
            </div>
          ) : (
            <div className="bg-surface-container-lowest rounded-xl p-8 text-center space-y-3">
              <span className="material-symbols-outlined text-5xl text-outline-variant">palette</span>
              <h3 className="text-lg font-bold japanese-text">クリエイティブデータなし</h3>
              <p className="text-sm text-on-surface-variant japanese-text">
                月次Excelを取り込むとテキスト広告・バナー広告のパフォーマンスが表示されます。
              </p>
            </div>
          )}
        </section>

        {/* ═══ 7. DETAILED REPORT SECTION ═══ */}
        <section id="section-detail-report" className="scroll-mt-24 space-y-6">
          {hasDetailReport ? (
            <div className="bg-surface-container-lowest p-8 rounded-xl ghost-border space-y-8">
              <div className="flex items-center gap-4">
                <span className="material-symbols-outlined text-primary text-3xl">description</span>
                <h2 className="text-xl font-extrabold text-primary japanese-text">詳細分析レポート</h2>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                {/* Fact */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">01</span>
                    <h3 className="text-base font-bold japanese-text">観測事実 (Fact)</h3>
                  </div>
                  <ul className="space-y-4">
                    {observations.length > 0 ? observations.map((obs, idx) => (
                      <li key={idx} className="flex gap-3">
                        <span className="text-primary font-mono text-[10px] mt-1 shrink-0">{obs.evidenceId ?? `E-${String(idx + 1).padStart(2, '0')}`}</span>
                        <p className="text-sm leading-relaxed text-on-surface-variant japanese-text">{obs.summary}</p>
                      </li>
                    )) : (
                      <li className="text-xs text-on-surface-variant/50 italic">観測データなし</li>
                    )}
                  </ul>
                </div>

                {/* Inference */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center text-secondary font-bold text-xs">02</span>
                    <h3 className="text-base font-bold japanese-text">要因仮説 (Inference)</h3>
                  </div>
                  <ul className="space-y-4">
                    {hypotheses.length > 0 ? hypotheses.map((hyp, idx) => (
                      <li key={idx} className="space-y-1">
                        <p className="text-sm leading-relaxed text-on-surface-variant japanese-text">{hyp.summary}</p>
                        {hyp.source && (
                          <span className="px-2 py-0.5 bg-surface-container rounded text-[9px] text-on-surface-variant">Source: {hyp.source}</span>
                        )}
                      </li>
                    )) : (
                      <li className="text-xs text-on-surface-variant/50 italic">仮説未生成</li>
                    )}
                  </ul>
                </div>

                {/* Action */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-primary-container/20 flex items-center justify-center text-primary font-bold text-xs">03</span>
                    <h3 className="text-base font-bold japanese-text">推奨施策 (Action)</h3>
                  </div>
                  {actions.length > 0 ? (
                    <div className="p-4 bg-primary text-on-primary rounded-xl space-y-3 shadow-md">
                      {actions.map((act, idx) => (
                        <div key={idx} className={idx > 0 ? 'pt-3 border-t border-on-primary/10' : ''}>
                          <p className="text-sm font-semibold japanese-text">{act.summary}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-on-surface-variant/50 italic">アクション未提案</p>
                  )}
                </div>
              </div>
            </div>
          ) : !loading && (
            <div className="bg-surface-container-lowest rounded-xl p-8 text-center space-y-3">
              <span className="material-symbols-outlined text-5xl text-outline-variant">description</span>
              <h3 className="text-lg font-bold japanese-text">詳細レポートがまだありません</h3>
              <p className="text-sm text-on-surface-variant japanese-text">
                レポート生成後に観測事実・要因仮説・推奨施策が表示されます。
              </p>
            </div>
          )}
        </section>

        {/* ═══ 8. ANALYST-ONLY SUPPLEMENTS ═══ */}
        {viewMode === 'analyst' && (hasGraphData || (excelState === 'applied' && excelImport)) && (
          <section className="space-y-6">
            <button
              onClick={() => setAnalystSupplementOpen((prev) => !prev)}
              className="w-full flex items-center justify-between p-5 bg-surface-container-lowest rounded-xl ghost-border hover:bg-surface-container-low transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`material-symbols-outlined ${analystSupplementOpen ? 'text-primary' : 'text-on-surface-variant'}`}>
                  {analystSupplementOpen ? 'expand_more' : 'chevron_right'}
                </span>
                <h2 className="font-bold text-lg japanese-text">Analyst Supplements</h2>
                <span className="text-[10px] font-bold bg-surface-container-highest text-on-surface-variant px-2 py-0.5 rounded uppercase">
                  {filteredGroups.length} charts
                  {excelImport?.chartGroups?.length > 0 ? ` + ${excelImport.chartGroups.length} excel` : ''}
                </span>
              </div>
              <span className="material-symbols-outlined text-on-surface-variant text-sm">
                {analystSupplementOpen ? 'unfold_less' : 'unfold_more'}
              </span>
            </button>

            {analystSupplementOpen && (
              <div className="space-y-8">
                {/* Excel detail (charts + creatives from import) */}
                {excelState === 'applied' && excelImport?.summary && (
                  <ExcelSummaryCard summary={excelImport.summary} />
                )}

                {excelState === 'applied' && excelImport && (excelImport.chartGroups?.length > 0 || excelImport.creativeRefs?.length > 0) && (
                  <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-sm overflow-hidden">
                    <button
                      onClick={() => setExcelDetailOpen((prev) => !prev)}
                      className="w-full px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-surface-container-low transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`material-symbols-outlined ${excelDetailOpen ? 'text-primary' : 'text-on-surface-variant'}`}>
                          {excelDetailOpen ? 'expand_more' : 'chevron_right'}
                        </span>
                        <h3 className="font-bold text-base text-on-surface japanese-text">Excel詳細グラフ</h3>
                        <span className="text-[10px] font-bold bg-surface-container-highest px-2 py-0.5 rounded uppercase text-on-surface-variant">
                          {excelImport.chartGroups?.length ?? 0} charts
                        </span>
                      </div>
                    </button>

                    {excelDetailOpen && (
                      <div className="px-6 pb-6 space-y-6">
                        <ImportedAdDetails excelImport={excelImport} />
                      </div>
                    )}
                  </div>
                )}

                {/* Theme tabs + full chart grid */}
                {hasGraphData && (
                  <>
                    <ThemeTabs activeTheme={activeTheme} onThemeChange={setActiveTheme} themes={themes} />

                    {displayThemes.map((theme) => (
                      <GraphSection
                        key={theme.id}
                        theme={theme}
                        isOpen={openSections[theme.id] ?? true}
                        onToggle={() => toggleSection(theme.id)}
                        viewMode={viewMode}
                      />
                    ))}

                    <AnomalySection chartGroups={filteredGroups} viewMode={viewMode} />
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {/* Empty state when no data at all */}
        {!loading && !error && !hasSummaryData && !hasGraphData && excelState !== 'applied' && (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/15 p-8 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-outline-variant">analytics</span>
            <h3 className="text-xl font-bold japanese-text">分析データがまだありません</h3>
            <p className="text-sm text-on-surface-variant japanese-text">
              セットアップウィザードを完了するか、上の「再取得」ボタンを押してデータを読み込んでください。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
