import './tokens.css'
import printStyles from './print.module.css'
import PriorityActionHeroV2 from './PriorityActionHeroV2'
import CompetitorMatrixV2 from './CompetitorMatrixV2'
import BrandRadarV2 from './BrandRadarV2'
import MarketRangeV2 from './MarketRangeV2'
import styles from './ReportViewV2.module.css'

/**
 * Stitch 2.0 report view. Activated by `?ui=v2` (see `useUiVersion`).
 *
 * v1 is untouched — a page renders either <ReportViewV1 /> or this, never
 * both. Envelope is preferred, markdown fallback is always wired so the
 * component is safe even when the backend flag is off.
 */

export default function ReportViewV2({ envelope, reportMd }) {
  return (
    <div className={`ui-v2 ${printStyles.printRoot} ${styles.root}`}>
      <PriorityActionHeroV2 envelope={envelope} reportMd={reportMd} />
      <MarketRangeV2 envelope={envelope} reportMd={reportMd} />
      <div className={styles.grid}>
        <CompetitorMatrixV2 envelope={envelope} reportMd={reportMd} />
        <BrandRadarV2 envelope={envelope} reportMd={reportMd} />
      </div>
    </div>
  )
}
