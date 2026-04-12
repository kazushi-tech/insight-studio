/**
 * Client-side Excel importer using SheetJS (xlsx)
 *
 * Supports ATOM monthly report workbooks. The importer prefers summary sheets
 * over raw export tabs so charts and KPIs stay aligned with the report layout.
 */
import * as XLSX from 'xlsx'

const KPI_ALIASES = {
  cost: ['費用', 'コスト', 'cost', '広告費', '広告費用', '利用金額', '利用額', 'ご利用額'],
  impr: ['表示回数', 'インプレッション', 'imp', 'impr', 'impressions', '表示'],
  click: ['クリック', 'click', 'clicks', 'クリック数'],
  cv: ['コンバージョン', 'cv', 'cvs', 'conversions', 'CV数', '成果', '獲得件数'],
  ctr: ['ctr', 'クリック率'],
  cvr: ['cvr', 'コンバージョン率', 'CV率', '転換率', '獲得率'],
  cpa: ['cpa', '獲得単価', 'コンバージョン単価'],
  cpc: ['cpc', 'クリック単価', '平均CPC'],
  revenue: ['売上', '収益', 'revenue', '売上金額'],
  roas: ['roas', '広告費用対効果', '費用対効果'],
}

const PERCENT_KPI_KEYS = new Set(['ctr', 'cvr'])

const HEADER_HINT_PATTERN = /月|日付|曜日|時間|キャンペーン|広告グループ|検索クエリ|検索語句|キーワード|タイトル|説明文|表示回数|クリック数|クリック率|クリック単価|ご利用額|利用額|獲得件数|獲得率|獲得単価|インプレッション|費用|ctr|cvr|cpc|cpa/i

const SHEET_SUFFIX_TYPES = [
  { type: 'raw', pattern: /(?:^|[_-])raw$/i },
  { type: 'creative', pattern: /(?:^|[_-])ad$/i },
  { type: 'adGroup', pattern: /(?:^|[_-])ag$/i },
  { type: 'campaign', pattern: /(?:^|[_-])c$/i },
  { type: 'searchQuery', pattern: /(?:^|[_-])query$/i },
  { type: 'keyword', pattern: /(?:^|[_-])kw$/i },
  { type: 'time', pattern: /(?:^|[_-])time$/i },
]

function normalizeHeader(header) {
  return String(header ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[（）()]/g, '')
}

function getCellText(value) {
  const text = String(value ?? '').trim()
  return text || null
}

