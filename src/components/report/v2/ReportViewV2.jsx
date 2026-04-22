import { useEffect, useMemo, useRef, useState } from 'react'
import './tokens.css'
import printStyles from './print.module.css'
import PriorityActionHeroV2 from './PriorityActionHeroV2'
import CompetitorMatrixV2 from './CompetitorMatrixV2'
import BrandRadarV2 from './BrandRadarV2'
import MarketRangeV2 from './MarketRangeV2'
import styles from './ReportViewV2.module.css'
import { makeHeadingSlug } from '../../../utils/headingSlug'

function extractHeadings(md) {
  if (!md) return []
  const headings = []
  const seenIds = new Map()
  for (const line of md.split('\n')) {
    const m = line.match(/^(#{1,3})\s+(.+)/)
    if (m) {
      const level = m[1].length
      const title = m[2].replace(/\*\*/g, '').trim()
      if (!title) continue
      const slug = makeHeadingSlug(title)
      const count = seenIds.get(slug) ?? 0
      seenIds.set(slug, count + 1)
      const id = count === 0 ? slug : slug + '-' + (count + 1)
      if (level === 2) {
        headings.push({ id, title, level })
      }
    }
  }
  return headings
}

export default function ReportViewV2({ envelope, reportMd }) {
  const headings = useMemo(() => extractHeadings(reportMd), [reportMd])
  const [activeId, setActiveId] = useState('')
  const tocRef = useRef(null)

  // IntersectionObserver to highlight current section in TOC
  useEffect(() => {
    if (!headings.length || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id)
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    )
    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [headings])

  return (
    <div className={`ui-v2 ${printStyles.printRoot} ${styles.root}`}>
      <PriorityActionHeroV2 envelope={envelope} reportMd={reportMd} />
      <MarketRangeV2 envelope={envelope} reportMd={reportMd} />
      <div className={styles.tocLayout}>
        {/* Section D-6: Sticky TOC sidebar (desktop only) */}
        {headings.length > 0 && (
          <nav className={`${styles.toc} ${printStyles.hideInPrint}`} aria-label="目次" ref={tocRef} aria-hidden="true">
            <div style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem', color: 'var(--md-sys-color-on-surface-variant, #49454f)' }}>
              目次
            </div>
            {headings.map((h) => (
              <button
                type="button"
                key={h.id}
                data-toc-link
                className={`${styles.tocItem} ${activeId === h.id ? styles.tocItemActive : ''}`}
                onClick={() => {
                  document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                {h.title}
              </button>
            ))}
          </nav>
        )}
        <div>
          <div className={styles.grid}>
            <CompetitorMatrixV2 envelope={envelope} reportMd={reportMd} />
            <BrandRadarV2 envelope={envelope} reportMd={reportMd} />
          </div>
        </div>
      </div>
    </div>
  )
}
