import { bqGenerateBatch } from '../api/adsInsights'

const GENERATE_RETRY_DELAYS_MS = [800, 1600]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableError(error) {
  return !error?.status || error.status === 429 || error.status >= 500
}

export function pickReportMarkdown(result) {
  const candidates = [
    result?.report_md,
    result?.point_pack,
    result?.point_pack_md,
    result?.markdown,
    result?.content,
    result?.text,
  ]

  return candidates.find((value) => typeof value === 'string' && value.trim().length > 0) ?? ''
}

export function pickChartGroups(result, periodTag) {
  const groups = Array.isArray(result?.chart_data?.groups) ? result.chart_data.groups : []
  return groups.map((group) => ({ ...group, _periodTag: periodTag }))
}

export function getChartPeriodTags(chartGroups = []) {
  return [...new Set(chartGroups.map((group) => group?._periodTag).filter(Boolean))]
}

function getChartGroupTitle(group, index) {
  const fallbackTitle = `chart-${index + 1}`
  return typeof group?.title === 'string' && group.title.trim().length > 0
    ? group.title.trim()
    : fallbackTitle
}

export function mergeChartGroupsByTitle(chartGroups = []) {
  if (!Array.isArray(chartGroups) || chartGroups.length === 0) return []

  const titleMap = new Map()

  chartGroups.forEach((group, index) => {
    const title = getChartGroupTitle(group, index)

    if (!titleMap.has(title)) titleMap.set(title, [])
    titleMap.get(title).push(group)
  })

  const mergedGroups = []

  for (const [, groupList] of titleMap) {
    if (groupList.length === 1) {
      mergedGroups.push(groupList[0])
      continue
    }

    const baseGroup = groupList[0]
    const mergedDatasets = []

    groupList.forEach((group, index) => {
      const periodTag = group?._periodTag || `Period ${index + 1}`
      const datasets = Array.isArray(group?.datasets) ? group.datasets : []

      datasets.forEach((dataset, datasetIndex) => {
        const label =
          typeof dataset?.label === 'string' && dataset.label.trim().length > 0
            ? dataset.label.trim()
            : `Dataset ${datasetIndex + 1}`

        mergedDatasets.push({
          ...dataset,
          label: `${label} (${periodTag})`,
        })
      })
    })

    mergedGroups.push({
      ...baseGroup,
      _periodTag: '',
      datasets: mergedDatasets,
    })
  }

  return mergedGroups
}