function parseNumeric(val) {
  if (val == null || val === '') return null
  if (typeof val === 'number') return Number.isFinite(val) ? val : null

  const cleaned = String(val).replace(/[,、￥¥$%％]/g, '').trim()
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function normalizeMetricValue(kpiKey, value) {
  const numeric = parseNumeric(value)
  if (numeric == null) return null
  if (PERCENT_KPI_KEYS.has(kpiKey) && Math.abs(numeric) <= 1) {
    return numeric * 100
  }
  return numeric
}

function formatTemporalLabel(value, granularity = 'day') {
  if (value == null || value === '') return null

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return granularity === 'month' ? `${year}/${month}` : `${year}/${month}/${day}`
  }

  const text = String(value).trim()
  if (!text) return null

  let match = text.match(/^(\d{4})[/-](\d{1,2})$/)
  if (match) {
    const [, year, month] = match
    return `${year}/${String(month).padStart(2, '0')}`
  }

  match = text.match(/^(\d{4})年(\d{1,2})月$/)
  if (match) {
    const [, year, month] = match
    return `${year}/${String(month).padStart(2, '0')}`
  }

  match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (match) {
    const [, year, month, day] = match
    return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`
  }

  match = text.match(/^(\d{4})-(\d{2})-(\d{2})T/)
  if (match) {
    const [, year, month, day] = match
    return `${year}/${month}/${day}`
  }

  match = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (match) {
    const [, year, month, day] = match
    return `${year}/${month}/${day}`
  }

  return text
}

function findHeaderRowIndex(rows) {
  const limit = Math.min(rows.length, 12)
  let bestIdx = 0
  let bestScore = -1

  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] || [])
      .map((cell) => String(cell ?? '').trim())
      .filter(Boolean)
    if (cells.length === 0) continue

    const hintHits = cells.filter((cell) => HEADER_HINT_PATTERN.test(cell)).length
    const score = hintHits * 20 + Math.min(cells.length, 12)
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  return bestIdx
}

function findColumnIndex(headers, matchers) {
  const headerTexts = headers.map((header) => String(header ?? ''))
  const normalizedHeaders = headerTexts.map(normalizeHeader)

  for (const matcher of matchers) {
    if (matcher instanceof RegExp) {
      const idx = headerTexts.findIndex((header) => matcher.test(header))
      if (idx >= 0) return idx
      continue
    }

    const normalizedMatcher = normalizeHeader(matcher)
    const idx = normalizedHeaders.findIndex((header) =>
      header === normalizedMatcher || header.includes(normalizedMatcher),
    )
    if (idx >= 0) return idx
  }

  return -1
}

function findKpiColumn(headers, kpiKey) {
  return findColumnIndex(headers, KPI_ALIASES[kpiKey] || [kpiKey])
}

function detectSectionTypeFromHeaders(headers, previewRows = []) {
  if (findColumnIndex(headers, [/検索クエリ|検索語句/i]) >= 0) return 'searchQuery'
  if (findColumnIndex(headers, [/タイトル\d*|説明文\d*|広告名|クリエイティブ/i]) >= 0) return 'creative'
  if (findColumnIndex(headers, [/広告グループ/i]) >= 0) return 'adGroup'
  if (findColumnIndex(headers, [/^キャンペーン$/i]) >= 0) return 'campaign'
  if (findColumnIndex(headers, [/^月$/i, /年月|対象月/i]) >= 0) return 'monthly'
  if (findColumnIndex(headers, [/^日付$/i, /^date$/i]) >= 0) return 'daily'
  if (findColumnIndex(headers, [/^曜日$/i]) >= 0) return 'dayOfWeek'
  if (findColumnIndex(headers, [/^時間$/i]) >= 0) return 'time'

  const firstColumnPreview = previewRows
    .map((row) => getCellText(row[0]))
    .filter(Boolean)

  if (firstColumnPreview.some((value) => /^\d{4}[/-]\d{1,2}$/.test(value) || /^\d{4}年\d{1,2}月$/.test(value))) {
    return 'monthly'
  }
  if (firstColumnPreview.some((value) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value) || /^\d{8}$/.test(value))) {
    return 'daily'
  }

  return null
}

function detectSectionType(sheetName, headers, previewRows) {
  const normalizedSheetName = normalizeHeader(sheetName)

  if (/表紙|cover/i.test(sheetName)) return 'cover'
  if (/raw/.test(normalizedSheetName)) return 'raw'

  for (const entry of SHEET_SUFFIX_TYPES) {
    if (entry.pattern.test(sheetName)) return entry.type
  }

  return detectSectionTypeFromHeaders(headers, previewRows)
}

function isSummaryLike(value) {
  return /^(合計|総計|計|total)$/i.test(String(value ?? '').trim())
}

function buildAdGroupLabel(row, headers) {
  const campaignIdx = findColumnIndex(headers, [/^キャンペーン$/i])
  const adGroupIdx = findColumnIndex(headers, [/広告グループ/i])
  const campaign = campaignIdx >= 0 ? getCellText(row[campaignIdx]) : null
  const adGroup = adGroupIdx >= 0 ? getCellText(row[adGroupIdx]) : null

  if (isSummaryLike(adGroup) || (isSummaryLike(campaign) && !adGroup)) return null
  if (campaign && adGroup) return `${campaign} / ${adGroup}`
  return adGroup || campaign
}

function resolveLabelValue(sectionType, row, headers) {
  if (sectionType === 'monthly') {
    const monthIdx = findColumnIndex(headers, [/^月$/i, /年月|対象月/i])
    const label = monthIdx >= 0 ? formatTemporalLabel(row[monthIdx], 'month') : formatTemporalLabel(row[0], 'month')
    return label && /^\d{4}\/\d{2}$/.test(label) ? label : null
  }

  if (sectionType === 'daily') {
    const dateIdx = findColumnIndex(headers, [/^日付$/i, /^date$/i])
    const label = dateIdx >= 0 ? formatTemporalLabel(row[dateIdx], 'day') : formatTemporalLabel(row[0], 'day')
    return label && /^\d{4}\/\d{2}\/\d{2}$/.test(label) ? label : null
  }

  if (sectionType === 'dayOfWeek') {
    const dayIdx = findColumnIndex(headers, [/^曜日$/i])
    const label = dayIdx >= 0 ? getCellText(row[dayIdx]) : getCellText(row[0])
    return /^(月|火|水|木|金|土|日)$/.test(label ?? '') ? label : null
  }

  if (sectionType === 'time') {
    const timeIdx = findColumnIndex(headers, [/^時間$/i])
    const label = timeIdx >= 0 ? getCellText(row[timeIdx]) : getCellText(row[0])
    return isSummaryLike(label) ? null : label
  }

  if (sectionType === 'campaign') {
    const campaignIdx = findColumnIndex(headers, [/^キャンペーン$/i])
    const label = campaignIdx >= 0 ? getCellText(row[campaignIdx]) : getCellText(row[0])
    return isSummaryLike(label) ? null : label
  }

  if (sectionType === 'adGroup') {
    const label = buildAdGroupLabel(row, headers)
    return isSummaryLike(label) ? null : label
  }

  if (sectionType === 'searchQuery') {
    const queryIdx = findColumnIndex(headers, [/検索クエリ|検索語句/i])
    const label = queryIdx >= 0 ? getCellText(row[queryIdx]) : getCellText(row[0])
    return isSummaryLike(label) ? null : label
  }

  return getCellText(row[0])
}

function isLabelCompatible(sectionType, label) {
  const text = String(label ?? '').trim()
  if (!text) return false

  if (sectionType === 'monthly') {
    return /^\d{4}[/-]\d{1,2}$/.test(text) || /^\d{4}年\d{1,2}月$/.test(text)
  }

  if (sectionType === 'daily') {
    return /^\d{4}\/\d{2}\/\d{2}$/.test(text)
      || /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(text)
      || /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(text)
      || /^\d{8}$/.test(text)
  }

  if (sectionType === 'dayOfWeek') {
    return /^(月|火|水|木|金|土|日|月曜|火曜|水曜|木曜|金曜|土曜|日曜)$/i.test(text)
  }

  return true
}

function parseTemporalSortValue(label) {
  const value = String(label ?? '').trim()
  if (!value) return null

  let match = value.match(/^(\d{4})[/-](\d{1,2})$/)
  if (match) {
    const [, year, month] = match
    return Number(year) * 100 + Number(month)
  }

  match = value.match(/^(\d{4})年(\d{1,2})月$/)
  if (match) {
    const [, year, month] = match
    return Number(year) * 100 + Number(month)
  }

  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (match) {
    const [, month, day, rawYear] = match
    const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)
    return year * 10000 + Number(month) * 100 + Number(day)
  }

  match = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (match) {
    return Number(value)
  }

  match = value.match(/^(\d{4})\/(\d{2})\/(\d{2})$/)
  if (match) {
    const [, year, month, day] = match
    return Number(`${year}${month}${day}`)
  }

  match = value.match(/^(\d{4})-(\d{2})-(\d{2})T/)
  if (match) {
    const [, year, month, day] = match
    return Number(`${year}${month}${day}`)
  }

  return null
}

function sortTrendData(labels, series, sectionType) {
  if (!['monthly', 'daily'].includes(sectionType)) {
    return { labels, series }
  }

  const sortable = labels.map((label, index) => ({
    index,
    sortValue: parseTemporalSortValue(label),
  }))

  if (sortable.some((item) => item.sortValue == null)) {
    return { labels, series }
  }

  const isDescending = sortable.length >= 2 && sortable[0].sortValue > sortable[sortable.length - 1].sortValue
  if (!isDescending) {
    return { labels, series }
  }

  const order = [...sortable]
    .sort((a, b) => a.sortValue - b.sortValue)
    .map((item) => item.index)

  return {
    labels: order.map((index) => labels[index]),
    series: Object.fromEntries(
      Object.entries(series).map(([key, values]) => [key, order.map((index) => values[index])]),
    ),
  }
}

function extractTrendData(data, headers, sectionType) {
  const labels = []
  const kpiSeries = {}

  for (const kpiKey of Object.keys(KPI_ALIASES)) {
    const colIdx = findKpiColumn(headers, kpiKey)
    if (colIdx >= 0) {
      kpiSeries[kpiKey] = { colIdx, data: [] }
    }
  }

  for (const row of data) {
    const label = resolveLabelValue(sectionType, row, headers)
    if (!label) continue
    if (!isLabelCompatible(sectionType, label)) continue

    labels.push(label)
    for (const [kpiKey, series] of Object.entries(kpiSeries)) {
      series.data.push(normalizeMetricValue(kpiKey, row[series.colIdx]))
    }
  }

  const series = Object.fromEntries(
    Object.entries(kpiSeries).map(([key, meta]) => [key, meta.data]),
  )

  return sortTrendData(labels, series, sectionType)
}

function normalizePotentialImageUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null

  const stripped = raw
    .replace(/^(?:\[|["'])+/, '')
    .replace(/(?:\]|["'])+$/, '')
  if (!stripped) return null

  if (/^data:image\//i.test(stripped)) return stripped
  if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(stripped)) return stripped
  return null
}

function collectRowsUntilBlank(rows, startIndex, blankThreshold = 1) {
  const collected = []
  let blankCount = 0

  for (let index = startIndex; index < rows.length; index += 1) {
    const row = rows[index] || []
    const hasValue = row.some((cell) => cell != null && String(cell).trim())
    if (!hasValue) {
      blankCount += 1
      if (collected.length > 0 && blankCount >= blankThreshold) break
      continue
    }

    blankCount = 0
    collected.push(row)
  }

  return collected
}

function extractSummarySections(rows, sheetName) {
  const sections = []

  const monthlyHeaderIdx = rows.findIndex((row, index) =>
    index < 15 && row.some((cell) => /^月$/i.test(String(cell ?? '').trim())),
  )
  if (monthlyHeaderIdx >= 0) {
    const monthlyHeaders = rows[monthlyHeaderIdx] || []
    const monthlyRows = collectRowsUntilBlank(rows, monthlyHeaderIdx + 1, 1)
    const monthlyTrend = extractTrendData(monthlyRows, monthlyHeaders, 'monthly')
    if (monthlyTrend.labels.length > 0) {
      sections.push({
        type: 'monthly',
        sheetName,
        labels: monthlyTrend.labels,
        series: monthlyTrend.series,
        rowCount: monthlyTrend.labels.length,
        status: 'extracted',
      })
    }
  }

  const mixedHeaderIdx = rows.findIndex((row) =>
    row.some((cell) => /^日付$/i.test(String(cell ?? '').trim())) && row.some((cell) => /^曜日$/i.test(String(cell ?? '').trim())),
  )
  if (mixedHeaderIdx >= 0) {
    const mixedRows = collectRowsUntilBlank(rows, mixedHeaderIdx + 1, 2)
    const mixedHeaders = rows[mixedHeaderIdx] || []

    const dailyHeaders = mixedHeaders.slice(0, 10)
    const dailyRows = mixedRows
      .map((row) => row.slice(0, 10))
      .filter((row) => row.some((cell) => cell != null && String(cell).trim()))
    const dailyTrend = extractTrendData(dailyRows, dailyHeaders, 'daily')
    if (dailyTrend.labels.length > 0) {
      sections.push({
        type: 'daily',
        sheetName,
        labels: dailyTrend.labels,
        series: dailyTrend.series,
        rowCount: dailyTrend.labels.length,
        status: 'extracted',
      })
    }

    const dayOfWeekHeaders = mixedHeaders.slice(11, 21)
    const dayOfWeekRows = mixedRows
      .map((row) => row.slice(11, 21))
      .filter((row) => row.some((cell) => cell != null && String(cell).trim()))
    const dayOfWeekTrend = extractTrendData(dayOfWeekRows, dayOfWeekHeaders, 'dayOfWeek')
    if (dayOfWeekTrend.labels.length > 0) {
      sections.push({
        type: 'dayOfWeek',
        sheetName,
        labels: dayOfWeekTrend.labels,
        series: dayOfWeekTrend.series,
        rowCount: dayOfWeekTrend.labels.length,
        status: 'extracted',
      })
    }
  }

  return sections
}

function extractCreativeInfo(data, headers) {
  const creatives = []
  const campaignIdx = findColumnIndex(headers, [/^キャンペーン$/i])
  const adGroupIdx = findColumnIndex(headers, [/広告グループ/i])
  const imageIdx = findColumnIndex(headers, [/画像|image|バナー|banner/i])
  const fallbackNameIdx = findColumnIndex(headers, [/広告名|広告タイトル|クリエイティブ|creative|見出し/i])
  const titleCols = headers
    .map((header, index) => ({ header: String(header ?? ''), index }))
    .filter(({ header }) => /タイトル\d*|見出し\d*/i.test(header))
    .map(({ index }) => index)
  const descCols = headers
    .map((header, index) => ({ header: String(header ?? ''), index }))
    .filter(({ header }) => /説明文\d*|description/i.test(header))
    .map(({ index }) => index)

  for (const row of data) {
    const titleParts = titleCols
      .map((idx) => getCellText(row[idx]))
      .filter((value) => value && value !== '-')
    const descriptionParts = descCols
      .map((idx) => getCellText(row[idx]))
      .filter((value) => value && value !== '-')

    const name = titleParts[0] || (fallbackNameIdx >= 0 ? getCellText(row[fallbackNameIdx]) : null)
    if (!name || isSummaryLike(name)) continue

    const campaign = campaignIdx >= 0 ? getCellText(row[campaignIdx]) : null
    const adGroup = adGroupIdx >= 0 ? getCellText(row[adGroupIdx]) : null
    const imageUrl = imageIdx >= 0 ? normalizePotentialImageUrl(row[imageIdx]) : null
    const textPreview = [...titleParts.slice(1, 3), ...descriptionParts.slice(0, 2)]
      .filter(Boolean)
      .join(' / ')

    const kpis = {}
    for (const kpiKey of ['ctr', 'cvr', 'click', 'impr', 'cv', 'cost']) {
      const colIdx = findKpiColumn(headers, kpiKey)
      if (colIdx >= 0) kpis[kpiKey] = normalizeMetricValue(kpiKey, row[colIdx])
    }

    creatives.push({
      name,
      subtitle: [campaign, adGroup].filter(Boolean).join(' / ') || null,
      description: textPreview || null,
      imageUrl,
      kpis,
    })
  }

  return creatives
}

function buildChartGroupsFromExcel(sections) {
  const groups = []

  if (sections.monthly?.status === 'extracted') {
    const monthly = sections.monthly
    const volumeDatasets = []
    if (monthly.series.click) volumeDatasets.push({ label: 'クリック数', data: monthly.series.click })
    if (monthly.series.cv) volumeDatasets.push({ label: 'CV数', data: monthly.series.cv })
    if (volumeDatasets.length === 0 && monthly.series.cost) {
      volumeDatasets.push({ label: '費用', data: monthly.series.cost })
    }
    if (volumeDatasets.length > 0) {
      groups.push({
        title: '月別推移トレンド',
        labels: monthly.labels,
        datasets: volumeDatasets,
        chartType: 'line',
        _source: 'excel',
      })
    }

    const rateDatasets = []
    if (monthly.series.ctr) rateDatasets.push({ label: 'CTR', data: monthly.series.ctr, isPercent: true })
    if (monthly.series.cvr) rateDatasets.push({ label: 'CVR', data: monthly.series.cvr, isPercent: true })
    if (monthly.series.roas) rateDatasets.push({ label: 'ROAS', data: monthly.series.roas, isPercent: true })
    if (rateDatasets.length > 0) {
      groups.push({
        title: '月別効率指標推移',
        labels: monthly.labels,
        datasets: rateDatasets,
        chartType: 'line',
        _source: 'excel',
      })
    }
  }

  if (sections.adGroup?.status === 'extracted') {
    const adGroup = sections.adGroup
    const metricKey = adGroup.series.click ? 'click' : adGroup.series.cv ? 'cv' : adGroup.series.cost ? 'cost' : null
    if (metricKey) {
      groups.push({
        title: '広告グループ別掲載結果',
        labels: adGroup.labels,
        datasets: [
          {
            label: metricKey === 'click' ? 'クリック数' : metricKey === 'cv' ? 'CV数' : '費用',
            data: adGroup.series[metricKey],
            isPercent: false,
          },
        ],
        chartType: 'bar_horizontal',
        _source: 'excel',
      })
    }
  }

  if (sections.campaign?.status === 'extracted') {
    const campaign = sections.campaign
    const metricKey = campaign.series.click ? 'click' : campaign.series.cv ? 'cv' : campaign.series.cost ? 'cost' : null
    if (metricKey) {
      groups.push({
        title: 'キャンペーン別実績',
        labels: campaign.labels,
        datasets: [
          {
            label: metricKey === 'click' ? 'クリック数' : metricKey === 'cv' ? 'CV数' : '費用',
            data: campaign.series[metricKey],
            isPercent: false,
          },
        ],
        chartType: 'bar_horizontal',
        _source: 'excel',
      })
    }
  }

  return groups
}

function scoreSection(section) {
  const seriesCount = Object.keys(section?.series || {}).length
  return seriesCount * 100 + (section?.rowCount || 0)
}

function upsertSection(sections, section) {
  const current = sections[section.type]
  if (!current || scoreSection(section) > scoreSection(current)) {
    sections[section.type] = section
  }
}

function buildKpisFromSections(sections) {
  for (const key of ['monthly', 'daily']) {
    const section = sections[key]
    if (section?.status !== 'extracted') continue

    const kpis = {}
    for (const [kpiKey, values] of Object.entries(section.series || {})) {
      const latest = [...values].reverse().find((value) => value != null)
      if (latest != null) kpis[kpiKey] = latest
    }
    if (Object.keys(kpis).length > 0) return kpis
  }

  return {}
}

export async function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'array', cellDates: true })
        resolve(extractFromWorkbook(workbook, file.name))
      } catch (error) {
        reject(new Error(`Excel解析エラー: ${error.message}`))
      }
    }
    reader.onerror = () => reject(new Error('ファイル読み込みに失敗しました'))
    reader.readAsArrayBuffer(file)
  })
}

export function extractFromWorkbook(workbook, fileName) {
  const sections = {}
  const warnings = []
  const creativeRefs = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
    if (rows.length < 2) continue

    if (sheetName.toLowerCase() === 'gsn' || rows.some((row) => row.some((cell) => /1\.\s*月別推移/.test(String(cell ?? ''))))) {
      const summarySections = extractSummarySections(rows, sheetName)
      for (const section of summarySections) {
        upsertSection(sections, section)
      }
      continue
    }

    const headerRowIdx = findHeaderRowIndex(rows)
    const headers = rows[headerRowIdx] || []
    const data = rows
      .slice(headerRowIdx + 1)
      .filter((row) => row.some((cell) => cell != null && String(cell).trim()))

    if (headers.length === 0 || data.length === 0) continue

    const previewRows = data.slice(0, 5)
    const sectionType = detectSectionType(sheetName, headers, previewRows)

    if (sectionType === 'cover' || sectionType === 'raw' || sectionType === 'keyword' || sectionType === 'time') {
      continue
    }

    if (sectionType === 'creative') {
      creativeRefs.push(...extractCreativeInfo(data, headers))
      continue
    }

    if (['monthly', 'daily', 'dayOfWeek', 'adGroup', 'campaign', 'searchQuery'].includes(sectionType)) {
      const trend = extractTrendData(data, headers, sectionType)
      if (trend.labels.length > 0) {
        upsertSection(sections, {
          type: sectionType,
          sheetName,
          labels: trend.labels,
          series: trend.series,
          rowCount: trend.labels.length,
          status: 'extracted',
        })
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
    if (!sections[key]) {
      sections[key] = { type: key, status: 'not_found' }
    }
  }

  if (creativeRefs.length === 0) {
    warnings.push('広告クリエイティブ情報が検出されませんでした')
  } else if (creativeRefs.every((ref) => !ref.imageUrl)) {
    warnings.push('このレポートには画像バナーが含まれていないため、クリエイティブ欄には広告文を表示しています')
  }

  return {
    fileName,
    importedAt: new Date().toISOString(),
    kpis: buildKpisFromSections(sections),
    sections,
    creativeRefs,
    chartGroups: buildChartGroupsFromExcel(sections),
    warnings,
    status: Object.values(sections).some((section) => section.status === 'extracted') ? 'partial' : 'empty',
  }
}

export function getExtractionSummary(result) {
  if (!result) return []

  return [
    { label: '月別推移', status: result.sections?.monthly?.status ?? 'not_found', count: result.sections?.monthly?.rowCount },
    { label: '広告グループ別', status: result.sections?.adGroup?.status ?? 'not_found', count: result.sections?.adGroup?.rowCount },
    { label: '広告クリエイティブ', status: result.creativeRefs?.length > 0 ? 'extracted' : 'not_found', count: result.creativeRefs?.length },
    { label: '検索クエリ', status: result.sections?.searchQuery?.status ?? 'not_found', count: result.sections?.searchQuery?.rowCount },
    { label: '日別推移', status: result.sections?.daily?.status ?? 'not_found', count: result.sections?.daily?.rowCount },
    { label: '曜日別', status: result.sections?.dayOfWeek?.status ?? 'not_found', count: result.sections?.dayOfWeek?.rowCount },
  ]
}
