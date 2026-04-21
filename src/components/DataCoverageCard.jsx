import { useMemo } from 'react'

const FIELD_LABELS = {
  title: 'タイトル',
  meta_description: 'Meta Description',
  og_type: 'OG Type',
  h1: 'H1',
  hero_copy: 'Hero Copy',
  main_cta: 'Main CTA',
  secondary_ctas: 'Secondary CTAs',
  pricing_snippet: 'Pricing',
  feature_bullets: 'Features',
  faq_items: 'FAQ',
  testimonials: '顧客の声',
  body_text_snippet: '本文抜粋',
}

const CRITICAL_FIELDS = ['pricing_snippet', 'main_cta']

function hasValue(v) {
  if (v == null || v === '') return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}

function getHostname(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return url || '?' }
}

function CoverageBar({ ratio }) {
  const pct = Math.round(ratio * 100)
  const color = pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function ScoreLabel({ ratio }) {
  const pct = Math.round(ratio * 100)
  if (pct >= 70) return <span className="text-xs font-bold text-emerald-700 dark:text-on-success-container">高信頼</span>
  if (pct >= 50) return <span className="text-xs font-bold text-amber-700 dark:text-on-warning-container">注意</span>
  return <span className="text-xs font-bold text-red-700 dark:text-on-error-container">低信頼</span>
}

export default function DataCoverageCard({ extracted, className = '' }) {
  const siteStats = useMemo(() => {
    const items = Array.isArray(extracted) ? extracted : extracted ? [extracted] : []
    return items.map((site, i) => {
      const total = Object.keys(FIELD_LABELS).length
      const available = Object.entries(FIELD_LABELS).filter(([key]) => hasValue(site[key]))
      const missing = Object.entries(FIELD_LABELS).filter(([key]) => !hasValue(site[key]))
      const criticalMissing = missing.filter(([key]) => CRITICAL_FIELDS.includes(key))
      const ratio = total > 0 ? available.length / total : 0

      return {
        url: site.url,
        hostname: getHostname(site.url || `site-${i}`),
        total,
        availableCount: available.length,
        missingFields: missing.map(([key, label]) => ({ key, label })),
        criticalMissing: criticalMissing.map(([key, label]) => ({ key, label })),
        ratio,
      }
    })
  }, [extracted])

  if (siteStats.length === 0) return null

  const avgRatio = siteStats.reduce((sum, s) => sum + s.ratio, 0) / siteStats.length
  const avgPct = Math.round(avgRatio * 10 * 10) / 10
  const hasCriticalGaps = siteStats.some((s) => s.criticalMissing.length > 0)

  return (
    <div className={`bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/8 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary text-lg">data_usage</span>
          <span className="text-sm font-bold text-on-surface">データカバレッジ</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-on-surface-variant">平均取得率</span>
          <span className="text-sm font-black tabular-nums text-on-surface">{avgPct}/10</span>
          <ScoreLabel ratio={avgRatio} />
        </div>
      </div>

      {hasCriticalGaps && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-warning-container border border-amber-200 dark:border-warning/30 rounded-xl text-xs text-amber-800 dark:text-on-warning-container">
          <span className="material-symbols-outlined text-sm text-amber-500">warning</span>
          <span>一部評価が不完全データに基づく可能性があります（pricing_snippet, main_cta 欠損）</span>
        </div>
      )}

      <div className="space-y-3">
        {siteStats.map((stat, i) => (
          <div key={stat.url || i} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-on-surface truncate max-w-[60%]">{stat.hostname}</span>
              <span className="text-on-surface-variant tabular-nums">{stat.availableCount}/{stat.total} 取得成功</span>
            </div>
            <CoverageBar ratio={stat.ratio} />
            {stat.criticalMissing.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {stat.criticalMissing.map(({ key, label }) => (
                  <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 dark:bg-error-container text-red-600 dark:text-error rounded-full text-[10px] font-bold">
                    <span className="material-symbols-outlined text-[10px]">close</span>
                    {label} 未取得
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
