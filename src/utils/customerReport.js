import { normalizeChartGroupShape } from './adsReports'
import {
  buildRankingRows,
  buildSeries,
  formatMetricValue,
  getLabels,
  shortenChartLabel,
  toFiniteNumber,
} from './chartSeriesTransform'

export const CUSTOMER_TERMS = {
  PV: '見られた回数',
  PV数: '見られた回数',
  セッション: '訪問',
  セッション数: '訪問数',
  CV: '問い合わせ・予約・購入などの成果',
  CV数: '成果数',
  コンバージョン: '問い合わせ・予約・購入などの成果',
  流入チャネル: 'どこから来たか',
  チャネル: '来訪元',
  直帰率: 'すぐ帰った人の割合',
  エンゲージメント: 'ちゃんと読まれたか',
  CPA: '1件の成果にかかった広告費',
  CTR: '広告を見た人のうち、サイトに来た割合',
  KPI: '見るべき数字',
  LP: '入口ページ',
  BigQuery: '保存されている計測データ',
  GA4: 'サイト計測',
}

const CUSTOMER_TERM_PATTERNS = [
  [/PV数/g, CUSTOMER_TERMS.PV数],
  [/\bPV\b/g, CUSTOMER_TERMS.PV],
  [/セッション数/g, CUSTOMER_TERMS.セッション数],
  [/セッション/g, CUSTOMER_TERMS.セッション],
  [/コンバージョン/g, CUSTOMER_TERMS.コンバージョン],
  [/\bCV数\b/g, CUSTOMER_TERMS.CV数],
  [/\bCV\b/g, CUSTOMER_TERMS.CV],
  [/流入チャネル/g, CUSTOMER_TERMS.流入チャネル],
  [/チャネル/g, CUSTOMER_TERMS.チャネル],
  [/直帰率/g, CUSTOMER_TERMS.直帰率],
  [/エンゲージメント/g, CUSTOMER_TERMS.エンゲージメント],
  [/\bCPA\b/g, CUSTOMER_TERMS.CPA],
  [/\bCTR\b/g, CUSTOMER_TERMS.CTR],
  [/\bKPI\b/g, CUSTOMER_TERMS.KPI],
  [/\bLP\b/g, CUSTOMER_TERMS.LP],
  [/BigQuery/g, CUSTOMER_TERMS.BigQuery],
  [/GA4/g, CUSTOMER_TERMS.GA4],
]

export const CUSTOMER_AI_PROMPTS = [
  {
    icon: 'summarize',
    label: '今回、何が起きているか教えて',
    color: 'text-primary',
  },
  {
    icon: 'contact_page',
    label: '問い合わせにつながる動きを見たい',
    color: 'text-emerald-600',
  },
  {
    icon: 'web_traffic',
    label: 'よく見られたページで直す場所は？',
    color: 'text-amber-600',
  },
  {
    icon: 'task_alt',
    label: '今日やることを3つに絞って',
    color: 'text-sky-700',
  },
]

export const CUSTOMER_AI_PROMPT_CARDS = CUSTOMER_AI_PROMPTS.map((prompt) => {
  const descriptions = {
    summarize: '専門用語を使わず、良かったこと・悪かったこと・急な変化を短く整理します。',
    contact_page: '問い合わせや予約などの成果につながる動きが確認できるかを見ます。',
    web_traffic: 'よく見られた入口ページのうち、改善の優先度が高いページを探します。',
    task_alt: '今日確認することと、今月直すことを分けて提案します。',
  }
  return {
    icon: prompt.icon,
    title: prompt.label,
    description: descriptions[prompt.icon] || '今のデータから次に見ることを整理します。',
  }
})

export function replaceCustomerTerms(value) {
  return CUSTOMER_TERM_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    String(value ?? ''),
  )
}

