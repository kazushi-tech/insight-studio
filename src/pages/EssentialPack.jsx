import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AUTH_EXPIRED_MESSAGE } from '../api/adsInsights'
import KpiGrid from '../components/ads/KpiGrid'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { LoadingSpinner, SkeletonBlock, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { extractMarkdownSummary, regenerateAdsReportBundle } from '../utils/adsReports'
import { extractKpis } from '../utils/kpiExtractor'

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

function ContextualInsightModule({ insightText }) {
  if (!insightText) return null

  return (
    <div className="grid grid-cols-3 gap-8 mt-8">
      <div className="col-span-2 bg-surface-container-low p-8 rounded-[0.75rem] border-l-4 border-primary-container">
        <div className="flex gap-4">
          <span className="material-symbols-outlined text-primary-container text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>lightbulb</span>
          <div>
            <h3 className="text-lg font-bold text-on-surface mb-2 japanese-text">AI自動考察</h3>
            <p className="text-sm text-on-surface-variant japanese-text leading-7">{insightText}</p>
          </div>
        </div>
      </div>
      <div className="bg-surface-container-high/50 p-8 rounded-[0.75rem] flex flex-col justify-center items-center text-center">
        <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-4">auto_awesome</span>
        <h4 className="font-bold text-on-surface mb-1 japanese-text">詳細分析</h4>
        <p className="text-xs text-on-surface-variant mb-3 japanese-text">各セクションの詳細レポートは<br/>アコーディオンを展開して確認できます</p>
      </div>
    </div>
  )
}

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
  const insightSummary = useMemo(() => {
    if (!currentReport) return null
    if (selectedPeriod === 'all' && periodReports.length > 1) return null

    const summarySection = sections.find((section) => section.kind === 'summary')
    return extractMarkdownSummary(summarySection?.md ?? currentReport)
  }, [currentReport, periodReports.length, sections, selectedPeriod])

  /* ── accordion 初期状態: summary + 最初の report を open ── */
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

  const navToSection = useCallback(
    (sectionId) => {
      setOpenSections((prev) => ({ ...prev, [sectionId]: true }))
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const container = mainRef.current
          const target = document.getElementById(sectionId)
          if (!container || !target) return

          const containerRect = container.getBoundingClientRect()
          const targetRect = target.getBoundingClientRect()
          const top = targetRect.top - containerRect.top + container.scrollTop - 16
          container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
        })
      })
    },
    [],
  )

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
    <div className="flex min-h-[calc(100vh-4rem)] overflow-x-hidden">
      {/* ── Sticky Left Nav ── */}
      <div className="w-[240px] min-w-[240px] bg-surface-container-lowest border-r border-outline-variant/10 p-5 space-y-5 sticky top-16 self-start max-h-[calc(100vh-4rem)] overflow-y-auto">
        {/* 期間プルダウン */}
        {periodReports.length > 1 && (
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider block mb-1">期間</label>
            <select
              value={selectedPeriod}
              onChange={handlePeriodChange}
              className="w-full px-3 py-2 text-sm bg-surface-container border border-outline-variant/30 rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
            >
              <option value="all">全期間 ({periodReports.length})</option>
              {periodReports.map((report) => (
                <option key={report.periodTag} value={report.periodTag}>
                  {report.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* 分析条件 */}
        {setupState && (
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider block mb-1">分析条件</label>
            <div className="space-y-0.5 text-xs text-on-surface-variant">
              <p>粒度: {setupState.granularity === 'monthly' ? '月別' : setupState.granularity === 'weekly' ? '週別' : '日別'}</p>
              <p>クエリ: {setupState.queryTypes?.join(', ')}</p>
            </div>
          </div>
        )}

        {/* セクションナビ (accordion 時) */}
        {useAccordion && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-secondary uppercase tracking-wider">セクション</label>
              <div className="flex gap-1">
                <button onClick={expandAll} className="text-[10px] px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-low transition-colors text-on-surface-variant">
                  全て開く
                </button>
                <button onClick={collapseAll} className="text-[10px] px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-low transition-colors text-on-surface-variant">
                  全て閉じる
                </button>
              </div>
            </div>
            <div className="space-y-0.5">
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault()
                    navToSection(s.id)
                  }}
                  className={`block px-3 py-1.5 text-xs rounded-lg transition-all leading-snug ${
                    openSections[s.id]
                      ? 'bg-surface-container-lowest text-on-surface font-bold shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-container'
                  } ${s.kind === 'summary' ? 'font-bold' : ''}`}
                >
                  {s.heading}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* 認証警告 */}
        {!isAdsAuthenticated && (
          <div className="bg-amber-50 border border-amber-200 rounded-[0.75rem] px-4 py-3 text-xs text-amber-800">
            <span className="material-symbols-outlined text-sm align-middle mr-1">warning</span>
            考察スタジオへのログインが必要です
          </div>
        )}

        {/* 再取得ボタン */}
        <button
          onClick={handleRefresh}
          disabled={loading || !isAdsAuthenticated || !setupState}
          className="w-full py-2.5 bg-secondary text-on-secondary rounded-[0.75rem] font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* サマリーカード */}
        {insightSummary && (
          <div className="bg-secondary p-4 rounded-[0.75rem] text-on-secondary">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-sm">description</span>
              <span className="font-bold text-xs">サマリー</span>
            </div>
            <p className="text-xs leading-relaxed">{insightSummary}</p>
          </div>
        )}
      </div>

      {/* ── Main Content ── */}
      <div ref={mainRef} className="flex-1 min-w-0 p-8 space-y-6 overflow-x-hidden overflow-y-auto">
        {error && (
          <ErrorBanner message={error} onRetry={handleRefresh} />
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-3xl font-extrabold text-on-surface tracking-tight japanese-text">要点パック (Essential Pack)</h2>
            <p className="text-sm text-on-surface-variant japanese-text">
              {setupState?.granularity === 'monthly' ? '月次' : setupState?.granularity === 'weekly' ? '週次' : setupState?.granularity === 'daily' ? '日次' : ''}パフォーマンス・サマリーレポート
              {selectedPeriod !== 'all' && ` — ${selectedPeriod}`}
              {selectedPeriod === 'all' && periodReports.length > 1 && ` — 複数期間サマリー (${periodReports.length}期間)`}
            </p>
          </div>
        </div>

        {loading && !currentReport && (
          <div className="bg-surface-container-lowest rounded-[0.75rem] p-8 space-y-6">
            <div className="flex items-center gap-3">
              <LoadingSpinner size="md" label="BigQuery バッチレポートを再取得中…" />
            </div>
            <SkeletonBlock variant="text" lines={8} />
          </div>
        )}

        {!loading && !error && !currentReport && (
          <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-8 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-outline-variant">description</span>
            <h3 className="text-xl font-bold japanese-text">レポート本文がまだありません</h3>
            <p className="text-sm text-on-surface-variant japanese-text">
              Wizard の generate_batch 結果をここに表示します。左のボタンで再取得してください。
            </p>
          </div>
        )}

        {/* ── Contextual Insight (folder 11 style) ── */}
        {currentReport && insightSummary && (
          <ContextualInsightModule insightText={insightSummary} />
        )}

        {/* ── Accordion セクション表示 ── */}
        {currentReport && useAccordion && (
          <div className="space-y-3">
            {sections.map((section) => (
              <div
                key={section.id}
                id={section.id}
                className={`rounded-[0.75rem] ghost-border scroll-mt-20 overflow-x-hidden transition-all ${
                  !openSections[section.id] && section.kind !== 'summary' ? 'opacity-80 hover:opacity-100' : ''
                }`}
              >
                {section.kind === 'summary' ? (
                  /* Summary: 常に開いた状態、ボタンなし */
                  <SectionContent section={section} />
                ) : (
                  /* Report: 開閉可能 accordion */
                  <>
                    <button
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={!!openSections[section.id]}
                      className={`w-full flex items-center justify-between px-6 py-4 text-left transition-colors rounded-t-[0.75rem] ${
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
                        <SectionContent section={section} />
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── 単一セクション表示 (accordion 不要時) ── */}
        {currentReport && !useAccordion && (
          <div className="bg-surface-container-lowest rounded-[0.75rem] panel-card-hover p-8 space-y-6">
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
    </div>
  )
}
