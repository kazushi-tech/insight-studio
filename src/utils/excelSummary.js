/**
 * Deterministic Excel summary generator (no LLM).
 *
 * Produces a "conclusion-first" summary from parsed Excel data so the user
 * can grasp the headline before opening the full report.
 */

// ── helpers ──

function pctChange(prev, curr) {
  if (prev == null || curr == null || prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

function fmt(value, suffix = '') {
  if (value == null) return '-'
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万${suffix}`
  return `${value.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}${suffix}`
}

function fmtPct(value) {
  if (value == null) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}

function fmtRate(value) {
  if (value == null) return '-'
  return `${value.toFixed(2)}%`
}

function share(part, total) {
  if (!total || total === 0) return 0
  return (part / total) * 100
}

// ── main export ──

/**
 * @param {{ kpis, sections, creativeRefs, warnings }} data — subset of parseExcelFile() output
 * @returns {null | { readiness, coverageNote, highlights, recommendedAction, detailFlags }}
 */
export function buildExcelSummary(data) {
  if (!data) return null

  const { sections = {}, creativeRefs = [] } = data

  const monthly  = sections.monthly?.status === 'extracted' ? sections.monthly : null
  const campaign = sections.campaign?.status === 'extracted' ? sections.campaign : null
  const adGroup  = sections.adGroup?.status === 'extracted' ? sections.adGroup : null

  // Nothing useful extracted — skip summary entirely
  if (!monthly && !campaign && !adGroup && creativeRefs.length === 0) return null

  const detailFlags = {
    hasMonthly:  !!monthly,
    hasCampaign: !!campaign,
    hasAdGroup:  !!adGroup,
    hasCreative: creativeRefs.length > 0,
  }

  // ── readiness ──
  const readinessParts = []
  if (campaign && campaign.labels.length <= 2) {
    readinessParts.push(`キャンペーン数${campaign.labels.length}件`)
  }
  if (adGroup && adGroup.labels.length <= 3) {
    readinessParts.push(`広告グループ数${adGroup.labels.length}件`)
  }
  const readiness = readinessParts.length > 0
    ? `${readinessParts.join('・')} — 比較対象が少ないため要約価値は限定的です`
    : null

  // ── coverageNote ──
  const allTextAd = creativeRefs.length > 0 && creativeRefs.every((r) => !r.imageUrl)
  const coverageNote = allTextAd ? 'TEXT AD 中心の構成です（画像バナーなし）' : null

  // ── highlight 1: 月次変化 ──
  const highlight1 = buildMonthlyChangeHighlight(monthly)

  // ── highlight 2: 寄与構造 ──
  const highlight2 = buildContributionHighlight(campaign, adGroup)

  // ── highlight 3: 勝ち訴求 ──
  const highlight3 = buildWinningCreativeHighlight(creativeRefs)

  const highlights = [highlight1, highlight2, highlight3]

  // ── recommendedAction ──
  const recommendedAction = deriveRecommendedAction(highlight1, highlight2, highlight3, monthly)

  return { readiness, coverageNote, highlights, recommendedAction, detailFlags }
}

// ── highlight builders ──

function buildMonthlyChangeHighlight(monthly) {
  const base = { label: '月次変化', text: null }

  if (!monthly || monthly.labels.length < 2) {
    base.text = monthly
      ? '単月データのみのため前月比較はできません'
      : '月別推移データなし'
    return base
  }

  const len = monthly.labels.length
  const prevLabel = monthly.labels[len - 2]
  const currLabel = monthly.labels[len - 1]

  const parts = []

  for (const [key, displayName] of [['click', 'クリック'], ['cv', 'CV'], ['cvr', 'CVR']]) {
    const series = monthly.series[key]
    if (!series) continue
    const prev = series[len - 2]
    const curr = series[len - 1]

    if (key === 'cvr') {
      if (prev != null && curr != null) {
        parts.push(`${displayName} ${fmtRate(prev)}→${fmtRate(curr)}`)
      }
    } else {
      const delta = pctChange(prev, curr)
      if (delta != null) {
        parts.push(`${displayName} ${fmtPct(delta)}`)
      }
    }
  }

  base.text = parts.length > 0
    ? `${prevLabel}→${currLabel}: ${parts.join(', ')}`
    : `${prevLabel}→${currLabel}: 主要指標の変動なし`
  base._monthlyDelta = extractMonthlyDelta(monthly)
  return base
}

function extractMonthlyDelta(monthly) {
  if (!monthly || monthly.labels.length < 2) return {}
  const len = monthly.labels.length
  const result = {}
  for (const key of ['click', 'cv', 'cvr', 'cost']) {
    const series = monthly.series[key]
    if (!series) continue
    result[key] = pctChange(series[len - 2], series[len - 1])
  }
  return result
}

function buildContributionHighlight(campaign, adGroup) {
  const base = { label: '寄与構造', text: null }

  const source = adGroup || campaign
  if (!source || source.labels.length === 0) {
    base.text = '比較データなし'
    return base
  }

  const metricKey = source.series.click ? 'click'
    : source.series.cv ? 'cv'
    : source.series.cost ? 'cost'
    : null

  if (!metricKey) {
    base.text = '比較データなし'
    return base
  }

  const values = source.series[metricKey]
  const total = values.reduce((s, v) => s + (v ?? 0), 0)

  if (total === 0 || source.labels.length <= 1) {
    base.text = source.labels.length === 1
      ? `${source.labels[0]} の単独運用です`
      : '比較データなし'
    base._concentration = null
    return base
  }

  // Find top contributor
  let maxIdx = 0
  let maxVal = values[0] ?? 0
  for (let i = 1; i < values.length; i++) {
    if ((values[i] ?? 0) > maxVal) {
      maxVal = values[i] ?? 0
      maxIdx = i
    }
  }

  const topShare = share(maxVal, total)
  const topLabel = source.labels[maxIdx]
  const entityType = adGroup ? '広告グループ' : 'キャンペーン'
  const metricLabel = metricKey === 'click' ? 'クリック' : metricKey === 'cv' ? 'CV' : '費用'

  if (topShare >= 60) {
    base.text = `${entityType}「${topLabel}」が${metricLabel}の${topShare.toFixed(0)}%を占有 — 偏りあり`
  } else {
    base.text = `${entityType}トップは「${topLabel}」(${metricLabel}${topShare.toFixed(0)}%) — 比較的分散`
  }
  base._concentration = topShare
  return base
}

function buildWinningCreativeHighlight(creativeRefs) {
  const base = { label: '勝ち訴求', text: null }

  if (!creativeRefs || creativeRefs.length === 0) {
    base.text = 'クリエイティブデータなし'
    return base
  }

  // Pick by CV first, then click
  let best = null
  let bestMetric = null
  let bestValue = -1

  for (const ref of creativeRefs) {
    if (ref.kpis?.cv != null && ref.kpis.cv > bestValue) {
      best = ref
      bestMetric = 'CV'
      bestValue = ref.kpis.cv
    }
  }

  if (!best) {
    for (const ref of creativeRefs) {
      if (ref.kpis?.click != null && ref.kpis.click > bestValue) {
        best = ref
        bestMetric = 'クリック'
        bestValue = ref.kpis.click
      }
    }
  }

  if (!best) {
    base.text = 'クリエイティブの成果指標なし'
    return base
  }

  const isTextAd = !best.imageUrl
  const typeTag = isTextAd ? '[TEXT AD] ' : ''
  base.text = `${typeTag}「${best.name}」が${bestMetric}最多 (${fmt(bestValue)})`
  return base
}

// ── recommended action ──

function deriveRecommendedAction(h1, h2, h3) {
  const delta = h1?._monthlyDelta ?? {}
  const concentration = h2?._concentration

  // High concentration → rebalance
  if (concentration != null && concentration >= 60) {
    const entity = h2.text?.includes('広告グループ') ? '広告グループ' : 'キャンペーン'
    return `${entity}間の配分が偏っています。予算・入札の再配分を検討してください。`
  }

  // CVR rising → scale winning creative
  if (delta.cvr != null && delta.cvr > 0 && h3?.text && !h3.text.includes('データなし')) {
    return '効率改善トレンドが見られます。勝ち訴求の横展開・予算拡大を検討してください。'
  }

  // CV declining → investigate
  if (delta.cv != null && delta.cv < -10) {
    return 'CV数が減少傾向です。検索語句レポートや広告グループ別の内訳を確認してください。'
  }

  // Click declining → check impressions / bidding
  if (delta.click != null && delta.click < -10) {
    return 'クリック数が減少傾向です。入札戦略やキーワードの見直しを検討してください。'
  }

  // Default
  return '現状維持で問題ありませんが、定期的な検索語句チェックを推奨します。'
}