export function friendlyDataMessage(statusOrMessage, fallback = 'この期間は十分なデータがありません') {
  const text = String(statusOrMessage ?? '').trim()
  const lower = text.toLowerCase()

  if (!text) return fallback
  if (lower === 'full' || lower === 'success') return '必要なデータを確認できています'
  if (lower === 'partial') return '一部のデータはまだ確認中です'
  if (lower === 'fallback' || lower === 'missing') return 'この分析に必要なデータがまだ十分にそろっていません'
  if (lower === 'failed' || lower === 'error') return 'データを確認できませんでした。少し時間をおいて再取得してください'
  if (lower === 'no_chart') return 'データは確認できましたが、表示できるグラフがまだありません'
  if (lower === 'no_data') return 'この期間は十分なデータがありません'
  if (/cv\s*0|cv0|コンバージョン.*0|成果.*0/i.test(text)) {
    return '問い合わせの計測がまだ確認できません'
  }
  if (/api|key|401|403|認証|未設定|接続/i.test(text)) {
    return 'この分析に必要な接続がまだ終わっていません'
  }
  if (/no_data|データ0|0件|empty|not found|見つかりません/i.test(text)) {
    return 'この期間は十分なデータがありません'
  }
  if (/error|failed|失敗|timeout|タイムアウト/i.test(text)) {
    return 'データを確認できませんでした。少し時間をおいて再取得してください'
  }
  if (lower === 'unknown') return 'まだ確認中です'
  return replaceCustomerTerms(text)
}

function queryTypeOfGroup(group = {}) {
  return String(
    group.queryType ??
    group.query_type ??
    group.metadata?.queryType ??
    group.metadata?.query_type ??
    '',
  )
}

function normalizeGroups(chartGroups = []) {
  return (Array.isArray(chartGroups) ? chartGroups : [])
    .map((group) => normalizeChartGroupShape(group))
}

function groupText(group = {}) {
  return [
    group.title,
    group.selectionLabel,
    group.metadata?.selectionLabel,
    group.coverageLabel,
  ].filter(Boolean).join(' ')
}

function findGroup(groups, queryType, patterns = []) {
  const normalizedPatterns = patterns.map((pattern) => new RegExp(pattern, 'i'))
  return groups.find((group) => {
    const type = queryTypeOfGroup(group)
    if (type === queryType) {
      if (normalizedPatterns.length === 0) return true
      return normalizedPatterns.some((pattern) => pattern.test(groupText(group)))
    }
    return false
  }) ?? null
}

function findAnyGroup(groups, queryType) {
  return groups.find((group) => queryTypeOfGroup(group) === queryType) ?? null
}

const PV_SERIES_MATCHERS = ['PV|page_views|見られた']
const CV_SERIES_MATCHERS = ['CV|コンバージョン|成果|問い合わせ|予約|購入']

function summarizeSeries(group, preferredMatchers = [], options = {}) {
  if (!group) return null
  const labels = getLabels(group)
  const seriesList = buildSeries(group)
  if (seriesList.length === 0) return null
  const matchers = preferredMatchers.map((matcher) => new RegExp(matcher, 'i'))
  const matchedSeries = matchers.length > 0
    ? seriesList.filter((item) => matchers.some((matcher) => matcher.test(item.label)))
    : seriesList
  const candidateSeries = matchedSeries.length > 0 ? matchedSeries : seriesList
  const additiveSeries = options.combineAllNonPercent
    ? seriesList.filter((item) => !item.usePercent)
    : options.combineMatches
      ? candidateSeries.filter((item) => !item.usePercent)
      : []
  const series = additiveSeries.length > 0
    ? {
        label: options.combinedLabel || additiveSeries[0].label,
        usePercent: false,
        values: labels.map((_, index) => {
          const values = additiveSeries.map((item) => item.values[index]).filter((value) => value != null)
          return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null
        }),
      }
    : candidateSeries[0]
  const values = series.values
    .map((value, index) => ({ value, label: labels[index] ?? `項目 ${index + 1}` }))
    .filter((point) => point.value != null)
  if (values.length === 0) return null
  const first = values[0]
  const latest = values[values.length - 1]
  const total = values.reduce((sum, point) => sum + point.value, 0)
  const delta = latest.value - first.value
  const deltaPercent = first.value !== 0 ? (delta / Math.abs(first.value)) * 100 : null
  return {
    label: replaceCustomerTerms(series.label),
    first,
    latest,
    total,
    delta,
    deltaPercent,
    usePercent: series.usePercent,
  }
}

