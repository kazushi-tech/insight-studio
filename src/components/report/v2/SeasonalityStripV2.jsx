import { useMemo } from 'react'
import { parseSeasonality } from '../../../utils/reportParsers'
import styles from './SeasonalityStripV2.module.css'

const MONTH_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']

export default function SeasonalityStripV2({ reportMd }) {
  const entries = useMemo(() => parseSeasonality(reportMd), [reportMd])

  if (!entries) return null

  const typeByMonth = {}
  for (const e of entries) {
    typeByMonth[e.month] = e.type
  }

  const hasPeak = entries.some((e) => e.type === 'peak')
  const hasOff = entries.some((e) => e.type === 'off')

  return (
    <section
      className={`${styles.panel} md-v2-enter`}
      aria-label="季節性ヒートストリップ"
      data-testid="seasonality-strip-v2"
    >
      <header className={styles.header}>
        <span className={styles.label}>Seasonality — 季節性</span>
        <div className={styles.legend} aria-hidden="true">
          {hasPeak && <span className={`${styles.legendDot} ${styles.peak}`} />}
          {hasPeak && <span className={styles.legendText}>ピーク</span>}
          {hasOff && <span className={`${styles.legendDot} ${styles.off}`} />}
          {hasOff && <span className={styles.legendText}>オフ</span>}
        </div>
      </header>

      <div className={styles.strip} role="list" aria-label="月別シーズン">
        {MONTH_LABELS.map((label, i) => {
          const month = i + 1
          const type = typeByMonth[month]
          return (
            <div
              key={month}
              role="listitem"
              className={`${styles.cell} ${type === 'peak' ? styles.cellPeak : type === 'off' ? styles.cellOff : styles.cellNeutral}`}
              aria-label={`${month}月: ${type === 'peak' ? 'ピーク' : type === 'off' ? 'オフ' : '通常'}`}
            >
              <span className={styles.monthLabel}>{label}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
