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

function EvidenceStatusBand({ report }) {
  const status = report?.review_status
  if (!status) return null
  const verdict = String(status.verdict || 'checked').toLowerCase()
  const isPass = verdict === 'pass'
  const isRecovered = verdict === 'recovered'
  const evidenceRows = Array.isArray(report?.evidence_table) ? report.evidence_table : []
  const first = evidenceRows[0] || {}
  const unsupported = Array.isArray(status.unsupported_kpis) ? status.unsupported_kpis : []
  const statusTitle = isPass
    ? '数値照合済み'
    : isRecovered
      ? '取得済みグラフ根拠で照合済み'
      : '照合範囲を限定して表示'

  return (
    <section
      className={`${cardStyles.evidenceStatusBand} ${isPass || isRecovered ? cardStyles.evidenceStatusPass : cardStyles.evidenceStatusWarn}`}
      data-testid="evidence-status-band"
      aria-label="数値照合状態"
    >
      <span className="material-symbols-outlined" aria-hidden="true">{isPass || isRecovered ? 'verified' : 'rule'}</span>
      <div>
        <strong className="japanese-text">{statusTitle}</strong>
        <p className="japanese-text">
          {[
            first.source ? `参照グラフ: ${first.source}` : '',
            first.claim ? `参照: ${first.claim}` : '',
            first.metric ? `指標: ${first.metric}` : '',
            first.value ? `値: ${first.value}` : '',
            first.period ? `期間: ${first.period}` : '',
            unsupported.length > 0 ? `未連携KPI: ${unsupported.join(' / ')}` : '',
            Array.isArray(status.checked_items) && status.checked_items.length > 0 ? '確認した項目: グラフ / 指標 / 値 / 期間' : '',
          ].filter(Boolean).join(' / ')}
        </p>
      </div>
    </section>
  )
}

function formatAgentLabel(item) {
  const key = String(item?.stage || item?.label || '').toLowerCase()
  if (key.includes('data_evidence') || key.includes('data evidence')) return '数値根拠の確認'
  if (key.includes('beginner') || key.includes('explanation')) return '表現の整理'
  if (key.includes('senior') || key.includes('adops')) return '運用観点の確認'
  if (key.includes('unsupported') || key.includes('kpi_guard')) return '未連携KPIの確認'
  if (key.includes('final') || key.includes('consistency') || key.includes('review')) return '整合性チェック'
  return item?.label || item?.stage || '確認項目'
}

function formatAgentMode(mode) {
  const value = String(mode || '').toLowerCase()
  if (value === 'llm_stage') return 'AI確認'
  if (value === 'deterministic_fallback') return '自動照合'
  if (value === 'unknown' || !value) return '確認済み'
  return '確認済み'
}

function AgentTracePanel({ trace = [] }) {
  const items = Array.isArray(trace) ? trace.filter((item) => item && typeof item === 'object') : []
  if (items.length === 0) return null
  const completedCount = items.filter((item) => ['completed', 'repaired'].includes(item.status)).length
  const usesLlm = items.some((item) => item.mode === 'llm_stage')

  return (
    <details className={cardStyles.agentTracePanel} data-testid="agent-trace-panel">
      <summary className="japanese-text">
        <span className="material-symbols-outlined" aria-hidden="true">account_tree</span>
        <span>
          <strong>根拠と整合性の確認</strong>
          <em>{items.length}項目を確認 / {completedCount}件完了 / {usesLlm ? 'AI確認を含む' : '自動照合済み'}</em>
        </span>
      </summary>
      <div className={cardStyles.agentTraceList}>
        {items.map((item, index) => (
          <article key={`${item.stage}-${index}`} className={cardStyles.agentTraceItem}>
            <div className={cardStyles.agentTraceHead}>
              <b>{index + 1}</b>
              <div>
                <strong>{formatAgentLabel(item)}</strong>
                <span>{item.summary || item.excerpt || '検査完了'}</span>
              </div>
              <mark data-mode={item.mode || 'unknown'}>{formatAgentMode(item.mode)}</mark>
            </div>
            {Array.isArray(item.checks) && item.checks.length > 0 && (
              <p className="japanese-text">確認: {item.checks.slice(0, 4).join(' / ')}</p>
            )}
            {Array.isArray(item.issues) && item.issues.length > 0 && (
              <p className={cardStyles.agentTraceIssue}>制約: {item.issues.slice(0, 3).join(' / ')}</p>
            )}
          </article>
        ))}
      </div>
    </details>
  )
}