function rowsFromGroup(group, limit = 3, mode = 'ranking') {
  if (!group) return []

  if (Array.isArray(group.rows) && group.rows.length > 0) {
    return group.rows
      .map((row, index) => {
        const bounceRate = toFiniteNumber(row.bounceRate ?? row.bounce_rate)
        const sessions = toFiniteNumber(row.sessions)
        return {
          label: row.label ?? row.lp ?? row.pagePath ?? `ページ ${index + 1}`,
          value: mode === 'bounce' ? bounceRate : (sessions ?? bounceRate),
          sessions,
          bounceRate,
          usePercent: mode === 'bounce',
        }
      })
      .filter((row) => row.value != null)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
  }

  return buildRankingRows(group, limit).map((row) => ({
    label: row.label,
    value: row.value,
    usePercent: row.usePercent || mode === 'bounce',
    share: row.share,
  }))
}

function formatCustomerValue(value, usePercent = false) {
  return formatMetricValue(value, usePercent)
}

function formatDelta(summary) {
  if (!summary || summary.deltaPercent == null || Math.abs(summary.deltaPercent) < 3) {
    return '大きな変化はまだ見えません'
  }
  return `${summary.deltaPercent > 0 ? '+' : ''}${summary.deltaPercent.toFixed(1)}%`
}

function buildNoticeList(executionSummary = [], groups = []) {
  const notices = []
  const cvSummary = executionSummary.find((item) => (item.query_type ?? item.queryType) === 'cv')
  const cvHasData = groups.some((group) => (
    queryTypeOfGroup(group) === 'cv'
    && summarizeSeries(group, CV_SERIES_MATCHERS, { combineAllNonPercent: true, combinedLabel: '成果合計' })?.total > 0
  ))

  if (cvSummary && !cvHasData) {
    notices.push({
      key: 'cv_missing',
      label: '問い合わせの計測がまだ確認できません',
      body: '成果の良し悪しは、問い合わせ・予約・購入などの計測が確認できてから判断します。',
      tone: 'warning',
    })
  }

  executionSummary.forEach((item, index) => {
    const status = item.status ?? 'unknown'
    if (!['no_data', 'error', 'unknown'].includes(status)) return
    const key = `${item.query_type ?? item.queryType ?? 'unknown'}-${status}-${index}`
    const label = friendlyDataMessage(item.message || status)
    if (notices.some((notice) => notice.label === label)) return
    notices.push({
      key,
      label,
      body: 'この項目は断定せず、必要な接続や期間を確認してから見直します。',
      tone: status === 'error' ? 'critical' : 'warning',
    })
  })

  return notices.slice(0, 4)
}

function buildListSection({ title, icon, group, empty, valueLabel, mode = 'ranking', limit = 3 }) {
  const items = rowsFromGroup(group, limit, mode).map((row) => ({
    label: shortenChartLabel(row.label, 58),
    value: formatCustomerValue(row.value, row.usePercent),
    note: valueLabel,
  }))

  return {
    title,
    icon,
    items,
    empty,
  }
}

