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

/* ── Markdown テキスト整形ヘルパー ── */

function sanitizeMdText(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')        // [text](url) → text
    .replace(/`([^`]*)`/g, '$1')                      // `code` → code
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')         // **bold** / *italic*
    .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')            // __bold__ / _italic_
    .replace(/^\s*#{1,6}\s+/gm, '')                    // # heading → plain
    .replace(/\s+/g, ' ')                              // normalize whitespace
    .trim()
}

function isValidActionTitle(title) {
  if (!title || title.length < 5) return false
  if (/^[a-z_\s.]+$/i.test(title) && title.length < 30) return false
  if ((title.match(/_/g) || []).length > 2) return false
  return true
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

  // 全箇条書きを整形して検証、最初の有効なタイトルを使う
  const allBullets = content.match(/^\s*[-*]\s+(.+)/gm) || []
  let title = ''

  for (const raw of allBullets) {
    const candidate = sanitizeMdText(raw.replace(/^\s*[-*]\s+/, ''))
    if (isValidActionTitle(candidate)) {
      title = candidate
      break
    }
  }

  // 箇条書きに有効なものが無ければ先頭行を使う
  if (!title) {
    const firstLine = sanitizeMdText(content.split('\n')[0] || '')
    if (isValidActionTitle(firstLine)) title = firstLine
  }

  if (!title) return null

  // 優先度を推定
  const isUrgent = /即時|至急|urgent|p0|最優先/i.test(content)
  const isHigh = /高|high|p1|今週/i.test(content)

  return {
    title: title.slice(0, 80),
    priority: isUrgent ? '至急' : isHigh ? '高' : '中',
    content,
  }
}

/* ── Pack-specific カード抽出 ── */

const PACK_CARD_SLOTS = [
  {
    id: 'conclusion',
    label: '結論 / 主要成果',
    icon: 'verified',
    patterns: /結論|主要|成果|サマリー|概要|結果|総括|まとめ|summary|conclusion|finding|result|overview|パフォーマンス|performance/i,
  },
  {
    id: 'opportunity',
    label: '最大機会',
    icon: 'trending_up',
    patterns: /機会|改善|成長|増加|好調|伸長|ポジティブ|opportunity|growth|improve|upside|potential|提案|施策|推奨|recommend|強み|strength/i,
  },
  {
    id: 'risk',
    label: '最大リスク',
    icon: 'warning',
    patterns: /リスク|課題|低下|悪化|懸念|問題|減少|下落|直帰|離脱|risk|decline|concern|issue|threat|bounce|exit|注意|alert|弱み|weakness/i,
  },
]

/**
 * レポート Markdown から要点パック専用カード (結論/機会/リスク) を抽出
 */
export function extractPackCards(reportMd) {
  if (!reportMd) return []

  const lines = reportMd.split(/\r?\n/)
  const h2Sections = []
  let currentHeading = null
  let currentLines = []

  const flush = () => {
    if (!currentHeading || currentLines.length === 0) return
    const content = currentLines.join('\n').trim()
    if (!content) return
    h2Sections.push({ heading: currentHeading, content })
  }

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/)
    const h1Match = !h2Match && line.match(/^#\s+(.+)/)
    if (h2Match || h1Match) {
      flush()
      currentHeading = (h2Match || h1Match)[1].replace(/[#*`]/g, '').trim()
      currentLines = []
      continue
    }
    if (currentHeading) currentLines.push(line)
  }
  flush()

  const cards = []
  const usedSections = new Set()

  for (const slot of PACK_CARD_SLOTS) {
    let bestSection = null
    for (const section of h2Sections) {
      if (usedSections.has(section.heading)) continue
      if (slot.patterns.test(section.heading)) {
        bestSection = section
        break
      }
    }

    // conclusion は最初のセクションをフォールバック
    if (!bestSection && slot.id === 'conclusion') {
      for (const section of h2Sections) {
        if (!usedSections.has(section.heading)) {
          bestSection = section
          break
        }
      }
    }

    if (!bestSection) continue
    usedSections.add(bestSection.heading)

    // 最初の 1-2 段落（散文のみ、テーブル・リストは除外）
    const paragraphs = bestSection.content
      .split(/\n\n+/)
      .map((p) => sanitizeMdText(p))
      .filter((p) => p.length > 10 && !p.startsWith('|'))

    let summary = ''
    if (paragraphs.length > 0) {
      summary = paragraphs.slice(0, 2).join(' ')
    } else {
      // 散文が無ければ箇条書きから要約
      const bullets = bestSection.content.match(/^\s*[-*]\s+(.+)/gm)
      if (bullets) {
        summary = bullets
          .slice(0, 3)
          .map((b) => sanitizeMdText(b.replace(/^\s*[-*]\s+/, '')))
          .join('。')
      }
    }

    if (summary.length > 150) summary = summary.slice(0, 147) + '…'
    if (!summary) continue

    cards.push({
      id: slot.id,
      label: slot.label,
      icon: slot.icon,
      summary,
      heading: bestSection.heading,
    })
  }

  return cards
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
