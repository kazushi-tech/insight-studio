/**
 * Report quality validation and content splitting utilities.
 * Tasks A, C: Hard-fail quality gate + body/appendix separation.
 * Phase 1-3: Quantitative claim validation, market source check,
 *            evaluation-deferred density check, competitive set overlap check.
 */

// Issue severity levels (Phase P1-C)
export const ISSUE_SEVERITY = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
}

// Section D-1: Blocker tokens → red banner + regenerate CTA
const BLOCKER_TOKENS = [
  '最優先3施策',
  'LP改善施策',
  '検索広告施策',
  '末尾欠け',
  'Section 5',
  'Section 5-2',
  '必須セクション',
  '構造エラー',
]

// Warning tokens → amber banner (important but not report-breaking)
const WARNING_TOKENS = [
  'サブセクション欠損(任意)',
  '5-3',
  '5-4',
  '評価保留密度',
  '価格未取得',
  '定量クレーム',
  '市場規模ソース',
  '競合セット矛盾',
  '予算配分',
  'L5転用',
]

// Legacy keyword tokens for severity classification
const _CRITICAL_TOKENS = [
  'セクション欠損',
  '見出し欠損',
  '末尾欠け',
  '未完',
  '途切れ',
  '途中切断',
  '構造エラー',
  '必須セクション',
  '最優先3施策',
  '予算フレーム',
  'LP改善施策',
  '検索広告施策',
  'Section 5',
]

const _INFO_TOKENS = [
  'サブセクション欠損(任意)',
  '任意',
  '5-3',
  '5-4',
]

/**
 * Section D-1: Split issues into blockers (red) and warnings (amber).
 * Blockers mean the report is unusable without regeneration.
 */
export function splitIssuesBySeverity(issues) {
  if (!issues || !Array.isArray(issues)) return { blockers: [], warnings: [] }
  const blockers = []
  const warnings = []
  for (const issue of issues) {
    const isBlocker = BLOCKER_TOKENS.some((t) => issue.includes(t))
    const isExplicitWarning = WARNING_TOKENS.some((t) => issue.includes(t))
    if (isBlocker) {
      blockers.push(issue)
    } else if (isExplicitWarning) {
      warnings.push(issue)
    } else {
      // Fallback: use classifyIssueSeverity
      const sev = classifyIssueSeverity(issue)
      if (sev === ISSUE_SEVERITY.CRITICAL) blockers.push(issue)
      else warnings.push(issue)
    }
  }
  return { blockers, warnings }
}

/**
 * Classify an issue string into a severity level (Phase P1-C).
 * @param {string} issue
 * @returns {'critical'|'warning'|'info'}
 */
export function classifyIssueSeverity(issue) {
  if (!issue || typeof issue !== 'string') return ISSUE_SEVERITY.WARNING
  for (const token of _INFO_TOKENS) {
    if (issue.includes(token)) return ISSUE_SEVERITY.INFO
  }
  for (const token of _CRITICAL_TOKENS) {
    if (issue.includes(token)) return ISSUE_SEVERITY.CRITICAL
  }
  return ISSUE_SEVERITY.WARNING
}

function uniqueIssues(items) {
  return [...new Set((items || []).filter(Boolean))]
}

/**
 * Check 1: Quantitative claim validation.
 * If ¥ amounts appear in action/plan sections but pricing is marked as unavailable, warn.
 */
function checkQuantitativeClaimsWithoutPricing(reportMd, issues) {
  const hasPriceAmount = /(?:施策|実行プラン|5-1|5-2|5-3)[^\n]*¥[\d,]+/.test(reportMd)
  if (!hasPriceAmount) return

  const pricingUnavailable = /(?:Pricing|価格|pricing_snippet)[^\n]*取得不可/.test(reportMd)
  if (pricingUnavailable) {
    issues.push('定量クレーム警告: 価格未取得ブランドに¥金額を含む施策が記載されています')
  }
}

