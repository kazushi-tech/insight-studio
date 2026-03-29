const TREND_PATTERN = /([+\-＋－]?\s*[\d,.]+\s*[%％])/

function parseTrend(text) {
  const match = String(text ?? '').match(TREND_PATTERN)
  if (!match) return null
  const raw = match[1].replace(/\s/g, '').replace(/[＋]/g, '+').replace(/[－]/g, '-')
  const num = parseFloat(raw.replace(/[,%％]/g, ''))
  if (!Number.isFinite(num)) return null
  const formatted = raw.includes('%') || raw.includes('％') ? raw : `${raw}%`
  return {
    value: formatted,
    tone: num > 0 ? 'positive' : num < 0 ? 'negative' : 'neutral',
  }
}

function cleanValue(text) {
  return String(text ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim()
}

function isIgnoredValue(text) {
  const lower = String(text).toLowerCase().trim()
  return !lower || lower === 'nan' || lower === '-' || lower === '—' || /(未取得|不明|算出不可|n\/a)/i.test(lower)
}

function extractFromTable(md) {
  const kpiTableMatch = md.match(/##\s*(主要\s*KPI|KPI\s*比較|KPIサマリー)[^\n]*\n([\s\S]*?)(?=\n##|\n#[^#]|$)/i)
  const tableBlock = kpiTableMatch ? kpiTableMatch[2] : md

  const tableLines = tableBlock.split(/\r?\n/).filter((line) => line.trim().startsWith('|'))
  if (tableLines.length < 3) return []

  const headerCells = tableLines[0].split('|').map((c) => c.trim()).filter(Boolean)
  const dataRows = tableLines.slice(2)

  const kpis = []
  for (const row of dataRows) {
    const cells = row.split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length < 2) continue

    const label = cleanValue(cells[0])
    const value = cleanValue(cells[1])
    if (!label || isIgnoredValue(value)) continue

    let trend = null
    for (let i = 2; i < cells.length; i++) {
      const header = (headerCells[i] ?? '').toLowerCase()
      if (/(増減|変化|前[月週日期]比|trend|change|diff)/i.test(header) || i === 2) {
        trend = parseTrend(cells[i])
        if (trend) break
      }
    }

    kpis.push({
      label,
      value,
      trend: trend?.value ?? null,
      tone: trend?.tone ?? 'neutral',
      source: 'table',
    })

    if (kpis.length >= 4) break
  }

  return kpis
}

function extractFromBullets(md) {
  const kpiSectionMatch = md.match(/##\s*(主要\s*KPI|KPI\s*サマリー|サマリー|概要)[^\n]*\n([\s\S]*?)(?=\n##|\n#[^#]|$)/i)
  if (!kpiSectionMatch) return []

  const block = kpiSectionMatch[2]
  const bullets = block.split(/\r?\n/).filter((line) => /^\s*[-*]\s+/.test(line))

  const kpis = []
  for (const bullet of bullets) {
    const text = bullet.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim()

    const kvMatch = text.match(/^(.+?)\s*[:：]\s*(.+)$/)
    if (!kvMatch) continue

    const label = kvMatch[1].trim()
    const rest = kvMatch[2].trim()

    const numMatch = rest.match(/^([¥$]?\s*[\d,]+\.?\d*\s*[%％回件円個万億]?)/)
    if (!numMatch) continue

    const value = numMatch[1].trim()
    if (isIgnoredValue(value)) continue

    const remaining = rest.slice(numMatch[0].length)
    const trend = parseTrend(remaining)

    kpis.push({
      label,
      value,
      trend: trend?.value ?? null,
      tone: trend?.tone ?? 'neutral',
      source: 'bullet',
    })

    if (kpis.length >= 4) break
  }

  return kpis
}

function extractByRegex(md) {
  const lines = md.split(/\r?\n/)
  const kpis = []

  for (const line of lines) {
    const match = line.match(/([\w\u3000-\u9fff]+)\s*[:：]\s*([¥$]?\s*[\d,]+\.?\d*)\s*([%％回件円個万億]?)/)
    if (!match) continue

    const label = match[1].trim()
    const value = `${match[2].trim()}${match[3]}`
    if (isIgnoredValue(value)) continue

    const trend = parseTrend(line.slice(line.indexOf(value) + value.length))

    kpis.push({
      label,
      value,
      trend: trend?.value ?? null,
      tone: trend?.tone ?? 'neutral',
      source: 'regex',
    })

    if (kpis.length >= 4) break
  }

  return kpis
}

export function extractKpis(sectionMd) {
  if (typeof sectionMd !== 'string' || !sectionMd.trim()) return []

  const fromTable = extractFromTable(sectionMd)
  if (fromTable.length > 0) return fromTable

  const fromBullets = extractFromBullets(sectionMd)
  if (fromBullets.length > 0) return fromBullets

  return extractByRegex(sectionMd)
}
