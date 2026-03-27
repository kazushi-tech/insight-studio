import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AUTH_EXPIRED_MESSAGE } from '../api/adsInsights'
import MarkdownRenderer from '../components/MarkdownRenderer'
import { LoadingSpinner, SkeletonBlock, ErrorBanner } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'
import { extractMarkdownSummary, regenerateAdsReportBundle } from '../utils/adsReports'

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
  const insightSummary = useMemo(() => extractMarkdownSummary(currentReport), [currentReport])

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
      <div className="w-[260px] min-w-[260px] bg-surface-container-lowest border-r border-surface-container p-5 space-y-5 sticky top-16 self-start max-h-[calc(100vh-4rem)] overflow-y-auto">
        {/* 期間プルダウン */}
        {periodReports.length > 1 && (
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider block mb-1">期間</label>
            <select
              value={selectedPeriod}
              onChange={handlePeriodChange}
              className="w-full px-3 py-2 text-sm bg-surface-container border border-outline-variant/30 rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-secondary/30"
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
                      ? 'text-secondary font-bold border-l-2 border-secondary bg-secondary/5'
                      : 'text-on-surface-variant border-l-2 border-transparent hover:bg-surface-container'
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
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
            <span className="material-symbols-outlined text-sm align-middle mr-1">warning</span>
            考察スタジオへのログインが必要です
          </div>
        )}

        {/* 再取得ボタン */}
        <button
          onClick={handleRefresh}
          disabled={loading || !isAdsAuthenticated || !setupState}
          className="w-full py-2.5 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="bg-secondary p-4 rounded-2xl text-on-secondary">
            <div className="flex items-center gap-2 mb-1">
              <span className="material-symbols-outlined text-sm">description</span>
              <span className="font-bold text-xs">SUMMARY</span>
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

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-extrabold text-[#1A1A2E] japanese-text">広告考察レポート</h2>
            <p className="text-xs text-on-surface-variant mt-1">report_md を表示しています</p>
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
          <div className="bg-surface-container-lowest rounded-2xl p-8 space-y-6">
            <div className="flex items-center gap-3">
              <LoadingSpinner size="md" label="BigQuery バッチレポートを再取得中…" />
            </div>
            <SkeletonBlock variant="text" lines={8} />
          </div>
        )}

        {!loading && !error && !currentReport && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-outline-variant">description</span>
            <h3 className="text-xl font-bold japanese-text">レポート本文がまだありません</h3>
            <p className="text-sm text-on-surface-variant japanese-text">
              Wizard の generate_batch 結果をここに表示します。左のボタンで再取得してください。
            </p>
          </div>
        )}

        {/* ── Accordion セクション表示 ── */}
        {currentReport && useAccordion && (
          <div className="space-y-3">
            {sections.map((section) => (
              <div
                key={section.id}
                id={section.id}
                className="rounded-2xl border border-outline-variant/20 shadow-[0_4px_12px_-4px_rgba(26,26,46,0.06)] scroll-mt-20 overflow-x-hidden"
              >
                {section.kind === 'summary' ? (
                  /* Summary: 常に開いた状態、ボタンなし */
                  <div className="p-6">
                    <h3 className="text-lg font-bold text-on-surface japanese-text mb-4">{section.heading}</h3>
                    <MarkdownRenderer content={section.md} />
                  </div>
                ) : (
                  /* Report: 開閉可能 accordion */
                  <>
                    <button
                      onClick={() => toggleSection(section.id)}
                      aria-expanded={!!openSections[section.id]}
                      className={`w-full flex items-center justify-between px-6 py-4 text-left transition-colors ${
                        openSections[section.id]
                          ? 'bg-secondary/5 text-secondary'
                          : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container/40'
                      }`}
                    >
                      <span className="font-bold text-sm">{section.heading}</span>
                      <span
                        className="material-symbols-outlined text-base transition-transform duration-200"
                        style={{ transform: openSections[section.id] ? 'rotate(180deg)' : 'rotate(0deg)' }}
                      >
                        expand_more
                      </span>
                    </button>
                    {openSections[section.id] && (
                      <div className="p-6 border-t border-outline-variant/10">
                        <MarkdownRenderer content={section.md} />
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
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 space-y-6">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary">article</span>
              <h3 className="text-xl font-bold japanese-text">
                {selectedPeriod === 'all' ? '統合レポート' : `${selectedPeriod} レポート`}
              </h3>
            </div>
            <MarkdownRenderer content={currentReport} />
          </div>
        )}
      </div>
    </div>
  )
}