function InsightReportV2({ report }) {
  const summary = Array.isArray(report.executive_summary) ? report.executive_summary : []
  const evidenceRows = Array.isArray(report.evidence_table) ? report.evidence_table : []
  const interpretation = Array.isArray(report.interpretation) ? report.interpretation : []
  const hypotheses = Array.isArray(report.hypotheses) ? report.hypotheses : []
  const actions = Array.isArray(report.actions) ? report.actions : []
  const limitations = Array.isArray(report.limitations) ? report.limitations : []

  return (
    <section className={cardStyles.markdownReport} data-testid="insight-report-v2" aria-label="AI考察レポート">
      <h2 className="japanese-text">AI考察レポート</h2>
      <EvidenceStatusBand report={report} />

      {hasItems(summary) && (
        <section className={cardStyles.markdownReportSection}>
          <h3 className="japanese-text">重要結論</h3>
          {summary.slice(0, 4).map((line, index) => (
            <p key={`summary-${index}`} className="japanese-text"><strong>{index + 1}.</strong> {line}</p>
          ))}
        </section>
      )}

      {hasItems(evidenceRows) && (
        <section className={cardStyles.markdownReportSection}>
          <h3 className="japanese-text">根拠テーブル</h3>
          <div className={cardStyles.simpleTableWrap}>
            <table className={cardStyles.simpleEvidenceTable}>
              <thead>
                <tr>
                  <th>根拠ID</th>
                  <th>指標</th>
                  <th>値</th>
                  <th>期間</th>
                  <th>根拠</th>
                </tr>
              </thead>
              <tbody>
                {evidenceRows.slice(0, 8).map((row, index) => (
                  <tr key={`evidence-${index}`}>
                    <td>{row.source || '-'}</td>
                    <td>{row.metric || '-'}</td>
                    <td><strong>{row.value || '-'}</strong></td>
                    <td>{row.period || '-'}</td>
                    <td className="japanese-text">{row.claim || row.confidence || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hasItems(interpretation) && (
        <section className={cardStyles.markdownReportSection}>
          <h3 className="japanese-text">読み解き</h3>
          {interpretation.slice(0, 4).map((line, index) => (
            <p key={`interpretation-${index}`} className="japanese-text">{line}</p>
          ))}
        </section>
      )}

      {hasItems(hypotheses) && (
        <section className={cardStyles.markdownReportSection}>
          <h3 className="japanese-text">仮説と不足データ</h3>
          {hypotheses.slice(0, 4).map((item, index) => (
            <p key={`hypothesis-${index}`} className="japanese-text">
              <strong>{item.hypothesis || '仮説'}:</strong> {[item.evidence, item.missing_data ? `不足: ${item.missing_data}` : ''].filter(Boolean).join(' / ')}
            </p>
          ))}
        </section>
      )}

      {hasItems(actions) && (
        <section className={cardStyles.markdownReportSection}>
          <h3 className="japanese-text">優先施策</h3>
          <ol className={cardStyles.simpleActionList}>
            {actions.slice(0, 5).map((item, index) => (
              <li key={`action-${index}`} className="japanese-text">
                <strong>{item.priority || `P${index}`}: {item.action}</strong>
                {[item.rationale, item.expected_metric ? `見る指標: ${item.expected_metric}` : ''].filter(Boolean).join(' / ')}
              </li>
            ))}
          </ol>
        </section>
      )}

      {hasItems(limitations) && (
        <section className={cardStyles.markdownReportSection}>
          <h3 className="japanese-text">制約</h3>
          {limitations.slice(0, 4).map((line, index) => (
            <p key={`limitation-${index}`} className="japanese-text">{line}</p>
          ))}
        </section>
      )}

      <AgentTracePanel trace={report.agent_trace} />
    </section>
  )
}

export default function InsightHtmlReport({ report, compact = false }) {
  if (!report) return null

  if (
    report.version === 'insight_report_v2' ||
    hasItems(report.executive_summary) ||
    hasItems(report.evidence_table)
  ) {
    return <InsightReportV2 report={report} />
  }

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
