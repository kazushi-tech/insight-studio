/**
 * Report export utilities — structured text generation for clipboard copy.
 */

/**
 * Copy text to clipboard with a brief confirmation.
 * Returns true on success.
 */
export async function copyReportToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Build a structured text summary for Compare results.
 */
export function buildCompareReportText({ overallScore, scores, summary, report }) {
  const lines = []
  lines.push('=== LP比較・競合分析レポート ===')
  lines.push('')
  if (overallScore != null) {
    lines.push(`総合スコア: ${overallScore}/100`)
    lines.push('')
  }
  const scoreLabels = {
    ux: 'UXコンバージョン率',
    conversion: 'コンバージョン',
    brand: 'ブランド信頼性',
    trust: '信頼性',
    seo: 'SEO最適化',
  }
  for (const [key, label] of Object.entries(scoreLabels)) {
    if (scores[key] != null) {
      lines.push(`${label}: ${scores[key]}/100`)
    }
  }
  if (summary) {
    lines.push('')
    lines.push('--- サマリー ---')
    lines.push(summary)
  }
  if (report) {
    lines.push('')
    lines.push('--- 分析レポート ---')
    lines.push(report)
  }
  return lines.join('\n')
}

/**
 * Build a structured text summary for Creative Review results.
 */
export function buildCreativeReviewReportText({ review }) {
  const lines = []
  lines.push('=== クリエイティブレビュー ===')
  lines.push('')
  if (review?.summary) {
    lines.push('--- 要約 ---')
    lines.push(review.summary)
    lines.push('')
  }
  if (review?.rubric_scores?.length) {
    lines.push('--- ルーブリック評価 ---')
    for (const item of review.rubric_scores) {
      lines.push(`${item.rubric_id}: ${item.score ?? 'N/A'}/5${item.comment ? ' — ' + item.comment : ''}`)
    }
    lines.push('')
  }
  if (review?.improvements?.length) {
    lines.push('--- 改善提案 ---')
    review.improvements.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.point}`)
      lines.push(`   背景: ${item.reason}`)
      lines.push(`   対応: ${item.action}`)
    })
    lines.push('')
  }
  if (review?.test_ideas?.length) {
    lines.push('--- テストアイデア ---')
    review.test_ideas.forEach((item, i) => {
      lines.push(`${i + 1}. [仮説] ${item.hypothesis}`)
      lines.push(`   [変更変数] ${item.variable}`)
      lines.push(`   [期待効果] ${item.expected_impact}`)
    })
  }
  return lines.join('\n')
}

/**
 * Build a structured text summary for Discovery results.
 */
export function buildDiscoveryReportText({ discoveries, reportMd }) {
  const lines = []
  lines.push('=== Discovery Hub レポート ===')
  lines.push('')
  if (reportMd) {
    lines.push('--- 分析レポート ---')
    lines.push(reportMd)
    lines.push('')
  }
  if (discoveries?.length) {
    lines.push(`--- 発見されたLP (${discoveries.length}件) ---`)
    for (const item of discoveries) {
      lines.push(`- ${item.title || item.url}`)
      if (item.score != null) lines.push(`  スコア: ${item.score}`)
      if (item.url) lines.push(`  URL: ${item.url}`)
    }
  }
  return lines.join('\n')
}
