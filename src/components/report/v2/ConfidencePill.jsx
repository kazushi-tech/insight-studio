import styles from './ConfidencePill.module.css'

/**
 * Small pill surfacing the deterministic market-estimate confidence band.
 * Uses 3-dot visualization (● ● ○ for low, ● ● ○ for medium, ● ● ● for
 * high) so the confidence level is legible at a glance without reading
 * the text label.
 */

const LEVEL_MAP = {
  高: { variant: 'high', label: '高', filled: 3 },
  中: { variant: 'medium', label: '中', filled: 2 },
  低: { variant: 'low', label: '低', filled: 1 },
  high: { variant: 'high', label: '高', filled: 3 },
  medium: { variant: 'medium', label: '中', filled: 2 },
  low: { variant: 'low', label: '低', filled: 1 },
}

function classifyConfidence(raw) {
  if (!raw) return { variant: 'unknown', label: '不明', filled: 0 }
  const lower = String(raw).toLowerCase()
  for (const [key, v] of Object.entries(LEVEL_MAP)) {
    if (raw.includes(key) || lower.includes(key.toLowerCase())) return v
  }
  return { variant: 'medium', label: raw, filled: 2 }
}

export default function ConfidencePill({ confidence }) {
  const { variant, label, filled } = classifyConfidence(confidence)
  return (
    <span
      className={`${styles.pill} ${styles[variant] ?? ''}`}
      aria-label={`信頼度 ${label}`}
      data-testid="confidence-pill"
    >
      <span className={styles.dots} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`${styles.dot} ${i < filled ? styles.dotFilled : styles.dotEmpty}`}
          />
        ))}
      </span>
      信頼度 {label}
    </span>
  )
}
