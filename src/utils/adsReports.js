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

  const results = await Promise.all(
    setupState.periods.map(period =>
      generateBatchWithRetry({
        query_types: setupState.queryTypes,
        dataset_id: setupState.datasetId,
        period,
      })
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
