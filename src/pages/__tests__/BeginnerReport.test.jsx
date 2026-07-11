import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BeginnerReport from '../BeginnerReport'

const hoisted = vi.hoisted(() => ({
  adsSetupMock: null,
  authUser: null,
}))

vi.mock('../../api/adsInsights', () => ({
  AUTH_EXPIRED_MESSAGE: '認証エラー',
}))

vi.mock('../../components/ads/ChartGroupCard', () => ({
  default: ({ group }) => <div data-testid="chart-card">{group.title}</div>,
}))

vi.mock('../../components/ads/SourceBadge', () => ({
  default: ({ source }) => <span data-testid="source-badge">{source}</span>,
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isAdsAuthenticated: true, user: hoisted.authUser }),
}))

vi.mock('../../contexts/AdsSetupContext', () => ({
  useAdsSetup: () => hoisted.adsSetupMock,
}))

function renderPage() {
  return render(
    <BrowserRouter>
      <BeginnerReport />
    </BrowserRouter>,
  )
}

describe('BeginnerReport', () => {
  beforeEach(() => {
    hoisted.authUser = { role: 'case_user', is_demo: false }
    hoisted.adsSetupMock = {
      setupState: {
        datasetId: 'analytics_test',
        periods: ['2026-07'],
        queryTypes: ['pv', 'traffic', 'cv'],
      },
      reportBundle: {
        source: 'bq_generate_batch',
        generatedAt: '2026-07-08T10:00:00.000Z',
        chartGroups: [
          {
            title: 'PV分析 — 日別推移',
            queryType: 'pv',
            chartType: 'line',
            _periodTag: '2026-07',
            labels: ['2026-07-01', '2026-07-02'],
            datasets: [{ label: 'PV数', data: [100, 150] }],
          },
          {
            title: '流入分析 — セッション数上位2チャネル',
            queryType: 'traffic',
            chartType: 'bar_horizontal',
            _periodTag: '2026-07',
            labels: ['organic / google', 'direct / none'],
            datasets: [{ label: 'セッション', data: [80, 20] }],
          },
        ],
        beginnerReport: {
          version: 'beginner_report_v1',
          summary_cards: [
            {
              type: 'what_happened',
              title: 'サイト閲覧は増えています',
              body: '期間内の最初の値から最新値まで +50.0% 変化しています。',
              severity: 'positive',
              evidence_chart_ids: ['chart_01'],
            },
            {
              type: 'data_gap',
              title: 'CV計測が見つかりません',
              body: '成果につながる行動が未取得です。',
              severity: 'warning',
              evidence_chart_ids: [],
            },
          ],
          next_actions: [
            { priority: 'P1', title: 'CV計測を確認する', reason: '成果データがないと判断できないためです。' },
          ],
          data_gaps: [
            { key: 'cv_missing', label: 'CVデータ未取得', impact: '成果判断は保留です。' },
          ],
          recommended_charts: ['chart_01'],
        },
        executionSummary: [
          { query_type: 'pv', status: 'success' },
          { query_type: 'cv', status: 'no_data' },
        ],
      },
      setReportBundle: vi.fn(),
      resetSetup: vi.fn(),
      currentCase: { case_id: 'case-a', is_demo: false },
    }
  })

  it('renders beginner cards, data gaps, actions, and evidence chart disclosure', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '初心者向け分析レポート' })).toBeInTheDocument()
    expect(screen.getByText('サイト閲覧は増えています')).toBeInTheDocument()
    expect(screen.getByText('CV計測が見つかりません')).toBeInTheDocument()
    expect(screen.getByText('CVデータ未取得')).toBeInTheDocument()
    expect(screen.getByText('CV計測を確認する')).toBeInTheDocument()
    expect(screen.getAllByText('PV分析 — 日別推移').length).toBeGreaterThan(0)
    expect(screen.getByTestId('chart-card')).toHaveTextContent('PV分析 — 日別推移')
    expect(screen.getByRole('link', { name: /詳細グラフを見る/ })).toHaveAttribute('href', '/ads/graphs')
    expect(screen.getByRole('link', { name: /AIに聞く/ })).toHaveAttribute('href', '/insights/ai')
  })

  it('uses chart fallback when reportBundle has no backend beginnerReport', () => {
    hoisted.adsSetupMock.reportBundle = {
      ...hoisted.adsSetupMock.reportBundle,
      beginnerReport: null,
    }

    renderPage()

    expect(screen.getByText('サイト閲覧は増えています')).toBeInTheDocument()
    expect(screen.getByText('まず流入元を見ます')).toBeInTheDocument()
    expect(screen.getByText('CV計測を確認する')).toBeInTheDocument()
  })

  it('uses demo source labels without exposing a BigQuery connection', () => {
    hoisted.adsSetupMock.currentCase = {
      case_id: 'demo',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    hoisted.authUser = { role: 'case_user', is_demo: true }
    hoisted.adsSetupMock.setupState.datasetId = 'demo_portfolio_dataset'
    hoisted.adsSetupMock.reportBundle.site = {
      name: 'こもれび工房（完全架空サイト）',
      url: 'https://komorebi-studio.example',
    }

    renderPage()

    expect(screen.getByText('DEMO / 完全架空データ')).toBeInTheDocument()
    expect(screen.getByText('データ: 完全架空データ')).toBeInTheDocument()
    expect(screen.getByTestId('demo-site-name')).toHaveTextContent('こもれび工房（完全架空サイト）')
    expect(screen.getByTestId('source-badge')).toHaveTextContent('demo')
    expect(screen.queryByText('GA4 / BIGQUERY')).not.toBeInTheDocument()
    expect(screen.queryByText(/保存先: demo_portfolio_dataset/)).not.toBeInTheDocument()
  })
})
