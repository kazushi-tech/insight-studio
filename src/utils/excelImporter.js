/**
 * Client-side Excel importer using SheetJS (xlsx)
 *
 * Parses ATOM monthly report Excel files and extracts:
 * - KPIs: cost, impr, click, cv, ctr, cvr, cpa, cpc, revenue, roas
 * - Sections: monthly trends, ad group breakdowns, creative info, etc.
 */
import * as XLSX from 'xlsx'

const KPI_ALIASES = {
  cost: ['費用', 'コスト', 'cost', '広告費', '広告費用', '利用金額'],
  impr: ['表示回数', 'インプレッション', 'imp', 'impr', 'impressions', '表示'],
  click: ['クリック', 'click', 'clicks', 'クリック数'],
  cv: ['コンバージョン', 'cv', 'cvs', 'conversions', 'CV数', '成果'],
  ctr: ['ctr', 'クリック率'],
  cvr: ['cvr', 'コンバージョン率', 'CV率', '転換率'],
  cpa: ['cpa', '獲得単価', 'コンバージョン単価'],
  cpc: ['cpc', 'クリック単価', '平均CPC'],
  revenue: ['売上', '収益', 'revenue', '売上金額'],
  roas: ['roas', '広告費用対効果', '費用対効果'],
}

const SECTION_PATTERNS = {
  monthly: /月別|月次|monthly|月間|推移/i,
  daily: /日別|日次|daily|日間/i,
  dayOfWeek: /曜日|day\s*of\s*week/i,
  adGroup: /広告グループ|ad\s*group|グループ別/i,
  searchQuery: /検索語句|検索クエリ|search\s*(query|term)/i,
  campaign: /キャンペーン|campaign/i,
  creative: /クリエイティブ|広告別|creative|バナー|banner/i,
}

function normalizeHeader(header) {
  return String(header ?? '').trim().toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[（）()]/g, '')
}

function findKpiColumn(headers, kpiKey) {
  const aliases = KPI_ALIASES[kpiKey] || [kpiKey]
  for (const alias of aliases) {
    const norm = normalizeHeader(alias)
    const idx = headers.findIndex((h) => normalizeHeader(h).includes(norm))
    if (idx >= 0) return idx
  }
  return -1
}

function detectSectionType(sheetName) {
  for (const [type, pattern] of Object.entries(SECTION_PATTERNS)) {
    if (pattern.test(sheetName)) return type
  }
  return null
}

