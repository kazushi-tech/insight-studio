import {
  AXIS_KEYS,
  findBrandSectionBodies,
  parseBrandVerdicts,
} from './brandEvalParser'

const ACTION_HEADINGS = [
  /##\s*(?:\d+[.．]?\s*)?最優先施策[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?優先施策[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?実行プラン[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?推奨(?:事項|施策)[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?(?:広告運用)?アクションプラン[^\n]*/,
  /##\s*(?:\d+[.．]?\s*)?改善提案[^\n]*/,
]

const KPI_RE = /(CVR|CPA|CTR|CPC|ROAS|CV|CTR|問い合わせ|申込|購入|クリック|コンバージョン)[^。\n、,]{0,24}(?:改善|向上|低下|削減|増加|回復|獲得|最適化|上昇|改善余地)?/i

const VERDICT_SCORE = {
  強: 100,
  同等: 62,
  弱: 28,
  評価保留: null,
}

const OWNER_AREA_LABELS = {
  lp: 'LP改善',
  copy: '広告文',
  delivery: '配信設定',
  measurement: '計測',
  classification: '競合分類確認',
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function extractSection(reportMd, headingPatterns) {
  if (typeof reportMd !== 'string') return ''
  for (const pattern of headingPatterns) {
    const match = reportMd.match(pattern)
    if (!match) continue
    const start = match.index + match[0].length
    const rest = reportMd.slice(start)
    const endMatch = rest.match(/\n##\s/)
    return rest.slice(0, endMatch ? endMatch.index : rest.length)
  }
  return ''
}

function cleanText(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitActionTitle(text) {
  const cleaned = cleanText(text)
  const match = cleaned.match(/^(.+?)[:：](.+)$/)
  if (!match) return { title: cleaned, detail: '' }
  return { title: match[1].trim(), detail: match[2].trim() }
}

function parseActionsFromMarkdown(reportMd) {
  const section = extractSection(reportMd, ACTION_HEADINGS)
  if (!section) return []

  const actions = []
  let current = null
  for (const rawLine of section.split(/\r?\n/)) {
    const bullet = rawLine.match(/^\s*(?:[-*•]|\d+[.．)])\s+(.+)$/)
    if (bullet) {
      if (current) actions.push(current)
      current = splitActionTitle(bullet[1])
      continue
    }
    const continuation = cleanText(rawLine)
    if (current && continuation && !continuation.startsWith('|') && !continuation.startsWith('#')) {
      current.detail = current.detail ? `${current.detail} ${continuation}` : continuation
    }
  }
  if (current) actions.push(current)
  return actions.slice(0, 5)
}

function normalizeAction(action, idx, reportMd) {
  const title = cleanText(action.title || action.name || action.action || `優先施策 ${idx + 1}`)
  const detail = cleanText(action.detail || action.reason || action.why || action.description || '')
  const expectedKpi = cleanText(action.expected_kpi || action.expectedKpi || action.kpi || '')
  const confidence = action.confidence ?? action.evidence_level ?? action.evidenceLevel ?? null
  const impact = action.impact ?? null
  const effort = action.effort ?? null

  const kpiMatch = expectedKpi || detail.match(KPI_RE)?.[0] || reportMd?.match(KPI_RE)?.[0] || ''
  return {
    title,
    detail,
    ownerArea: normalizeOwnerArea(action.owner_area || action.ownerArea || `${title} ${detail}`),
    expectedKpi: cleanText(kpiMatch) || 'CVR / CPA への影響を実測で確認',
    confidence: normalizeConfidence(confidence),
    impact: normalizeAxisValue(impact, idx === 0 ? 82 : 68),
    effort: normalizeAxisValue(effort, idx === 0 ? 42 : 58),
    whyNow: cleanText(action.why_now || action.whyNow || action.reason || action.why || detail) || '競合との初回接点で差が出やすい箇所のため、次回配信前に判断します',
    firstStep: cleanText(action.first_task || action.firstTask || action.first_step || action.firstStep || action.action || detail) || '該当LP/広告の変更案を1案作り、A/Bテスト設計へ落とし込む',
  }
}

function normalizeOwnerArea(value) {
  const text = String(value || '').toLowerCase()
  if (/競合|分類|対象外|compare|competitor/.test(text)) return OWNER_AREA_LABELS.classification
  if (/計測|ga4|bigquery|タグ|utm|measurement|tracking/.test(text)) return OWNER_AREA_LABELS.measurement
  if (/配信|入札|ターゲ|campaign|広告セット|delivery|bid/.test(text)) return OWNER_AREA_LABELS.delivery
  if (/広告文|コピー|cta|訴求|creative|copy/.test(text)) return OWNER_AREA_LABELS.copy
  return OWNER_AREA_LABELS.lp
}

function normalizeAxisValue(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return clamp(value, 0, 100)
  const text = String(value || '').toLowerCase()
  if (/high|大|高|強/.test(text)) return 82
  if (/low|小|低|弱/.test(text)) return 32
  if (/medium|中/.test(text)) return 58
  return fallback
}

export function normalizeConfidence(value) {
  const text = String(value || '').trim().toLowerCase()
  if (/high|確認済|強|高/.test(text)) return { key: 'high', label: '高', icon: 'verified', helper: '確認済み根拠が中心' }
  if (/low|低|弱/.test(text)) return { key: 'low', label: '低', icon: 'visibility_off', helper: '推定が多く再確認が必要' }
  if (/pending|評価保留|保留|unknown|null/.test(text)) return { key: 'pending', label: '評価保留', icon: 'pending', helper: '取得不足のため判断保留' }
  return { key: 'medium', label: '中', icon: 'fact_check', helper: '確認済みと推定が混在' }
}

function getActions(envelope, reportMd) {
  const envActions = Array.isArray(envelope?.priority_actions) ? envelope.priority_actions : []
  const source = envActions.length > 0 ? envActions : parseActionsFromMarkdown(reportMd)
  return source.slice(0, 4).map((action, idx) => normalizeAction(action, idx, reportMd))
}

function normalizeRole(role) {
  const value = String(role || '').toLowerCase()
  if (value === 'direct' || value.includes('直') || value.includes('直接')) return 'direct'
  if (value === 'adjacent' || value === 'indirect' || value.includes('準') || value.includes('隣接')) return 'adjacent'
  if (value === 'out_of_scope' || value.includes('対象外') || value.includes('除外')) return 'out_of_scope'
  if (value === 'reference' || value === 'benchmark' || value.includes('参考')) return 'reference'
  return 'direct'
}

const SEARCH_OR_TOOL_DOMAINS = [
  'google.com',
  'cloud.google.com',
  'vertexaisearch.cloud.google.com',
  'bing.com',
  'yahoo.co.jp/search',
]

const BROAD_MARKETPLACE_DOMAINS = [
  'aliexpress.com',
  'amazon.',
  'rakuten.',
  'shopping.yahoo.',
  'yahoo.co.jp/shopping',
]

function inferRoleOverride(value, reason = '') {
  const text = `${value || ''} ${reason || ''}`.toLowerCase()
  if (SEARCH_OR_TOOL_DOMAINS.some((domain) => text.includes(domain))) {
    return 'out_of_scope'
  }
  if (BROAD_MARKETPLACE_DOMAINS.some((domain) => text.includes(domain))) {
    return 'reference'
  }
  return null
}

export function getRoleMeta(role) {
  const normalized = normalizeRole(role)
  if (normalized === 'direct') return { key: normalized, label: '直接競合', icon: 'adjust' }
  if (normalized === 'adjacent') return { key: normalized, label: '隣接競合', icon: 'call_split' }
  if (normalized === 'reference') return { key: normalized, label: '参考サイト', icon: 'visibility' }
  return { key: normalized, label: '対象外', icon: 'block' }
}

function scoreAxes(verdicts, axes, fallback) {
  const scores = axes
    .map((axis) => VERDICT_SCORE[verdicts?.[axis]?.verdict ?? '評価保留'])
    .filter((score) => score != null)
  if (!scores.length) return fallback
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
}

function fromEnvelopeBrands(evaluations) {
  if (!Array.isArray(evaluations)) return []
  return evaluations
    .map((e, idx) => {
      const roleOverride = inferRoleOverride(
        `${e.brand || ''} ${e.domain || ''} ${e.url || ''}`,
        e.classification_reason || e.reason,
      )
      const role = getRoleMeta(roleOverride || e.role || e.competitor_tier)
      if (role.key === 'out_of_scope') return null
      const verdicts = {}
      for (const axis of e.axes || []) {
        if (!AXIS_KEYS.includes(axis.axis)) continue
        verdicts[axis.axis] = {
          verdict: axis.verdict ?? null,
          evidence: axis.evidence ?? '',
          reason: axis.reason ?? '',
        }
      }
      return makeBrandPoint({
        brand: e.brand || `競合 ${idx + 1}`,
        verdicts,
        role,
        reason: e.classification_reason || e.reason || '',
      }, idx)
    })
    .filter(Boolean)
}

function fromMarkdownBrands(reportMd) {
  return findBrandSectionBodies(reportMd)
    .map((chunk, idx) => {
      const verdicts = parseBrandVerdicts(chunk.body)
      if (!verdicts) return null
      const isReference = /参考|評価保留|benchmark/i.test(chunk.title)
      return makeBrandPoint({
        brand: cleanText(chunk.title.replace(/（.*?）/g, '')),
        verdicts,
        role: getRoleMeta(isReference ? 'reference' : 'direct'),
        reason: isReference ? 'レポート上で参考観測または評価保留として扱われています' : '',
      }, idx)
    })
    .filter(Boolean)
}

function makeBrandPoint(row, idx) {
  const acquisition = scoreAxes(row.verdicts, ['検索意図一致', 'CTA明確性', '購買導線'], 45 + idx * 8)
  const trust = scoreAxes(row.verdicts, ['FV訴求', '信頼構築', '価格・オファー'], 55 - idx * 6)
  const pendingCount = AXIS_KEYS.filter((axis) => !row.verdicts?.[axis] || row.verdicts[axis].verdict === '評価保留').length
  const confirmedCount = AXIS_KEYS.filter((axis) => /確認済/.test(row.verdicts?.[axis]?.evidence || '')).length
  return {
    brand: row.brand,
    x: clamp(acquisition, 12, 88),
    y: clamp(trust, 12, 88),
    role: row.role,
    reason: row.reason,
    pendingCount,
    confirmedCount,
  }
}

function getBrands(envelope, reportMd) {
  const fromEnv = fromEnvelopeBrands(envelope?.brand_evaluations)
  return fromEnv.length > 0 ? fromEnv : fromMarkdownBrands(reportMd)
}

function normalizeEvidenceItem(item, idx) {
  const level = normalizeConfidence(item.evidence_level || item.evidenceLevel || item.level || item.confidence)
  return {
    label: cleanText(item.label || item.title || item.source_url || `根拠 ${idx + 1}`),
    sourceUrl: cleanText(item.source_url || item.sourceUrl || item.url || ''),
    observation: cleanText(item.observation || item.evidence_text || item.detail || item.reason || ''),
    level,
  }
}

function getEvidenceItems(envelope, brands) {
  const envItems = Array.isArray(envelope?.evidence_items) ? envelope.evidence_items : []
  if (envItems.length > 0) {
    return envItems.slice(0, 6).map(normalizeEvidenceItem)
  }

  return brands.slice(0, 4).map((brand) => ({
    label: brand.brand,
    sourceUrl: '',
    observation: brand.reason || `${brand.role.label}として比較。確認済み ${brand.confirmedCount} 件、評価保留 ${brand.pendingCount} 件。`,
    level: brand.pendingCount > brand.confirmedCount ? normalizeConfidence('pending') : normalizeConfidence('medium'),
  }))
}

function getTierSummary(envelope, brands) {
  const rows = Array.isArray(envelope?.brand_evaluations) ? envelope.brand_evaluations : []
  const source = rows.length > 0
    ? rows.map((row) => ({
        brand: cleanText(row.brand || row.domain || row.url || ''),
        role: getRoleMeta(
          inferRoleOverride(
            `${row.brand || ''} ${row.domain || ''} ${row.url || ''}`,
            row.classification_reason || row.reason,
          ) || row.role || row.competitor_tier,
        ),
        reason: cleanText(row.classification_reason || row.reason || ''),
      }))
    : brands.map((brand) => ({
        brand: brand.brand,
        role: brand.role,
        reason: brand.reason,
      }))

  const counts = { direct: 0, adjacent: 0, reference: 0, out_of_scope: 0 }
  const examples = []
  for (const item of source) {
    counts[item.role.key] = (counts[item.role.key] || 0) + 1
    if (examples.length < 5) examples.push(item)
  }
  return { counts, examples }
}

function buildEvidenceSummary(brands) {
  const confirmed = brands.reduce((sum, brand) => sum + brand.confirmedCount, 0)
  const pending = brands.reduce((sum, brand) => sum + brand.pendingCount, 0)
  const confidence = pending > confirmed
    ? normalizeConfidence('pending')
    : confirmed >= Math.max(2, pending)
      ? normalizeConfidence('high')
      : normalizeConfidence('medium')
  return {
    confirmed,
    pending,
    confidence,
  }
}

export function buildReportDecisionInsights({ envelope, reportMd }) {
  const actions = getActions(envelope, reportMd)
  const brands = getBrands(envelope, reportMd)
  const evidenceItems = getEvidenceItems(envelope, brands)
  const tiers = getTierSummary(envelope, brands)
  const evidence = buildEvidenceSummary(brands)
  const summary = envelope?.decision_summary || {}
  const fallbackTopAction = actions[0] || {
    title: '優先施策をレポート本文で確認',
    detail: '構造化された優先施策が見つからないため、詳細レポートを確認してください。',
    expectedKpi: 'CVR / CPA への影響を実測で確認',
    ownerArea: OWNER_AREA_LABELS.lp,
    confidence: evidence.confidence,
    impact: 60,
    effort: 50,
    whyNow: 'レポート本文の実行プランを読み、最初の検証対象を決める必要があります',
    firstStep: '詳細レポート内の改善提案から、最初に検証する1施策を選ぶ',
  }
  const topAction = {
    ...fallbackTopAction,
    title: cleanText(summary.top_action) || fallbackTopAction.title,
    detail: cleanText(summary.why_now) || fallbackTopAction.detail,
    whyNow: cleanText(summary.why_now) || fallbackTopAction.whyNow,
    expectedKpi: cleanText(summary.expected_kpi) || fallbackTopAction.expectedKpi,
    confidence: summary.confidence ? normalizeConfidence(summary.confidence) : fallbackTopAction.confidence,
  }

  return {
    actions,
    topAction,
    brands,
    evidence,
    evidenceItems,
    tiers,
  }
}
