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
  ページビュー: '見られた回数',
  セッション: '訪問',
  セッション数: '訪問数',
  CV: '問い合わせ・予約・購入などの成果',
  CV数: '成果数',
  CVR: '成果につながった割合',
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
  [/\bchart[_ -]?\d+\b/gi, '根拠グラフ'],
  [/\bdataset(?:_id)?\b/gi, '接続設定'],
  [/\bAPI[ _-]?key\b/gi, '接続設定'],
  [/データセット/g, '接続設定'],
  [/API\s*キー/gi, '接続設定'],
  [/\bquery[_ -]?type\b/gi, '分析項目'],
  [/\bnull\b/gi, '未取得'],
  [/\bpage[ _-]?views?\b/gi, CUSTOMER_TERMS.PV],
  [/\bsessions?\b/gi, CUSTOMER_TERMS.セッション],
  [/ランディングページ/g, CUSTOMER_TERMS.LP],
  [/ページビュー/g, CUSTOMER_TERMS.ページビュー],
  [/PV数/g, CUSTOMER_TERMS.PV数],
  [/\bPV\b/g, CUSTOMER_TERMS.PV],
  [/セッション数/g, CUSTOMER_TERMS.セッション数],
  [/セッション/g, CUSTOMER_TERMS.セッション],
  [/コンバージョン/g, CUSTOMER_TERMS.コンバージョン],
  [/\bCV数\b/g, CUSTOMER_TERMS.CV数],
  [/\bCVR\b/g, CUSTOMER_TERMS.CVR],
  [/\bCV\b/g, CUSTOMER_TERMS.CV],
  [/流入チャネル/g, CUSTOMER_TERMS.流入チャネル],
  [/チャネル/g, CUSTOMER_TERMS.チャネル],
  [/直帰率/g, CUSTOMER_TERMS.直帰率],
  [/エンゲージメント/g, CUSTOMER_TERMS.エンゲージメント],
  [/\bCPA\b/g, CUSTOMER_TERMS.CPA],
  [/\bCTR\b/g, CUSTOMER_TERMS.CTR],
  [/\bKPI\b/g, CUSTOMER_TERMS.KPI],
  [/\bLP\b/g, CUSTOMER_TERMS.LP],
  [/BigQuery/gi, CUSTOMER_TERMS.BigQuery],
  [/GA4/gi, CUSTOMER_TERMS.GA4],
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

export const CUSTOMER_REPORT_SCHEMA_VERSION = 'report.v2'

const CUSTOMER_REPORT_CONCLUSION_ORDER = {
  what_happened: 0,
  so_what: 1,
  check_first: 2,
  next_action: 3,
}

const CUSTOMER_REPORT_SEVERITIES = new Set(['positive', 'neutral', 'warning', 'critical'])
const CUSTOMER_REPORT_AVAILABILITY = {
  ready: {
    label: '確認できています',
    message: 'この期間のデータを確認できています',
  },
  partial: {
    label: '一部確認中です',
    message: '一部のデータはまだ確認中です。確認できた範囲だけを表示します',
  },
  empty: {
    label: '判断できるデータがありません',
    message: 'この期間は十分なデータがありません。期間または接続設定を確認してください',
  },
  error: {
    label: 'データを確認できませんでした',
    message: '少し時間をおいて、もう一度取得してください',
  },
}

const QUERY_TYPE_TO_THEME = {
  pv: 'lp',
  landing: 'lp',
  engagement: 'lp',
  traffic: 'traffic',
  campaign: 'traffic',
  cv: 'cv',
  device: 'device',
  hourly: 'time',
  anomaly: 'anomaly',
  auction_proxy: 'traffic',
}

const EVIDENCE_QUESTIONS = {
  lp: '見られたページの根拠を確認する',
  traffic: 'どこから来たかの根拠を確認する',
  cv: '成果につながる動きの根拠を確認する',
  device: '使われた端末の根拠を確認する',
  time: '見られた時間帯の根拠を確認する',
  anomaly: '急な変化の根拠を確認する',
  other: '数字の根拠を確認する',
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function cleanText(value, fallback = '') {
  if (!['string', 'number'].includes(typeof value)) return fallback
  const text = String(value).trim()
  return text || fallback
}

function customerText(value, fallback = '') {
  return replaceCustomerTerms(cleanText(value, fallback))
}

function finiteOrNull(value) {
  if (value == null || value === '') return null
  const number = typeof value === 'string'
    ? Number(value.replace(/,/g, '').replace(/[%％]$/, ''))
    : Number(value)
  return Number.isFinite(number) ? number : null
}

function uniqueItems(items, keyOf, limit = Infinity) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const key = keyOf(item)
    if (!item || !key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
    if (result.length >= limit) break
  }
  return result
}

