import { bqGenerateBatch } from '../api/adsInsights'
import { latestPeriodValue } from './wizardPeriods'

const GENERATE_RETRY_DELAYS_MS = [800, 1600]

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableError(error) {
  // data_availability === 'failed' のような決定論的失敗（BQ全失敗）は
  // 再試行しても成功しないため、再試行対象から除外する。
  if (error?.deterministic) return false
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

export function pickExecutionSummary(result, periodTag) {
  const summary = Array.isArray(result?.execution_summary)
    ? result.execution_summary
    : result?.execution_summary
      ? [result.execution_summary]
      : []

  return summary
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      periodTag,
      query_type: item.query_type ?? item.queryType ?? '',
      queryType: item.query_type ?? item.queryType ?? '',
      status: item.status ?? 'unknown',
      row_count: Number.isFinite(Number(item.row_count)) ? Number(item.row_count) : null,
      rowCount: Number.isFinite(Number(item.row_count ?? item.rowCount)) ? Number(item.row_count ?? item.rowCount) : null,
      chart_group_count: Number.isFinite(Number(item.chart_group_count)) ? Number(item.chart_group_count) : 0,
      chartGroupCount: Number.isFinite(Number(item.chart_group_count ?? item.chartGroupCount)) ? Number(item.chart_group_count ?? item.chartGroupCount) : 0,
      message: item.message ?? '',
    }))
}

function normalizeDataAvailability(value, fallback = 'full') {
  const normalized = String(value ?? '').toLowerCase()
  if (['full', 'partial', 'failed', 'fallback', 'missing'].includes(normalized)) return normalized
  return fallback
}

function summarizeAvailability(results = [], periodReports = []) {
  const availabilityValues = (Array.isArray(results) ? results : [])
    .map((result) => normalizeDataAvailability(
      result?.data_availability ?? result?.dataAvailability,
      result?.ok === false ? 'failed' : 'full',
    ))
  const executionStatuses = periodReports
    .flatMap((item) => item.executionSummary ?? [])
    .map((item) => item.status)
    .filter(Boolean)

  const hasFailedResult = (Array.isArray(results) ? results : []).some((result) => result?.ok === false)
  const hasErrorStatus = executionStatuses.some((status) => ['error', 'unknown'].includes(status))
  const hasNoDataStatus = executionStatuses.some((status) => status === 'no_data')
  const hasAnySuccess = executionStatuses.some((status) => ['success', 'no_chart'].includes(status))
  const hasPartial = availabilityValues.some((value) => ['partial', 'missing'].includes(value)) || ((hasErrorStatus || hasNoDataStatus) && hasAnySuccess)
  const hasFailed = availabilityValues.some((value) => value === 'failed') || hasFailedResult || ((hasErrorStatus || hasNoDataStatus) && !hasAnySuccess && executionStatuses.length > 0)

  if (hasFailed && !hasAnySuccess && !hasPartial) return 'failed'
  if (hasFailed || hasPartial) return 'partial'
  if (availabilityValues.some((value) => value === 'fallback')) return 'fallback'
  return 'full'
}