function parseNumeric(val) {
  if (val == null || val === '') return null
  if (typeof val === 'number') return val
  const cleaned = String(val).replace(/[,、￥¥$%％]/g, '').trim()
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function extractKpisFromSheet(data, headers) {
  const kpis = {}
  for (const kpiKey of Object.keys(KPI_ALIASES)) {
    const colIdx = findKpiColumn(headers, kpiKey)
    if (colIdx < 0) continue
    for (let i = data.length - 1; i >= 0; i--) {
      const val = parseNumeric(data[i][colIdx])
      if (val !== null) {
        kpis[kpiKey] = val
        break
      }
    }
  }
  return kpis
}

function extractTrendData(data, headers) {
  const labels = []
  const kpiSeries = {}

  for (const kpiKey of Object.keys(KPI_ALIASES)) {
    const colIdx = findKpiColumn(headers, kpiKey)
    if (colIdx >= 0) kpiSeries[kpiKey] = { colIdx, data: [] }
  }

  for (const row of data) {
    const label = String(row[0] ?? '').trim()
    if (!label) continue
    labels.push(label)
    for (const series of Object.values(kpiSeries)) {
      series.data.push(parseNumeric(row[series.colIdx]))
    }
  }

  return {
    labels,
    series: Object.fromEntries(
      Object.entries(kpiSeries).map(([k, v]) => [k, v.data]),
    ),
  }
}

function extractCreativeInfo(data, headers) {
  const creatives = []
  const nameColIdx = headers.findIndex((h) =>
    /広告名|広告タイトル|クリエイティブ|creative|タイトル|name|見出し/i.test(String(h)),
  )
  const imgColIdx = headers.findIndex((h) =>
    /画像|image|バナー|banner|url|リンク/i.test(String(h)),
  )

  for (const row of data) {
    const name = nameColIdx >= 0 ? String(row[nameColIdx] ?? '').trim() : null
    const imageUrl = imgColIdx >= 0 ? String(row[imgColIdx] ?? '').trim() : null
    if (!name && !imageUrl) continue

    const kpis = {}
    for (const kpiKey of ['ctr', 'cvr', 'click', 'impr', 'cv']) {
      const colIdx = findKpiColumn(headers, kpiKey)
      if (colIdx >= 0) kpis[kpiKey] = parseNumeric(row[colIdx])
    }

    creatives.push({ name, imageUrl, kpis })
  }
  return creatives
}

function buildChartGroupsFromExcel(sections) {
  const groups = []

  if (sections.monthly?.status === 'extracted') {
    const s = sections.monthly
    const volumeDs = []
    if (s.series.cost) volumeDs.push({ label: '費用', data: s.series.cost })
    if (s.series.click) volumeDs.push({ label: 'クリック数', data: s.series.click })
    if (s.series.cv) volumeDs.push({ label: 'CV数', data: s.series.cv })
    if (volumeDs.length > 0) {
      groups.push({ title: '月別推移トレンド', labels: s.labels, datasets: volumeDs, chartType: 'bar', _source: 'excel' })
    }

    const rateDs = []
    if (s.series.ctr) rateDs.push({ label: 'CTR', data: s.series.ctr })
    if (s.series.cvr) rateDs.push({ label: 'CVR', data: s.series.cvr })
    if (s.series.roas) rateDs.push({ label: 'ROAS', data: s.series.roas })
    if (rateDs.length > 0) {
      groups.push({ title: '月別効率指標推移', labels: s.labels, datasets: rateDs, chartType: 'line', _source: 'excel' })
    }
  }

  if (sections.adGroup?.status === 'extracted') {
    const s = sections.adGroup
    const key = s.series.roas ? 'roas' : s.series.cv ? 'cv' : s.series.cost ? 'cost' : null
    if (key) {
      const label = key === 'roas' ? 'ROAS' : key === 'cv' ? 'CV数' : '費用'
      groups.push({ title: '広告グループ別掲載結果', labels: s.labels, datasets: [{ label, data: s.series[key] }], chartType: 'bar_horizontal', _source: 'excel' })
    }
  }

  if (sections.campaign?.status === 'extracted') {
    const s = sections.campaign
    const key = s.series.cost ? 'cost' : s.series.cv ? 'cv' : null
    if (key) {
      groups.push({ title: 'キャンペーン別実績', labels: s.labels, datasets: [{ label: key === 'cost' ? '費用' : 'CV数', data: s.series[key] }], chartType: 'bar_horizontal', _source: 'excel' })
    }
  }

  return groups
}

export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'array' })
        resolve(extractFromWorkbook(workbook, file.name))
      } catch (err) {
        reject(new Error(`Excel解析エラー: ${err.message}`))
      }
    }
    reader.onerror = () => reject(new Error('ファイル読み込みに失敗しました'))
    reader.readAsArrayBuffer(file)
  })
}