function normalizeAvailabilityState(value) {
  const state = String(value ?? '').trim().toLowerCase()
  if (['ready', 'full', 'success', 'measured', 'measured_zero', 'available'].includes(state)) return 'ready'
  if (['partial', 'fallback', 'no_chart', 'unknown', 'pending'].includes(state)) return 'partial'
  if (['empty', 'unavailable', 'no_data', 'missing', 'not_configured', 'not_applicable'].includes(state)) return 'empty'
  if (['error', 'failed', 'query_error'].includes(state)) return 'error'
  return ''
}

function normalizeAvailability(report, options, hasUsefulContent) {
  const rawAvailability = isPlainObject(report.availability) ? report.availability : {}
  const rawState = rawAvailability.overall ?? rawAvailability.state ?? rawAvailability.status ?? report.availability ??
    report.analysis?.state ?? options.dataAvailability ?? options.availability
  const state = normalizeAvailabilityState(rawState) || (hasUsefulContent ? 'ready' : 'empty')
  const defaults = CUSTOMER_REPORT_AVAILABILITY[state]
  const rawMessage = rawAvailability.message ?? rawAvailability.reason ?? report.analysis?.reason ??
    options.missingReason ?? options.availabilityMessage

  return {
    state,
    label: customerText(rawAvailability.label, defaults.label),
    message: rawMessage ? friendlyDataMessage(rawMessage, defaults.message) : defaults.message,
  }
}

function normalizeMeasurement(value, fallbackState = '') {
  const measurement = isPlainObject(value) ? value : { value }
  const rawValue = measurement.value ?? null
  let state = String(measurement.state ?? fallbackState ?? '').trim().toLowerCase()
  if (!['measured', 'measured_zero', 'no_data', 'not_configured', 'not_applicable'].includes(state)) {
    state = rawValue == null ? 'no_data' : finiteOrNull(rawValue) === 0 ? 'measured_zero' : 'measured'
  }
  const normalizedValue = ['measured', 'measured_zero'].includes(state) ? rawValue : null

  return {
    state,
    value: normalizedValue,
    reason: measurement.reason ? customerText(measurement.reason) : null,
  }
}

function normalizeMetrics(report, options) {
  const rawMetrics = Array.isArray(report.metrics)
    ? report.metrics
    : Array.isArray(options.metrics) ? options.metrics : []

  return rawMetrics
    .map((metric, index) => {
      if (!isPlainObject(metric)) return null
      const key = cleanText(metric.key ?? metric.id, `metric_${index + 1}`)
      const currentSource = metric.current ?? metric.current_value ?? metric.value
      const hasComparison = metric.comparison != null || metric.comparison_value != null
      const current = normalizeMeasurement(currentSource, metric.state)
      const comparison = hasComparison
        ? normalizeMeasurement(metric.comparison ?? metric.comparison_value, metric.comparison_state)
        : null
      const rawComparison = isPlainObject(metric.comparison) ? metric.comparison : {}
      const rawChange = isPlainObject(metric.change)
        ? metric.change
        : {
            state: rawComparison.status,
            absolute: rawComparison.absolute_change,
            percent: rawComparison.percent_change,
          }
      return {
        key,
        label: customerText(metric.label, `数字 ${index + 1}`),
        unit: metric.unit ? customerText(metric.unit) : null,
        aggregation: cleanText(metric.aggregation, 'sum'),
        source_label: metric.source_label || metric.source
          ? customerText(metric.source_label ?? metric.source)
          : null,
        current,
        comparison,
        change: {
          state: cleanText(rawChange.state, hasComparison ? 'unavailable' : 'not_requested'),
          absolute: finiteOrNull(rawChange.absolute),
          percent: finiteOrNull(rawChange.percent),
        },
      }
    })
    .filter(Boolean)
}

function normalizeConclusion(item, index) {
  if (typeof item === 'string') {
    return {
      key: `conclusion_${index + 1}`,
      kind: 'what_happened',
      title: customerText(item),
      body: '',
      severity: 'neutral',
      evidence_keys: [],
    }
  }
  if (!isPlainObject(item)) return null
  const title = customerText(item.title ?? item.label)
  const body = customerText(item.body ?? item.description ?? item.message)
  if (!title && !body) return null
  const rawKind = cleanText(item.kind ?? item.type, 'what_happened')
  const kind = Object.hasOwn(CUSTOMER_REPORT_CONCLUSION_ORDER, rawKind) ? rawKind : 'what_happened'
  const requestedSeverity = item.severity === 'attention' ? 'warning' : item.severity
  const severity = CUSTOMER_REPORT_SEVERITIES.has(requestedSeverity) ? requestedSeverity : 'neutral'
  const rawEvidenceKeys = item.evidence_keys ?? item.evidence_chart_ids ?? item.evidenceKeys ?? item.evidence ?? []
  const evidenceKeys = (Array.isArray(rawEvidenceKeys) ? rawEvidenceKeys : [rawEvidenceKeys])
    .map((value) => cleanText(value))
    .filter(Boolean)
    .slice(0, 4)

  return {
    key: cleanText(item.key ?? item.id, `conclusion_${index + 1}`),
    kind,
    title: title || body,
    body,
    severity,
    confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : null,
    evidence_keys: evidenceKeys,
  }
}