function collectMissingReasons(results = [], executionSummary = []) {
  const reasons = []
  ;(Array.isArray(results) ? results : []).forEach((result) => {
    const reason = result?.missing_reason ?? result?.missingReason ?? result?.message ?? result?.error
    if (reason) reasons.push(String(reason))
  })
  ;(Array.isArray(executionSummary) ? executionSummary : []).forEach((item) => {
    if (['error', 'no_data', 'unknown'].includes(item?.status) && item?.message) {
      reasons.push(`${item.query_type || item.queryType || 'unknown'}: ${item.message}`)
    }
  })
  return [...new Set(reasons)].slice(0, 5).join(' / ')
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

function normalizeFriendlyChartTitle(title) {
  return String(title ?? '')
    .replace(/オークション圧分析/g, '流入集中の参考値')
    .replace(/オークション圧/g, '流入集中の参考値')
    .replace(/流入の競合影響チェック（推定）/g, '流入集中の参考値')
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

function inferQueryTypeFromTitle(title) {
  const text = String(title ?? '')
  if (/PV分析|ページビュー|見られた回数/i.test(text)) return 'pv'
  if (/流入分析|来訪元|チャネル|source|medium/i.test(text)) return 'traffic'
  if (/CV分析|コンバージョン|成果|問い合わせ|予約|購入/i.test(text)) return 'cv'
  if (/検索クエリ|サイト内.*検索/i.test(text)) return 'search'
  if (/異常検知|z[-_\s]?score|急に変わった/i.test(text)) return 'anomaly'
  if (/LP分析|ランディング|入口ページ/i.test(text)) return 'landing'
  if (/デバイス|スマホ|パソコン|OS/i.test(text)) return 'device'
  if (/時間帯|曜日|hourly/i.test(text)) return 'hourly'
  if (/ユーザー属性|年齢|性別|地域/i.test(text)) return 'user_attr'
  if (/エンゲージメント|ちゃんと読まれた/i.test(text)) return 'engagement'
  if (/流入集中|競合影響|有料流入への偏り/i.test(text)) return 'auction_proxy'
  return ''
}

export function normalizeChartGroupShape(group = {}) {
  const groupForTitle = {
    ...group,
    title: normalizeFriendlyChartTitle(group?.title ?? ''),
  }
  const inferredSelectionLabel =
    groupForTitle?.selectionLabel ||
    groupForTitle?.metadata?.selectionLabel ||
    inferTrendSelectionLabel(groupForTitle) ||
    inferRankingSelectionLabel(groupForTitle)
  const originalTitle = String(groupForTitle?.title ?? '')
  const trendTitle = normalizeTrendTitle(groupForTitle, inferredSelectionLabel)
  const finalTitle =
    trendTitle !== originalTitle
      ? trendTitle
      : normalizeRankingTitle(groupForTitle, inferredSelectionLabel)
  const queryType = String(
    group?.queryType ?? group?.query_type ?? group?.metadata?.queryType ?? group?.metadata?.query_type ?? inferQueryTypeFromTitle(finalTitle),
  )
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
    ...(queryType ? { queryType } : {}),
    title: normalizeFriendlyChartTitle(finalTitle),
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
      targetTag = latestPeriodValue(periodTags)
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
    `1. ビジネス影響: 取得済み指標が収益・リードに関係しそうな箇所を、根拠付きの仮説として整理`,
    `2. ファネル品質: PV→セッション→エンゲージメント→CVの各段階を確認。未取得のCVR/CPA/ROAS/広告費は断定しない`,
    `3. チャネル効率: source/medium別の流入効率を比較。チャネル間の補完・カニバリゼーションも評価`,
    `4. ユーザー行動: デバイス・時間帯・地域パターン。モバイル比率70%超なら最優先課題として扱う`,
    `5. 異常分解: ±30%以上の急変動は流入元・デバイス・時間帯・地域で要因分解`,
    `6. 時間帯戦略: トラフィックピークとCVピークの相関。デイパート別の最適化提案`,
    `7. クロスチャネル相関: 複数チャネルの同時変動パターン検出`,
  ]

  const typeDirectives = {
    pv_analysis: 'PV/セッション比で回遊深度を評価。曜日パターンを特定。突出ページは流入元別・デバイス別で要因仮説を分解',
    traffic_analysis: 'source/medium別の構成比と前期間比を対比。単一チャネル依存50%超はリスク評価',
    cv_analysis: 'CVイベント種別の傾向。CVRや決済フロー課題は、入力に該当イベントと母数がある場合のみ仮説提示',
    device_analysis: 'モバイル比率が高い場合: モバイル/PCの取得済み指標を比較し、未取得のCVRやCPAは追加確認に回す',
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
    `- 期待効果: 入力データに根拠がある場合だけ数値化し、ない場合は「見る指標」と「判定条件」に留める`,
    `- CPA/ROAS/CTR/CPC/広告費/インプレッションは、根拠パックに存在しない限り未取得として扱う`,
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

function formatEvidenceLabel(label) {
  const text = String(label ?? '').trim()
  const compactDate = text.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/)
  if (compactDate) return `${Number(compactDate[2])}/${Number(compactDate[3])}`
  return text
}

function buildDateAliases(label) {
  const text = String(label ?? '').trim()
  const match = text.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/)
  if (!match) return text ? [text] : []
  const [, year, month, day] = match
  const m = Number(month)
  const d = Number(day)
  return [
    `${year}${month}${day}`,
    `${year}-${month}-${day}`,
    `${year}/${m}/${d}`,
    `${year}年${m}月${d}日`,
    `${m}/${d}`,
  ]
}

function normalizeForPromptMatch(value) {
  return String(value ?? '').toLowerCase()
}

function compactDigits(value) {
  return String(value ?? '').replace(/[^0-9]/g, '')
}

function extractPromptMatchTokens(prompt) {
  const source = String(prompt ?? '')
  const tokens = new Set()
  const compactTokens = new Set()

  function addDate(year, month, day) {
    const y = String(year)
    const m = String(month).padStart(2, '0')
    const d = String(day).padStart(2, '0')
    const aliases = buildDateAliases(`${y}${m}${d}`)
    aliases.forEach((alias) => {
      tokens.add(normalizeForPromptMatch(alias))
      const compact = compactDigits(alias)
      if (compact.length >= 4) compactTokens.add(compact)
    })
  }

  for (const match of source.matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)) {
    addDate(match[1], match[2], match[3])
  }
  for (const match of source.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g)) {
    addDate(match[1], match[2], match[3])
  }
  for (const match of source.matchAll(/\b(\d{4})(\d{2})(\d{2})\b/g)) {
    addDate(match[1], match[2], match[3])
  }
  for (const match of source.matchAll(/(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?:[^\d]|$)/g)) {
    const alias = `${Number(match[1])}/${Number(match[2])}`
    tokens.add(alias)
    compactTokens.add(compactDigits(alias))
  }

  return { tokens, compactTokens }
}

