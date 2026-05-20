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
  return groups.map((group) => normalizeChartGroupShape({ ...group, _periodTag: periodTag }))
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

function toFiniteNumber(value) {
  if (value == null || value === '') return null
  const normalized =
    typeof value === 'string' ? Number(value.trim().replace(/,/g, '').replace(/[%％]$/, '')) : Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

function normalizeWarningList(warnings) {
  if (!Array.isArray(warnings)) return []
  return warnings.filter((warning) => typeof warning === 'string' && warning.trim().length > 0)
}

function isRankingLikeChart(group) {
  const title = String(group?.title ?? '')
  const chartType = String(group?.chartType ?? '')
  return (
    Number.isFinite(Number(group?.limit)) ||
    chartType === 'bar_horizontal' ||
    /上位|ランキング|検索クエリ|LP分析|OS別|地域別|Top\s*\d+/i.test(title)
  )
}

function sameLabels(a = [], b = []) {
  return a.length === b.length && a.every((label, index) => label === b[index])
}

function getActualCountFromCoverage(coverageLabel) {
  const match = String(coverageLabel ?? '').match(/上位(\d+)件/)
  return match ? Number(match[1]) : null
}

function inferTrendSelectionLabel(group) {
  const title = String(group?.title ?? '')
  const coverageLabel = group?.coverageLabel ?? group?.metadata?.coverageLabel
  const actualCount = getActualCountFromCoverage(coverageLabel)
  if (!actualCount || !title.includes('日別推移')) return ''

  if (title.includes('LP分析')) return `セッション数上位${actualCount}LPを表示`
  if (title.includes('検索クエリ')) return `検索回数上位${actualCount}語を表示`
  if (title.includes('流入分析')) return `セッション数上位${actualCount}チャネルを表示`
  return ''
}

function inferRankingSelectionLabel(group) {
  const title = String(group?.title ?? '')
  const chartType = String(group?.chartType ?? '')
  const coverageLabel = group?.coverageLabel ?? group?.metadata?.coverageLabel
  const actualCount = getActualCountFromCoverage(coverageLabel)
  if (!actualCount || title.includes('日別推移')) return ''
  if (chartType !== 'bar_horizontal' && !/上位|ランキング|Top\s*\d+/i.test(title)) return ''

  if (title.includes('検索クエリ')) return `検索回数上位${actualCount}語を表示`
  if (title.includes('流入分析')) return `セッション数上位${actualCount}チャネルを表示`
  if (title.includes('ユーザー属性') && title.includes('地域')) return `セッション数上位${actualCount}地域を表示`
  if (title.includes('デバイス分析') && title.includes('OS')) return `セッション数上位${actualCount}OSを表示`
  if (title.includes('LP品質')) return `品質スコア上位${actualCount}LPを表示`
  if (title.includes('LP分析') && title.includes('直帰率')) return `直帰率上位${actualCount}LPを表示`
  if (title.includes('LP分析')) return `セッション数上位${actualCount}LPを表示`
  return ''
}

function normalizeTrendTitle(group, selectionLabel) {
  const title = String(group?.title ?? '')
  if (!selectionLabel || !title.includes('日別推移')) return title

  if (title.includes('LP分析')) return `LP分析 — ${selectionLabel.replace('を表示', '')}の日別推移`
  if (title.includes('検索クエリ')) return `検索クエリ — ${selectionLabel.replace('を表示', '')}の日別推移`
  if (title.includes('流入分析')) return `流入分析 — ${selectionLabel.replace('を表示', '')}の日別推移`
  return title
}

function normalizeRankingTitle(group, selectionLabel) {
  const title = String(group?.title ?? '')
  if (!selectionLabel || title.includes('日別推移')) return title

  if (title.includes('検索クエリ')) return `検索クエリ — ${selectionLabel.replace('を表示', '')}`
  if (title.includes('流入分析')) return `流入分析 — ${selectionLabel.replace('を表示', '')}`
  if (title.includes('ユーザー属性') && title.includes('地域')) return `ユーザー属性 — ${selectionLabel.replace('を表示', '')}`
  if (title.includes('デバイス分析') && title.includes('OS')) return `デバイス分析 — ${selectionLabel.replace('を表示', '')}`
  if (title.includes('LP品質')) return `LP品質ランキング — ${selectionLabel.replace('を表示', '')}`
  if (title.includes('LP分析')) return `LP分析 — ${selectionLabel.replace('を表示', '')}`
  return title
}

export function normalizeChartGroupShape(group = {}) {
  const inferredSelectionLabel =
    group?.selectionLabel ||
    group?.metadata?.selectionLabel ||
    inferTrendSelectionLabel(group) ||
    inferRankingSelectionLabel(group)
  const originalTitle = String(group?.title ?? '')
  const trendTitle = normalizeTrendTitle(group, inferredSelectionLabel)
  const finalTitle =
    trendTitle !== originalTitle
      ? trendTitle
      : normalizeRankingTitle(group, inferredSelectionLabel)
  const rawLabels = Array.isArray(group?.labels) ? group.labels : []
  const rawDatasets = Array.isArray(group?.datasets) ? group.datasets : []
  const maxDataLength = rawDatasets.reduce(
    (max, dataset) => Math.max(max, Array.isArray(dataset?.data) ? dataset.data.length : 0),
    0,
  )
  const normalizedLength = Math.max(rawLabels.length, maxDataLength)
  const labels = Array.from({ length: normalizedLength }, (_, index) => {
    const label = rawLabels[index]
    if (label == null || String(label).trim() === '') return `未対応ラベル ${index + 1}`
    return String(label)
  })

  let missingDataPoints = 0
  let overflowDataPoints = 0
  let finiteValueCount = 0

  const datasets = rawDatasets.map((dataset, datasetIndex) => {
    const data = Array.isArray(dataset?.data) ? dataset.data : []
    if (data.length < normalizedLength) missingDataPoints += normalizedLength - data.length
    if (data.length > rawLabels.length) overflowDataPoints += data.length - rawLabels.length

    const normalizedData = Array.from({ length: normalizedLength }, (_, index) => {
      const value = index < data.length ? data[index] : null
      if (value == null || value === '') {
        missingDataPoints += index < data.length ? 1 : 0
        return null
      }
      const numeric = toFiniteNumber(value)
      if (numeric == null) {
        missingDataPoints += 1
        return null
      }
      finiteValueCount += 1
      return value
    })

    return {
      ...dataset,
      label:
        typeof dataset?.label === 'string' && dataset.label.trim().length > 0
          ? dataset.label.trim()
          : `Dataset ${datasetIndex + 1}`,
      data: normalizedData,
    }
  })

  const warnings = new Set(normalizeWarningList(group?.warnings))
  if (rawLabels.length !== maxDataLength && rawDatasets.length > 0) warnings.add('label_data_mismatch')
  if (missingDataPoints > 0) warnings.add('missing_values')
  if (overflowDataPoints > 0) warnings.add('overflow_values')

  return {
    ...group,
    title: finalTitle,
    selectionLabel: inferredSelectionLabel,
    labels,
    datasets,
    warnings: [...warnings],
    metadata: {
      ...(group?.metadata ?? {}),
      selectionLabel: inferredSelectionLabel,
      labelCount: labels.length,
      maxDataLength,
      missingDataPoints,
      overflowDataPoints,
      finiteValueCount,
      hasLabelDataMismatch: rawLabels.length !== maxDataLength && rawDatasets.length > 0,
    },
  }
}

export function mergeChartGroupsByTitle(chartGroups = []) {
  if (!Array.isArray(chartGroups) || chartGroups.length === 0) return []

  const titleMap = new Map()

  chartGroups.forEach((group, index) => {
    const normalizedGroup = normalizeChartGroupShape(group)
    const title = getChartGroupTitle(normalizedGroup, index)

    if (!titleMap.has(title)) titleMap.set(title, [])
    titleMap.get(title).push(normalizedGroup)
  })

  const mergedGroups = []

  for (const [, groupList] of titleMap) {
    if (groupList.length === 1) {
      mergedGroups.push(normalizeChartGroupShape(groupList[0]))
      continue
    }

    const baseGroup = groupList[0]
    const canMerge =
      !groupList.some(isRankingLikeChart) &&
      groupList.every((group) => group?.chartType === baseGroup?.chartType && sameLabels(group?.labels ?? [], baseGroup?.labels ?? []))

    if (!canMerge) {
      groupList.forEach((group) => mergedGroups.push(normalizeChartGroupShape(group)))
      continue
    }

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

  return mergedGroups.map(normalizeChartGroupShape)
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

export function isMeaningfulChartGroup(group) {
  const normalizedGroup = normalizeChartGroupShape(group)
  const values = (Array.isArray(normalizedGroup?.datasets) ? normalizedGroup.datasets : [])
    .flatMap((dataset) => (Array.isArray(dataset?.data) ? dataset.data : []))
    .map(toFiniteNumber)
    .filter((value) => value != null)

  return values.length > 0
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

  return groups.map(normalizeChartGroupShape).filter(isMeaningfulChartGroup)
}

export function buildAnalysisInstructions(queryTypes = [], periods = []) {
  const typeLabels = {
    pv_analysis: 'ページビュー分析',
    traffic_analysis: 'トラフィック分析',
    cv_analysis: 'コンバージョン分析',
    device_analysis: 'デバイス分析',
    user_analysis: 'ユーザー行動分析',
  }
  const types = queryTypes.map(t => typeLabels[t] || t).join('、')
  const periodInfo = periods.length > 1
    ? `複数期間（${periods.join('、')}）の比較データ`
    : periods[0] ? `期間: ${periods[0]}` : ''

  const lenses = [
    `1. ビジネス影響: 指標が収益・リードに与える影響を定量化`,
    `2. ファネル品質: PV→セッション→エンゲージメント→CVの各段階転換率。業界一般水準（CVR 1-3%、直帰率40-60%）と比較`,
    `3. チャネル効率: source/medium別の流入効率を比較。チャネル間の補完・カニバリゼーションも評価`,
    `4. ユーザー行動: デバイス・時間帯・地域パターン。モバイル比率70%超なら最優先課題として扱う`,
    `5. 異常分解: ±30%以上の急変動は流入元・デバイス・時間帯・地域で要因分解`,
    `6. 時間帯戦略: トラフィックピークとCVピークの相関。デイパート別の最適化提案`,
    `7. クロスチャネル相関: 複数チャネルの同時変動パターン検出`,
  ]

  const typeDirectives = {
    pv_analysis: 'PV/セッション比で回遊深度を評価。曜日パターンを特定。突出ページは流入元別・デバイス別で要因分解',
    traffic_analysis: 'source/medium別の構成比と前期間比を対比。単一チャネル依存50%超はリスク評価',
    cv_analysis: 'CVイベント種別の傾向。カート→購入率が40%未満なら決済フロー課題の仮説提示。デバイス別CVR比較',
    device_analysis: 'モバイル70%超の場合: モバイル/PCの直帰率・CVR数値比較、モバイル固有UX課題、モバイル優先CRO提案',
    user_analysis: '新規/リピーター比率の健全性評価。都市別で主要エリア外の成長機会を特定',
  }

  const activeDirectives = queryTypes
    .filter(t => typeDirectives[t])
    .map(t => `- ${typeDirectives[t]}`)

  const comparisonDirective = periods.length > 1
    ? [
        `複数期間（${periods.join('、')}）の比較要件:`,
        `- 全指標の前後比較を表形式で提示`,
        `- 改善指標と悪化指標を明確に分離`,
        `- 最大変化率の指標を上位3つまで特定`,
      ].join('\n')
    : ''

  return [
    `【分析フレームワーク】`,
    `データ種別: ${types || 'GA4ウェブ解析データ'}。${periodInfo}`,
    ``,
    `評価レンズ:`,
    ...lenses,
    ...(activeDirectives.length > 0
      ? [``, `クエリ別追加要件:`, ...activeDirectives]
      : []),
    ...(comparisonDirective ? [``, comparisonDirective] : []),
    ``,
    `【類推ルール（厳守）】`,
    `類推を行う場合、以下の証拠種別のうち最低1つを明示:`,
    `- 日付相関: 特定日の変動と外部イベントの日付照合`,
    `- 地域相関: 地域別データによる事象関連トラフィックの検証`,
    `- 流入元相関: source/medium別内訳による仮説の検証`,
    `- デバイス相関: デバイス別パターンによるユーザー層推定`,
    `× 「マラソンイベントが影響した可能性がある」`,
    `○ 「【類推】2/23のPV急増（+45%）は大阪マラソンと日付が一致。大阪からのアクセスが前週比+40%（地域相関）」`,
    ``,
    `【アクション要件】`,
    `推奨アクションは以下を満たす:`,
    `- 優先度: P0（即時）/ P1（今週）/ P2（来月）`,
    `- 具体性: 何を・どの程度・いつまでに`,
    `- 期待効果: 想定改善幅（例: 直帰率10pt改善でCV +15件/月）`,
    ``,
    `【フォーマット要件（厳守）】`,
    `出力の構成比率: 段落（散文）50%以上 / テーブル・表 20%以上 / 箇条書き 30%以下`,
    `- 比較・数値対比 → テーブルを使う`,
    `- 原因分析・仮説・背景説明 → 段落（散文）で書く`,
    `- アクション列挙のみ → 箇条書きを使う`,
    `- 箇条書きだけでセクションを構成してはならない`,
  ].join('\n')
}

function normalizeSearchText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-') // unify dashes
    .replace(/[\s\u3000]+/g, ' ') // unify whitespace incl full-width
    .trim()
}

/**
 * Match the chart groups most relevant to an AI response by scoring title,
 * KPI-label, and dataset-label hits against the response text. Used to power
 * the related-charts accordion in InsightTurnCard.
 */
export function matchRelevantCharts(aiContent, chartGroups, { limit = 3 } = {}) {
  if (!aiContent || !Array.isArray(chartGroups) || chartGroups.length === 0) return []
  const normalized = normalizeSearchText(aiContent)
  if (!normalized) return []

  const scored = chartGroups.map((group) => {
    const title = group?.title || ''
    const titleHit = title && normalized.includes(normalizeSearchText(title)) ? 3 : 0

    let kpiHit = 0
    const kpis = Array.isArray(group?.kpis) ? group.kpis : []
    for (const kpi of kpis) {
      const label = kpi?.label || ''
      if (label && normalized.includes(normalizeSearchText(label))) kpiHit += 1
    }
    const datasets = Array.isArray(group?.datasets) ? group.datasets : []
    for (const ds of datasets) {
      const label = ds?.label || ''
      if (label && normalized.includes(normalizeSearchText(label))) kpiHit += 1
    }

    return { group, score: titleHit + kpiHit }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map((s) => s.group)
}

export function buildAiChartContext(chartGroups = []) {
  if (!Array.isArray(chartGroups) || chartGroups.length === 0) return null

  const contextGroups = mergeChartGroupsByTitle(chartGroups)
    .map(normalizeChartGroupShape)
    .filter(isMeaningfulChartGroup)
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
  const resultsByPeriod = new Map()
  ;(Array.isArray(results) ? results : []).forEach((result, index) => {
    const resultPeriod = result?.period ?? result?.periodTag ?? periods[index]
    if (resultPeriod) resultsByPeriod.set(resultPeriod, result)
  })
  const periodReports = periods.map((periodTag, index) => {
    const result = resultsByPeriod.get(periodTag) ?? results[index] ?? {}
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
  const fallbackReportMd = [
    '# 分析データの確認待ち',
    '',
    `対象データセット: ${datasetId}`,
    `対象期間: ${periods.join('、') || '未指定'}`,
    `分析項目: ${(setupState?.queryTypes ?? []).join('、') || '未指定'}`,
    '',
    'BigQueryからレポート本文が返っていないため、現時点では数値断定を避けて質問に回答します。',
    '「どの指標を見るべきか」「不足データをどう確認するか」「次に取得すべきレポート」を中心にAI考察できます。',
  ].join('\n')

  return {
    source: 'bq_generate_batch',
    dataAvailability: reportMd ? 'full' : 'fallback',
    missingReason: reportMd ? '' : 'BigQueryからレポート本文が返っていません。',
    datasetId,
    reportMd: reportMd || fallbackReportMd,
    chartGroups: periodReports.flatMap((item) => item.chartGroups),
    periodReports,
    results,
    generatedAt: new Date().toISOString(),
  }
}

export function buildAdsFallbackReportBundle(setupState, reason = 'BQレポート本文の取得待ち') {
  const periods = setupState?.periods ?? []
  const results = periods.map((period) => ({
    ok: true,
    report_md: [
      '# 分析データの暫定コンテキスト',
      '',
      `対象期間: ${period}`,
      `状態: ${reason}`,
      '',
      '数値断定は避け、確認すべき指標・仮説・追加取得データを中心に回答します。',
    ].join('\n'),
    chart_data: {},
    results: {},
    skipped: setupState?.queryTypes ?? [],
    fallback_reason: reason,
  }))

  return {
    ...buildAdsReportBundle({ setupState, results }),
    source: 'bq_generate_fallback',
    dataAvailability: 'fallback',
    missingReason: reason,
  }
}

export async function regenerateAdsReportBundle(setupState) {
  if (!setupState?.queryTypes?.length || !setupState?.periods?.length) {
    throw new Error('セットアップ条件が不足しています。')
  }

  const results = await Promise.all(
    setupState.periods.map(period =>
      generateBatchWithRetry({
        query_types: setupState.queryTypes,
        dataset_id: setupState.datasetId,
        period,
      }).then((result) => ({ ...result, period }))
    )
  )

  return buildAdsReportBundle({ setupState, results })
}

export function extractMarkdownSummary(markdown) {
  if (typeof markdown !== 'string') return null
  const lines = markdown.split(/\r?\n/)
  const summaryLines = []
  let lastWasHeading = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^#{1,3}\s/.test(trimmed)) {
      summaryLines.push(trimmed)
      lastWasHeading = true
    } else if (lastWasHeading && trimmed.length > 0) {
      summaryLines.push(trimmed)
      lastWasHeading = false
    }
  }
  return summaryLines.join('\n') || null
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