function normalizeConclusions(report) {
  const rawItems = Array.isArray(report.conclusions)
    ? report.conclusions
    : Array.isArray(report.summary_cards) ? report.summary_cards : []

  return rawItems
    .filter((item) => !isPlainObject(item) || !['data_gap'].includes(item.kind ?? item.type))
    .map(normalizeConclusion)
    .filter(Boolean)
    .sort((a, b) => CUSTOMER_REPORT_CONCLUSION_ORDER[a.kind] - CUSTOMER_REPORT_CONCLUSION_ORDER[b.kind])
    .slice(0, 3)
}

function normalizeAction(item, index) {
  const action = typeof item === 'string' ? { title: item } : item
  if (!isPlainObject(action)) return null
  const title = customerText(action.title ?? action.label ?? action.action)
  const reason = customerText(action.reason ?? action.body ?? action.description)
  if (!title && !reason) return null
  const contractPriority = { high: 'P1', medium: 'P2', low: 'P3' }[action.priority]
  const priority = contractPriority ?? cleanText(action.priority, `P${index + 1}`)
  const requestedTimeframe = cleanText(action.timeframe ?? action.when).toLowerCase()
  const timeframe = requestedTimeframe === 'today' || requestedTimeframe.includes('今日')
    ? 'today'
    : requestedTimeframe === 'month' || requestedTimeframe.includes('月')
      ? 'month'
      : priority.toUpperCase() === 'P1' ? 'today' : 'month'
  const rawEvidenceKeys = action.evidence_keys ?? action.evidenceKeys ?? action.evidence ?? []
  const evidenceKeys = (Array.isArray(rawEvidenceKeys) ? rawEvidenceKeys : [rawEvidenceKeys])
    .map((value) => cleanText(value))
    .filter(Boolean)
    .slice(0, 4)

  return {
    key: cleanText(action.key ?? action.id, `action_${index + 1}`),
    priority,
    title: title || reason,
    reason,
    timeframe,
    success_metric: customerText(action.success_metric ?? action.successMetric),
    confidence: ['high', 'medium', 'low'].includes(action.confidence) ? action.confidence : null,
    evidence_keys: evidenceKeys,
  }
}

function normalizeActions(report) {
  const rawItems = Array.isArray(report.actions)
    ? report.actions
    : Array.isArray(report.next_actions) ? report.next_actions : []
  return rawItems.map(normalizeAction).filter(Boolean).slice(0, 3)
}

function normalizeCaveat(item, index) {
  const caveat = typeof item === 'string' ? { title: item } : item
  if (!isPlainObject(caveat)) return null
  const title = customerText(caveat.title ?? caveat.label)
  const body = customerText(caveat.body ?? caveat.impact ?? caveat.message ?? caveat.description)
  if (!title && !body) return null
  return {
    key: cleanText(caveat.key ?? caveat.id, `caveat_${index + 1}`),
    title: title || 'まだ判断できないこと',
    body,
    next_step: customerText(caveat.next_step ?? caveat.nextStep ?? caveat.action),
  }
}

function normalizeCaveats(report) {
  const explicit = Array.isArray(report.caveats)
    ? report.caveats
    : Array.isArray(report.data_gaps) ? report.data_gaps : []
  const cards = Array.isArray(report.summary_cards)
    ? report.summary_cards.filter((item) => isPlainObject(item) && (item.kind ?? item.type) === 'data_gap')
    : []
  return uniqueItems(
    [...explicit, ...cards].map(normalizeCaveat).filter(Boolean),
    (item) => item.key || item.title,
    5,
  )
}

function chartIndexFromEvidenceKey(value) {
  const match = String(value ?? '').match(/chart[_ -]?(\d+)/i)
  return match ? Number(match[1]) - 1 : -1
}

function evidenceTheme(item, group) {
  const rawTheme = cleanText(item?.theme ?? item?.theme_id ?? item?.themeId)
  if (rawTheme) return rawTheme
  const queryType = cleanText(item?.query_type ?? item?.queryType ?? queryTypeOfGroup(group))
  return QUERY_TYPE_TO_THEME[queryType] ?? 'other'
}

