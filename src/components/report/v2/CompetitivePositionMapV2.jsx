import { useMemo } from 'react'
import { buildReportDecisionInsights } from '../../../utils/reportDecisionInsights'
import styles from './CompetitivePositionMapV2.module.css'

export default function CompetitivePositionMapV2({ envelope, reportMd, focusedBrand, onBrandSelect }) {
  const insights = useMemo(
    () => buildReportDecisionInsights({ envelope, reportMd }),
    [envelope, reportMd],
  )
  const brands = insights.brands.slice(0, 8)

  if (brands.length < 2) return null

  return (
    <section
      className={`${styles.panel} md-v2-enter`}
      aria-labelledby="competitive-position-map-v2-title"
      data-testid="competitive-position-map-v2"
    >
      <header className={styles.header}>
        <div>
          <span className={styles.label}>Competitor Position Map — 競合ポジション</span>
          <h2 id="competitive-position-map-v2-title" className={styles.title}>
            獲得導線 × 信頼訴求
          </h2>
        </div>
        <div className={styles.legend} aria-label="競合分類">
          <span><i className={styles.direct} />直接競合</span>
          <span><i className={styles.adjacent} />隣接/参考</span>
        </div>
      </header>

      <div className={styles.mapWrap}>
        <div className={styles.axisY}>信頼訴求・FV品質</div>
        <div className={styles.map} role="img" aria-label="横軸が獲得導線、縦軸が信頼訴求の競合ポジション図">
          <span className={styles.quadrantTopLeft}>信頼先行</span>
          <span className={styles.quadrantTopRight}>勝ち筋候補</span>
          <span className={styles.quadrantBottomLeft}>改善余地</span>
          <span className={styles.quadrantBottomRight}>獲得先行</span>
          {brands.map((brand, idx) => {
            const active = focusedBrand === brand.brand
            const isPrimary = brand.role.key === 'direct'
            return (
              <button
                type="button"
                key={`${brand.brand}-${idx}`}
                className={`${styles.point} ${isPrimary ? styles.pointDirect : styles.pointAdjacent} ${active ? styles.pointActive : ''}`}
                style={{
                  left: `${brand.x}%`,
                  bottom: `${brand.y}%`,
                }}
                onClick={() => onBrandSelect?.(brand.brand)}
                aria-pressed={active}
                aria-label={`${brand.brand}: ${brand.role.label}。獲得導線 ${brand.x}、信頼訴求 ${brand.y}`}
              >
                <span>{brand.brand}</span>
                <small>{brand.role.label}</small>
              </button>
            )
          })}
        </div>
        <div className={styles.axisX}>獲得導線・CTA明確性</div>
      </div>

      <div className={styles.notes}>
        {brands.slice(0, 3).map((brand) => (
          <div key={brand.brand} className={styles.note}>
            <span className="material-symbols-outlined" aria-hidden="true">{brand.role.icon}</span>
            <p>
              <strong>{brand.brand}</strong>
              <span>{brand.reason || `${brand.role.label}として比較。評価保留 ${brand.pendingCount} 件。`}</span>
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