function normalizeNumericToken(value) {
  const raw = String(value ?? '').replace(/,/g, '').trim()
  if (!raw) return ''
  const number = Number(raw)
  if (!Number.isFinite(number)) return ''
  if (Number.isInteger(number)) return String(number)
  return String(number).replace(/\.0+$/, '')
}

function extractPromptValueTokens(prompt) {
  const source = String(prompt ?? '')
  const values = new Set()
  for (const match of source.matchAll(/\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const normalized = normalizeNumericToken(match[0])
    if (!normalized || normalized.length < 2) continue
    const numeric = Number(normalized)
    if (Number.isInteger(numeric) && numeric >= 1900 && numeric <= 2099) continue
    values.add(normalized)
  }
  return values
}

function collectChartValueTokens(group) {
  const normalized = normalizeChartGroupShape(group)
  const values = new Set()
  for (const dataset of Array.isArray(normalized.datasets) ? normalized.datasets : []) {
    for (const value of Array.isArray(dataset?.data) ? dataset.data : []) {
      const token = normalizeNumericToken(value)
      if (token) values.add(token)
    }
  }
  return values
}

function chartGroupSearchText(group) {
  const normalized = normalizeChartGroupShape(group)
  const parts = [
    normalized.title,
    normalized._periodTag,
    normalized.periodTag,
    normalized.queryType,
    normalized.selectionLabel,
    ...(Array.isArray(normalized.labels) ? normalized.labels : []),
    ...(Array.isArray(normalized.datasets) ? normalized.datasets.map((dataset) => dataset?.label) : []),
  ].filter(Boolean)

  const dateAliases = parts.flatMap((part) => buildDateAliases(part))
  const text = [...parts, ...dateAliases].map(normalizeForPromptMatch).join(' ')
  const compact = [...parts, ...dateAliases].map(compactDigits).filter(Boolean).join(' ')
  return { text, compact, normalized }
}

function scoreChartGroupForPrompt(prompt, group) {
  const source = normalizeForPromptMatch(prompt)
  const { tokens, compactTokens } = extractPromptMatchTokens(prompt)
  const { text, compact } = chartGroupSearchText(group)
  const promptValues = extractPromptValueTokens(prompt)
  const chartValues = collectChartValueTokens(group)
  let score = 0

  for (const token of tokens) {
    if (token && text.includes(token)) score += 100
  }
  for (const token of compactTokens) {
    if (token && token.length >= 4 && compact.includes(token)) score += 100
  }
  for (const value of promptValues) {
    if (chartValues.has(value)) score += 120
  }

  const keywordPairs = [
    ['流入', /流入|チャネル|organic|referral|direct|social/i],
    ['チャネル', /流入|チャネル|organic|referral|direct|social/i],
    ['pv', /pv|ページビュー|ユーザー|セッション/i],
    ['PV', /pv|ページビュー|ユーザー|セッション/i],
    ['セッション', /pv|ページビュー|ユーザー|セッション/i],
    ['検索', /検索|クエリ/i],
    ['lp', /lp|ランディング|ページ/i],
    ['LP', /lp|ランディング|ページ/i],
    ['デバイス', /デバイス|os|ブラウザ/i],
    ['地域', /地域|都道府県|市区町村/i],
  ]

  for (const [keyword, pattern] of keywordPairs) {
    if (source.includes(normalizeForPromptMatch(keyword)) && pattern.test(text)) score += 20
  }

  return score
}

export function selectChartGroupsForPrompt(chartGroups = [], prompt = '', options = {}) {
  if (!Array.isArray(chartGroups) || chartGroups.length === 0) return []
  const maxGroups = Number.isFinite(Number(options.maxGroups)) ? Number(options.maxGroups) : 36
  const fallbackOnNoMatch = options.fallbackOnNoMatch !== false
  const scored = chartGroups
    .map((group, index) => ({ group, index, score: scoreChartGroupForPrompt(prompt, group) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)

  if (scored.length === 0) return fallbackOnNoMatch ? chartGroups.slice(0, maxGroups) : []
  return scored.slice(0, maxGroups).map((item) => item.group)
}

function buildSeriesEvidence(dataset, labels) {
  const data = Array.isArray(dataset?.data) ? dataset.data : []
  const points = data.map((value, index) => {
    const numeric = toFiniteNumber(value)
    const rawLabel = labels[index] ?? `#${index + 1}`
    return {
      index,
      label: formatEvidenceLabel(rawLabel),
      rawLabel,
      aliases: buildDateAliases(rawLabel),
      value: numeric,
    }
  })
  const validPoints = points.filter((point) => point.value != null)
  const missingCount = points.length - validPoints.length
  if (validPoints.length === 0) {
    return {
      label: dataset?.label ?? 'データ',
      point_count: points.length,
      missing_count: missingCount,
      points: [],
      latest: null,
      first: null,
      total: null,
      average: null,
      max: null,
      min: null,
      change_from_first: null,
      notable_swings: [],
      top_points: [],
    }
  }

  const total = validPoints.reduce((sum, point) => sum + point.value, 0)
  const first = validPoints[0]
  const latest = validPoints[validPoints.length - 1]
  const max = validPoints.reduce((best, point) => (point.value > best.value ? point : best), validPoints[0])
  const min = validPoints.reduce((best, point) => (point.value < best.value ? point : best), validPoints[0])
  const changeFromFirst = first.value === 0
    ? null
    : {
        from_label: first.label,
        to_label: latest.label,
        absolute: latest.value - first.value,
        percent: ((latest.value - first.value) / first.value) * 100,
      }

  const notableSwings = []
  for (let index = 1; index < validPoints.length; index += 1) {
    const previous = validPoints[index - 1]
    const current = validPoints[index]
    if (previous.value === 0) continue
    const percent = ((current.value - previous.value) / previous.value) * 100
    if (Math.abs(percent) >= 30) {
      notableSwings.push({
        from_label: previous.label,
        to_label: current.label,
        from_value: previous.value,
        to_value: current.value,
        percent,
      })
    }
  }

  const topPoints = [...validPoints]
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)
    .map(({ label, rawLabel, aliases, value }) => ({ label, rawLabel, aliases, value }))

  return {
    label: dataset?.label ?? 'データ',
    point_count: points.length,
    missing_count: missingCount,
    points: validPoints.map(({ label, rawLabel, aliases, value }) => ({ label, rawLabel, aliases, value })),
    latest: { label: latest.label, rawLabel: latest.rawLabel, aliases: latest.aliases, value: latest.value },
    first: { label: first.label, rawLabel: first.rawLabel, aliases: first.aliases, value: first.value },
    total,
    average: total / validPoints.length,
    max: { label: max.label, rawLabel: max.rawLabel, aliases: max.aliases, value: max.value },
    min: { label: min.label, rawLabel: min.rawLabel, aliases: min.aliases, value: min.value },
    change_from_first: changeFromFirst,
    notable_swings: notableSwings
      .sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent))
      .slice(0, 5),
    top_points: topPoints,
  }
}