function normalizeEvidenceItem(item, index, groups, options) {
  const evidence = typeof item === 'string' ? { key: item } : item
  if (!isPlainObject(evidence)) return null
  const key = cleanText(
    evidence.key ?? evidence.evidence_id ?? evidence.evidenceId ?? evidence.chart_id ??
      evidence.chartId ?? evidence.chart_key ?? evidence.id ?? evidence.source,
    `evidence_${index + 1}`,
  )
  const chartIndex = chartIndexFromEvidenceKey(key)
  const group = chartIndex >= 0 ? groups[chartIndex] : null
  const theme = evidenceTheme(evidence, group)
  const rawTitle = evidence.title ?? evidence.label ?? group?.title ?? group?.selectionLabel
  const title = customerText(rawTitle, `根拠グラフ ${index + 1}`)
  const rawPeriod = evidence.period ?? evidence.period_tag ?? group?._periodTag ?? options.period

  return {
    key,
    theme,
    title: /^chart[_ -]?\d+$/i.test(title) ? `根拠グラフ ${index + 1}` : title,
    question: customerText(evidence.question, EVIDENCE_QUESTIONS[theme] ?? EVIDENCE_QUESTIONS.other),
    period: cleanText(rawPeriod) || null,
  }
}

function normalizeEvidence(report, conclusions, options) {
  const groups = normalizeGroups(options.chartGroups ?? options.groups ?? [])
  const explicit = Array.isArray(report.evidence) ? report.evidence : []
  const recommended = report.recommended_charts ?? report.recommendedCharts ?? []
  const linked = conclusions.flatMap((item) => item.evidence_keys)
  const rawItems = [
    ...explicit,
    ...(Array.isArray(recommended) ? recommended : []),
    ...linked,
  ]
  return uniqueItems(
    rawItems.map((item, index) => normalizeEvidenceItem(item, index, groups, options)).filter(Boolean),
    (item) => item.key,
    3,
  )
}

function normalizeScope(report, options) {
  const scope = isPlainObject(report.scope) ? report.scope : {}
  const metadata = isPlainObject(report.metadata) ? report.metadata : {}
  const site = isPlainObject(options.site) ? options.site : {}
  const currentPeriod = isPlainObject(scope.current_period) ? scope.current_period : null
  const currentPeriodLabel = currentPeriod?.start && currentPeriod?.end
    ? currentPeriod.start === currentPeriod.end
      ? currentPeriod.start
      : `${currentPeriod.start} 〜 ${currentPeriod.end}`
    : ''
  const period = cleanText(scope.period ?? report.period ?? options.period ?? options.periodTag, currentPeriodLabel)
  return {
    report_id: cleanText(scope.report_id ?? scope.reportId ?? report.report_id ?? report.reportId ?? options.reportId) || null,
    project_id: cleanText(scope.project_id ?? scope.projectId ?? report.project_id ?? report.projectId ?? options.projectId) || null,
    period: period || null,
    period_label: customerText(scope.period_label ?? scope.periodLabel ?? options.periodLabel, period || '表示中の期間'),
    comparison_period: cleanText(
      scope.comparison_period ?? scope.comparisonPeriod ?? report.comparison_period ?? report.comparisonPeriod,
    ) || null,
    query_type: cleanText(scope.query_type ?? scope.queryType ?? report.analysis?.query_type ?? report.analysis?.queryType) || null,
    site_name: customerText(scope.site_name ?? scope.siteName ?? metadata.site_name ?? site.name) || null,
  }
}

function unwrapCustomerReport(value) {
  if (!isPlainObject(value)) return null
  if (typeof value.valid === 'boolean' && isPlainObject(value.report)) return value.report
  if (isPlainObject(value.customer_report)) return value.customer_report
  if (isPlainObject(value.customerReport)) return value.customerReport
  if (isPlainObject(value.report_v2)) return value.report_v2
  if (isPlainObject(value.reportV2)) return value.reportV2
  if (isPlainObject(value.beginner_report)) return value.beginner_report
  if (isPlainObject(value.beginnerReport)) return value.beginnerReport
  return value
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isIsoDateTime(value) {
  return typeof value === 'string' && /T/.test(value) && Number.isFinite(Date.parse(value))
}

function monthPeriod(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  }
}

function normalizeContractPeriod(value) {
  if (isPlainObject(value)) {
    return {
      start: cleanText(value.start),
      end: cleanText(value.end),
    }
  }
  const text = cleanText(value)
  if (isIsoDate(text)) return { start: text, end: text }
  return monthPeriod(text)
}

function isPreviousMonth(currentValue, comparisonValue) {
  const current = String(currentValue ?? '').match(/^(\d{4})-(\d{2})$/)
  const comparison = String(comparisonValue ?? '').match(/^(\d{4})-(\d{2})$/)
  if (!current || !comparison) return false
  const currentIndex = Number(current[1]) * 12 + Number(current[2])
  const comparisonIndex = Number(comparison[1]) * 12 + Number(comparison[2])
  return currentIndex - comparisonIndex === 1
}