function extractFromWorkbook(workbook, fileName) {
  const sections = {}
  const warnings = []
  let aggregatedKpis = {}
  const creativeRefs = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 })
    if (jsonData.length < 2) continue

    let headerRowIdx = 0
    for (let i = 0; i < Math.min(jsonData.length, 5); i++) {
      const nonEmpty = (jsonData[i] || []).filter((c) => c != null && String(c).trim()).length
      if (nonEmpty >= 3) { headerRowIdx = i; break }
    }

    const headers = jsonData[headerRowIdx] || []
    const data = jsonData.slice(headerRowIdx + 1).filter((row) =>
      row.some((c) => c != null && String(c).trim()),
    )
    if (data.length === 0) continue

    const sectionType = detectSectionType(sheetName)

    const sheetKpis = extractKpisFromSheet(data, headers)
    if (Object.keys(sheetKpis).length > Object.keys(aggregatedKpis).length) {
      aggregatedKpis = { ...aggregatedKpis, ...sheetKpis }
    }

    if (sectionType === 'monthly' || sectionType === 'daily' || sectionType === 'dayOfWeek') {
      const trend = extractTrendData(data, headers)
      if (trend.labels.length > 0) {
        sections[sectionType] = { type: sectionType, sheetName, labels: trend.labels, series: trend.series, rowCount: trend.labels.length, status: 'extracted' }
      }
    } else if (sectionType === 'adGroup' || sectionType === 'campaign') {
      const trend = extractTrendData(data, headers)
      if (trend.labels.length > 0) {
        sections[sectionType] = { type: sectionType, sheetName, labels: trend.labels, series: trend.series, rowCount: trend.labels.length, status: 'extracted' }
      }
    } else if (sectionType === 'searchQuery') {
      const trend = extractTrendData(data, headers)
      sections.searchQuery = { type: 'searchQuery', sheetName, labels: trend.labels, series: trend.series, rowCount: trend.labels.length, status: trend.labels.length > 0 ? 'extracted' : 'not_found' }
    } else if (sectionType === 'creative') {
      creativeRefs.push(...extractCreativeInfo(data, headers))
    }

    if (!sectionType) {
      const firstCol = data.slice(0, 5).map((r) => String(r[0] ?? ''))
      const hasDatePattern = firstCol.some((v) => /\d{4}[/-]\d{1,2}|[1-9]\d?月/.test(v))
      if (hasDatePattern && !sections.monthly) {
        const trend = extractTrendData(data, headers)
        if (trend.labels.length > 0) {
          sections.monthly = { type: 'monthly', sheetName, labels: trend.labels, series: trend.series, rowCount: trend.labels.length, status: 'extracted' }
        }
      }
      if (creativeRefs.length === 0) {
        const hasCreativeCol = headers.some((h) => /広告名|タイトル|creative|バナー/i.test(String(h ?? '')))
        if (hasCreativeCol) creativeRefs.push(...extractCreativeInfo(data, headers))
      }
    }
  }

  for (const key of ['monthly', 'adGroup']) {
    if (!sections[key]) {
      sections[key] = { type: key, status: 'not_found' }
      warnings.push(`${key === 'monthly' ? '月別推移' : '広告グループ別'}データが検出されませんでした`)
    }
  }
  for (const key of ['daily', 'dayOfWeek', 'searchQuery', 'campaign']) {
    if (!sections[key]) sections[key] = { type: key, status: 'not_found' }
  }
  if (creativeRefs.length === 0) {
    warnings.push('バナー画像・広告タイトル情報が検出されませんでした')
  }

  return {
    fileName,
    importedAt: new Date().toISOString(),
    kpis: aggregatedKpis,
    sections,
    creativeRefs,
    chartGroups: buildChartGroupsFromExcel(sections),
    warnings,
    status: Object.values(sections).some((s) => s.status === 'extracted') ? 'partial' : 'empty',
  }
}

export function getExtractionSummary(result) {
  if (!result) return []
  return [
    { label: '月別推移', status: result.sections?.monthly?.status ?? 'not_found', count: result.sections?.monthly?.rowCount },
    { label: '広告グループ別', status: result.sections?.adGroup?.status ?? 'not_found', count: result.sections?.adGroup?.rowCount },
    { label: 'バナー画像', status: result.creativeRefs?.length > 0 ? 'extracted' : 'not_found', count: result.creativeRefs?.length },
    { label: '検索語句', status: result.sections?.searchQuery?.status ?? 'not_found', count: result.sections?.searchQuery?.rowCount },
    { label: '日別推移', status: result.sections?.daily?.status ?? 'not_found', count: result.sections?.daily?.rowCount },
    { label: '曜日別', status: result.sections?.dayOfWeek?.status ?? 'not_found', count: result.sections?.dayOfWeek?.rowCount },
  ]
}
