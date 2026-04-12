import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AUTH_EXPIRED_MESSAGE } from '../api/adsInsights'
import KpiGrid from '../components/ads/KpiGrid'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { LoadingSpinner, SkeletonBlock, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { extractMarkdownSummary, regenerateAdsReportBundle } from '../utils/adsReports'
import { extractKpis } from '../utils/kpiExtractor'
import {
  extractExecutiveCards,
  computeCoverageSummary,
  extractRefinedInsights,
  extractRecommendedAction,
  extractDataQualityAlerts,
  EVIDENCE_TYPES,
} from '../utils/executiveSummaryExtractor'

/* ── reference 準拠: h1 セクション分割 + 重複 id 回避 ── */
function splitMarkdownByTopLevelSections(markdown) {
  if (!markdown) return []
  const lines = markdown.split(/\r?\n/)
  const sections = []
  let currentHeading = null
  let currentLines = []
  const idCounts = {}

  const flush = () => {
    const md = currentLines.join('\n').trim()
    if (!md) return

    const heading = currentHeading || '概要'
    const baseId = `sec-${heading.replace(/[^\w\u3000-\u9fff]/g, '-').toLowerCase()}`
    idCounts[baseId] = (idCounts[baseId] || 0) + 1

    sections.push({
      heading,
      id: idCounts[baseId] === 1 ? baseId : `${baseId}-${idCounts[baseId]}`,
      md,
      kind: /サマリー|概要|統合|summary/i.test(heading) ? 'summary' : 'report',
    })
  }

  for (const line of lines) {
    const match = line.match(/^# (.+)/)
    if (match && !line.startsWith('##')) {
      if (currentHeading !== null || currentLines.length > 0) {
        flush()
      }
      currentHeading = match[1].replace(/[#*`]/g, '').trim()
      currentLines = [line]
      continue
    }

    currentLines.push(line)
  }

  flush()
  return sections
}

/* ── Evidence Type カラーマッピング ── */
const TYPE_STYLES = {
  observed: {
    bg: 'bg-primary/5', border: 'border-primary/10', text: 'text-primary',
    badgeBg: 'bg-primary/10', label: '実測 (Observed)',
  },
  derived: {
    bg: 'bg-secondary/5', border: 'border-secondary/10', text: 'text-secondary',
    badgeBg: 'bg-secondary/10', label: '導出 (Derived)',
  },
  proxy: {
    bg: 'bg-outline-variant/5', border: 'border-outline-variant/20', text: 'text-on-surface-variant',
    badgeBg: 'bg-outline-variant/10', label: '代替 (Proxy)',
  },
  inferred: {
    bg: 'bg-tertiary/5', border: 'border-tertiary/10', text: 'text-tertiary',
    badgeBg: 'bg-tertiary/10', label: '推論 (Inferred)',
  },
}

/* ── Executive Summary Header ── */
function ExecutiveSummaryHeader({ setupState, reportBundle, selectedPeriod, periodReports, alerts, coverage }) {
  const periods = setupState?.periods ?? []
  const dateRange = periods.length > 0
    ? periods.length === 1 ? periods[0] : `${periods[0]} 〜 ${periods[periods.length - 1]}`
    : null

  return (
    <section className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-primary font-bold text-xs tracking-widest uppercase">
          <span className="material-symbols-outlined text-sm">auto_awesome</span>
          期間要約 (Executive Summary)
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight text-on-surface japanese-text">
          期間要約{' '}
          <span className="text-on-surface-variant/40 font-normal text-xl ml-2">(EXECUTIVE SUMMARY)</span>
        </h1>
        <div className="flex items-center gap-4 mt-4 text-sm text-on-surface-variant font-medium whitespace-nowrap flex-wrap">
          {setupState?.datasetId && (
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[18px]">folder</span>
              {setupState.datasetId}
            </span>
          )}
          {dateRange && (
            <span className="flex items-center gap-1.5 text-on-surface">
              <span className="material-symbols-outlined text-[18px]">calendar_today</span>
              {dateRange}
            </span>
          )}
          {reportBundle?.generatedAt && (
            <span className="flex items-center gap-1.5 text-on-surface-variant/70 text-xs">
              <span className="material-symbols-outlined text-[16px]">update</span>
              {new Date(reportBundle.generatedAt).toLocaleString('ja-JP')}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-6 flex-wrap">
        {/* Data Quality Alert */}
        {alerts.length > 0 && (
          <div className="bg-error/5 border border-error/20 px-4 py-2 rounded-xl flex items-center gap-3">
            <span className="material-symbols-outlined text-error text-[20px]">warning</span>
            <div>
              <p className="text-[10px] font-bold text-error uppercase">データ品質アラート (Data Alert)</p>
              <p className="text-[11px] text-on-surface-variant">{alerts[0].message}</p>
            </div>
          </div>
        )}

        {/* Coverage Summary */}
        {coverage.total > 0 && (
          <div className="flex flex-col gap-2 min-w-[280px]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">カバレッジサマリー (Coverage)</span>
              <span className="text-[10px] text-outline">Total {coverage.total} Evidences</span>
            </div>
            <div className="flex gap-1.5">
              {Object.entries(EVIDENCE_TYPES).map(([key, def]) => (
                <div key={key} className={`${TYPE_STYLES[key].bg} border ${TYPE_STYLES[key].border} px-2 py-1 rounded flex flex-col items-center min-w-[56px] ${coverage[key] === 0 ? 'opacity-40' : ''}`}>
                  <span className={`text-[9px] ${TYPE_STYLES[key].text} font-bold`}>{def.label} ({def.en})</span>
                  <span className={`text-sm font-extrabold ${TYPE_STYLES[key].text}`}>{coverage[key]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/* ── Executive Summary Card ── */
function ExecutiveCard({ card, index }) {
  const style = TYPE_STYLES[card.evidenceType] || TYPE_STYLES.observed
  const isRisk = card.cardType === 'risk'
  const borderClass = isRisk ? 'border-error/20' : 'border-outline-variant/20'

  return (
    <div className={`bg-surface-container-lowest p-6 rounded-xl border ${borderClass} shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between`}>
      <div>
        <div className="flex items-center justify-between mb-4">
          {isRisk ? (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-error bg-error/5 px-2 py-0.5 rounded border border-error/10 uppercase tracking-widest flex items-center gap-1 w-fit">
                <span className="material-symbols-outlined text-[12px] font-bold">warning</span>
                品質状態: 要注意
              </span>
              <span className={`text-[9px] font-bold ${style.text} ${style.bg} px-2 py-0.5 rounded border ${style.border} uppercase tracking-widest w-fit`}>
                {style.label}
              </span>
            </div>
          ) : (
            <span className={`text-[10px] font-bold ${style.text} ${style.bg} px-2 py-0.5 rounded border ${style.border} uppercase tracking-widest`}>
              {style.label}
            </span>
          )}
          <span className={`${style.badgeBg} ${style.text} text-[10px] font-bold px-2 py-0.5 rounded-full`}>
            [{card.evidenceId}]
          </span>
        </div>

        <div className="text-sm font-bold text-on-surface mb-1">{card.label}</div>
        <div className="flex flex-col mb-2">
          <div className={`text-3xl font-extrabold tabular-nums ${isRisk ? 'text-tertiary' : style.text}`}>
            {card.value}
          </div>
          {card.trend && (
            <div className="flex items-center gap-1 mt-1">
              <span className={`text-[11px] font-bold ${card.tone === 'positive' ? 'text-success' : card.tone === 'negative' ? 'text-error' : 'text-on-surface-variant'}`}>
                {card.trend}
              </span>
              <span className="text-[9px] text-on-surface-variant font-bold uppercase">前期間比</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-outline-variant/10">
        <div className="flex items-center justify-between text-[9px] font-bold text-on-surface-variant uppercase">
          <span>分類: {style.label}</span>
          <span className="material-symbols-outlined text-sm text-outline-variant">open_in_new</span>
        </div>
      </div>
    </div>
  )
}

/* ── Recommended Action Card ── */
function RecommendedActionCard({ action }) {
  if (!action) return null

  return (
    <div className="bg-primary text-on-primary p-6 rounded-xl shadow-lg flex flex-col justify-between relative overflow-hidden">
      <div className="absolute top-0 right-0 p-4 opacity-10">
        <span className="material-symbols-outlined text-6xl">rocket_launch</span>
      </div>
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[10px] font-bold text-white/90 bg-white/10 px-2 py-0.5 rounded border border-white/20 uppercase tracking-widest">
            推奨アクション <span className="text-[8px] opacity-70">(Recommended)</span>
          </span>
          <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
            {action.priority === '至急' ? '至急 (Urgent)' : action.priority === '高' ? '高 (High)' : '中 (Medium)'}
          </span>
        </div>
        <div className="text-xl font-bold mb-3">{action.title}</div>
      </div>
    </div>
  )
}

/* ── Refined Insights Section ── */
function RefinedInsightsSection({ insights, reportMd }) {
  if (!reportMd) return null

  // Markdown からセクションを使って分析ブロックを構築
  const sections = splitMarkdownByTopLevelSections(reportMd)
  const reportSections = sections.filter((s) => s.kind === 'report')

  if (reportSections.length === 0 && insights.length === 0) return null

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-extrabold text-on-surface japanese-text">
          AI 精緻化分析 <span className="text-on-surface-variant font-normal text-sm ml-1">(Refined Insights)</span>
        </h2>
        <div className="h-px flex-1 bg-outline-variant/15" />
      </div>

      <div className="space-y-6">
        {/* 実際のレポートセクションから精緻化ブロックを表示 */}
        {reportSections.slice(0, 3).map((section, idx) => {
          const isInferred = /推論|仮説|推定|inference|inferred/i.test(section.heading)
          const typeKey = isInferred ? 'inferred' : 'observed'
          const style = TYPE_STYLES[typeKey]
          const icon = isInferred ? 'psychology' : 'visibility'
          const typeLabel = isInferred ? '推定インサイト (Inferred Insight)' : '観測事実 (Observed Fact)'
          const evidenceId = `E-${String(idx + 1).padStart(2, '0')}`

          const kpis = extractKpis(section.md)
          const summaryText = extractMarkdownSummary(section.md)

          return (
            <div key={section.id} className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/15">
              <div className="bg-surface-container-low px-6 py-3 flex items-center justify-between border-b border-outline-variant/10">
                <div className="flex items-center gap-3">
                  <span className={`material-symbols-outlined ${style.text}`}>{icon}</span>
                  <span className="text-sm font-bold text-on-surface">{typeLabel}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`text-[11px] font-bold ${style.text} tracking-tighter`}>リンク済み: {evidenceId}</span>
                  <span className={`evidence-tag ${style.badgeBg} ${style.text} border ${style.border}`}>
                    {isInferred ? '推定インサイト (Inferred)' : '直接証拠 (Direct Evidence)'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-outline-variant/15">
                {/* 観測事実 */}
                <div className={`p-6 space-y-3 ${style.bg.replace('/5', '/[0.01]')}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold ${style.text} uppercase tracking-widest block`}>根拠 [{evidenceId}]</span>
                  </div>
                  <p className="text-sm text-on-surface leading-relaxed font-medium japanese-text">
                    {section.heading}
                  </p>
                  {kpis.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {kpis.slice(0, 2).map((kpi, i) => (
                        <span key={i} className="text-[10px] font-bold bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface-variant">
                          {kpi.label}: {kpi.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 要因仮説 */}
                <div className="p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest block">要因仮説 (Root Cause)</span>
                    <span className={`text-[9px] font-bold ${style.badgeBg} ${style.text} px-1.5 py-0.5 rounded`}>
                      仮説強度: {isInferred ? '中 (Weak Signal)' : '高 (Strong Inference)'}
                    </span>
                  </div>
                  <div className="text-sm text-on-surface leading-relaxed japanese-text">
                    <MarkdownRenderer content={section.md} variant="essential-pack" />
                  </div>
                </div>

                {/* 改善示唆 */}
                <div className="p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest block">改善示唆 (Action Plan)</span>
                    <span className={`text-[9px] font-bold ${style.text} border ${style.border} px-1.5 py-0.5 rounded`}>
                      優先度: {isInferred ? '中' : '高'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ── Evidence Drawer ── */
function EvidenceDrawer({ cards, reportBundle }) {
  if (!cards || cards.length === 0) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30">
      <details className="group bg-surface-container-lowest border-t border-outline-variant shadow-[0_-10px_30px_rgba(0,0,0,0.08)]">
        <summary className="flex items-center justify-between px-8 py-3 cursor-pointer list-none hover:bg-surface-container-low transition-colors select-none">
          <div className="flex items-center gap-4">
            <span className="material-symbols-outlined text-on-surface-variant transition-transform group-open:rotate-180">keyboard_arrow_up</span>
            <span className="text-[12px] font-bold text-on-surface-variant uppercase tracking-widest">根拠データ (Raw Evidence Drawer)</span>
          </div>
          <div className="flex gap-8 items-center">
            <div className="flex gap-4">
              {reportBundle?.generatedAt && (
                <span className="text-[10px] text-primary font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-primary rounded-full" />
                  最終同期: {new Date(reportBundle.generatedAt).toLocaleString('ja-JP')}
                </span>
              )}
            </div>
          </div>
        </summary>
        <div className="px-8 pb-10 pt-6 bg-surface-container-lowest max-h-[500px] overflow-y-auto">
          {/* Card-to-Evidence Mapping */}
          <div className="mb-8 p-4 bg-surface-container-low rounded-xl border border-outline-variant/10">
            <h4 className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-3">Card-to-Evidence Mapping</h4>
            <div className="flex flex-wrap gap-4">
              {cards.map((card) => {
                const style = TYPE_STYLES[card.evidenceType] || TYPE_STYLES.observed
                return (
                  <div key={card.evidenceId} className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-lowest rounded-lg border border-outline-variant/20 shadow-sm">
                    <span className="text-[10px] font-bold text-on-surface">{card.label}</span>
                    <span className="material-symbols-outlined text-xs text-outline">arrow_forward</span>
                    <span className={`text-[10px] font-bold ${style.text}`}>[{card.evidenceId}] {EVIDENCE_TYPES[card.evidenceType]?.en ?? 'Observed'}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Evidence Details */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {cards.map((card) => {
              const style = TYPE_STYLES[card.evidenceType] || TYPE_STYLES.observed
              return (
                <div key={card.evidenceId} className={`space-y-4 p-5 border border-outline-variant/15 rounded-xl ${style.bg.replace('/5', '/[0.02]')}`}>
                  <div className="flex items-center justify-between border-b border-outline-variant/10 pb-2">
                    <h4 className="text-[11px] font-extrabold text-on-surface">{card.evidenceId}: {card.label}</h4>
                    <span className={`text-[9px] font-bold ${style.badgeBg} ${style.text} px-1.5 py-0.5 rounded`}>
                      {EVIDENCE_TYPES[card.evidenceType]?.en ?? 'OBSERVED'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px]">
                      <span className="text-on-surface-variant">Raw Value</span>
                      <span className={`font-bold ${style.text}`}>{card.value}</span>
                    </div>
                    {card.trend && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-on-surface-variant">Trend</span>
                        <span className={`font-bold ${card.tone === 'positive' ? 'text-success' : card.tone === 'negative' ? 'text-error' : 'text-on-surface-variant'}`}>
                          {card.trend}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-[10px]">
                      <span className="text-on-surface-variant">分類</span>
                      <span className="font-bold">{style.label}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </details>
    </div>
  )
}

/* ── Section Content (既存互換) ── */
function SectionContent({ section, showSummaryHeader = true }) {
  const kpis = useMemo(() => extractKpis(section.md), [section.md])
  const isSummary = section.kind === 'summary' && showSummaryHeader

  return (
    <div className={isSummary ? 'bg-surface-container-lowest p-6' : ''}>
      {isSummary && (
        <div className="flex items-center gap-3 mb-5">
          <span className="w-9 h-9 rounded-lg bg-primary-container/10 text-primary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-lg">summarize</span>
          </span>
          <div>
            <h3 className="text-lg font-bold text-on-surface japanese-text">{section.heading}</h3>
            <p className="text-xs text-on-surface-variant">主要KPIと全体サマリー</p>
          </div>
        </div>
      )}
      <KpiGrid kpis={kpis} />
      <MarkdownRenderer content={section.md} variant="essential-pack" />
    </div>
  )
}

/* ── Main Component ── */
export default function EssentialPack() {
  const { isAdsAuthenticated } = useAuth()
  const { setupState, reportBundle, setReportBundle } = useAdsSetup()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedPeriod, setSelectedPeriod] = useState('all')
  const [openSections, setOpenSections] = useState({})
  const mainRef = useRef(null)

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

  const periodReports = useMemo(() => reportBundle?.periodReports ?? [], [reportBundle?.periodReports])
  const chartGroups = useMemo(() => reportBundle?.chartGroups ?? [], [reportBundle?.chartGroups])

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

  const sections = useMemo(() => splitMarkdownByTopLevelSections(currentReport), [currentReport])
  const useAccordion = sections.length > 1

  /* ── Executive Summary 用データ抽出 ── */
  const executiveCards = useMemo(
    () => extractExecutiveCards(currentReport, chartGroups),
    [currentReport, chartGroups],
  )
  const coverage = useMemo(() => computeCoverageSummary(executiveCards), [executiveCards])
  const refinedInsights = useMemo(() => extractRefinedInsights(currentReport), [currentReport])
  const recommendedAction = useMemo(() => extractRecommendedAction(currentReport), [currentReport])
  const qualityAlerts = useMemo(
    () => extractDataQualityAlerts(currentReport, chartGroups),
    [currentReport, chartGroups],
  )

  /* ── accordion 初期状態 ── */
  useEffect(() => {
    if (!sections.length) return
    const init = {}
    let firstReportDone = false
    for (const s of sections) {
      if (s.kind === 'summary') {
        init[s.id] = true
      } else if (!firstReportDone) {
        init[s.id] = true
        firstReportDone = true
      } else {
        init[s.id] = false
      }
    }
    setOpenSections(init)
  }, [sections])

  const toggleSection = useCallback((id) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const expandAll = useCallback(() => {
    setOpenSections((prev) => {
      const next = { ...prev }
      for (const key of Object.keys(next)) next[key] = true
      return next
    })
  }, [])

  const collapseAll = useCallback(() => {
    const next = {}
    for (const s of sections) next[s.id] = s.kind === 'summary'
    setOpenSections(next)
  }, [sections])

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

  function handlePeriodChange(e) {
    setSelectedPeriod(e.target.value)
    if (mainRef.current) mainRef.current.scrollTop = 0
  }

  return (
    <div ref={mainRef} className="flex-1 min-w-0 overflow-y-auto pb-48">
      <div className="px-10 py-8 max-w-[1400px] mx-auto space-y-10">

        {/* ── 認証警告 ── */}
        {!isAdsAuthenticated && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 text-sm text-amber-800 flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-600">warning</span>
            考察スタジオへのログインが必要です
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={handleRefresh} />}

        {/* ── Section 1: Header ── */}
        <ExecutiveSummaryHeader
          setupState={setupState}
          reportBundle={reportBundle}
          selectedPeriod={selectedPeriod}
          periodReports={periodReports}
          alerts={qualityAlerts}
          coverage={coverage}
        />

        {/* ── 期間選択 + 更新ボタン ── */}
        <div className="flex items-center gap-4">
          {periodReports.length > 1 && (
            <select
              value={selectedPeriod}
              onChange={handlePeriodChange}
              className="px-4 py-2 text-sm bg-surface-container-low border border-outline-variant/30 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              <option value="all">全期間 ({periodReports.length})</option>
              {periodReports.map((report) => (
                <option key={report.periodTag} value={report.periodTag}>
                  {report.label}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading || !isAdsAuthenticated || !setupState}
            className="px-5 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <LoadingSpinner size="sm" />
                <span>取得中…</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">sync</span>
                レポートを再取得
              </>
            )}
          </button>
        </div>

        {/* ── Loading State ── */}
        {loading && !currentReport && (
          <div className="bg-surface-container-lowest rounded-xl p-8 space-y-6">
            <div className="flex items-center gap-3">
              <LoadingSpinner size="md" label="BigQuery バッチレポートを再取得中…" />
            </div>
            <SkeletonBlock variant="text" lines={8} />
          </div>
        )}

        {/* ── Empty State ── */}
        {!loading && !error && !currentReport && (
          <div className="bg-surface-container-lowest rounded-xl p-8 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-outline-variant">description</span>
            <h3 className="text-xl font-bold japanese-text">レポート本文がまだありません</h3>
            <p className="text-sm text-on-surface-variant japanese-text">
              Wizard の generate_batch 結果をここに表示します。上のボタンで再取得してください。
            </p>
          </div>
        )}

        {/* ── Section 2: Executive Cards ── */}
        {currentReport && (executiveCards.length > 0 || recommendedAction) && (
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {executiveCards.map((card, i) => (
              <ExecutiveCard key={card.evidenceId} card={card} index={i} />
            ))}
            <RecommendedActionCard action={recommendedAction} />
          </section>
        )}

        {/* ── Section 3: AI 精緻化分析 ── */}
        {currentReport && (
          <RefinedInsightsSection insights={refinedInsights} reportMd={currentReport} />
        )}

        {/* ── Section 4: 詳細レポート (Accordion) ── */}
        {currentReport && useAccordion && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-on-surface japanese-text">
                詳細レポート <span className="text-on-surface-variant font-normal text-sm ml-1">(Full Report)</span>
              </h2>
              <div className="flex gap-1">
                <button onClick={expandAll} className="text-[10px] px-3 py-1 rounded-lg bg-surface-container hover:bg-surface-container-low transition-colors text-on-surface-variant font-bold">
                  全て開く
                </button>
                <button onClick={collapseAll} className="text-[10px] px-3 py-1 rounded-lg bg-surface-container hover:bg-surface-container-low transition-colors text-on-surface-variant font-bold">
                  全て閉じる
                </button>
              </div>
            </div>

            {sections.map((section) => (
              <div
                key={section.id}
                id={section.id}
                className="rounded-xl ghost-border scroll-mt-20 overflow-x-hidden transition-all"
              >
                {section.kind === 'summary' ? (
                  <SectionContent section={section} />
                ) : (
                  <>
                    <button
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={!!openSections[section.id]}
                      className={`w-full flex items-center justify-between px-6 py-4 text-left transition-colors rounded-t-xl ${
                        openSections[section.id]
                          ? 'bg-surface-container-lowest text-on-surface'
                          : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                          openSections[section.id] ? 'bg-primary-container/10 text-primary-container' : 'bg-surface-container text-on-surface-variant'
                        }`}>
                          <span className="material-symbols-outlined text-lg">article</span>
                        </span>
                        <span className="font-bold text-sm japanese-text">{section.heading}</span>
                      </span>
                      <span
                        className="material-symbols-outlined text-base transition-transform duration-200"
                        style={{ transform: openSections[section.id] ? 'rotate(180deg)' : 'rotate(0deg)' }}
                      >
                        expand_more
                      </span>
                    </button>
                    {openSections[section.id] && (
                      <div className="bg-surface-container-lowest p-6 border-t border-outline-variant/8">
                        <SectionContent section={section} showSummaryHeader={false} />
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </section>
        )}

        {/* ── 単一セクション表示 ── */}
        {currentReport && !useAccordion && sections.length > 0 && (
          <div className="bg-surface-container-lowest rounded-xl p-8 space-y-6">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary">article</span>
              <h3 className="text-xl font-bold japanese-text">
                {selectedPeriod === 'all' ? '統合レポート' : `${selectedPeriod} レポート`}
              </h3>
            </div>
            <SectionContent
              section={{
                ...(sections[0] ?? {
                  heading: selectedPeriod === 'all' ? '統合レポート' : `${selectedPeriod} レポート`,
                  md: currentReport,
                  kind: 'report',
                }),
                kind: 'report',
              }}
              showSummaryHeader={false}
            />
          </div>
        )}
      </div>

      {/* ── Evidence Drawer (固定下部) ── */}
      {currentReport && executiveCards.length > 0 && (
        <EvidenceDrawer cards={executiveCards} reportBundle={reportBundle} />
      )}
    </div>
  )
}