function contractMeasurementStatus(value) {
  const state = String(value ?? '').trim().toLowerCase()
  if (state === 'measured' || state === 'measured_zero') return state
  if (state === 'not_configured') return 'not_configured'
  if (state === 'not_applicable' || state === 'unsupported') return 'unsupported'
  if (state === 'query_error' || state === 'query_failed' || state === 'error') return 'query_failed'
  return 'no_period_data'
}

function contractComparisonStatus(value, comparison) {
  const state = String(value ?? '').trim().toLowerCase()
  if (['available', 'baseline_zero', 'not_available'].includes(state)) return state
  if (state === 'baseline_zero') return 'baseline_zero'
  if (!comparison || !['measured', 'measured_zero'].includes(comparison.state)) return 'not_available'
  return 'available'
}

function normalizeContractMetric(metric, index, options) {
  const key = cleanText(metric?.key ?? metric?.id)
  const current = isPlainObject(metric?.current) ? metric.current : null
  const comparisonMeasurement = isPlainObject(metric?.comparison) && Object.hasOwn(metric.comparison, 'state')
    ? metric.comparison
    : null
  const comparisonObject = isPlainObject(metric?.comparison) ? metric.comparison : {}
  const change = isPlainObject(metric?.change) ? metric.change : {}
  const isFlatContractMetric = Object.hasOwn(metric ?? {}, 'value') && Object.hasOwn(comparisonObject, 'status')
  const evidenceKey = cleanText(
    metric?.evidence_key ?? metric?.evidenceKey ?? options.evidenceKeys?.[key] ?? options.evidenceKey,
  )

  return {
    key,
    label: cleanText(metric?.label),
    value: isFlatContractMetric ? metric.value ?? null : current?.value ?? metric?.value ?? null,
    unit: typeof metric?.unit === 'string' ? metric.unit : '',
    aggregation: cleanText(metric?.aggregation),
    comparison: {
      value: isFlatContractMetric ? comparisonObject.value ?? null : comparisonMeasurement?.value ?? null,
      absolute_change: isFlatContractMetric
        ? comparisonObject.absolute_change ?? null
        : change.absolute ?? null,
      percent_change: isFlatContractMetric
        ? comparisonObject.percent_change ?? null
        : change.percent ?? null,
      status: contractComparisonStatus(
        isFlatContractMetric ? comparisonObject.status : change.state,
        comparisonMeasurement,
      ),
    },
    evidence_key: evidenceKey || cleanText(options.evidence?.[index]?.key),
  }
}

function normalizeContractStatement(item) {
  const statement = isPlainObject(item) ? item : {}
  const rawEvidence = statement.evidence_keys ?? statement.evidenceKeys ?? []
  const evidenceKeys = (Array.isArray(rawEvidence) ? rawEvidence : [rawEvidence])
    .map((value) => cleanText(value))
    .filter(Boolean)
  const severity = statement.severity === 'warning' ? 'attention' : cleanText(statement.severity)
  const result = {
    title: cleanText(statement.title),
    confidence: cleanText(statement.confidence),
    evidence_keys: evidenceKeys,
  }
  const body = cleanText(statement.body)
  if (body) result.body = body
  if (severity) result.severity = severity
  const kind = cleanText(statement.kind ?? statement.type)
  if (kind) result.kind = kind
  if (!result.title && typeof item === 'string') result.title = item.trim()
  if (!result.title) result.title = ''
  return result
}

function normalizeContractAction(item) {
  const source = isPlainObject(item) ? item : {}
  const rawEvidence = source.evidence_keys ?? source.evidenceKeys ?? []
  const evidenceKeys = (Array.isArray(rawEvidence) ? rawEvidence : [rawEvidence])
    .map((value) => cleanText(value))
    .filter(Boolean)
  const priority = { P1: 'high', P2: 'medium', P3: 'low' }[source.priority] ?? cleanText(source.priority)
  return {
    priority,
    title: cleanText(source.title),
    reason: cleanText(source.reason),
    confidence: cleanText(source.confidence),
    timeframe: cleanText(source.timeframe),
    success_metric: cleanText(source.success_metric ?? source.successMetric),
    evidence_keys: evidenceKeys,
  }
}

function deriveContractOverall(report, availabilityMetrics) {
  const explicit = cleanText(report.availability?.overall)
  if (explicit) return explicit
  const analysisState = cleanText(report.analysis?.state)
  if (analysisState === 'query_error') return 'failed'
  const measuredCount = availabilityMetrics.filter((item) => ['measured', 'measured_zero'].includes(item.status)).length
  if (measuredCount === 0) return 'unavailable'
  return measuredCount === availabilityMetrics.length ? 'full' : 'partial'
}

