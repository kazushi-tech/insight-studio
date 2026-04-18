import { useMemo } from 'react'
import { extractMarketRanges } from '../../utils/kpiExtractor'
import { REPORT_COLORS } from './reportTheme'

/**
 * Horizontal range bars for market size / search volume / CPC / CVR / ad spend.
 * Visualizes the deterministic market estimate block that the backend injects.
 */

function formatNumber(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  if (n >= 10000) return n.toLocaleString('ja-JP')
  if (Number.isInteger(n)) return n.toLocaleString('ja-JP')
  return n.toFixed(1)
}

function RangeRow({ label, min, max, unit, colorVar }) {
  // Use the max of this group as the scale ceiling × 1.2 for visual headroom.
  // But each bar should show its own range relative to 0..max of itself × some scale.
  const maxDisplay = max === 0 ? 1 : max
  const fillStart = (min / maxDisplay) * 100
  const fillEnd = 100
  const bgColor = colorVar || REPORT_COLORS.primaryFixedDim

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-bold text-on-surface japanese-text">{label}</span>
        <span className="text-on-surface-variant tabular-nums font-mono">
          {formatNumber(min)}〜{formatNumber(max)} <span className="text-[10px] ml-1">{unit}</span>
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-surface-container-low overflow-hidden">
        <div
          className="absolute top-0 bottom-0 rounded-full"
          style={{
            left: `${fillStart}%`,
            right: `${100 - fillEnd}%`,
            backgroundColor: bgColor,
          }}
          aria-hidden="true"
        />
        <div
          className="absolute top-0 bottom-0 w-[2px] rounded"
          style={{
            left: `${fillStart}%`,
            backgroundColor: REPORT_COLORS.primary,
          }}
          aria-hidden="true"
        />
        <div
          className="absolute top-0 bottom-0 w-[2px] rounded"
          style={{
            left: `${fillEnd - 0.2}%`,
            backgroundColor: REPORT_COLORS.primary,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

export default function MarketRangeBar({ reportMd }) {
  const ranges = useMemo(() => extractMarketRanges(reportMd), [reportMd])

  if (!ranges.length) return null

  const confidence = ranges[0]?.confidence

  return (
    <section
      className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/15 print:break-inside-avoid"
      aria-label="市場推定レンジ"
    >
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: '20px' }}>
            insights
          </span>
          <span className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface-variant">
            市場推定レンジ（【市場推定】）
          </span>
        </div>
        {confidence && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
            信頼度: {confidence}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {ranges.map((r, i) => (
          <RangeRow key={i} {...r} />
        ))}
      </div>
    </section>
  )
}
