import cardStyles from './InsightTurnCard.module.css'

const DELTA_ICON = {
  up: 'trending_up',
  down: 'trending_down',
  flat: 'trending_flat',
}

function hasItems(items) {
  return Array.isArray(items) && items.length > 0
}

function ReportItemList({ title, icon, items, tone = 'default', compact = false }) {
  if (!hasItems(items)) return null
  return (
    <section className={`${cardStyles.htmlReportPanel} ${cardStyles[`htmlReportPanel_${tone}`] || ''}`}>
      <div className={cardStyles.sectionHeader}>
        <span className="material-symbols-outlined" aria-hidden="true">{icon}</span>
        <h3 className="japanese-text">{title}</h3>
      </div>
      <div className={compact ? cardStyles.htmlReportCompactList : cardStyles.htmlReportList}>
        {items.map((item, index) => (
          <article key={`${title}-${index}`} className={cardStyles.htmlReportItem}>
            {(item.title || item.priority) && (
              <div className={cardStyles.htmlReportItemHead}>
                {item.priority && <b>{item.priority}</b>}
                {item.title && <strong className="japanese-text">{item.title}</strong>}
              </div>
            )}
            {item.body && <p className="japanese-text">{item.body}</p>}
            {hasItems(item.evidence) && !compact && (
              <ul className={cardStyles.htmlReportEvidenceList}>
                {item.evidence.map((line, evidenceIndex) => (
                  <li key={`${title}-${index}-evidence-${evidenceIndex}`} className="japanese-text">
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

export default function InsightHtmlReport({ report, compact = false }) {
  if (!report) return null

  const metricCards = Array.isArray(report.metric_cards) ? report.metric_cards : []
  const findings = Array.isArray(report.findings) ? report.findings : []
  const risks = Array.isArray(report.risks) ? report.risks : []
  const actions = Array.isArray(report.actions) ? report.actions : []
  const evidence = Array.isArray(report.evidence) ? report.evidence : []
  const recommendedCharts = Array.isArray(report.recommended_charts) ? report.recommended_charts : []

  const hasReportContent =
    report.summary ||
    hasItems(metricCards) ||
    hasItems(findings) ||
    hasItems(risks) ||
    hasItems(actions) ||
    hasItems(evidence) ||
    hasItems(recommendedCharts)

  if (!hasReportContent) return null

  return (
    <section
      className={`${cardStyles.htmlReport} ${compact ? cardStyles.htmlReportCompact : ''}`}
      data-testid="insight-html-report"
      aria-label="HTMLレポート"
    >
      {report.summary && (
        <header className={cardStyles.htmlReportHero}>
          <div>
            <p className={cardStyles.htmlReportKicker}>Executive Summary</p>
            <h2 className="japanese-text">{report.summary}</h2>
          </div>
          <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
        </header>
      )}

      {hasItems(metricCards) && (
        <div className={cardStyles.htmlReportMetricGrid} data-testid="insight-html-report-metrics">
          {metricCards.map((metric, index) => (
            <article key={`${metric.label}-${index}`} className={cardStyles.htmlReportMetricCard}>
              <p>{metric.label}</p>
              <div>
                <strong>{metric.value}</strong>
                {metric.delta && (
                  <span
                    className={`material-symbols-outlined ${cardStyles[`metricDelta_${metric.delta}`] || ''}`}
                    aria-label={metric.delta}
                  >
                    {DELTA_ICON[metric.delta] || 'trending_flat'}
                  </span>
                )}
              </div>
              {metric.note && !compact && <small className="japanese-text">{metric.note}</small>}
            </article>
          ))}
        </div>
      )}

      <div className={cardStyles.htmlReportGrid}>
        <ReportItemList
          title="主要所見"
          icon="fact_check"
          items={findings}
          tone="finding"
          compact={compact}
        />
        <ReportItemList
          title="リスク / 要確認"
          icon="report"
          items={risks}
          tone="risk"
          compact={compact}
        />
      </div>

      {hasItems(actions) && (
        <section className={cardStyles.htmlReportPanel}>
          <div className={cardStyles.sectionHeader}>
            <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
            <h3 className="japanese-text">次アクション</h3>
          </div>
          <div className={cardStyles.htmlActionList}>
            {actions.map((action, index) => (
              <article key={`${action.label}-${index}`} className={cardStyles.htmlActionItem}>
                <b>{action.label || `P${index}`}</b>
                <div>
                  <strong className="japanese-text">{action.title}</strong>
                  {action.body && <p className="japanese-text">{action.body}</p>}
                  {hasItems(action.evidence) && !compact && (
                    <small className="japanese-text">{action.evidence[0]}</small>
                  )}
                </div>
                {!compact && (action.owner || action.due) && (
                  <span className="japanese-text">{[action.owner, action.due].filter(Boolean).join(' / ')}</span>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {(hasItems(evidence) || hasItems(recommendedCharts)) && (
        <footer className={cardStyles.htmlReportFooter}>
          {hasItems(evidence) && (
            <div>
              <span className={cardStyles.chartChipLabel}>根拠</span>
              <div className={cardStyles.chartChips}>
                {evidence.slice(0, compact ? 3 : 6).map((line, index) => (
                  <span key={`evidence-${index}`} className={`${cardStyles.chartChip} japanese-text`}>
                    <span className="material-symbols-outlined" aria-hidden="true">database</span>
                    {line}
                  </span>
                ))}
              </div>
            </div>
          )}
          {hasItems(recommendedCharts) && (
            <div>
              <span className={cardStyles.chartChipLabel}>推奨グラフ</span>
              <div className={cardStyles.chartChips}>
                {recommendedCharts.slice(0, compact ? 3 : 6).map((chart, index) => (
                  <span key={`chart-${index}`} className={`${cardStyles.chartChip} japanese-text`}>
                    <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
                    {chart}
                  </span>
                ))}
              </div>
            </div>
          )}
        </footer>
      )}
    </section>
  )
}
