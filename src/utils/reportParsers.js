// MD parsers for Phase 2 chart components.
// All parsers return null/[] when data is absent, so components hide themselves.

/**
 * Parse "競合広告投資推定" section for horizontal bar chart.
 * Accepts formats:
 *   | ブランド | 推定投資額 | ...
 *   | BrandA  | 1,000〜2,000万円 |
 */
export function parseAdSpendRanges(md) {
  if (!md) return []

  // Find the ad-spend section
  const sectionMatch = md.match(
    /##[^\n]*(?:競合広告投資推定|広告投資推定|3[-\s.]2[^\n]*)/
  )
  if (!sectionMatch) return []

  const afterSection = md.slice(sectionMatch.index + sectionMatch[0].length)
  const nextSection = afterSection.search(/\n##\s/)
  const body = afterSection.slice(0, nextSection === -1 ? afterSection.length : nextSection)

  const rows = []
  const lineRe = /\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/g
  let headerSkipped = false
  let m
  while ((m = lineRe.exec(body)) !== null) {
    const col1 = m[1].trim()
    const col2 = m[2].trim()
    // Skip separator lines and header rows
    if (/^[-:]+$/.test(col1) || /^[-:]+$/.test(col2)) continue
    if (!headerSkipped) { headerSkipped = true; continue }

    const range = parseMoneyRange(col2)
    if (!range) continue
    rows.push({ brand: col1, ...range })
  }
  return rows
}

function parseMoneyRange(text) {
  // "1,000〜2,000万円" or "500万〜1,000万" or "1億〜2億"
  const norm = text.replace(/,/g, '').replace(/，/g, '')
  const m = norm.match(
    /([\d.]+)\s*([億万千]?)\s*[〜～~-]\s*([\d.]+)\s*([億万千円]*)/
  )
  if (!m) return null
  const unit1 = m[2] || m[4] || ''
  const unit2 = m[4] || m[2] || ''
  const effectiveUnit = unit1 || unit2
  return {
    min: toMan(parseFloat(m[1]), effectiveUnit),
    max: toMan(parseFloat(m[3]), effectiveUnit),
    unit: '万円',
  }
}

function toMan(value, unit) {
  if (unit === '億') return value * 10000
  if (unit === '千') return value / 10
  return value // 万 or bare
}

/**
 * Parse seasonality info from MD.
 * Looks for lines like "ピーク: 3月〜5月" or "オフ: 7月〜8月"
 * Returns array of { month: 1-12, type: 'peak'|'off' } or null.
 */
export function parseSeasonality(md) {
  if (!md) return null

  const sectionMatch = md.match(/##[^\n]*(?:季節性|シーズナリティ|seasonality)/i)
  const body = sectionMatch
    ? md.slice(sectionMatch.index).split(/\n##\s/)[0]
    : md

  const entries = []

  // Pattern: ピーク〜XX月
  const peakMatches = body.matchAll(
    /(?:ピーク|最盛期|繁忙期)[^\n:：]*[：:]\s*([\d月〜～,、-]+)/gi
  )
  for (const pm of peakMatches) {
    entries.push(...monthsFromRange(pm[1], 'peak'))
  }

  // Pattern: オフ〜XX月
  const offMatches = body.matchAll(
    /(?:オフ|閑散期|低迷期)[^\n:：]*[：:]\s*([\d月〜～,、-]+)/gi
  )
  for (const om of offMatches) {
    entries.push(...monthsFromRange(om[1], 'off'))
  }

  return entries.length ? entries : null
}

function monthsFromRange(text, type) {
  const results = []
  // "3月〜5月" → [3,4,5]
  const rangeMatch = text.match(/(\d{1,2})\s*月?\s*[〜～-]\s*(\d{1,2})\s*月?/)
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1])
    const end = parseInt(rangeMatch[2])
    if (start >= 1 && end <= 12 && start <= end) {
      for (let m = start; m <= end; m++) results.push({ month: m, type })
    }
    return results
  }
  // Single month "3月"
  const single = text.match(/(\d{1,2})\s*月/)
  if (single) {
    const m = parseInt(single[1])
    if (m >= 1 && m <= 12) results.push({ month: m, type })
  }
  return results
}

/**
 * Parse data-coverage table.
 * Expects: | ブランド | 取得率 | 信頼レベル |
 */
export function parseCoverageTable(md) {
  if (!md) return []

  const tableMatch = md.match(
    /\|[^\n]*(?:取得率|カバレッジ|coverage)[^\n]*\|/i
  )
  if (!tableMatch) return []

  const start = md.lastIndexOf('\n', tableMatch.index) + 1
  const afterTable = md.slice(start)
  const lines = afterTable
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .slice(0, 20)

  const rows = []
  let headerRow = null

  for (const line of lines) {
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
    if (!cells.length) continue
    if (/^[-:]+$/.test(cells[0])) continue // separator
    if (!headerRow) { headerRow = cells; continue }

    const rateIdx = headerRow.findIndex((h) =>
      /取得率|カバレッジ|coverage/i.test(h)
    )
    const levelIdx = headerRow.findIndex((h) =>
      /信頼|level|レベル/i.test(h)
    )

    const brand = cells[0]
    const rateRaw = rateIdx >= 0 ? cells[rateIdx] : null
    const level = levelIdx >= 0 ? cells[levelIdx] : null
    const rate = rateRaw ? parseFloat(rateRaw.replace('%', '')) : null

    if (brand && brand !== '---') {
      rows.push({ brand, rate, level })
    }
  }

  return rows
}
