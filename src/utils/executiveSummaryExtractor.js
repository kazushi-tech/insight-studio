/**
 * Executive Summary データ抽出ユーティリティ
 *
 * 既存の reportBundle / chartGroups / markdown から
 * Executive Summary カードや Evidence 情報を抽出する。
 * モック値は使わず、取得できない場合は null を返す。
 */

import { extractKpis } from './kpiExtractor'

/* ── Evidence 種別定義 ── */
const EVIDENCE_TYPES = {
  observed: { label: '実測', en: 'Observed', color: 'primary' },
  derived:  { label: '導出', en: 'Derived',  color: 'secondary' },
  proxy:    { label: '代替', en: 'Proxy',    color: 'outline' },
  inferred: { label: '推論', en: 'Inferred', color: 'tertiary' },
}

/* ── KPI → Evidence 種別マッピング ── */
const OBSERVED_PATTERNS = /cvr|コンバージョン|cv数|セッション|pv|ページビュー|直帰率|離脱率|bounce|exit|ctr|click|imp|表示回数|費用|cost|cpa|cpc|roas/i
const DERIVED_PATTERNS  = /検索需要|潜在|機会|推計|click\s*share|シェア|opportunity|estimated|導出/i
const PROXY_PATTERNS    = /オークション|競合|推定|proxy|代替|benchmark/i
const INFERRED_PATTERNS = /推論|ai|スコア|score|evaluation|判定|示唆|仮説/i

function classifyEvidenceType(label) {
  if (OBSERVED_PATTERNS.test(label)) return 'observed'
  if (DERIVED_PATTERNS.test(label))  return 'derived'
  if (PROXY_PATTERNS.test(label))    return 'proxy'
  if (INFERRED_PATTERNS.test(label)) return 'inferred'
  return 'observed' // デフォルトは実測扱い
}

/* ── Executive Summary カード抽出 ── */

/**
 * KPI の中からカード候補を分類して返す
 */
function classifyKpiForCard(kpi, index) {
  const label = (kpi.label ?? '').toLowerCase()
  const evidenceType = classifyEvidenceType(label)

  // CVR / コンバージョン率
  if (/cvr|コンバージョン率|conversion\s*rate/i.test(label)) {
    return { cardType: 'cvr', evidenceType, priority: 0 }
  }
  // 離脱率 / 直帰率
  if (/離脱|直帰|bounce|exit/i.test(label)) {
    return { cardType: 'risk', evidenceType, priority: 2 }
  }
  // 検索需要 / 流入機会
  if (/需要|機会|流入|セッション|session|pv|ページビュー|traffic/i.test(label)) {
    return { cardType: 'opportunity', evidenceType, priority: 1 }
  }
  // CPA / CPC / ROAS
  if (/cpa|cpc|roas|費用|cost/i.test(label)) {
    return { cardType: 'efficiency', evidenceType, priority: 3 }
  }

  return { cardType: index === 0 ? 'cvr' : 'general', evidenceType, priority: 10 + index }
}

/**
 * Markdown + chartGroups から Executive Summary 用のカードデータを生成
 */
export function extractExecutiveCards(reportMd, chartGroups = []) {
  const kpis = extractKpis(reportMd ?? '')
  if (kpis.length === 0) return []

  const classified = kpis.map((kpi, index) => ({
    ...kpi,
    ...classifyKpiForCard(kpi, index),
    evidenceId: `E-${String(index + 1).padStart(2, '0')}`,
  }))

  // カードスロットに割り当て
  const slots = ['cvr', 'opportunity', 'risk']
  const cards = []
  const used = new Set()

  for (const slotType of slots) {
    const candidate = classified
      .filter((c) => c.cardType === slotType && !used.has(c.evidenceId))
      .sort((a, b) => a.priority - b.priority)[0]

    if (candidate) {
      cards.push(candidate)
      used.add(candidate.evidenceId)
    }
  }

  // 残りを埋める (最大3枚)
  for (const c of classified) {
    if (cards.length >= 3) break
    if (!used.has(c.evidenceId)) {
      cards.push(c)
      used.add(c.evidenceId)
    }
  }

  return cards
}

/* ── Coverage Summary 算出 ── */

export function computeCoverageSummary(cards) {
  const counts = { observed: 0, derived: 0, proxy: 0, inferred: 0 }
  for (const card of cards) {
    if (counts[card.evidenceType] !== undefined) {
      counts[card.evidenceType]++
    }
  }
  const total = cards.length
  return { ...counts, total }
}