export function dedupeExactChartGroups(chartGroups = []) {
  if (!Array.isArray(chartGroups) || chartGroups.length === 0) return []

  const seen = new Set()
  const deduped = []

  chartGroups.forEach((group) => {
    const title = group?.title || ''
    const labels = JSON.stringify(group?.labels || [])
    const datasetsSignature = (Array.isArray(group?.datasets) ? group.datasets : [])
      .map((dataset) => `${dataset?.label || ''}:${JSON.stringify(dataset?.data || [])}`)
      .join('|')
    const signature = `${title}__${labels}__${datasetsSignature}`

    if (seen.has(signature)) return

    seen.add(signature)
    deduped.push(group)
  })

  return deduped
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null
  const normalized =
    typeof value === 'string' ? Number(value.trim().replace(/,/g, '').replace(/[%％]$/, '')) : Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

export function isMeaningfulChartGroup(group) {
  const values = (Array.isArray(group?.datasets) ? group.datasets : [])
    .flatMap((dataset) => (Array.isArray(dataset?.data) ? dataset.data : []))
    .map(toFiniteNumber)
    .filter((value) => value != null)

  if (values.length === 0) return false
  if (values.length === 1) return true

  const first = values[0]
  return values.some((value) => value !== first)
}

export function getDisplayChartGroups(chartGroups = [], periodFilter = 'latest') {
  if (!Array.isArray(chartGroups) || chartGroups.length === 0) return []

  let groups

  if (periodFilter === 'all') {
    groups = mergeChartGroupsByTitle(chartGroups)
  } else {
    const periodTags = getChartPeriodTags(chartGroups)
    let targetTag = periodFilter

    if (targetTag === 'latest' && periodTags.length > 0) {
      targetTag = periodTags[periodTags.length - 1]
    }

    groups = !targetTag
      ? dedupeExactChartGroups(chartGroups)
      : dedupeExactChartGroups(chartGroups.filter((group) => group?._periodTag === targetTag))
  }

  return groups.filter(isMeaningfulChartGroup)
}

export function buildAiChartContext(chartGroups = []) {
  if (!Array.isArray(chartGroups) || chartGroups.length === 0) return null

  const contextGroups = mergeChartGroupsByTitle(chartGroups).filter(isMeaningfulChartGroup)
  if (contextGroups.length === 0) return null

  return contextGroups
    .map((group) => ({
      title: group?.title ?? '',
      chartType: group?.chartType ?? 'line',
      labels: Array.isArray(group?.labels) ? group.labels : [],
      datasets: (Array.isArray(group?.datasets) ? group.datasets : []).map((dataset) => ({
        label: dataset?.label ?? '',
        data: Array.isArray(dataset?.data) ? dataset.data : [],
      })),
      _periodTag: group?._periodTag ?? '',
    }))
    .filter(
      (group) =>
        group.title ||
        group.labels.length > 0 ||
        group.datasets.length > 0 ||
        group._periodTag,
    )
}

export async function generateBatchWithRetry(payload) {
  for (let attempt = 0; attempt <= GENERATE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await bqGenerateBatch(payload)
    } catch (error) {
      if (!isRetryableError(error) || attempt === GENERATE_RETRY_DELAYS_MS.length) {
        throw error
      }
      await sleep(GENERATE_RETRY_DELAYS_MS[attempt])
    }
  }

  throw new Error('BQレポート生成に失敗しました。')
}

export function buildAdsReportBundle({ setupState, results }) {
  const datasetId = setupState?.datasetId
  if (!datasetId) throw new Error('dataset_id が設定されていません。案件を選択してください。')
  const periods = setupState?.periods ?? []
  const periodReports = periods.map((periodTag, index) => {
    const result = results[index] ?? {}
    const reportMd = pickReportMarkdown(result)
    const chartGroups = pickChartGroups(result, periodTag)

    return {
      periodTag,
      label: periodTag,
      reportMd,
      chartGroups,
      raw: result,
    }
  })

  const reportSections = periodReports.filter((item) => item.reportMd)
  const reportMd =
    reportSections.length <= 1
      ? (reportSections[0]?.reportMd ?? '')
      : reportSections
          .map((item) => `# ${item.label}\n\n${item.reportMd}`)
          .join('\n\n---\n\n')

  return {
    source: 'bq_generate_batch',
    datasetId,
    reportMd,
    chartGroups: periodReports.flatMap((item) => item.chartGroups),
    periodReports,
    results,
    generatedAt: new Date().toISOString(),
  }
}

export async function regenerateAdsReportBundle(setupState) {
  if (!setupState?.queryTypes?.length || !setupState?.periods?.length) {
    throw new Error('セットアップ条件が不足しています。')
  }

  const results = []

  for (const period of setupState.periods) {
    const result = await generateBatchWithRetry({
      query_types: setupState.queryTypes,
      dataset_id: setupState.datasetId,
      period,
    })
    results.push(result)
  }

  return buildAdsReportBundle({ setupState, results })
}

export function extractMarkdownSummary(markdown) {
  if (typeof markdown !== 'string') return null

  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .filter((line) => !line.startsWith('|'))
    .filter((line) => !line.startsWith('- '))

  return lines.find((line) => line.length >= 20) ?? null
}

export function extractMarkdownHeadings(markdown) {
  if (typeof markdown !== 'string') return []

  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(#{1,3})\s+/.test(line))
    .map((line, index) => {
      const [, hashes, title] = line.match(/^(#{1,3})\s+(.+)$/) ?? []
      return {
        id: `heading-${index}`,
        level: hashes?.length ?? 1,
        title: title ?? line,
      }
    })
}
