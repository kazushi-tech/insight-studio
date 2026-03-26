import { bqGenerateBatch, DEFAULT_ADS_DATASET_ID } from '../api/adsInsights'

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
  const datasetId = setupState?.datasetId ?? DEFAULT_ADS_DATASET_ID
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
      dataset_id: setupState.datasetId ?? DEFAULT_ADS_DATASET_ID,
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