export function buildChartEvidencePack(chartGroups = [], options = {}) {
  if (!Array.isArray(chartGroups) || chartGroups.length === 0) return null

  const scopeLabel = options.scopeLabel ?? ''
  const maxCharts = Number.isFinite(Number(options.maxCharts)) ? Number(options.maxCharts) : 24
  const contextGroups = chartGroups
    .map(normalizeChartGroupShape)
    .filter(isMeaningfulChartGroup)
    .slice(0, maxCharts)

  if (contextGroups.length === 0) return null

  const charts = contextGroups.map((group, index) => {
    const title = getChartGroupTitle(group, index)
    const periodTag = group?._periodTag ?? group?.periodTag ?? ''
    const labels = Array.isArray(group?.labels) ? group.labels : []
    const series = (Array.isArray(group?.datasets) ? group.datasets : [])
      .map((dataset) => buildSeriesEvidence(dataset, labels))
      .filter((item) => item.point_count > 0)
    const missingValues = series.reduce((sum, item) => sum + item.missing_count, 0)
    const finiteValues = series.reduce((sum, item) => sum + Math.max(0, item.point_count - item.missing_count), 0)
    const rankingTop = series.flatMap((item) =>
      item.top_points.slice(0, 5).map((point) => ({
        series_label: item.label,
        label: point.label,
        rawLabel: point.rawLabel,
        value: point.value,
      })),
    )

    return {
      chart_id: `chart_${String(index + 1).padStart(2, '0')}`,
      title,
      chart_type: group?.chartType ?? 'line',
      period_tag: periodTag,
      query_type: group?.queryType ?? group?.metadata?.queryType ?? '',
      selection_label: group?.selectionLabel ?? group?.metadata?.selectionLabel ?? '',
      label_count: labels.length,
      series_count: series.length,
      missing_values: missingValues,
      finite_values: finiteValues,
      series,
      ranking_top: rankingTop
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
      warnings: Array.isArray(group?.warnings) ? group.warnings : [],
    }
  }).filter((chart) => chart.series.length > 0)

  if (charts.length === 0) return null

  return {
    version: 'chart_evidence_pack_v1',
    scope_label: scopeLabel,
    generated_at: new Date().toISOString(),
    chart_count: charts.length,
    total_series_count: charts.reduce((sum, chart) => sum + chart.series_count, 0),
    total_finite_values: charts.reduce((sum, chart) => sum + chart.finite_values, 0),
    total_missing_values: charts.reduce((sum, chart) => sum + chart.missing_values, 0),
    charts,
  }
}

