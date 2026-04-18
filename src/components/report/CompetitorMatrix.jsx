import { useMemo, useState } from 'react'
import { HEATMAP_GRADIENT } from './reportTheme'
import JudgmentBadge from './JudgmentBadge'
import EvidenceDetail from './EvidenceDetail'
import {
  AXIS_KEYS,
  findBrandSectionBodies,
  parseBrandVerdicts,
} from '../../utils/brandEvalParser'

/**
 * Heatmap-style competitor matrix: brands (rows) × 6 evaluation axes (cols).
 * Parses per-brand evaluation tables from section 4 of the report:
 *
 *   ### brand.example
 *   | 評価軸 | 判定 | 根拠 | 証拠強度 |
 *   | --- | --- | --- | --- |
 *   | 検索意図一致 | 強 | ... | 確認済み |
 *
 * Returns null when no parseable brand tables are found, so the page layout
 * is unchanged on unsupported reports.
 */

function parseMatrix(reportMd) {
  const brandChunks = findBrandSectionBodies(reportMd)
  const rows = []
  for (const chunk of brandChunks) {
    const verdicts = parseBrandVerdicts(chunk.body)
    if (!verdicts) continue
    rows.push({ brand: chunk.title, verdicts })
  }
  return rows
}

function cellColor(verdict) {
  if (verdict === '強') return HEATMAP_GRADIENT[5]
  if (verdict === '同等') return HEATMAP_GRADIENT[3]
  if (verdict === '弱') return HEATMAP_GRADIENT[1]
  return HEATMAP_GRADIENT[0]
}

function cellTextColor(verdict) {
  if (verdict === '強' || verdict === '同等') return '#ffffff'
  return '#14532d'
}

export default function CompetitorMatrix({ reportMd }) {
  const rows = useMemo(() => parseMatrix(reportMd), [reportMd])
  const [active, setActive] = useState(null)
  const [detail, setDetail] = useState(null)

  if (!rows || rows.length === 0) return null

  return (
    <section
      className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant/15 print:break-inside-avoid"
      aria-label="競合比較ヒートマップ"
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined text-primary" style={{ fontSize: '20px' }}>grid_on</span>
        <span className="text-xs font-bold uppercase tracking-[0.15em] text-on-surface-variant">競合比較ヒートマップ</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="text-left p-2 font-bold text-on-surface-variant sticky left-0 bg-surface-container-lowest">ブランド</th>
              {AXIS_KEYS.map((axis) => (
                <th key={axis} className="text-center p-2 font-bold text-on-surface-variant whitespace-nowrap">
                  {axis}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td className="p-2 font-semibold text-on-surface whitespace-nowrap sticky left-0 bg-surface-container-lowest border-r border-outline-variant/15">
                  <div className="max-w-[12rem] truncate" title={row.brand}>{row.brand}</div>
                </td>
                {AXIS_KEYS.map((axis, ci) => {
                  const cell = row.verdicts[axis]
                  const verdict = cell?.verdict
                  const isActive = active?.row === ri && active?.col === ci
                  return (
                    <td key={ci} className="p-1 relative">
                      <button
                        type="button"
                        onMouseEnter={() => setActive({ row: ri, col: ci })}
                        onMouseLeave={() => setActive(null)}
                        onFocus={() => setActive({ row: ri, col: ci })}
                        onBlur={() => setActive(null)}
                        onClick={() => cell && setDetail({ brand: row.brand, axis, cell })}
                        className="w-full rounded-lg px-2 py-3 text-center font-bold cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-primary hover:brightness-110"
                        style={{
                          backgroundColor: cellColor(verdict),
                          color: cellTextColor(verdict),
                        }}
                        aria-label={`${row.brand} の ${axis} は ${verdict ?? '-'}。詳細を開く`}
                      >
                        {verdict ?? '-'}
                      </button>
                      {isActive && cell && (
                        <div className="absolute z-20 left-1/2 -translate-x-1/2 top-full mt-1 w-56 bg-inverse-surface text-inverse-on-surface text-[11px] font-normal rounded-lg p-3 shadow-lg text-left whitespace-normal leading-relaxed pointer-events-none">
                          <div className="font-bold mb-1 text-[12px]">{row.brand}</div>
                          <div className="mb-1 text-inverse-on-surface/80">{axis}</div>
                          <div className="mb-1"><JudgmentBadge verdict={verdict ?? '評価保留'} size="xs" /></div>
                          {cell.reason && (
                            <div className="mt-2 text-inverse-on-surface/70">
                              <span className="font-bold">根拠:</span> {cell.reason.length > 80 ? cell.reason.slice(0, 77) + '…' : cell.reason}
                            </div>
                          )}
                          {cell.evidence && (
                            <div className="mt-1 text-inverse-on-surface/60">証拠: {cell.evidence}</div>
                          )}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EvidenceDetail
        open={!!detail}
        onClose={() => setDetail(null)}
        brand={detail?.brand}
        axis={detail?.axis}
        cell={detail?.cell}
      />
    </section>
  )
}