function normalizeContractCandidate(report, options) {
  const scope = isPlainObject(report.scope) ? report.scope : {}
  const metadata = isPlainObject(report.metadata) ? report.metadata : {}
  const generatedAt = cleanText(report.generated_at ?? report.generatedAt ?? metadata.generated_at ?? options.generatedAt)
  const currentPeriodSource = scope.current_period ?? report.period ?? options.currentPeriod ?? options.period
  const comparisonPeriodSource = scope.comparison_period ?? report.comparison_period ??
    report.comparisonPeriod ?? options.comparisonPeriod
  const currentPeriod = normalizeContractPeriod(currentPeriodSource)
  const comparisonPeriod = comparisonPeriodSource == null || comparisonPeriodSource === ''
    ? null
    : normalizeContractPeriod(comparisonPeriodSource)
  const rawMetrics = Array.isArray(report.metrics) ? report.metrics : []
  const metrics = rawMetrics.map((metric, index) => normalizeContractMetric(metric, index, options))
  const rawAvailabilityMetrics = Array.isArray(report.availability?.metrics)
    ? report.availability.metrics
    : rawMetrics.map((metric, index) => ({
        key: cleanText(metric?.key ?? metric?.id, `metric_${index + 1}`),
        status: contractMeasurementStatus(metric?.current?.state ?? metric?.state),
        reason: metric?.current?.reason ?? metric?.reason ?? null,
        last_observed_at: generatedAt || null,
      }))
  const availabilityMetrics = rawAvailabilityMetrics.map((metric) => ({
    key: cleanText(metric?.key),
    status: contractMeasurementStatus(metric?.status),
    reason: metric?.reason == null ? null : cleanText(metric.reason),
    last_observed_at: metric?.last_observed_at ?? metric?.lastObservedAt ?? generatedAt ?? null,
  }))
  const comparisonPolicy = cleanText(scope.comparison_policy ?? scope.comparisonPolicy ?? options.comparisonPolicy) ||
    (comparisonPeriod == null
      ? 'none'
      : isPreviousMonth(currentPeriodSource, comparisonPeriodSource) ? 'previous_month' : '')
  const freshness = isPlainObject(scope.data_freshness) ? scope.data_freshness : {}
  const conclusions = (Array.isArray(report.conclusions) ? report.conclusions : [])
    .map(normalizeContractStatement)
  const actions = (Array.isArray(report.actions) ? report.actions : [])
    .map(normalizeContractAction)
  const evidence = (Array.isArray(report.evidence) ? report.evidence : Array.isArray(options.evidence) ? options.evidence : [])
    .map((item) => ({
      key: cleanText(item?.key),
      query_type: cleanText(item?.query_type ?? item?.queryType),
      title: cleanText(item?.title),
      chart: isPlainObject(item?.chart) ? { ...item.chart } : null,
    }))
  const caveats = (Array.isArray(report.caveats) ? report.caveats : [])
    .map((item) => typeof item === 'string'
      ? item.trim()
      : [cleanText(item?.title ?? item?.label), cleanText(item?.body ?? item?.impact)].filter(Boolean).join('：'))
    .filter(Boolean)

  return {
    schema_version: CUSTOMER_REPORT_SCHEMA_VERSION,
    report_id: cleanText(report.report_id ?? report.reportId ?? options.reportId),
    project_id: cleanText(report.project_id ?? report.projectId ?? metadata.project_id ?? options.projectId),
    scope: {
      current_period: currentPeriod,
      comparison_period: comparisonPeriod,
      comparison_policy: comparisonPolicy,
      timezone: cleanText(scope.timezone ?? metadata.timezone ?? options.timezone),
      data_freshness: {
        status: cleanText(freshness.status ?? options.freshnessStatus, 'unknown'),
        last_observed_at: freshness.last_observed_at ?? freshness.lastObservedAt ?? generatedAt ?? null,
      },
    },
    availability: {
      overall: deriveContractOverall(report, availabilityMetrics),
      metrics: availabilityMetrics,
    },
    metrics,
    conclusions,
    actions,
    evidence,
    caveats,
    generated_at: generatedAt,
  }
}