/**
 * Check 2: Market growth rate source check.
 * If 「年率X%」 appears without 【市場推定】 tag, warn.
 */
function checkMarketGrowthSource(reportMd, issues) {
  const growthPatterns = reportMd.match(/年率\s*[\d.]+\s*[%％]/g) || []
  for (const gp of growthPatterns) {
    const idx = reportMd.indexOf(gp)
    const ctxStart = Math.max(0, idx - 80)
    const ctxEnd = Math.min(reportMd.length, idx + gp.length + 80)
    const ctx = reportMd.slice(ctxStart, ctxEnd)
    if (!/【市場推定】|AI推定|参考値/.test(ctx)) {
      issues.push('市場規模ソース警告: 「年率X%」が【市場推定】ラベルなしで登場しています')
      return // one warning is enough
    }
  }
}

/**
 * Check 3: Evaluation-deferred density check.
 * If >40% of evaluation axes have 「評価保留」, warn about reliability limitation.
 */
function checkDeferredDensity(reportMd, issues) {
  // Find evaluation table rows
  const tableRows = reportMd.match(/^\|.*\|.*\|.*$/gm) || []
  const evalRows = tableRows.filter((r) => r.includes('評価保留'))
  const totalRows = tableRows.filter((r) => {
    const cells = r.split('|').map((c) => c.trim()).filter(Boolean)
    return cells.length >= 3 && !/^[#-]+$/.test(cells[0])
  })

  if (totalRows.length === 0) return
  const deferredRatio = evalRows.length / totalRows.length
  if (deferredRatio > 0.4) {
    issues.push(`評価保留密度警告: 評価軸の${Math.round(deferredRatio * 100)}%が「評価保留」 — データ不足により結論の信頼性が制限されています`)
  }
}

/**
 * Check 4: Competitive set overlap check.
 * If the same brand appears with contradictory evaluations, warn.
 */
function checkCompetitiveSetOverlap(reportMd, issues) {
  // Extract brand names from 【BrandName】 brackets
  const brandMatches = reportMd.matchAll(/【([^】]+)】/g)
  const brandPositions = new Map()
  for (const m of brandMatches) {
    const name = m[1].trim()
    if (!brandPositions.has(name)) brandPositions.set(name, [])
    brandPositions.get(name).push(m.index)
  }

  // Check for contradictory ranking (same brand as both 1位 and 3位 in different contexts)
  for (const [name, positions] of brandPositions) {
    const ranks = new Set()
    for (const pos of positions) {
      const ctx = reportMd.slice(Math.max(0, pos - 20), Math.min(reportMd.length, pos + name.length + 20))
      const rankMatch = ctx.match(/([123])位/)
      if (rankMatch) ranks.add(rankMatch[1])
    }
    if (ranks.size > 1) {
      issues.push(`競合セット矛盾: 【${name}】の順位評価が複数箇所で矛盾しています (${[...ranks].map((r) => `${r}位`).join(' vs ')})`)
    }
  }
}

function extractAppendixQualityIssues(reportMd) {
  if (!reportMd || typeof reportMd !== 'string') return []

  const auditMatch = reportMd.match(/##\s+Appendix A\.\s+品質監査[\s\S]*?(?=\n##\s+Appendix|\n<!-- appendix-end -->|$)/)
  if (!auditMatch) return []

  return uniqueIssues(
    auditMatch[0]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2).trim()),
  )
}

/**
 * Check if a report has critical quality issues that should block display (Task A).
 * Prefers backend structured quality fields; falls back to appendix audit and local checks.
 * @param {string} reportMd - Raw markdown report (body or full report)
 * @param {{ qualityStatus?: string, qualityIssues?: string[], qualityIsCritical?: boolean } | null} backendQuality
 * @returns {{ isQualityFailure: boolean, issues: string[] }}
 */
