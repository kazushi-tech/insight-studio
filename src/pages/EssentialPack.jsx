import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AUTH_EXPIRED_MESSAGE } from '../api/adsInsights'
import KpiGrid from '../components/ads/KpiGrid'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { LoadingSpinner, SkeletonBlock, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { regenerateAdsReportBundle } from '../utils/adsReports'
import { extractKpis } from '../utils/kpiExtractor'
import {
  extractExecutiveCards,
  computeCoverageSummary,
  extractRefinedInsights,
  extractRecommendedAction,
  extractDataQualityAlerts,
  EVIDENCE_TYPES,
} from '../utils/executiveSummaryExtractor'

/* ── reference: h1 section split ── */
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
      if (currentHeading !== null || currentLines.length > 0) flush()
      currentHeading = match[1].replace(/[#*`]/g, '').trim()
      currentLines = [line]
      continue
    }
    currentLines.push(line)
  }
  flush()
  return sections
}

/* ── Evidence Type colour map ── */
const TYPE_STYLES = {
  observed: { bg: 'bg-primary/5', border: 'border-primary/10', text: 'text-primary', badgeBg: 'bg-primary/10', label: '実測 (Observed)', borderL: 'border-l-primary' },
  derived:  { bg: 'bg-secondary/5', border: 'border-secondary/10', text: 'text-secondary', badgeBg: 'bg-secondary/10', label: '導出 (Derived)', borderL: 'border-l-secondary' },
  proxy:    { bg: 'bg-outline-variant/5', border: 'border-outline-variant/20', text: 'text-on-surface-variant', badgeBg: 'bg-outline-variant/10', label: '代替 (Proxy)', borderL: 'border-l-outline-variant' },
  inferred: { bg: 'bg-tertiary/5', border: 'border-tertiary/10', text: 'text-tertiary', badgeBg: 'bg-tertiary/10', label: '推論 (Inferred)', borderL: 'border-l-tertiary' },
}

