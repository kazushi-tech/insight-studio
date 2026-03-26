import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { generateInsights } from '../api/adsInsights'
import { useAuth } from '../contexts/AuthContext'
import { useAdsSetup } from '../contexts/AdsSetupContext'

const SECTION_CONFIG = [
  {
    navLabel: 'サマリー',
    icon: 'grid_view',
    title: '全体サマリー',
    subtitle: '主要指標の概況と前月比推移',
  },
  {
    navLabel: 'トラフィック',
    icon: 'public',
    title: 'トラフィック分析',
    subtitle: 'デバイス別・時間帯別の流入傾向',
  },
  {
    navLabel: 'コンバージョン',
    icon: 'conversion_path',
    title: 'コンバージョン考察',
    subtitle: '成果に繋がったキーワードとクリエイティブの分析',
  },
  {
    navLabel: 'ROI分析',
    icon: 'monetization_on',
    title: 'ROI・費用対効果',
    subtitle: '投資に対する利益率の算出と将来予測',
  },
]

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeSections(rawSections) {
  const sections = Array.isArray(rawSections) ? rawSections : []

  return SECTION_CONFIG.map((config, index) => {
    const section = sections[index] ?? {}

    return {
      ...config,
      ...section,
      metrics: Array.isArray(section.metrics) ? section.metrics : [],
      devices: Array.isArray(section.devices) ? section.devices : [],
      table: Array.isArray(section.table) ? section.table : [],
    }
  })
}

function pickText(...values) {
  return values.find(isText) ?? null
}

function sectionHasStructuredData(section) {
  return (
    section.metrics.length > 0 ||
    section.devices.length > 0 ||
    section.table.length > 0 ||
    isText(section.summary) ||
    isText(section.report) ||
    isText(section.content) ||
    isText(section.description) ||
    isText(section.body)
  )
}

