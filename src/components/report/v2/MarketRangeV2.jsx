import { useMemo } from 'react'
import ConfidencePill from './ConfidencePill'
import { extractMarketRanges } from '../../../utils/kpiExtractor'
import styles from './MarketRangeV2.module.css'

/**
 * Stitch 2.0 market range panel. Prefers `envelope.market_estimate` when
 * provided, falls back to the MD-only `extractMarketRanges` parser.
 */

function formatNumber(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  if (n >= 10000) return n.toLocaleString('ja-JP')
  if (Number.isInteger(n)) return n.toLocaleString('ja-JP')
  return n.toFixed(1)
}

const LOW_CONFIDENCE_TOKENS = ['低', 'low']
const WIDTH_MASK_RATIO = 10

function isLowConfidence(raw) {
  if (!raw) return false
  const text = String(raw).toLowerCase()
  return LOW_CONFIDENCE_TOKENS.some((t) => text.includes(t.toLowerCase()))
}

function rangeRatio(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return Infinity
  return max / min
}

function fromEnvelope(marketEstimate) {
  if (!marketEstimate || !Array.isArray(marketEstimate.ranges) || marketEstimate.ranges.length === 0) {
    return null
  }
  return {
    confidence: marketEstimate.confidence ?? '',
    ranges: marketEstimate.ranges.map((r) => ({
      label: r.label,
      min: r.min,
      max: r.max,
      unit: r.unit || '',
    })),
  }
}

function fromMd(reportMd) {
  const ranges = extractMarketRanges(reportMd)
  if (!ranges.length) return null
  return {
    confidence: ranges[0]?.confidence ?? '',
    ranges,
  }
}

function RangeRow({ label, min, max, unit, masked, ratio }) {
  const ceiling = max === 0 ? 1 : max
  const fillStart = (min / ceiling) * 100
  const fillEnd = 100

  if (masked) {
    return (
      <div className={`${styles.row} ${styles.rowMasked}`} data-testid="market-range-masked">
        <div className={styles.rowHead}>
          <span className={styles.rowLabel}>{label}</span>
          <span className={`${styles.rowValue} ${styles.rowMaskedValue}`}>
            推定根拠不足（low信頼・幅{ratio.toFixed(1)}×）
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.rowLabel}>{label}</span>
        <span className={styles.rowValue}>
          <span className={styles.rowNumber}>
            {formatNumber(min)}〜{formatNumber(max)}
          </span>
          {unit && <span className={styles.rowUnit}>{unit}</span>}
        </span>
      </div>
      <div className={styles.track} aria-hidden="true">
        <div
          className={styles.fill}
          style={{ left: `${fillStart}%`, right: `${100 - fillEnd}%` }}
        />
        <div className={styles.tickMin} style={{ left: `${fillStart}%` }} />
        <div className={styles.tickMax} style={{ left: `calc(${fillEnd}% - 2px)` }} />
      </div>
    </div>
  )
}

export default function MarketRangeV2({ envelope, reportMd }) {
  const data = useMemo(() => {
    return fromEnvelope(envelope?.market_estimate) ?? fromMd(reportMd)
  }, [envelope, reportMd])

  if (!data) return null

  return (
    <section
      className={`${styles.panel} md-v2-enter`}
      aria-label="市場推定レンジ"
      data-testid="market-range-v2"
    >
      <header className={styles.header}>
        <span className={styles.label}>Market Estimate — 市場推定レンジ</span>
        {data.confidence && <ConfidencePill confidence={data.confidence} />}
      </header>

      <div className={styles.rows}>
        {data.ranges.map((r, i) => {
          const ratio = rangeRatio(r.min, r.max)
          const masked = isLowConfidence(data.confidence) && ratio >= WIDTH_MASK_RATIO
          return <RangeRow key={i} {...r} masked={masked} ratio={ratio} />
        })}
      </div>
    </section>
  )
}
