import { useMemo, useState } from 'react'
import { HEATMAP_GRADIENT } from './reportTheme'
import JudgmentBadge from './JudgmentBadge'
import EvidenceDetail from './EvidenceDetail'

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

const AXIS_KEYS = ['検索意図一致', 'FV訴求', 'CTA明確性', '信頼構築', '価格・オファー', '購買導線']

function findBrandSectionBodies(reportMd) {
  if (typeof reportMd !== 'string') return []
  // Find the brand evaluation section (## 4. ブランド別評価 / ## ブランド別評価)
  const sectionMatch = reportMd.match(/##\s*(?:\d+[.．]?\s*)?ブランド別評価[^\n]*/)
  if (!sectionMatch) return []
  const start = sectionMatch.index + sectionMatch[0].length
  const rest = reportMd.slice(start)
  const endMatch = rest.match(/\n##\s/)
  const end = endMatch ? endMatch.index : rest.length
  const sectionBody = rest.slice(0, end)

  // Split on ### headings → brand chunks
  const chunks = sectionBody.split(/\n###\s+/)
  // First chunk is before any ### heading; skip it
  return chunks.slice(1).map((chunk) => {
    const [first, ...lines] = chunk.split('\n')
    return { title: first.trim(), body: lines.join('\n') }
  })
}

function parseBrandTable(body) {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'))
  if (lines.length < 3) return null

  const header = lines[0].split('|').map((c) => c.trim()).filter(Boolean)
  const axisIdx = header.findIndex((h) => /評価軸/.test(h))
  const verdictIdx = header.findIndex((h) => /判定/.test(h))
  const evidenceIdx = header.findIndex((h) => /証拠強度/.test(h))
  const reasonIdx = header.findIndex((h) => /根拠/.test(h))
  if (axisIdx === -1 || verdictIdx === -1) return null

  const verdicts = {}
  for (const line of lines.slice(2)) {
    const cells = line.split('|').map((c) => c.trim())
    const offset = 1 // leading empty before first pipe
    const axis = cells[axisIdx + offset]
    const verdictRaw = cells[verdictIdx + offset] || ''
    const evidence = evidenceIdx !== -1 ? cells[evidenceIdx + offset] : ''
    const reason = reasonIdx !== -1 ? cells[reasonIdx + offset] : ''
    if (!axis) continue

    const verdictMatch = verdictRaw.match(/強|同等|弱|評価保留/)
    const normalizedAxis = AXIS_KEYS.find((k) => axis.includes(k) || k.includes(axis.replace(/[・\s]/g, '')))
    if (!normalizedAxis) continue
    verdicts[normalizedAxis] = {
      verdict: verdictMatch ? verdictMatch[0] : null,
      evidence: evidence || '',
      reason: reason || '',
    }
  }
  return Object.keys(verdicts).length > 0 ? verdicts : null
}

function parseMatrix(reportMd) {
  const brandChunks = findBrandSectionBodies(reportMd)
  const rows = []
  for (const chunk of brandChunks) {
    const verdicts = parseBrandTable(chunk.body)
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