const BEGINNER_CARD_TYPES = new Set(['what_happened', 'so_what', 'check_first', 'data_gap', 'next_action'])
const BEGINNER_SEVERITIES = new Set(['positive', 'neutral', 'warning', 'critical'])

function cleanBeginnerText(value, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function normalizeBeginnerStringList(value, limit = 5) {
  return Array.isArray(value)
    ? value
        .map((item) => cleanBeginnerText(item))
        .filter(Boolean)
        .filter((item, index, array) => array.indexOf(item) === index)
        .slice(0, limit)
    : []
}

function normalizeBeginnerCards(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const type = BEGINNER_CARD_TYPES.has(item.type) ? item.type : 'what_happened'
      const title = cleanBeginnerText(item.title)
      const body = cleanBeginnerText(item.body)
      if (!title || !body) return null
      return {
        type,
        title,
        body,
        severity: BEGINNER_SEVERITIES.has(item.severity) ? item.severity : 'neutral',
        evidence_chart_ids: normalizeBeginnerStringList(item.evidence_chart_ids ?? item.evidenceChartIds, 4),
      }
    })
    .filter(Boolean)
    .slice(0, 5)
}

function normalizeBeginnerActions(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const title = cleanBeginnerText(item.title)
      const reason = cleanBeginnerText(item.reason)
      if (!title && !reason) return null
      return {
        priority: cleanBeginnerText(item.priority, `P${index + 1}`),
        title: title || reason,
        reason,
      }
    })
    .filter(Boolean)
    .slice(0, 4)
}

