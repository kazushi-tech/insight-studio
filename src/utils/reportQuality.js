/**
 * Report quality validation and content splitting utilities.
 * Tasks A, C: Hard-fail quality gate + body/appendix separation.
 */

/**
 * Check if a report has critical quality issues that should block display (Task A).
 * Detects the backend's quality-failure marker and local truncation checks.
 * @param {string} reportMd - Raw markdown report
 * @returns {{ isQualityFailure: boolean, issues: string[] }}
 */
export function checkReportQuality(reportMd) {
  if (!reportMd || typeof reportMd !== 'string') {
    return { isQualityFailure: false, issues: [] }
  }

  const issues = []

  // 1. Backend quality-failure marker (Task A)
  if (/品質基準未達/.test(reportMd)) {
    issues.push('品質基準未達: レポート生成品質に問題が検出されました')
  }

  // 2. Local truncation detection
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

  // 3. Missing critical sections
  if (!/エグゼクティブサマリー/.test(reportMd)) {
    issues.push('必須セクション欠損: エグゼクティブサマリー')
  }

  return {
    isQualityFailure: issues.length > 0,
    issues,
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