/* ── Executive Summary Header ── */
function ExecutiveSummaryHeader({ setupState, reportBundle, alerts, coverage }) {
  const periods = setupState?.periods ?? []
  const dateRange = periods.length > 0
    ? periods.length === 1 ? periods[0] : `${periods[0]} 〜 ${periods[periods.length - 1]}`
    : null

  return (
    <section className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-primary font-bold text-xs tracking-widest uppercase">
          <span className="material-symbols-outlined text-sm">auto_awesome</span>
          期間要約 (EXECUTIVE SUMMARY)
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
        {alerts.length > 0 && (
          <div className="bg-error/5 border border-error/20 px-4 py-2 rounded-xl flex items-center gap-3">
            <span className="material-symbols-outlined text-error text-[20px]">warning</span>
            <div>
              <p className="text-[10px] font-bold text-error uppercase">データ品質アラート (Data Alert)</p>
              <p className="text-[11px] text-on-surface-variant">{alerts[0].message}</p>
            </div>
          </div>
        )}

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

/* ── Executive Card (data-driven: CVR / 潜在需要 / 離脱率) ── */
function ExecutiveCard({ card }) {
  const style = TYPE_STYLES[card.evidenceType] || TYPE_STYLES.observed

  return (
    <a href={`#${card.evidenceId}-detail`} className={`bg-surface-container-lowest p-5 rounded-xl border-l-4 ${style.borderL} shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`evidence-tag ${style.badgeBg} ${style.text} border ${style.border}`}>
          {style.label}
        </span>
        <span className="text-[9px] font-bold text-on-surface-variant bg-surface-container-high px-1.5 py-0.5 rounded">
          {card.evidenceId}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-black tabular-nums ${card.cardType === 'risk' ? 'text-tertiary' : 'text-on-surface'}`}>
          {card.value}
        </span>
      </div>

      <p className="text-sm font-bold text-on-surface japanese-text line-clamp-1">{card.label}</p>

      {card.trend && (
        <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/10">
          <span className={`material-symbols-outlined text-sm ${card.tone === 'positive' ? 'text-success' : card.tone === 'negative' ? 'text-error' : 'text-on-surface-variant'}`}>
            {card.tone === 'positive' ? 'trending_up' : card.tone === 'negative' ? 'trending_down' : 'trending_flat'}
          </span>
          <span className={`text-sm font-bold tabular-nums ${card.tone === 'positive' ? 'text-success' : card.tone === 'negative' ? 'text-error' : 'text-on-surface-variant'}`}>
            {card.trend}
          </span>
          <span className="text-[10px] text-on-surface-variant font-bold uppercase">前期間比</span>
        </div>
      )}

      {card.source && (
        <p className="text-[10px] text-on-surface-variant/70">ソース: {card.source}</p>
      )}
    </a>
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
      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-white/90 bg-white/10 px-2 py-0.5 rounded border border-white/20 uppercase tracking-widest">
            推奨アクション <span className="text-[8px] opacity-70">(Recommended)</span>
          </span>
          <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
            {action.priority === '至急' ? '至急 (Urgent)' : action.priority === '高' ? '高 (High)' : '中 (Medium)'}
          </span>
        </div>
        <div className="text-lg font-bold leading-snug japanese-text line-clamp-2">{action.title}</div>

        {action.details && (
          <div className="bg-white/10 rounded-lg p-3 space-y-1.5 text-[11px] font-medium">
            {action.details.impact && (
              <div className="flex justify-between">
                <span className="text-white/70">期待効果</span>
                <span className="font-bold">{action.details.impact}</span>
              </div>
            )}
            {action.details.range && (
              <div className="flex justify-between">
                <span className="text-white/70">改善レンジ</span>
                <span className="font-bold">{action.details.range}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Refined Insights Section (per-block 3-column layout) ── */
function RefinedInsightsSection({ insights }) {
  if (!insights || insights.length === 0) return null

  const observations = insights.filter((b) => b.type === 'observation')
  const hypotheses = insights.filter((b) => b.type === 'hypothesis')
  const actions = insights.filter((b) => b.type === 'action')

  const blockCount = Math.max(observations.length, hypotheses.length, actions.length)
  if (blockCount === 0) return null

  const blocks = []
  for (let i = 0; i < blockCount; i++) {
    const obs = observations[i] ?? null
    const hyp = hypotheses[i] ?? null
    const act = actions[i] ?? null
    const primary = obs || hyp || act
    if (!primary) continue

    const blockType = obs ? 'observed' : hyp ? 'inferred' : 'derived'
    const blockLabel = obs ? '観測事実 (Observed Fact)' : hyp ? '推定インサイト (Inferred Insight)' : '改善示唆 (Action Plan)'
    const evidenceId = primary.evidenceId

    blocks.push({ blockType, blockLabel, evidenceId, obs, hyp, act })
  }

  if (blocks.length === 0) return null

  const strengthLabel = (block) => {
    if (block.obs && block.hyp) return block.hyp.summary?.length > 50 ? '仮説強度: 高 (Strong Inference)' : '仮説強度: 中 (Weak Signal)'
    return null
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-extrabold text-on-surface japanese-text">
          AI 精緻化分析 <span className="text-on-surface-variant font-normal text-sm ml-1">(Refined Insights)</span>
        </h2>
        <div className="h-px flex-1 bg-outline-variant/15" />
      </div>

      <div className="space-y-5">
        {blocks.map((block, idx) => {
          const style = TYPE_STYLES[block.blockType] || TYPE_STYLES.observed
          const strength = strengthLabel(block)

          return (
            <div key={idx} className={`${style.bg} border ${style.border} rounded-xl overflow-hidden`}>
              <div className="bg-surface-container-low px-5 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold ${style.text} uppercase tracking-widest`}>
                    {block.blockLabel}
                  </span>
                  <span className={`text-[9px] font-bold ${style.badgeBg} ${style.text} px-1.5 py-0.5 rounded`}>
                    {block.evidenceId}
                  </span>
                </div>
                {strength && (
                  <span className="text-[10px] font-bold text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">
                    {strength}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-outline-variant/15">
                {/* Column 1: 根拠 */}
                <div className="p-5 space-y-2">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-sm text-primary">visibility</span>
                    <span className="text-[10px] font-bold text-primary uppercase tracking-widest">根拠 (Evidence)</span>
                  </div>
                  {block.obs ? (
                    <>
                      <p className="text-xs font-bold text-on-surface japanese-text">{block.obs.heading}</p>
                      <p className="text-sm text-on-surface-variant leading-relaxed japanese-text line-clamp-4">{block.obs.summary}</p>
                    </>
                  ) : (
                    <p className="text-xs text-on-surface-variant/50 italic">観測データなし</p>
                  )}
                </div>

                {/* Column 2: 要因仮説 */}
                <div className="p-5 space-y-2">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-sm text-tertiary">psychology</span>
                    <span className="text-[10px] font-bold text-tertiary uppercase tracking-widest">要因仮説 (Root Cause)</span>
                  </div>
                  {block.hyp ? (
                    <>
                      <p className="text-xs font-bold text-on-surface japanese-text">{block.hyp.heading}</p>
                      <p className="text-sm text-on-surface-variant leading-relaxed japanese-text line-clamp-4">{block.hyp.summary}</p>
                    </>
                  ) : (
                    <p className="text-xs text-on-surface-variant/50 italic">仮説未生成</p>
                  )}
                </div>

                {/* Column 3: 改善示唆 */}
                <div className="p-5 space-y-2">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-sm text-secondary">rocket_launch</span>
                    <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">改善示唆 (Action Plan)</span>
                  </div>
                  {block.act ? (
                    <>
                      <p className="text-xs font-bold text-on-surface japanese-text">{block.act.heading}</p>
                      <p className="text-sm text-on-surface-variant leading-relaxed japanese-text line-clamp-4">{block.act.summary}</p>
                    </>
                  ) : (
                    <p className="text-xs text-on-surface-variant/50 italic">アクション未提案</p>
                  )}
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
          <div className="flex gap-4 items-center">
            {reportBundle?.generatedAt && (
              <span className="text-[10px] text-primary font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 bg-primary rounded-full" />
                最終同期: {new Date(reportBundle.generatedAt).toLocaleString('ja-JP')}
              </span>
            )}
          </div>
        </summary>
        <div className="px-8 pb-10 pt-6 bg-surface-container-lowest max-h-[500px] overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {cards.map((card) => {
              const style = TYPE_STYLES[card.evidenceType] || TYPE_STYLES.observed
              return (
                <div key={card.evidenceId} id={`${card.evidenceId}-detail`} className={`p-5 border border-outline-variant/15 rounded-xl ${style.bg}`}>
                  <div className="flex items-center gap-2 mb-3 border-b border-outline-variant/10 pb-2">
                    <span className={`evidence-tag ${style.badgeBg} ${style.text} border ${style.border}`}>
                      {style.label}
                    </span>
                    <span className="text-[9px] font-bold text-on-surface-variant bg-surface-container-high px-1.5 py-0.5 rounded">{card.evidenceId}</span>
                  </div>
                  <p className="text-xs font-bold text-on-surface mb-2">{card.label}</p>
                  <div className="space-y-1.5 text-[11px] text-on-surface-variant">
                    <div className="flex justify-between">
                      <span className="font-medium">ソース</span>
                      <span className="font-bold text-on-surface">{card.source ?? 'BQ / GA4'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Raw Value</span>
                      <span className="font-bold text-on-surface tabular-nums">{card.value}</span>
                    </div>
                    {card.trend && (
                      <div className="flex justify-between">
                        <span className="font-medium">変化</span>
                        <span className={`font-bold tabular-nums ${card.tone === 'positive' ? 'text-success' : card.tone === 'negative' ? 'text-error' : 'text-on-surface'}`}>{card.trend}</span>
                      </div>
                    )}
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

/* ── Section Content (legacy) ── */
function SectionContent({ section }) {
  const kpis = useMemo(() => extractKpis(section.md), [section.md])
  return (
    <div>
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
        if (!cancelled) setError(e.isAuthError ? AUTH_EXPIRED_MESSAGE : e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [isAdsAuthenticated, reportBundle?.source, setReportBundle, setupState])

  const periodReports = useMemo(() => reportBundle?.periodReports ?? [], [reportBundle?.periodReports])
  const chartGroups = useMemo(() => reportBundle?.chartGroups ?? [], [reportBundle?.chartGroups])

  useEffect(() => {
    if (periodReports.length <= 1) { setSelectedPeriod('all'); return }
    if (!periodReports.some((r) => r.periodTag === selectedPeriod)) {
      setSelectedPeriod(periodReports[periodReports.length - 1]?.periodTag ?? 'all')
    }
  }, [periodReports, selectedPeriod])

  const currentReport = useMemo(() => {
    if (selectedPeriod === 'all') return reportBundle?.reportMd ?? ''
    return periodReports.find((r) => r.periodTag === selectedPeriod)?.reportMd ?? ''
  }, [periodReports, reportBundle?.reportMd, selectedPeriod])

  const sections = useMemo(() => splitMarkdownByTopLevelSections(currentReport), [currentReport])

  /* ── Executive Summary data ── */
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

  /* ── accordion state ── */
  useEffect(() => {
    if (!sections.length) return
    const init = {}
    for (const s of sections) init[s.id] = false
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
    for (const s of sections) next[s.id] = false
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
      setError(e.isAuthError ? AUTH_EXPIRED_MESSAGE : e.message)
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
      <div className="px-8 py-8 max-w-[1680px] space-y-8">

        {!isAdsAuthenticated && (
          <div className="bg-amber-50 dark:bg-warning-container border border-amber-200 dark:border-warning/30 rounded-xl px-6 py-4 text-sm text-amber-800 dark:text-on-warning-container flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-600 dark:text-warning">warning</span>
            考察スタジオへのログインが必要です
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={handleRefresh} />}

        {/* Header */}
        <ExecutiveSummaryHeader
          setupState={setupState}
          reportBundle={reportBundle}
          alerts={qualityAlerts}
          coverage={coverage}
        />

        {/* Period selector + refresh */}
        <div className="flex items-center gap-4">
          {periodReports.length > 1 && (
            <select
              value={selectedPeriod}
              onChange={handlePeriodChange}
              className="px-4 py-2 text-sm bg-surface-container-low border border-outline-variant/30 rounded-xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              <option value="all">全期間 ({periodReports.length})</option>
              {periodReports.map((report) => (
                <option key={report.periodTag} value={report.periodTag}>{report.label}</option>
              ))}
            </select>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading || !isAdsAuthenticated || !setupState}
            className="px-5 py-2 bg-primary text-on-primary rounded-xl font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><LoadingSpinner size="sm" /><span>取得中…</span></>
            ) : (
              <><span className="material-symbols-outlined text-sm">sync</span>レポートを再取得</>
            )}
          </button>
        </div>

        {/* Loading */}
        {loading && !currentReport && (
          <div className="bg-surface-container-lowest rounded-xl p-8 space-y-6">
            <LoadingSpinner size="md" label="BigQuery バッチレポートを再取得中…" />
            <SkeletonBlock variant="text" lines={8} />
          </div>
        )}

        {/* Empty */}
        {!loading && !error && !currentReport && (
          <div className="bg-surface-container-lowest rounded-xl p-8 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-outline-variant">description</span>
            <h3 className="text-xl font-bold japanese-text">レポート本文がまだありません</h3>
            <p className="text-sm text-on-surface-variant japanese-text">
              Wizard の generate_batch 結果をここに表示します。上のボタンで再取得してください。
            </p>
          </div>
        )}

        {/* Executive Cards (4-column: 3 data + recommended action) */}
        {currentReport && (executiveCards.length > 0 || recommendedAction) && (
          <section className={`grid grid-cols-1 gap-5 ${
            (executiveCards.length + (recommendedAction ? 1 : 0)) >= 4 ? 'md:grid-cols-2 lg:grid-cols-4' :
            (executiveCards.length + (recommendedAction ? 1 : 0)) >= 3 ? 'md:grid-cols-3' :
            'md:grid-cols-2'
          }`}>
            {executiveCards.map((card) => (
              <ExecutiveCard key={card.evidenceId} card={card} />
            ))}
            <RecommendedActionCard action={recommendedAction} />
          </section>
        )}

        {/* Refined Insights (per-block 3-column) */}
        {currentReport && <RefinedInsightsSection insights={refinedInsights} />}

        {/* Detail Report Accordion */}
        {currentReport && sections.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-on-surface japanese-text">
                詳細レポート <span className="text-on-surface-variant font-normal text-sm ml-1">(Full Report)</span>
              </h2>
              <div className="flex gap-1">
                <button onClick={expandAll} className="text-[10px] px-3 py-1 rounded-lg bg-surface-container hover:bg-surface-container-low transition-colors text-on-surface-variant font-bold">全て開く</button>
                <button onClick={collapseAll} className="text-[10px] px-3 py-1 rounded-lg bg-surface-container hover:bg-surface-container-low transition-colors text-on-surface-variant font-bold">全て閉じる</button>
              </div>
            </div>

            {sections.map((section) => (
              <div key={section.id} id={section.id} className="rounded-xl ghost-border scroll-mt-20 overflow-x-hidden transition-all">
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
                      <span className="material-symbols-outlined text-lg">
                        {section.kind === 'summary' ? 'summarize' : 'article'}
                      </span>
                    </span>
                    <span className="font-bold text-sm japanese-text">{section.heading}</span>
                  </span>
                  <span className="material-symbols-outlined text-base transition-transform duration-200" style={{ transform: openSections[section.id] ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                    expand_more
                  </span>
                </button>
                {openSections[section.id] && (
                  <div className="bg-surface-container-lowest p-6 border-t border-outline-variant/8">
                    <SectionContent section={section} />
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
      </div>

      {/* Evidence Drawer */}
      {currentReport && executiveCards.length > 0 && (
        <EvidenceDrawer cards={executiveCards} reportBundle={reportBundle} />
      )}
    </div>
  )
}
