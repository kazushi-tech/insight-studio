// Section headings already visualised by ReportViewV2 cards.
// Aligned with report_envelope.py:95-99 regex patterns.
const V2_SECTION_HEADING_RES = [
  // PriorityActionHeroV2
  /##\s*(?:\d+[.．]?\s*)?(最優先施策|優先施策|実行プラン|推奨事項)[^\n]*/,
  // CompetitorMatrixV2 + BrandRadarV2
  /##\s*(?:\d+[.．]?\s*)?ブランド別評価[^\n]*/,
  // MarketRangeV2
  /##\s*(?:\d+[.．]?\s*)?市場推定データ[^\n]*/,
]

function stripSection(md, headingRe) {
  const m = headingRe.exec(md)
  if (!m) return md
  const start = m.index
  const afterHeading = md.slice(start + m[0].length)
  const nextSection = afterHeading.search(/\n##\s/)
  const end = start + m[0].length + (nextSection === -1 ? afterHeading.length : nextSection)
  return md.slice(0, start) + md.slice(end)
}

/**
 * Remove sections from `md` that are already rendered by ReportViewV2 cards,
 * so they don't appear again in the MarkdownRenderer below the cards.
 *
 * Only used in Discovery.jsx's cleanBody pipeline — the original MD
 * used for PDF/copy (buildDiscoveryReportText) is left untouched.
 */
export function stripV2CoveredSections(md) {
  if (!md) return md
  let result = md
  for (const re of V2_SECTION_HEADING_RES) {
    result = stripSection(result, re)
  }
  return result
}
