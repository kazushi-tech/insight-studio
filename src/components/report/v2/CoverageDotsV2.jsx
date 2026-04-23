import { useMemo } from 'react'
import { parseCoverageTable } from '../../../utils/reportParsers'
import styles from './CoverageDotsV2.module.css'

function rateToLevel(rate) {
  if (rate === null || rate === undefined) return 'unknown'
  if (rate >= 80) return 'high'
  if (rate >= 50) return 'mid'
  return 'low'
}

function formatRate(rate) {
  if (rate === null || rate === undefined) return '—'
  return `${Math.round(rate)}%`
}

export default function CoverageDotsV2({ reportMd }) {
  const rows = useMemo(() => parseCoverageTable(reportMd), [reportMd])

  if (!rows.length) return null

  return (
    <section
      className={`${styles.panel} md-v2-enter`}
      aria-label="データカバレッジ"
      data-testid="coverage-dots-v2"
    >
      <header className={styles.header}>
        <span className={styles.label}>Data Coverage — データ取得率</span>
      </header>

      <div className={styles.grid}>
        {rows.map((row, i) => {
          const level = row.level
            ? row.level.toLowerCase().includes('高') || row.level.toLowerCase().includes('high')
              ? 'high'
              : row.level.toLowerCase().includes('中') || row.level.toLowerCase().includes('med')
                ? 'mid'
                : 'low'
            : rateToLevel(row.rate)

          return (
            <div key={i} className={styles.card}>
              <div className={styles.brandName}>{row.brand}</div>
              <div className={styles.barWrap} aria-hidden="true">
                <div
                  className={`${styles.bar} ${styles[`bar_${level}`]}`}
                  style={{ width: row.rate != null ? `${Math.min(100, row.rate)}%` : '0%' }}
                />
              </div>
              <div className={styles.meta}>
                <span className={`${styles.rateBadge} ${styles[`badge_${level}`]}`}>
                  {formatRate(row.rate)}
                </span>
                {row.level && <span className={styles.levelText}>{row.level}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
