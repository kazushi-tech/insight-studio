import { useMemo, useState } from 'react'
import { VERDICT_TOKENS_V2 } from './reportThemeV2'
import {
  AXIS_KEYS,
  findBrandSectionBodies,
  parseBrandVerdicts,
} from '../../../utils/brandEvalParser'
import styles from './CompetitorMatrixV2.module.css'

/**
 * Stitch 2.0 competitor matrix. Prefers `envelope.brand_evaluations[]`,
 * falls back to markdown parsing shared with v1 (brandEvalParser).
 *
 * Cells combine color (background) + symbol (foreground) so the chart
 * remains readable under color-vision differences.
 */

function fromEnvelope(evaluations) {
  if (!Array.isArray(evaluations) || evaluations.length === 0) return []
  return evaluations
    .map((e) => {
      const map = {}
      for (const a of e.axes || []) {
        if (!AXIS_KEYS.includes(a.axis)) continue
        map[a.axis] = {
          verdict: a.verdict ?? null,
          reason: a.reason ?? '',
          evidence: a.evidence ?? '',
        }
      }
      if (Object.keys(map).length === 0) return null
      return { brand: e.brand || '', verdicts: map }
    })
    .filter(Boolean)
}

function fromMd(reportMd) {
  const chunks = findBrandSectionBodies(reportMd)
  const rows = []
  for (const chunk of chunks) {
    const verdicts = parseBrandVerdicts(chunk.body)
    if (!verdicts) continue
    rows.push({ brand: chunk.title, verdicts })
  }
  return rows
}

export default function CompetitorMatrixV2({ envelope, reportMd }) {
  const rows = useMemo(() => {
    const fromEnv = fromEnvelope(envelope?.brand_evaluations)
    return fromEnv.length > 0 ? fromEnv : fromMd(reportMd)
  }, [envelope, reportMd])

  const [detail, setDetail] = useState(null)

  if (!rows.length) return null

  return (
    <section
      className={`${styles.panel} md-v2-enter`}
      aria-label="競合比較マトリクス"
      data-testid="competitor-matrix-v2"
    >
      <header className={styles.header}>
        <span className={styles.label}>Competitor Matrix — 競合比較</span>
      </header>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thBrand}>評価軸</th>
              {rows.map((row, ri) => (
                <th key={ri} className={styles.th} title={row.brand}>
                  <span className={styles.brandHead}>{row.brand}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AXIS_KEYS.map((axis) => (
              <tr key={axis}>
                <th scope="row" className={styles.rowHead} title={axis}>
                  <span className={styles.axisName}>{axis}</span>
                </th>
                {rows.map((row, ci) => {
                  const cell = row.verdicts[axis]
                  const verdict = cell?.verdict
                  const token = verdict ? VERDICT_TOKENS_V2[verdict] : null
                  return (
                    <td key={ci} className={styles.cellCell}>
                      <button
                        type="button"
                        className={styles.cellButton}
                        style={{
                          backgroundColor: token?.bg ?? 'var(--md-v2-verdict-pending-bg)',
                          color: token?.fg ?? 'var(--md-v2-verdict-pending-fg)',
                        }}
                        disabled={!cell}
                        onClick={() => cell && setDetail({ brand: row.brand, axis, cell })}
                        aria-label={`${row.brand} の ${axis} は ${verdict ?? '判定なし'}`}
                      >
                        <span aria-hidden="true" className={styles.symbol}>
                          {token?.symbol ?? '・'}
                        </span>
                        <span className={styles.verdictText}>{token?.label ?? '-'}</span>
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail && (
        <aside className={styles.detail} role="dialog" aria-label="評価詳細">
          <div className={styles.detailHeader}>
            <div>
              <div className={styles.detailBrand}>{detail.brand}</div>
              <div className={styles.detailAxis}>{detail.axis}</div>
            </div>
            <button
              type="button"
              className={styles.detailClose}
              onClick={() => setDetail(null)}
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>
          {detail.cell.reason && (
            <p className={styles.detailReason}>
              <span className={styles.detailTag}>根拠</span>
              {detail.cell.reason}
            </p>
          )}
          {detail.cell.evidence && (
            <p className={styles.detailEvidence}>
              <span className={styles.detailTag}>証拠</span>
              {detail.cell.evidence}
            </p>
          )}
        </aside>
      )}
    </section>
  )
}
