/**
 * Shared parser for the `## ブランド別評価` section of discovery/compare reports.
 *
 * Handles the 3-brand regression where only the first brand was rendered in
 * Phase B heatmap / radar components. Root cause: the previous section-end
 * boundary `\n##\s` terminated as soon as LLM promoted any sub-heading
 * (e.g. `## キタムラ`) to top level. The new boundary only stops at KNOWN
 * major sections (`## 実行プラン`, `## アクション...`, etc.), so promoted
 * brand headings are captured as additional chunks instead of ending the
 * section early.
 */

export const AXIS_KEYS = [
  '検索意図一致',
  'FV訴求',
  'CTA明確性',
  '信頼構築',
  '価格・オファー',
  '購買導線',
]

const BRAND_EVAL_SECTION_RE =
  /#{2,3}\s*(?:\d+[-．.]?\d*[.．]?\s*)?ブランド別評価[^\n]*/

const NEXT_MAJOR_SECTION_RE =
  /\n#{2,3}\s+(?:\d+[.．]?\s*)?(?:実行プラン|アクションプラン|5[.．]\s|施策|改善提案|推奨事項|KPIフレーム|付録|Appendix|注記|参考観測枠)/

const NON_BRAND_TITLE_RE = /^(まとめ|小括|補遺|注記|備考|総評|Appendix|参考観測枠)$/i

export function findBrandEvalSectionBody(reportMd) {
  if (typeof reportMd !== 'string') return ''
  const sectionMatch = reportMd.match(BRAND_EVAL_SECTION_RE)
  if (!sectionMatch) return ''
  const start = sectionMatch.index + sectionMatch[0].length
  const rest = reportMd.slice(start)
  const endMatch = rest.match(NEXT_MAJOR_SECTION_RE)
  const end = endMatch ? endMatch.index : rest.length
  return rest.slice(0, end)
}

export function findBrandSectionBodies(reportMd) {
  const sectionBody = findBrandEvalSectionBody(reportMd)
  if (!sectionBody) return []
  const chunks = sectionBody.split(/\n#{2,3}\s+/)
  return chunks
    .slice(1)
    .map((chunk) => {
      const [first, ...lines] = chunk.split('\n')
      return { title: first.trim(), body: lines.join('\n') }
    })
    .filter((c) => c.title && !NON_BRAND_TITLE_RE.test(c.title))
}

export function parseBrandVerdicts(body) {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
  if (lines.length < 3) return null

  const header = lines[0]
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean)
  const axisIdx = header.findIndex((h) => /評価軸/.test(h))
  const verdictIdx = header.findIndex((h) => /判定/.test(h))
  const evidenceIdx = header.findIndex((h) => /証拠強度/.test(h))
  const reasonIdx = header.findIndex((h) => /根拠/.test(h))
  if (axisIdx === -1 || verdictIdx === -1) return null

  const verdicts = {}
  for (const line of lines.slice(2)) {
    const cells = line.split('|').map((c) => c.trim())
    const offset = 1
    const axis = cells[axisIdx + offset]
    const verdictRaw = cells[verdictIdx + offset] || ''
    const evidence = evidenceIdx !== -1 ? cells[evidenceIdx + offset] : ''
    const reason = reasonIdx !== -1 ? cells[reasonIdx + offset] : ''
    if (!axis) continue

    const verdictMatch = verdictRaw.match(/強|同等|弱|評価保留/)
    const normalizedAxis = AXIS_KEYS.find(
      (k) => axis.includes(k) || k.includes(axis.replace(/[・\s]/g, ''))
    )
    if (!normalizedAxis) continue
    verdicts[normalizedAxis] = {
      verdict: verdictMatch ? verdictMatch[0] : null,
      evidence: evidence || '',
      reason: reason || '',
    }
  }
  return Object.keys(verdicts).length > 0 ? verdicts : null
}