function validateCustomerReportContract(report) {
  const issues = []
  const add = (path, code, message) => issues.push({ path, code, message })
  const requireText = (value, path) => {
    if (!cleanText(value)) add(path, 'required', '空でない文字列が必要です')
  }
  const requireNumberOrNull = (value, path) => {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      add(path, 'invalid_number', '有限の数値または null が必要です')
    }
  }

  requireText(report.report_id, 'report_id')
  requireText(report.project_id, 'project_id')
  if (!report.scope?.current_period || !isIsoDate(report.scope.current_period.start) || !isIsoDate(report.scope.current_period.end)) {
    add('scope.current_period', 'invalid_period', '開始日と終了日を YYYY-MM-DD で指定してください')
  }
  if (report.scope?.comparison_period &&
    (!isIsoDate(report.scope.comparison_period.start) || !isIsoDate(report.scope.comparison_period.end))) {
    add('scope.comparison_period', 'invalid_period', '比較期間の日付形式が正しくありません')
  }
  if (!['previous_month', 'previous_week', 'previous_equal_days', 'none'].includes(report.scope?.comparison_policy)) {
    add('scope.comparison_policy', 'invalid_enum', '比較方法を明示してください')
  }
  requireText(report.scope?.timezone, 'scope.timezone')
  if (!['fresh', 'delayed', 'unknown'].includes(report.scope?.data_freshness?.status)) {
    add('scope.data_freshness.status', 'invalid_enum', 'データ鮮度の状態が正しくありません')
  }
  const lastObservedAt = report.scope?.data_freshness?.last_observed_at
  if (lastObservedAt !== null && !isIsoDateTime(lastObservedAt)) {
    add('scope.data_freshness.last_observed_at', 'invalid_datetime', '日時形式が正しくありません')
  }
  if (!['full', 'partial', 'unavailable', 'failed'].includes(report.availability?.overall)) {
    add('availability.overall', 'invalid_enum', '利用可能状態が正しくありません')
  }
  report.availability?.metrics?.forEach((item, index) => {
    requireText(item.key, `availability.metrics.${index}.key`)
    if (!['measured', 'measured_zero', 'not_configured', 'no_period_data', 'unsupported', 'query_failed'].includes(item.status)) {
      add(`availability.metrics.${index}.status`, 'invalid_enum', '計測状態が正しくありません')
    }
    if (item.reason !== null && typeof item.reason !== 'string') {
      add(`availability.metrics.${index}.reason`, 'invalid_type', '理由は文字列または null が必要です')
    }
    if (item.last_observed_at !== null && !isIsoDateTime(item.last_observed_at)) {
      add(`availability.metrics.${index}.last_observed_at`, 'invalid_datetime', '日時形式が正しくありません')
    }
  })
  report.metrics.forEach((metric, index) => {
    requireText(metric.key, `metrics.${index}.key`)
    requireText(metric.label, `metrics.${index}.label`)
    requireText(metric.aggregation, `metrics.${index}.aggregation`)
    requireText(metric.evidence_key, `metrics.${index}.evidence_key`)
    if (typeof metric.unit !== 'string') add(`metrics.${index}.unit`, 'invalid_type', '単位は文字列が必要です')
    requireNumberOrNull(metric.value, `metrics.${index}.value`)
    requireNumberOrNull(metric.comparison.value, `metrics.${index}.comparison.value`)
    requireNumberOrNull(metric.comparison.absolute_change, `metrics.${index}.comparison.absolute_change`)
    requireNumberOrNull(metric.comparison.percent_change, `metrics.${index}.comparison.percent_change`)
    if (!['available', 'baseline_zero', 'not_available'].includes(metric.comparison.status)) {
      add(`metrics.${index}.comparison.status`, 'invalid_enum', '比較状態が正しくありません')
    }
  })
  const evidenceKeys = new Set(report.evidence.map((item) => item.key))
  const validateReferences = (item, path) => {
    if (item.evidence_keys?.some((key) => !evidenceKeys.has(key))) {
      add(`${path}.evidence_keys`, 'unknown_evidence', '存在する根拠キーを指定してください')
    }
  }
  const validateConclusion = (item, path) => {
    requireText(item.kind, `${path}.kind`)
    requireText(item.title, `${path}.title`)
    requireText(item.body, `${path}.body`)
    if (!['positive', 'neutral', 'attention', 'critical'].includes(item.severity)) {
      add(`${path}.severity`, 'invalid_enum', '重要度が正しくありません')
    }
    if (!['high', 'medium', 'low'].includes(item.confidence)) {
      add(`${path}.confidence`, 'invalid_enum', '確信度が正しくありません')
    }
    if (!Array.isArray(item.evidence_keys) || item.evidence_keys.length === 0 || item.evidence_keys.some((key) => !cleanText(key))) {
      add(`${path}.evidence_keys`, 'required', '根拠キーを1件以上指定してください')
    }
    validateReferences(item, path)
  }
  if (report.conclusions.length > 3) add('conclusions', 'too_many', '結論は3件以内にしてください')
  if (report.actions.length > 3) add('actions', 'too_many', '行動は3件以内にしてください')
  report.conclusions.forEach((item, index) => validateConclusion(item, `conclusions.${index}`))
  report.actions.forEach((item, index) => {
    requireText(item.title, `actions.${index}.title`)
    if (!['high', 'medium', 'low'].includes(item.confidence)) {
      add(`actions.${index}.confidence`, 'invalid_enum', '確信度が正しくありません')
    }
    if (!Array.isArray(item.evidence_keys) || item.evidence_keys.length === 0 || item.evidence_keys.some((key) => !cleanText(key))) {
      add(`actions.${index}.evidence_keys`, 'required', '根拠キーを1件以上指定してください')
    }
    validateReferences(item, `actions.${index}`)
    if (!['high', 'medium', 'low'].includes(item.priority)) add(`actions.${index}.priority`, 'invalid_enum', '優先度が正しくありません')
    requireText(item.reason, `actions.${index}.reason`)
    requireText(item.timeframe, `actions.${index}.timeframe`)
    requireText(item.success_metric, `actions.${index}.success_metric`)
  })
  report.evidence.forEach((item, index) => {
    requireText(item.key, `evidence.${index}.key`)
    requireText(item.query_type, `evidence.${index}.query_type`)
    requireText(item.title, `evidence.${index}.title`)
    if (item.chart !== null && !isPlainObject(item.chart)) add(`evidence.${index}.chart`, 'invalid_type', 'chart はオブジェクトまたは null が必要です')
  })
  report.metrics.forEach((metric, index) => {
    if (metric.evidence_key && !evidenceKeys.has(metric.evidence_key)) {
      add(`metrics.${index}.evidence_key`, 'unknown_evidence', '存在する根拠キーを指定してください')
    }
  })
  if (!isIsoDateTime(report.generated_at)) add('generated_at', 'invalid_datetime', '生成日時を明示してください')
  return issues
}

