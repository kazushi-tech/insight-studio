import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import InsightHtmlReport from '../InsightHtmlReport'

const report = {
  summary: 'CVR低下はLP導線の影響が強い',
  metric_cards: [
    { label: 'CVR', value: '1.2%', delta: 'down', note: '前期比で悪化' },
    { label: 'CPA', value: '¥4,200', delta: 'up' },
  ],
  findings: [{ title: 'LP別CVR', body: '主要LPで低下', evidence: ['LP分析'] }],
  risks: [{ title: 'CV未取得', body: '一部CVが未計測' }],
  actions: [{ label: 'P0', title: 'LP別CVRを確認', body: '悪化LPを特定', owner: '運用担当', due: '今日', evidence: ['CVR推移'] }],
  evidence: ['CVR推移', 'LP分析'],
  recommended_charts: ['LP別CVR', '検索クエリ'],
}

describe('InsightHtmlReport', () => {
  it('renders structured report sections', () => {
    render(<InsightHtmlReport report={report} />)

    expect(screen.getByTestId('insight-html-report')).toBeInTheDocument()
    expect(screen.getByText('CVR低下はLP導線の影響が強い')).toBeInTheDocument()
    expect(screen.getByText('CVR')).toBeInTheDocument()
    expect(screen.getByText('1.2%')).toBeInTheDocument()
    expect(screen.getByText('主要所見')).toBeInTheDocument()
    expect(screen.getByText('リスク / 要確認')).toBeInTheDocument()
    expect(screen.getByText('次アクション')).toBeInTheDocument()
    expect(screen.getAllByText('LP別CVR').length).toBeGreaterThan(0)
  })

  it('hides verbose notes in compact mode', () => {
    render(<InsightHtmlReport report={report} compact />)

    expect(screen.getByTestId('insight-html-report')).toBeInTheDocument()
    expect(screen.queryByText('前期比で悪化')).not.toBeInTheDocument()
    expect(screen.queryByText('CVR推移')).not.toBeNull()
  })

  it('returns null for an empty report', () => {
    const { container } = render(<InsightHtmlReport report={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders insight_report_v2 with evidence status and agent trace', () => {
    render(
      <InsightHtmlReport
        report={{
          version: 'insight_report_v2',
          executive_summary: ['5/7はPV数328です'],
          evidence_table: [
            { claim: 'PV分析 — 日別推移', metric: 'PV数', value: '328', period: '5/7', source: 'chart_01', confidence: 'high' },
          ],
          interpretation: ['PV数を中心に見ます。'],
          hypotheses: [{ hypothesis: '流入増の仮説', evidence: 'chart_01', missing_data: '広告費' }],
          actions: [{ priority: 'P0', action: '流入元を確認', rationale: 'PV数328', expected_metric: 'PV数' }],
          limitations: ['CPA、ROAS、CTRは未取得'],
          review_status: {
            verdict: 'pass',
            notes: ['8つの役割で順番に検査'],
            unsupported_kpis: ['CPA', 'ROAS', 'CTR'],
          },
          agent_trace: [
            {
              stage: 'data_evidence_agent',
              label: 'Data Evidence Agent',
              status: 'completed',
              mode: 'deterministic_fallback',
              summary: 'chart_id と数値を照合しました。',
              checks: ['chart_id抽出'],
              issues: [],
              excerpt: 'chart_01',
            },
          ],
        }}
      />,
    )

    expect(screen.getByTestId('insight-report-v2')).toHaveTextContent('AI考察レポート')
    expect(screen.getByTestId('evidence-status-band')).toHaveTextContent('chart_id: chart_01')
    expect(screen.getByTestId('agent-trace-panel')).toHaveTextContent('Data Evidence Agent')
  })
})