function normalizeBeginnerGaps(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const label = cleanBeginnerText(item.label)
      const impact = cleanBeginnerText(item.impact)
      if (!label && !impact) return null
      return {
        key: cleanBeginnerText(item.key, `gap_${index + 1}`),
        label: label || '判断保留',
        impact,
      }
    })
    .filter(Boolean)
    .slice(0, 5)
}

export function normalizeBeginnerReport(report) {
  if (!report || typeof report !== 'object') return null
  const summaryCards = normalizeBeginnerCards(report.summary_cards ?? report.summaryCards)
  const nextActions = normalizeBeginnerActions(report.next_actions ?? report.nextActions)
  const dataGaps = normalizeBeginnerGaps(report.data_gaps ?? report.dataGaps)
  const recommendedCharts = normalizeBeginnerStringList(report.recommended_charts ?? report.recommendedCharts, 3)

  if (summaryCards.length === 0 && nextActions.length === 0 && dataGaps.length === 0 && recommendedCharts.length === 0) {
    return null
  }

  return {
    version: cleanBeginnerText(report.version, 'beginner_report_v1'),
    summary_cards: summaryCards,
    next_actions: nextActions,
    data_gaps: dataGaps,
    recommended_charts: recommendedCharts,
  }
}

function formatBeginnerValue(value) {
  const number = toFiniteNumber(value)
  if (number == null) return '未取得'
  return number.toLocaleString('ja-JP', {
    maximumFractionDigits: Math.abs(number) >= 1000 ? 0 : 1,
  })
}

function queryTypeOfGroup(group) {
  return group?.queryType ?? group?.query_type ?? group?.metadata?.queryType ?? group?.metadata?.query_type ?? ''
}

function mainDatasetOfGroup(group) {
  const datasets = Array.isArray(group?.datasets) ? group.datasets : []
  return datasets
    .map((dataset) => {
      const values = (Array.isArray(dataset?.data) ? dataset.data : [])
        .map(toFiniteNumber)
        .filter((value) => value != null)
      return { dataset, values }
    })
    .filter((item) => item.values.length > 0)
    .sort((a, b) => b.values.length - a.values.length || b.values.reduce((sum, value) => sum + value, 0) - a.values.reduce((sum, value) => sum + value, 0))[0] ?? null
}

function topPointOfGroup(group, dataset) {
  const labels = Array.isArray(group?.labels) ? group.labels : []
  const data = Array.isArray(dataset?.data) ? dataset.data : []
  const points = data
    .map((value, index) => ({
      label: labels[index] == null ? `項目${index + 1}` : String(labels[index]),
      value: toFiniteNumber(value),
    }))
    .filter((point) => point.value != null && point.label.trim())
  if (points.length === 0) return null
  return points.sort((a, b) => b.value - a.value)[0]
}

function makeFallbackBeginnerCard(type, title, body, severity = 'neutral', evidenceChartIds = []) {
  return { type, title, body, severity, evidence_chart_ids: evidenceChartIds }
}

