import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CustomerReportDocument from '../CustomerReportDocument'

const report = {
  schema_version: 'report.v2',
  report_id: 'report-private-id',
  project_id: 'project-private-id',
  scope: {
    current_period: { start: '2026-07-01', end: '2026-07-31' },
    site_name: 'GA4 dataset サイト',
  },
  availability: { overall: 'full' },
  metrics: [{
    key: 'pv',
    label: 'PV',
    value: 120,
    unit: 'sessions',
    aggregation: 'sum',
    comparison: { value: 100, absolute_change: 20, percent_change: 20, status: 'available' },
    evidence_key: 'chart_01',
  }],
  conclusions: [{
    kind: 'what_happened',
    title: 'BigQueryのPVが増えました',
    body: 'dataset IDはnullです',
    severity: 'positive',
    confidence: 'high',
    evidence_keys: ['chart_01'],
  }],
  actions: [{
    priority: 'high',
    title: 'CVとAPI keyを確認する',
    reason: 'GA4の根拠を確かめるためです',
    confidence: 'high',
    timeframe: '今週',
    success_metric: 'CV',
    evidence_keys: ['chart_01'],
  }],
  evidence: [{ key: 'chart_01', query_type: 'traffic', title: 'chart_01', chart: null }],
  caveats: ['APIキーが未設定なら判断できません'],
  generated_at: '2026-08-01T00:00:00Z',
}

describe('CustomerReportDocument', () => {
  it('renders one customer-safe heading and never exposes implementation terms or ids', () => {
    const { container } = render(
      <CustomerReportDocument
        report={report}
        title="GA4 / BigQuery Web成果レポート"
        summary="dataset ID と API key の概要"
        expiresAt="2026-08-08T00:00:00Z"
      />,
    )

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /Web成果レポート/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '今回の結論' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '次にやること' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'まだ判断できないこと' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '数字の根拠' })).toBeInTheDocument()
    expect(container.textContent).not.toContain('report-private-id')
    expect(container.textContent).not.toContain('project-private-id')
    expect(container.textContent).not.toMatch(
      /GA4|BigQuery|dataset|\bPV\b|\bCV\b|chart_01|null|API key|APIキー/i,
    )
  })
})