export function normalizeCustomerReportContract(value, options = {}) {
  const report = unwrapCustomerReport(value)
  const version = cleanText(report?.schema_version ?? report?.schemaVersion ?? report?.version)
  if (!report || version !== CUSTOMER_REPORT_SCHEMA_VERSION) {
    return {
      valid: false,
      issues: [{ path: 'schema_version', code: 'wrong_contract', message: 'report.v2 契約ではありません' }],
      report: null,
    }
  }
  const candidate = normalizeContractCandidate(report, options)
  const issues = validateCustomerReportContract(candidate)
  return {
    valid: issues.length === 0,
    issues,
    report: issues.length === 0 ? candidate : null,
  }
}

export function isCustomerReportV2(value, options = {}) {
  return normalizeCustomerReportContract(value, options).valid
}

/**
 * Build the UI reading model from either a validated `report.v2` or the legacy
 * beginner report. Legacy input stays labelled `legacy.v1`; this function
 * never promotes incomplete data to the public contract. `insight_report_v2`
 * is intentionally excluded because it belongs to the AI answer surface.
 */
export function buildCustomerReportViewModel(value, options = {}) {
  const report = unwrapCustomerReport(value)
  if (!report) return null
  const sourceVersion = cleanText(report.schema_version ?? report.schemaVersion ?? report.version)
  if (sourceVersion === 'insight_report_v2') return null

  const metrics = normalizeMetrics(report, options)
  const conclusions = normalizeConclusions(report)
  const actions = normalizeActions(report)
  const caveats = normalizeCaveats(report)
  const evidence = normalizeEvidence(report, conclusions, options)
  const hasUsefulContent = metrics.length > 0 || conclusions.length > 0 || actions.length > 0 || evidence.length > 0
  const availability = normalizeAvailability(report, options, hasUsefulContent)

  if (!sourceVersion && !hasUsefulContent && caveats.length === 0) return null

  const sourceSchema = sourceVersion === CUSTOMER_REPORT_SCHEMA_VERSION
    ? CUSTOMER_REPORT_SCHEMA_VERSION
    : sourceVersion === 'beginner_report_v1' ? 'legacy.v1' : 'unknown'

  return {
    source_schema: sourceSchema,
    scope: normalizeScope(report, options),
    availability,
    metrics,
    conclusions,
    actions,
    evidence,
    caveats,
    generated_at: cleanText(
      report.generated_at ?? report.generatedAt ?? report.metadata?.generated_at ?? options.generatedAt,
    ) || null,
  }
}

export function getCustomerReportGaps(value) {
  const report = isPlainObject(value) && typeof value.source_schema === 'string'
    ? value
    : buildCustomerReportViewModel(value)
  if (!report) return []
  const caveats = Array.isArray(report.caveats) ? report.caveats : []
  if (report.availability?.state === 'ready') return caveats
  const availabilityGap = {
    key: `availability_${report.availability?.state || 'empty'}`,
    title: report.availability?.label || 'まだ判断できないことがあります',
    body: report.availability?.message || '',
    next_step: report.availability?.state === 'error' ? 'もう一度取得する' : '期間または接続設定を確認する',
  }
  return uniqueItems([availabilityGap, ...caveats], (item) => item.key || item.title, 5)
}

function queryTypeOfGroup(group = {}) {
  return String(
    group?.queryType ??
    group?.query_type ??
    group?.metadata?.queryType ??
    group?.metadata?.query_type ??
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