export function buildBeginnerReportFromCharts(chartGroups = [], executionSummary = []) {
  const groups = (Array.isArray(chartGroups) ? chartGroups : []).map(normalizeChartGroupShape)
  const cards = []
  const nextActions = []
  const dataGaps = []
  const recommendedCharts = []

  const statusByQuery = new Map(
    (Array.isArray(executionSummary) ? executionSummary : [])
      .map((item) => [item?.query_type ?? item?.queryType ?? '', item?.status ?? 'unknown']),
  )
  const cvStatus = statusByQuery.get('cv')
  const cvHasChart = groups.some((group) => queryTypeOfGroup(group) === 'cv')
  if ((cvStatus && cvStatus !== 'success' && cvStatus !== 'no_chart') || (cvStatus && !cvHasChart)) {
    dataGaps.push({
      key: 'cv_missing',
      label: 'CVデータ未取得',
      impact: '成果につながる行動が見えないため、良し悪しは判断保留です。',
    })
  }

  const contexts = groups
    .map((group, index) => {
      const main = mainDatasetOfGroup(group)
      if (!main) return null
      const first = main.values[0]
      const latest = main.values[main.values.length - 1]
      const delta = main.values.length >= 2 && first !== 0 ? ((latest - first) / Math.abs(first)) * 100 : null
      return {
        chartId: `chart_${String(index + 1).padStart(2, '0')}`,
        group,
        queryType: queryTypeOfGroup(group),
        dataset: main.dataset,
        values: main.values,
        latest,
        delta,
        topPoint: topPointOfGroup(group, main.dataset),
      }
    })
    .filter(Boolean)

  const pushRecommended = (chartId) => {
    if (chartId && !recommendedCharts.includes(chartId) && recommendedCharts.length < 3) recommendedCharts.push(chartId)
  }

  const pv = contexts.find((item) => item.queryType === 'pv')
  if (pv) {
    const title = pv.delta == null || Math.abs(pv.delta) < 10
      ? '閲覧数は大きく崩れていません'
      : pv.delta > 0
        ? 'サイト閲覧は増えています'
        : 'サイト閲覧は減っています'
    const body = pv.delta == null || Math.abs(pv.delta) < 10
      ? `最新値は ${formatBeginnerValue(pv.latest)} です。まずは急な変化がないかを確認します。`
      : `期間内の最初の値から最新値まで ${pv.delta > 0 ? '+' : ''}${pv.delta.toFixed(1)}% 変化しています。増減した日と流入元を次に見ます。`
    cards.push(makeFallbackBeginnerCard('what_happened', title, body, pv.delta < -10 ? 'warning' : pv.delta > 10 ? 'positive' : 'neutral', [pv.chartId]))
    pushRecommended(pv.chartId)
  }

  const traffic = contexts.find((item) => item.queryType === 'traffic' && item.topPoint)
  if (traffic) {
    cards.push(makeFallbackBeginnerCard(
      'check_first',
      'まず流入元を見ます',
      `もっとも多い流入元は「${traffic.topPoint.label}」で、値は ${formatBeginnerValue(traffic.topPoint.value)} です。どこから来た人が多いかを最初に確認します。`,
      'neutral',
      [traffic.chartId],
    ))
    nextActions.push({ priority: 'P2', title: '上位の流入元を確認する', reason: '来訪が増減したとき、最初に見るべき入口だからです。' })
    pushRecommended(traffic.chartId)
  }

  const landing = contexts.find((item) => item.queryType === 'landing' && item.topPoint)
  if (landing) {
    cards.push(makeFallbackBeginnerCard(
      'so_what',
      '見られているページを確認します',
      `上位ページは「${landing.topPoint.label}」で、値は ${formatBeginnerValue(landing.topPoint.value)} です。よく見られるページから改善候補を探します。`,
      'neutral',
      [landing.chartId],
    ))
    nextActions.push({ priority: 'P2', title: '上位LPの内容を確認する', reason: '訪問が集まるページを直すほど、改善の影響が見えやすいためです。' })
    pushRecommended(landing.chartId)
  }

  if (dataGaps.some((gap) => gap.key === 'cv_missing')) {
    cards.push(makeFallbackBeginnerCard(
      'data_gap',
      'CV計測が見つかりません',
      '成果につながる行動が未取得です。閲覧数が良く見えても、成果の良し悪しはまだ断定しません。',
      'warning',
    ))
    nextActions.unshift({ priority: 'P1', title: 'CV計測を確認する', reason: '成果データがないと、良い流入かどうかを判断できないためです。' })
  }

  if (cards.length === 0 && contexts.length > 0) {
    cards.push(makeFallbackBeginnerCard(
      'what_happened',
      '取得済みグラフから順に確認します',
      '大きな結論はまだ出さず、まず数値が取れているグラフから状態を確認します。',
      'neutral',
      [contexts[0].chartId],
    ))
    pushRecommended(contexts[0].chartId)
  }

  if (cards.length === 0) {
    cards.push(makeFallbackBeginnerCard(
      'data_gap',
      '判断できるグラフがまだありません',
      'セットアップ条件またはBigQuery接続を確認してから、再取得してください。',
      'warning',
    ))
  }

  if (nextActions.length === 0) {
    nextActions.push({ priority: 'P1', title: '根拠グラフを3つだけ確認する', reason: '最初から全グラフを見ると判断が散らばるためです。' })
  }

  return normalizeBeginnerReport({
    version: 'beginner_report_v1',
    summary_cards: cards,
    next_actions: nextActions,
    data_gaps: dataGaps,
    recommended_charts: recommendedCharts,
  })
}