export function checkReportQuality(reportMd, backendQuality = null) {
  if (!reportMd || typeof reportMd !== 'string') {
    return { isQualityFailure: false, issues: [] }
  }

  const backendIssues = uniqueIssues([
    ...(Array.isArray(backendQuality?.qualityIssues) ? backendQuality.qualityIssues : []),
    ...extractAppendixQualityIssues(reportMd),
  ])
  const hasStructuredBackendStatus = typeof backendQuality?.qualityIsCritical === 'boolean'
  const issues = [...backendIssues]

  if (hasStructuredBackendStatus) {
    if (issues.length === 0 && backendQuality?.qualityIsCritical) {
      issues.push('品質基準未達: レポート生成品質に問題が検出されました')
    }
    return {
      isQualityFailure: backendQuality.qualityIsCritical,
      issues: uniqueIssues(issues),
    }
  }

  // Legacy backend compatibility: appendix / marker-only detection.
  if (/品質基準未達/.test(reportMd) && issues.length === 0) {
    issues.push('品質基準未達: レポート生成品質に問題が検出されました')
  }

  // Local truncation detection
  const lines = reportMd.trim().split('\n')
  const lastLines = lines.slice(-5)

  for (const line of lastLines) {
    const stripped = line.trim()
    if (!stripped) continue

    // Unclosed table row
    if (stripped.startsWith('|') && !stripped.endsWith('|')) {
      issues.push(`末尾欠け: テーブル行が途切れている可能性`)
      break
    }

    // Very short heading (truncated)
    if (/^#{1,3}\s+\S{1,5}$/.test(stripped)) {
      issues.push(`末尾欠け: 見出しが途切れている可能性`)
      break
    }
  }

  // Missing critical sections
  if (!/エグゼクティブサマリー/.test(reportMd)) {
    issues.push('必須セクション欠損: エグゼクティブサマリー')
  }

  // Task E: Section 5-2 completeness check (multi-URL reports)
  const hasSection51 = /5-1[.．].*LP/.test(reportMd)
  const hasSection52 = /5-2[.．].*検索広告/.test(reportMd)
  if (hasSection51 && !hasSection52) {
    issues.push('Section 5-2 欠損: 検索広告施策セクションが見つかりません')
  }

  // Task B v3: L5 only ad copy detection
  if (/(?:推奨訴求|広告見出し|コピー案)[^\n]*(?:アンチドーピング対応|品質認証取得|認証済み)/.test(reportMd)) {
    issues.push('L5転用警告: L5 only 情報が広告コピーに転用されている可能性')
  }

  // Task C v3: Price copy without data
  if (/(?:5-1|5-2|実行プラン|LP改善|施策)[^\n]*¥[\d,]+/.test(reportMd)) {
    // Check if pricing is unknown for any brand
    if (/Pricing[^\n]*取得不可/.test(reportMd) || /価格[^\n]*取得不可/.test(reportMd)) {
      issues.push('価格未取得警告: 価格未取得ブランドに¥表記の価格コピーが含まれています')
    }
  }

  // Task D v3: Fixed budget ratio without qualification
  const ratioMatch = reportMd.match(/(?:指名防衛|指名)\s*(\d{2,3})\s*[/:／：]\s*(?:非指名|カテゴリ)\s*(\d{2,3})/)
  if (ratioMatch) {
    const ctxStart = Math.max(0, ratioMatch.index - 100)
    const ctx = reportMd.slice(ctxStart, ratioMatch.index + ratioMatch[0].length + 50)
    if (!/(?:目安|仮説|初期|レンジ|Phase|phase)/.test(ctx)) {
      issues.push('予算配分警告: 固定比率が条件なしで記載されています（phase設計推奨）')
    }
  }

  // Phase 1-3 checks
  checkQuantitativeClaimsWithoutPricing(reportMd, issues)
  checkMarketGrowthSource(reportMd, issues)
  checkDeferredDensity(reportMd, issues)
  checkCompetitiveSetOverlap(reportMd, issues)

  return {
    isQualityFailure: issues.length > 0,
    issues: uniqueIssues(issues),
  }
}

