import { useMemo, useState } from 'react'
import { BRAND_PALETTE_V2 } from './reportThemeV2'
import RadarChartSvg from '../RadarChartSvg'
import {
  AXIS_KEYS,
  findBrandSectionBodies,
  parseBrandVerdicts,
} from '../../../utils/brandEvalParser'
import { getRoleMeta } from '../../../utils/reportDecisionInsights'
import styles from './BrandRadarV2.module.css'

const VERDICT_SCORE = {
  強: 1.0,
  同等: 0.5,
  弱: 0.0,
  評価保留: null,
}

function fromEnvelope(evaluations) {
  if (!Array.isArray(evaluations) || evaluations.length === 0) return []
  return evaluations
    .map((e) => {
      const role = getRoleMeta(e.role || e.competitor_tier)
      if (role.key === 'out_of_scope') return null
      const scores = {}
      for (const a of e.axes || []) {
        if (!AXIS_KEYS.includes(a.axis)) continue
        scores[a.axis] = VERDICT_SCORE[a.verdict] ?? null
      }
      return Object.keys(scores).length
        ? { brand: e.brand, scores, isReference: role.key === 'reference' || role.key === 'adjacent' }
        : null
    })
    .filter(Boolean)
}

function fromMd(reportMd) {
  const chunks = findBrandSectionBodies(reportMd)
  const brands = []
  for (const c of chunks) {
    const verdicts = parseBrandVerdicts(c.body)
    if (!verdicts) continue
    const scores = {}
    for (const [axis, cell] of Object.entries(verdicts)) {
      const verdict = cell.verdict ?? '評価保留'
      scores[axis] = VERDICT_SCORE[verdict] ?? null
    }
    if (Object.keys(scores).length === 0) continue
    brands.push({ brand: c.title, scores })
  }
  return brands
}

export default function BrandRadarV2({ envelope, reportMd, focusedBrand }) {
  const brands = useMemo(() => {
    const envBrands = fromEnvelope(envelope?.brand_evaluations)
    return envBrands.length > 0 ? envBrands : fromMd(reportMd)
  }, [envelope, reportMd])

  // F-04: pill toggle — track hidden brands set
  const [hiddenBrands, setHiddenBrands] = useState(new Set())

  // Phase 1: when focusedBrand is set, override pill-based hiddenBrands
  // Derived instead of setState-in-effect to avoid cascading renders
  const effectiveHiddenBrands = useMemo(() => {
    if (!focusedBrand) return hiddenBrands
    const referenceBrands = new Set(brands.filter((b) => b.isReference).map((b) => b.brand))
    return new Set(brands.map((b) => b.brand).filter((n) => n !== focusedBrand && !referenceBrands.has(n)))
  }, [focusedBrand, brands, hiddenBrands])

  if (!brands.length) return null

  return (
    <section
      id="brand-radar-v2"
      className={`${styles.panel} md-v2-enter`}
      aria-label="ブランド別レーダー"
      data-testid="brand-radar-v2"
    >
      <header className={styles.header}>
        <span className={styles.label}>Brand Radar — 6軸評価</span>
        <div className={styles.toggleGroup} role="group" aria-label="ブランド表示切替">
          {brands.map((b) => {
            const isHidden = effectiveHiddenBrands.has(b.brand)
            return (
              <button
                key={b.brand}
                type="button"
                aria-pressed={!isHidden}
                onClick={() => {
                  setHiddenBrands((prev) => {
                    const next = new Set(prev)
                    if (next.has(b.brand)) next.delete(b.brand)
                    else next.add(b.brand)
                    return next
                  })
                }}
                className={`${styles.toggle} ${isHidden ? styles.toggleHidden : styles.toggleActive} ${b.isReference ? styles.toggleReference : ''}`}
                title={b.isReference ? `${b.brand}（参考観測）` : b.brand}
              >
                {b.brand}
                {b.isReference && <span className={styles.refMark}>参考</span>}
              </button>
            )
          })}
        </div>
      </header>

      <div className={styles.canvasWrap}>
        <RadarChartSvg
          axes={AXIS_KEYS}
          series={brands
            .filter((brand) => !effectiveHiddenBrands.has(brand.brand))
            .map((brand, index) => {
              const color = BRAND_PALETTE_V2[index % BRAND_PALETTE_V2.length]
              const isFocused = !focusedBrand || focusedBrand === brand.brand || brand.isReference
              return {
                name: brand.brand,
                values: AXIS_KEYS.map((key) => brand.scores[key] ?? null),
                stroke: color.border,
                fill: brand.isReference
                  ? color.bg.replace(/,[^,]+\)$/, ', 0.12)')
                  : color.bg,
                dashed: brand.isReference,
                dimmed: !isFocused,
                emphasized: isFocused,
              }
            })}
        />
      </div>
    </section>
  )
}
