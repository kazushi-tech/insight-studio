import { useUiVersion } from '../../../hooks/useUiVersion'
import styles from './UiVersionToggle.module.css'

/**
 * Surface `?ui=v1 | v2` as a small pill toggle. Writes via `useUiVersion`
 * which keeps localStorage + URL in sync.
 */

export default function UiVersionToggle({ className = '' }) {
  const { version, setUiVersion } = useUiVersion()
  return (
    <div className={`${styles.toggle} ${className}`} role="radiogroup" aria-label="レポートUIバージョン">
      <button
        type="button"
        role="radio"
        aria-checked={version === 'v1'}
        className={`${styles.option} ${version === 'v1' ? styles.active : ''}`}
        onClick={() => setUiVersion('v1')}
      >
        v1
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={version === 'v2'}
        className={`${styles.option} ${version === 'v2' ? styles.active : ''}`}
        onClick={() => setUiVersion('v2')}
      >
        v2 <span className={styles.badge}>NEW</span>
      </button>
    </div>
  )
}
