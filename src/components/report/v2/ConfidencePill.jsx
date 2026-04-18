import styles from './ConfidencePill.module.css'

/**
 * Small pill surfacing the deterministic market-estimate confidence band.
 * Colors ride the v2 token palette so light/dark confidence reads cleanly.
 */

const LEVEL_MAP = {
  高: { variant: 'high', label: '高' },
  中: { variant: 'medium', label: '中' },
  低: { variant: 'low', label: '低' },
}

function classifyConfidence(raw) {
  if (!raw) return { variant: 'unknown', label: '不明' }
  for (const [key, v] of Object.entries(LEVEL_MAP)) {
    if (raw.includes(key)) return v
  }
  return { variant: 'medium', label: raw }
}

export default function ConfidencePill({ confidence }) {
  const { variant, label } = classifyConfidence(confidence)
  return (
    <span
      className={`${styles.pill} ${styles[variant] ?? ''}`}
      aria-label={`信頼度 ${label}`}
    >
      <span className={styles.dot} aria-hidden="true" />
      信頼度 {label}
    </span>
  )
}