export default function EssentialPack() {
  const { isAdsAuthenticated } = useAuth()
  const { setupState } = useAdsSetup()
  const [activeNav, setActiveNav] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [insights, setInsights] = useState(null)
  const autoRequestedKeyRef = useRef(null)

  const requestKey = useMemo(() => {
    if (!setupState) return null

    return [
      setupState.completedAt,
      setupState.granularity,
      ...(setupState.queryTypes ?? []),
      '::',
      ...(setupState.periods ?? []),
    ].join('|')
  }, [setupState])

  useEffect(() => {
    setActiveNav(0)
    setError(null)
    setInsights(null)
    autoRequestedKeyRef.current = null
  }, [requestKey])

  const handleGenerate = useCallback(async () => {
    if (!isAdsAuthenticated || !setupState || loading) return

    setError(null)
    setLoading(true)
    try {
      const data = await generateInsights({
        type: 'essential_pack',
        query_types: setupState.queryTypes,
        periods: setupState.periods,
        granularity: setupState.granularity,
      })
      setInsights(data)
    } catch (e) {
      setError(e.message)
      setInsights(null)
    } finally {
      setLoading(false)
    }
  }, [isAdsAuthenticated, loading, setupState])

  useEffect(() => {
    if (!requestKey || !isAdsAuthenticated) return
    if (autoRequestedKeyRef.current === requestKey) return

    autoRequestedKeyRef.current = requestKey
    void handleGenerate()
  }, [handleGenerate, isAdsAuthenticated, requestKey])

  const report = pickText(
    insights?.report,
    insights?.analysis,
    insights?.content,
    insights?.response,
  )
  const insightSummary = pickText(insights?.summary, insights?.ai_insight)
  const displaySections = normalizeSections(insights?.sections)
  const visibleSection = displaySections[activeNav]
  const sectionText = visibleSection
    ? pickText(
        visibleSection.summary,
        visibleSection.report,
        visibleSection.content,
        visibleSection.description,
        visibleSection.body,
      )
    : null
  const hasStructuredSections = displaySections.some(sectionHasStructuredData)
  const hasVisibleStructuredData = visibleSection ? sectionHasStructuredData(visibleSection) : false

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <div className="w-[280px] bg-surface-container-lowest border-r border-surface-container p-6 space-y-6">
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
            </div>
          </div>
        )}

        <div>
          <h4 className="text-sm font-bold text-[#1A1A2E] mb-3 japanese-text">レポート構成</h4>
          <nav className="flex flex-col gap-1">
            {displaySections.map((section, index) => (
              <button
                key={section.navLabel}
                onClick={() => setActiveNav(index)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all text-left ${
                  index === activeNav
                    ? 'bg-secondary/10 text-secondary font-bold'
                    : 'text-on-surface-variant hover:bg-surface-container'
                }`}
              >
                <span className="material-symbols-outlined text-lg">{section.icon}</span>
                {section.navLabel}
              </button>
            ))}
          </nav>
        </div>

        {!isAdsAuthenticated && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
            <span className="material-symbols-outlined text-sm align-middle mr-1">warning</span>
            考察スタジオへのログインが必要です
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={loading || !isAdsAuthenticated || !setupState}
          className="w-full py-3 bg-secondary text-on-secondary rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
              生成中…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-sm">smart_toy</span>
              {insights ? 'AI考察を再生成' : 'AI考察を生成'}
            </>
          )}
        </button>

        {insightSummary && (
          <div className="bg-secondary p-5 rounded-2xl text-on-secondary">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined">smart_toy</span>
              <span className="font-bold text-sm">AI INSIGHT</span>
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
          <h2 className="text-2xl font-extrabold text-[#1A1A2E] japanese-text">広告考察レポート</h2>
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

        {loading && !insights && (
          <div className="flex items-center justify-center py-16 gap-3 text-on-surface-variant bg-surface-container-lowest rounded-2xl">
            <span className="material-symbols-outlined text-2xl animate-spin">progress_activity</span>
            <span className="text-sm japanese-text">BigQuery 読み込み結果をもとに AI 考察を生成中…</span>
          </div>
        )}

        {!loading && !error && !insights && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-8 text-center space-y-3">
            <span className="material-symbols-outlined text-5xl text-outline-variant">analytics</span>
            <h3 className="text-xl font-bold japanese-text">考察レポートを生成中です</h3>
            <p className="text-sm text-on-surface-variant japanese-text">
              セットアップ条件に基づいて backend から要点パックを取得します。返却がない場合はエラーをそのまま表示します。
            </p>
          </div>
        )}

        {report && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-4">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary">auto_awesome</span>
              <div>
                <h3 className="text-xl font-bold japanese-text">AI生成レポート</h3>
                <p className="text-sm text-on-surface-variant">考察スタジオが返した本文をそのまま表示しています</p>
              </div>
            </div>
            <div className="text-sm text-on-surface-variant leading-relaxed whitespace-pre-wrap japanese-text">{report}</div>
          </div>
        )}

        {insights && !hasStructuredSections && !report && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-6 py-5 text-sm text-amber-800">
            backend から構造化セクションも本文も返っていません。固定ダミーは表示せず、この状態をそのまま示しています。
          </div>
        )}

        {insights && visibleSection && (
          <div className="bg-surface-container-lowest rounded-2xl shadow-[0_24px_48px_-12px_rgba(26,26,46,0.08)] p-6 space-y-5">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary">{visibleSection.icon}</span>
              <div>
                <h3 className="text-xl font-bold japanese-text">{visibleSection.title}</h3>
                <p className="text-sm text-on-surface-variant">{visibleSection.subtitle}</p>
              </div>
            </div>

            {sectionText && (
              <div className="bg-surface-container rounded-xl px-5 py-4 text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap japanese-text">
                {sectionText}
              </div>
            )}

            {activeNav === 0 && visibleSection.metrics.length > 0 && (
              <div className="grid grid-cols-3 gap-4">
                {visibleSection.metrics.map((metric, index) => (
                  <div key={`${metric.label ?? 'metric'}-${index}`} className="bg-surface-container rounded-xl p-4">
                    <p className="text-xs text-on-surface-variant font-bold uppercase tracking-wider">{metric.label ?? `指標 ${index + 1}`}</p>
                    <div className="flex items-baseline gap-2 mt-2">
                      <span className="text-3xl font-black tabular-nums text-primary">{metric.value ?? '-'}</span>
                      {metric.change && <span className="text-sm font-bold text-secondary">{metric.change}</span>}
                      {metric.tag && <span className="text-xs px-2 py-0.5 bg-surface-container-high rounded font-bold">{metric.tag}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeNav === 1 && visibleSection.devices.length > 0 && (
              <div className="space-y-3">
                {visibleSection.devices.map((device, index) => (
                  <div key={`${device.label ?? 'device'}-${index}`} className="flex items-center gap-4">
                    <span className="text-sm w-32 japanese-text">{device.label ?? `項目 ${index + 1}`}</span>
                    <div className="flex-1 h-3 bg-surface-container rounded-full overflow-hidden">
                      <div
                        className="h-full bg-secondary rounded-full"
                        style={{ width: `${Math.max(0, Math.min(Number(device.value) || 0, 100))}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold tabular-nums w-12 text-right">{device.value ?? 0}%</span>
                  </div>
                ))}
              </div>
            )}

            {activeNav === 2 && visibleSection.table.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-on-surface-variant border-b border-surface-container">
                    <th className="py-3 text-left font-bold">広告セット名</th>
                    <th className="py-3 text-right font-bold">CV数</th>
                    <th className="py-3 text-right font-bold">CVR</th>
                    <th className="py-3 text-right font-bold">CPA</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSection.table.map((row, index) => (
                    <tr key={`${row.name ?? 'row'}-${index}`} className="border-b border-surface-container/50">
                      <td className="py-3 font-bold japanese-text">{row.name ?? '-'}</td>
                      <td className="py-3 text-right tabular-nums">{row.cv ?? '-'}</td>
                      <td className="py-3 text-right tabular-nums">{row.cvr ?? '-'}</td>
                      <td className="py-3 text-right tabular-nums">{row.cpa ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!hasVisibleStructuredData && (
              <div className="bg-surface-container rounded-xl px-5 py-4 text-sm text-on-surface-variant japanese-text">
                このセクションの構造化データは backend から返っていません。固定ダミーは表示せず、返却済みの本文のみを上部に表示しています。
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