/**
 * Split a report into body and appendix sections (Task C).
 * The backend uses `<!-- appendix-start -->` and `<!-- appendix-end -->` markers.
 * Also handles the legacy `---` separator for Appendix.
 * @param {string} reportMd - Full markdown report
 * @returns {{ body: string, appendix: string | null }}
 */
export function splitReportSections(reportMd) {
  if (!reportMd || typeof reportMd !== 'string') {
    return { body: reportMd || '', appendix: null }
  }

  // Priority 1: HTML comment markers from updated backend
  const markerStart = reportMd.indexOf('<!-- appendix-start -->')
  const markerEnd = reportMd.indexOf('<!-- appendix-end -->')

  if (markerStart !== -1) {
    const body = reportMd.slice(0, markerStart).trimEnd()
    const appendix = markerEnd !== -1
      ? reportMd.slice(markerStart, markerEnd + '<!-- appendix-end -->'.length).trim()
      : reportMd.slice(markerStart).trim()
    return { body, appendix }
  }

  // Priority 2: Legacy separator — find "Appendix" heading after a `---`
  const appendixMatch = reportMd.match(/\n---\s*\n##\s+Appendix/)
  if (appendixMatch) {
    const splitPos = appendixMatch.index
    return {
      body: reportMd.slice(0, splitPos).trimEnd(),
      appendix: reportMd.slice(splitPos).trim(),
    }
  }

  // No appendix found
  return { body: reportMd, appendix: null }
}

/**
 * Strip model-generated date lines from report body (Task B frontend complement).
 * The backend does this server-side, but this catches any remaining artifacts.
 * @param {string} reportMd
 * @returns {string}
 */
export function stripModelDates(reportMd) {
  if (!reportMd) return reportMd
  return reportMd
    .replace(/(?:作成日|分析実施日|実施日|レポート作成日)\s*[:：].*\n?/g, '')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * Detect and strip orphaned table fragments at the tail of the report body.
 * Triggered by truncated LLM outputs that leave dangling headers like
 * "| 評価軸 |" with no separator / no body rows.
 *
 * Detection rule: a trailing run of lines starting with `|` that does NOT
 * contain a separator row (`| --- | --- |` style) AND has fewer than 3
 * rows — treat as incomplete and remove.
 *
 * @param {string} reportMd
 * @returns {string}
 */
export function stripTruncatedTables(reportMd) {
  if (!reportMd || typeof reportMd !== 'string') return reportMd
  const lines = reportMd.split('\n')

  // Walk back from the end collecting the trailing contiguous pipe block
  // (blank lines between pipes are allowed).
  let end = lines.length
  // Skip trailing blank lines
  while (end > 0 && lines[end - 1].trim() === '') end--
  const blockEnd = end

  let blockStart = end
  while (blockStart > 0) {
    const line = lines[blockStart - 1]
    const stripped = line.trim()
    if (stripped === '' || stripped.startsWith('|')) {
      blockStart--
      continue
    }
    break
  }

  if (blockStart === blockEnd) return reportMd

  const blockLines = lines.slice(blockStart, blockEnd).filter((l) => l.trim().startsWith('|'))
  if (blockLines.length === 0) return reportMd

  const hasSeparator = blockLines.some((l) => /^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(l.trim()))
  const rowCount = blockLines.length

  // A well-formed table has header + separator + at least one data row = 3 lines.
  // If we have no separator OR the total is < 3 lines, it's a truncated fragment.
  if (hasSeparator && rowCount >= 3) return reportMd

  // Also require the block not to be preceded by a heading within 2 lines
  // (if it is, it's probably a legit intentional header awaiting data).
  return lines.slice(0, blockStart).join('\n').replace(/\n+$/, '')
}
