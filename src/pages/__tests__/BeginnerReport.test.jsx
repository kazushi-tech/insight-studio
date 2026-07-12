import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BeginnerReport from '../BeginnerReport'

const hoisted = vi.hoisted(() => ({
  adsSetupMock: null,
  authUser: null,
  askProjectReportQuestion: vi.fn(),
  reportHistory: null,
}))

vi.mock('../../api/adsInsights', () => ({
  AUTH_EXPIRED_MESSAGE: '認証エラー',
}))

vi.mock('../../api/projectReports', () => ({
  askProjectReportQuestion: (...args) => hoisted.askProjectReportQuestion(...args),
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

vi.mock('../../contexts/ReportHistoryContext', () => ({
  useReportHistory: () => hoisted.reportHistory,
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
    hoisted.askProjectReportQuestion.mockReset()
    hoisted.authUser = { role: 'case_user', is_demo: false }
    hoisted.reportHistory = {
      history: [],
      projectRef: 'case-a',
      addEntry: vi.fn(),
      historyState: 'ready',
    }
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

  it('renders the customer conclusion, hold, action, and evidence surfaces', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Web成果レポート' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '今回の結論' })).toBeInTheDocument()
    expect(screen.getByText('サイト閲覧は増えています')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /成果データ未取得/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /成果計測を確認する/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /見られた回数分析/ })).toHaveAttribute(
      'href',
      '/ads/graphs?period=latest&theme=lp&view=summary',
    )
    expect(screen.getByRole('link', { name: 'すべて見る' })).toHaveAttribute('href', '/ads/graphs')
    expect(screen.getByRole('button', { name: 'この結果をAIに聞く' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('uses chart fallback when reportBundle has no backend beginnerReport', () => {
    hoisted.adsSetupMock.reportBundle = {
      ...hoisted.adsSetupMock.reportBundle,
      beginnerReport: null,
    }

    renderPage()

    expect(screen.getByText('サイト閲覧は増えています')).toBeInTheDocument()
    expect(screen.getByText('まず流入元を見ます')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /成果計測を確認する/ })).toBeInTheDocument()
  })

  it('uses demo labels without exposing implementation vocabulary', () => {
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

    const { container } = renderPage()

    expect(screen.getByText('デモデータ')).toBeInTheDocument()
    expect(screen.getByText(/対象: こもれび工房/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/GA4|BigQuery|dataset|\bPV\b|\bCV\b|chart_01|null|API key/i)
  })

  it('renders only a validated report.v2 and asks from its exact saved server row', async () => {
    hoisted.adsSetupMock.reportBundle.reportV2 = {
      schema_version: 'report.v2',
      report_id: 'report-1',
      project_id: 'project-1',
      scope: {
        current_period: { start: '2026-07-01', end: '2026-07-31' },
        comparison_period: { start: '2026-06-01', end: '2026-06-30' },
        comparison_policy: 'previous_month',
        timezone: 'Asia/Tokyo',
        data_freshness: { status: 'fresh', last_observed_at: '2026-08-01T00:00:00Z' },
      },
      availability: {
        overall: 'full',
        metrics: [{ key: 'sessions', status: 'measured', reason: null, last_observed_at: '2026-07-31T00:00:00Z' }],
      },
      metrics: [{
        key: 'sessions',
        label: 'セッション数',
        value: 120,
        unit: 'sessions',
        aggregation: 'sum',
        comparison: { value: 100, absolute_change: 20, percent_change: 20, status: 'available' },
        evidence_key: 'metric:sessions',
      }],
      conclusions: [{
        kind: 'measured_increase',
        title: '訪問数が前の期間より増えています',
        body: '訪問数は前の期間より20%増えました。',
        severity: 'positive',
        confidence: 'high',
        evidence_keys: ['metric:sessions'],
      }],
      actions: [{
        priority: 'medium',
        title: '増えた内訳を確認する',
        reason: '伸びを再現できるか判断します。',
        confidence: 'medium',
        timeframe: '今週',
        success_metric: 'セッション数',
        evidence_keys: ['metric:sessions'],
      }],
      evidence: [{ key: 'metric:sessions', query_type: 'traffic', title: '流入元別の訪問数', chart: null }],
      caveats: ['原因はこのデータだけでは判断できません。'],
      generated_at: '2026-08-01T00:00:00Z',
    }
    hoisted.reportHistory.history = [{
      id: 'saved-row-1',
      serverReportId: 'saved-row-1',
      reportBundle: {
        reportV2: { report_id: 'report-1' },
      },
    }]
    hoisted.askProjectReportQuestion.mockResolvedValue({
      ok: true,
      answer: {
        answerable: true,
        text: 'セッション数は120sessionsです。',
        confidence: 'high',
        citations: [{ evidence_key: 'metric:sessions', title: '流入元別の訪問数' }],
        reason: null,
      },
    })
    const user = userEvent.setup()

    renderPage()

    expect(screen.getByRole('heading', { name: '訪問数が前の期間より増えています' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '増えた内訳を確認する' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '原因はこのデータだけでは判断できません。' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '流入元別の訪問数' })).toHaveAttribute(
      'href',
      '/ads/graphs?period=latest&theme=traffic&view=summary',
    )
    expect(screen.getByRole('link', { name: '流入元別の訪問数' }).closest('li')).toHaveAttribute(
      'id',
      'report-evidence-1',
    )

    await user.click(screen.getByRole('button', { name: 'この結果をAIに聞く' }))
    await user.selectOptions(
      screen.getByLabelText('質問例から選ぶ'),
      '今回、どの数字が変わりましたか',
    )
    await user.click(screen.getByRole('button', { name: 'このレポートから回答する' }))

    expect(hoisted.askProjectReportQuestion).toHaveBeenCalledWith(
      'case-a',
      'saved-row-1',
      '今回、どの数字が変わりましたか',
    )
    expect(screen.getByText('訪問数は120訪問です。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '根拠を見る: 流入元別の訪問数' })).toHaveAttribute(
      'href',
      '#report-evidence-1',
    )
  })
})
