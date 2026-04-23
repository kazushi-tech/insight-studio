import { useMemo } from 'react'
import { parseAdSpendRanges } from '../../../utils/reportParsers'
import styles from './AdSpendComparisonV2.module.css'

function formatManyen(value) {
  if (!Number.isFinite(value)) return ''
  if (value >= 10000) return `${(value / 10000).toFixed(1)}億`
  return `${value.toLocaleString('ja-JP')}万`
}

export default function AdSpendComparisonV2({ reportMd }) {
  const rows = useMemo(() => parseAdSpendRanges(reportMd), [reportMd])

  if (!rows.length) return null

  const maxVal = Math.max(...rows.map((r) => r.max))
  if (maxVal <= 0) return null

  return (
    <section
      className={`${styles.panel} md-v2-enter`}
      aria-label="競合広告投資比較"
      data-testid="ad-spend-comparison-v2"
    >
      <header className={styles.header}>
        <span className={styles.label}>Ad Spend — 広告投資推定比較</span>
      </header>

      <div className={styles.rows}>
        {rows.map((row, i) => {
          const fillStart = (row.min / maxVal) * 100
          const fillEnd = (row.max / maxVal) * 100
          return (
            <div key={i} className={styles.row}>
              <div className={styles.rowHead}>
                <span className={styles.brandName}>{row.brand}</span>
                <span className={styles.rowValue}>
                  {formatManyen(row.min)}〜{formatManyen(row.max)}
                  <span className={styles.unit}>{row.unit}</span>
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
        })}
      </div>
    </section>
  )
}