export async function generateBatchWithRetry(payload) {
  for (let attempt = 0; attempt <= GENERATE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const result = await bqGenerateBatch(payload)
      if (result?.ok === false) {
        // data_availability === 'failed' は BQ 全失敗（CVデータ無し等）の決定論的エラー。
        // 再試行しても結果は変わらないため deterministic フラグを立てて即 throw する。
        // partial 等の非決定論的失敗は従来どおり status 500 で再試行対象に残す。
        const deterministicFailure = result?.data_availability === 'failed'
        const error = new Error(result?.message || result?.missing_reason || result?.error || 'BQレポート生成に失敗しました。')
        error.status = deterministicFailure ? 502 : 500
        error.body = result
        if (deterministicFailure) error.deterministic = true
        throw error
      }
      return result
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
    const reportV2 = result?.report_v2 ?? result?.reportV2 ?? null
    const reportMd = pickReportMarkdown(result)
    const chartGroups = pickChartGroups(result, periodTag)
    const executionSummary = pickExecutionSummary(result, periodTag)
    const site = result?.site && typeof result.site === 'object'
      ? {
          name: String(result.site.name ?? '').trim(),
          url: String(result.site.url ?? '').trim(),
        }
      : null
    const beginnerReport =
      normalizeBeginnerReport(result?.beginner_report ?? result?.beginnerReport) ||
      buildBeginnerReportFromCharts(chartGroups, executionSummary)

    return {
      periodTag,
      label: periodTag,
      reportMd,
      chartGroups,
      executionSummary,
      beginnerReport,
      reportV2,
      site: site?.name ? site : null,
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

  const flatExecutionSummary = periodReports.flatMap((item) => item.executionSummary)
  const flatChartGroups = periodReports.flatMap((item) => item.chartGroups)
  const latestPeriod = latestPeriodValue(periodReports.map((item) => item.periodTag))
  const latestPeriodReport = periodReports.find((item) => item.periodTag === latestPeriod) ?? null
  const site = latestPeriodReport?.site ?? periodReports.find((item) => item.site)?.site ?? null
  const beginnerReport =
    latestPeriodReport?.beginnerReport ||
    buildBeginnerReportFromCharts(flatChartGroups, flatExecutionSummary)
  const reportV2 = latestPeriodReport?.reportV2 ?? null
  const dataAvailability = reportMd
    ? summarizeAvailability(results, periodReports)
    : 'fallback'
  const missingReason = reportMd
    ? collectMissingReasons(results, flatExecutionSummary)
    : 'BigQueryからレポート本文が返っていません。'

  return {
    source: 'bq_generate_batch',
    dataAvailability,
    missingReason,
    datasetId,
    reportMd: reportMd || fallbackReportMd,
    chartGroups: flatChartGroups,
    beginnerReport,
    reportV2,
    site,
    periodReports,
    executionSummary: flatExecutionSummary,
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

  const settled = await Promise.allSettled(
    setupState.periods.map(period =>
      generateBatchWithRetry({
        query_types: setupState.queryTypes,
        dataset_id: setupState.datasetId,
        project_ref: setupState.projectRef,
        period,
      }).then((result) => ({ ...result, period }))
    ),
  )
  const results = settled.map((item, index) => {
    if (item.status === 'fulfilled') return item.value
    const period = setupState.periods[index]
    const error = item.reason
    return {
      ok: false,
      period,
      data_availability: 'failed',
      missing_reason: error?.message || 'BigQueryレポート生成に失敗しました。',
      report_md: '',
      chart_data: {},
      execution_summary: (setupState.queryTypes ?? []).map((queryType) => ({
        query_type: queryType,
        status: 'error',
        row_count: 0,
        chart_group_count: 0,
        message: error?.message || 'BigQueryレポート生成に失敗しました。',
      })),
    }
  })

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
