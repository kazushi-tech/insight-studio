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
})
