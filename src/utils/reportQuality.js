/**
 * Report quality validation and content splitting utilities.
 * Tasks A, C: Hard-fail quality gate + body/appendix separation.
 */

function uniqueIssues(items) {
  return [...new Set((items || []).filter(Boolean))]
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