/* ── 精緻化分析ブロック抽出 ── */

const SECTION_KEYWORDS = {
  observation: /観測|事実|実測|ファクト|fact|finding|発見|結果|現状/i,
  hypothesis:  /仮説|要因|原因|cause|root\s*cause|why|理由|背景/i,
  action:      /改善|施策|アクション|推奨|action|recommendation|提案|対策|次のステップ/i,
}

/**
 * Markdown の H2 セクションから、精緻化分析に使えるブロックを抽出
 */
export function extractRefinedInsights(reportMd) {
  if (!reportMd) return []

  const lines = reportMd.split(/\r?\n/)
  const sections = []
  let currentHeading = null
  let currentLines = []

  const flush = () => {
    if (!currentHeading || currentLines.length === 0) return
    const content = currentLines.join('\n').trim()
    if (!content) return
    sections.push({ heading: currentHeading, content })
  }

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/)
    if (h2Match) {
      flush()
      currentHeading = h2Match[1].replace(/[#*`]/g, '').trim()
      currentLines = []
      continue
    }
    if (currentHeading) currentLines.push(line)
  }
  flush()

  // セクションを observation/hypothesis/action に分類
  const blocks = []
  let blockIndex = 0

  for (const section of sections) {
    let type = null
    for (const [key, pattern] of Object.entries(SECTION_KEYWORDS)) {
      if (pattern.test(section.heading)) {
        type = key
        break
      }
    }
    if (!type) continue

    // 最初の1-2段落を抽出
    const paragraphs = section.content
      .split(/\n\n+/)
      .map((p) => p.replace(/^\s*[-*]\s+/, '').trim())
      .filter((p) => p.length > 0 && !p.startsWith('|'))
      .slice(0, 2)

    if (paragraphs.length === 0) continue

    blocks.push({
      type,
      heading: section.heading,
      summary: paragraphs.join(' '),
      evidenceId: `E-${String(blockIndex + 1).padStart(2, '0')}`,
    })
    blockIndex++
  }

  return blocks
}

/**
 * Markdown からアクション/推奨セクションを抽出
 */
export function extractRecommendedAction(reportMd) {
  if (!reportMd) return null

  const lines = reportMd.split(/\r?\n/)
  let inActionSection = false
  let actionLines = []

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/)
    if (h2Match) {
      const heading = h2Match[1]
      if (/推奨|アクション|改善|施策|提案|次のステップ|action|recommend/i.test(heading)) {
        inActionSection = true
        actionLines = []
        continue
      } else if (inActionSection) {
        break
      }
    }
    if (inActionSection) actionLines.push(line)
  }

  const content = actionLines.join('\n').trim()
  if (!content) return null

  // 最初のアクション項目を抽出
  const firstBullet = content.match(/^\s*[-*]\s+(.+)/m)
  const title = firstBullet
    ? firstBullet[1].replace(/\*\*/g, '').trim()
    : content.split('\n')[0].replace(/\*\*/g, '').trim()

  if (!title) return null

  // 優先度を推定
  const isUrgent = /即時|至急|urgent|p0|最優先/i.test(content)
  const isHigh = /高|high|p1|今週/i.test(content)

  return {
    title: title.slice(0, 60),
    priority: isUrgent ? '至急' : isHigh ? '高' : '中',
    content,
  }
}

/* ── Data Quality Alert 抽出 ── */

export function extractDataQualityAlerts(reportMd, chartGroups = []) {
  const alerts = []

  if (reportMd) {
    // サンプル数警告
    if (/サンプル数.*少|低.*サンプル|small\s*sample|low\s*sample/i.test(reportMd)) {
      alerts.push({ type: 'warning', message: 'サンプル数が基準値を下回っている可能性があります' })
    }
    // データ欠損
    if (/欠損|missing|不足|取得不可|未取得/i.test(reportMd)) {
      alerts.push({ type: 'info', message: '一部データに欠損があります' })
    }
  }

  // chartGroups のデータ不足チェック
  const emptyGroups = chartGroups.filter(
    (g) => !Array.isArray(g?.datasets) || g.datasets.length === 0,
  )
  if (emptyGroups.length > 0) {
    alerts.push({
      type: 'info',
      message: `${emptyGroups.length}件のチャートグループでデータ系列がありません`,
    })
  }

  return alerts
}

export { EVIDENCE_TYPES }