export function buildCustomerSimpleReport(chartGroups = [], executionSummary = [], options = {}) {
  const groups = normalizeGroups(chartGroups)
  const pvGroup = findGroup(groups, 'pv', ['PV|ページビュー|見られた'])
  const trafficGroup = findAnyGroup(groups, 'traffic')
  const cvGroup = findAnyGroup(groups, 'cv')
  const landingVisitsGroup = findGroup(groups, 'landing', ['セッション|訪問|上位']) ?? findAnyGroup(groups, 'landing')
  const landingBounceGroup = findGroup(groups, 'landing', ['直帰|bounce|すぐ'])
  const anomalyGroup = findGroup(groups, 'anomaly', ['z[- ]?score|標準化'])

  const pv = summarizeSeries(pvGroup, PV_SERIES_MATCHERS)
  const cv = summarizeSeries(cvGroup, CV_SERIES_MATCHERS, { combineAllNonPercent: true, combinedLabel: '成果合計' })
  const trafficRows = rowsFromGroup(trafficGroup, 1)
  const bounceRows = rowsFromGroup(landingBounceGroup, 1, 'bounce')
  const notices = buildNoticeList(executionSummary, groups)
  const hasCvData = cv && cv.total > 0

  const summaryPieces = []
  if (pv) {
    summaryPieces.push(`見られた回数は ${formatDelta(pv)} です`)
  } else {
    summaryPieces.push('見られた回数はまだ十分に確認できません')
  }
  if (trafficRows[0]) {
    summaryPieces.push(`多い来訪元は「${shortenChartLabel(trafficRows[0].label, 32)}」です`)
  }
  summaryPieces.push(hasCvData
    ? `問い合わせ・予約・購入などの成果は ${formatCustomerValue(cv.total)} 件確認できます`
    : '問い合わせの計測がまだ確認できません')

  const hasSuddenChange = Boolean(
    anomalyGroup
    && buildSeries(anomalyGroup).some((series) => series.values.some((value) => value != null && Math.abs(value) >= 2)),
  )
  const suddenChange = hasSuddenChange
    ? '急に変わった日がある可能性があります。詳しく見る画面で、日付ごとの変化を確認します。'
    : '急な変化は、今の表示範囲では強く出ていません。'

  const topBounce = bounceRows[0]
  const todayActions = [
    hasCvData
      ? '問い合わせ・予約・購入などの成果が出た日と、来訪元を並べて確認する'
      : '問い合わせ計測が正しく動いているか確認する',
    topBounce
      ? `「${shortenChartLabel(topBounce.label, 32)}」をスマホで開き、最初の見え方とボタン位置を確認する`
      : 'よく見られた入口ページを1つ開き、問い合わせまで迷わず進めるか確認する',
  ]

  const monthActions = [
    trafficRows[0]
      ? `「${shortenChartLabel(trafficRows[0].label, 32)}」から来た人向けに、入口ページの説明を1つ改善する`
      : '訪問が多い来訪元を特定し、入口ページの説明を合わせる',
    '改善後に、見られた回数・訪問・問い合わせの変化を同じ期間で比べる',
  ]

  return {
    periodLabel: options.periodLabel || '表示中の期間',
    availabilityMessage: friendlyDataMessage(options.missingReason || options.dataAvailability || ''),
    summary: {
      title: '今回のまとめ',
      body: `${summaryPieces.join('。')}。${suddenChange}`,
      chips: [
        { label: '表示期間', value: options.periodLabel || '-' },
        { label: '根拠データ', value: `${groups.length}件` },
        { label: '判断保留', value: notices.length > 0 ? `${notices.length}件` : 'なし' },
      ],
    },
    sections: [
      buildListSection({
        title: 'よく見られたページ',
        icon: 'web',
        group: landingVisitsGroup,
        empty: 'この期間は、よく見られたページを十分に確認できません。',
        valueLabel: '訪問の多さ',
      }),
      buildListSection({
        title: 'どこから来たか',
        icon: 'travel_explore',
        group: trafficGroup,
        empty: 'この期間は、来訪元を十分に確認できません。',
        valueLabel: '訪問の多さ',
      }),
      {
        title: '問い合わせにつながる動き',
        icon: 'contact_page',
        items: hasCvData
          ? rowsFromGroup(cvGroup, 3).map((row) => ({
              label: shortenChartLabel(row.label, 58),
              value: formatCustomerValue(row.value, row.usePercent),
              note: '成果の動き',
            }))
          : [],
        empty: '問い合わせの計測がまだ確認できません。まず接続と計測条件を確認します。',
      },
      buildListSection({
        title: 'すぐ帰った可能性があるページ',
        icon: 'logout',
        group: landingBounceGroup,
        empty: 'この期間は、すぐ帰った可能性があるページを十分に確認できません。',
        valueLabel: 'すぐ帰った人の割合',
        mode: 'bounce',
      }),
    ],
    notices,
    actions: {
      today: todayActions,
      month: monthActions,
    },
    aiPrompts: CUSTOMER_AI_PROMPTS,
  }
}
