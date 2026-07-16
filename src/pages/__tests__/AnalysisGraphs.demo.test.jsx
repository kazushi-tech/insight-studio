import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalysisGraphs, { ChartCardErrorBoundary } from '../AnalysisGraphs'

const state = vi.hoisted(() => ({
  currentCase: null,
  setupState: null,
  reportBundle: null,
  authUser: null,
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAdsAuthenticated: true,
    analysisKey: '',
    analysisProvider: null,
    user: state.authUser,
  }),
}))

vi.mock('../../contexts/AdsSetupContext', () => ({
  useAdsSetup: () => ({
    setupState: state.setupState,
    reportBundle: state.reportBundle,
    setReportBundle: vi.fn(),
    resetSetup: vi.fn(),
    currentCase: state.currentCase,
  }),
}))

vi.mock('../../components/ai-assistant/AiContextRail', () => ({
  default: () => null,
}))

function renderPage(initialEntry = '/ads/graphs') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AnalysisGraphs />
    </MemoryRouter>,
  )
}

function chartGroup({
  title,
  queryType,
  period = '2026-06',
  value = 12,
}) {
  return {
    title,
    queryType,
    chartType: 'bar',
    _periodTag: period,
    labels: ['項目'],
    datasets: [{ label: '件数', data: [value] }],
  }
}

function BrokenGraph() {
  throw new Error('test-only graph render failure')
}

describe('AnalysisGraphs demo labels', () => {
  beforeEach(() => {
    state.currentCase = null
    state.authUser = { role: 'case_user', is_demo: false }
    state.setupState = {
      datasetId: 'analytics_test',
      periods: ['2026-06'],
      queryTypes: ['pv'],
    }
    state.reportBundle = {
      source: 'bq_generate_batch',
      site: {
        name: 'こもれび工房（完全架空サイト）',
        url: 'https://komorebi-studio.example',
      },
      reportMd: '# テストレポート',
      chartGroups: [],
      executionSummary: [],
      dataAvailability: 'full',
      generatedAt: '2026-07-11T00:00:00.000Z',
    }
  })

  it('isolates one graph render failure behind a readable fallback', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render(
        <ChartCardErrorBoundary title="時間帯グラフ">
          <BrokenGraph />
        </ChartCardErrorBoundary>,
      )

      expect(screen.getByRole('alert')).toHaveTextContent('時間帯グラフを表示できませんでした')
      expect(screen.getByRole('alert')).toHaveTextContent('ほかのグラフはそのまま確認できます')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('recovers a failed graph only after a new report version is loaded', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { rerender } = render(
        <ChartCardErrorBoundary title="時間帯グラフ" resetKey="report-v1">
          <BrokenGraph />
        </ChartCardErrorBoundary>,
      )

      expect(screen.getByRole('alert')).toHaveTextContent('時間帯グラフを表示できませんでした')

      rerender(
        <ChartCardErrorBoundary title="時間帯グラフ" resetKey="report-v1">
          <div>復旧したグラフ</div>
        </ChartCardErrorBoundary>,
      )
      expect(screen.getByRole('alert')).toBeInTheDocument()

      rerender(
        <ChartCardErrorBoundary title="時間帯グラフ" resetKey="report-v2">
          <div>復旧したグラフ</div>
        </ChartCardErrorBoundary>,
      )

      await waitFor(() => expect(screen.getByText('復旧したグラフ')).toBeInTheDocument())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('labels the source as demo data without exposing the synthetic dataset as a connection', () => {
    state.currentCase = {
      case_id: 'demo',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    state.authUser = { role: 'case_user', is_demo: true }
    state.setupState = { ...state.setupState, datasetId: 'demo_portfolio_dataset' }

    const { container } = renderPage()

    expect(screen.getByRole('heading', { name: '数字の根拠' })).toBeInTheDocument()
    expect(screen.getByTestId('demo-data-connection')).toHaveTextContent('完全架空データ')
    expect(screen.getByTestId('demo-site-name')).toHaveTextContent('こもれび工房（完全架空サイト）')
    expect(screen.getByText('完全架空データ')).toBeInTheDocument()
    expect(screen.queryByText('demo_portfolio_dataset')).not.toBeInTheDocument()
    expect(screen.queryByText('サイト計測データ')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ads-graph-ai-rail')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/GA4|BigQuery|dataset|\bPV\b|\bCV\b|chart_01|null|API key/i)
  })

  it('keeps the normal source label unchanged', () => {
    renderPage()

    expect(screen.getByText('サイト計測データ接続済み')).toBeInTheDocument()
    expect(screen.queryByTestId('demo-data-connection')).not.toBeInTheDocument()
  })

  it('keeps normal labels when an admin selects a demo currentCase', () => {
    state.authUser = { role: 'admin', is_demo: true }
    state.currentCase = {
      case_id: 'demo',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    state.setupState = { ...state.setupState, datasetId: 'demo_portfolio_dataset' }

    renderPage()

    expect(screen.queryByTestId('demo-data-connection')).not.toBeInTheDocument()
    expect(screen.getByText('サイト計測データ接続済み')).toBeInTheDocument()
  })

  it('translates technical chart labels before rendering a customer evidence page', () => {
    state.reportBundle = {
      ...state.reportBundle,
      reportMd: '',
      chartGroups: [{
        title: 'GA4 chart_01 の PV',
        queryType: 'pv',
        chartType: 'bar',
        _periodTag: '2026-06',
        labels: ['dataset の結果'],
        datasets: [{ label: 'CV / API key', data: [12] }],
      }],
      executionSummary: [{
        query_type: 'pv',
        status: 'success',
        row_count: 1,
        chart_group_count: 1,
      }],
    }

    const { container } = renderPage()

    expect(container.textContent).toContain('サイト計測')
    expect(container.textContent).toContain('見られた回数')
    expect(container.textContent).not.toMatch(
      /GA4|BigQuery|dataset|\bPV\b|\bCV\b|chart_01|null|API key|APIキー/i,
    )
  })

  it('opens the graph question panel as a keyboard-safe mobile sheet and restores focus', async () => {
    const user = userEvent.setup()
    state.reportBundle = {
      ...state.reportBundle,
      chartGroups: [{
        title: '閲覧数の日別推移',
        queryType: 'pv',
        chartType: 'line',
        _periodTag: '2026-06',
        labels: ['2026-06-01'],
        datasets: [{ label: '見られた回数', data: [12] }],
      }],
      executionSummary: [{ query_type: 'pv', status: 'success', row_count: 1, chart_group_count: 1 }],
    }
    renderPage()

    const trigger = screen.getByRole('button', { name: 'この数字をAIに聞く' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'グラフを見ながら質問' })
    expect(dialog).toHaveClass('block')
    expect(dialog).not.toHaveClass('hidden')
    expect(screen.getByRole('button', { name: 'AIグラフチャットを閉じる' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'グラフを見ながら質問' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'この数字をAIに聞く' })).toHaveFocus()
  })

  it('shows every selected query status even when no graph can be rendered', () => {
    state.setupState = {
      ...state.setupState,
      queryTypes: ['pv', 'campaign'],
    }
    state.reportBundle = {
      ...state.reportBundle,
      chartGroups: [],
      dataAvailability: 'failed',
      executionSummary: [
        { periodTag: '2026-06', query_type: 'pv', status: 'error', chart_group_count: 0, message: '接続確認が必要です。' },
        { periodTag: '2026-06', query_type: 'campaign', status: 'no_data', chart_group_count: 0, message: '対象データがありません。' },
      ],
    }

    renderPage()

    const coverageHeading = screen.getByRole('heading', { name: '選択した分析項目と表示期間の対応' })
    const coverage = coverageHeading.closest('section')
    expect(within(coverage).getByText('見られた回数')).toBeInTheDocument()
    expect(within(coverage).getByText('キャンペーン別の来訪')).toBeInTheDocument()
    expect(within(coverage).getByText('確認が必要')).toBeInTheDocument()
    expect(within(coverage).getByText('十分なデータなし')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: 'この期間は十分なデータがありません' })).toHaveLength(1)
  })

  it('opens all graph themes and graph cards by default', () => {
    state.setupState = { ...state.setupState, queryTypes: ['pv', 'traffic'] }
    state.reportBundle = {
      ...state.reportBundle,
      chartGroups: [
        chartGroup({ title: '閲覧数', queryType: 'pv' }),
        chartGroup({ title: '参照元別セッション', queryType: 'traffic' }),
      ],
      executionSummary: [
        { periodTag: '2026-06', query_type: 'pv', status: 'success', chart_group_count: 1 },
        { periodTag: '2026-06', query_type: 'traffic', status: 'success', chart_group_count: 1 },
      ],
    }

    renderPage()

    const lpSectionButton = screen.getAllByRole('button', { name: /LP分析/ })
      .find((button) => button.hasAttribute('aria-expanded'))
    const trafficSectionButton = screen.getAllByRole('button', { name: /流入分析/ })
      .find((button) => button.hasAttribute('aria-expanded'))
    expect(lpSectionButton).toHaveAttribute('aria-expanded', 'true')
    expect(trafficSectionButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTitle('グラフを閉じる')).toHaveLength(2)
  })

  it('falls back to all themes when a stale theme URL has no matching graph', () => {
    state.reportBundle = {
      ...state.reportBundle,
      chartGroups: [chartGroup({ title: '閲覧数', queryType: 'pv' })],
      executionSummary: [
        { periodTag: '2026-06', query_type: 'pv', status: 'success', chart_group_count: 1 },
      ],
    }

    renderPage('/ads/graphs?theme=device')

    expect(screen.getByRole('button', { name: '全件' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('閲覧数')).toBeInTheDocument()
  })

  it('scopes query coverage counts to the displayed latest period', () => {
    state.setupState = {
      ...state.setupState,
      periods: ['2026-05', '2026-06'],
      queryTypes: ['pv'],
    }
    state.reportBundle = {
      ...state.reportBundle,
      chartGroups: [
        chartGroup({ title: '5月の閲覧数', queryType: 'pv', period: '2026-05' }),
        chartGroup({ title: '6月の閲覧数', queryType: 'pv', period: '2026-06' }),
      ],
      executionSummary: [
        { periodTag: '2026-05', query_type: 'pv', status: 'success', row_count: 20, chart_group_count: 3 },
        { periodTag: '2026-06', query_type: 'pv', status: 'success', row_count: 10, chart_group_count: 1 },
      ],
    }

    renderPage()

    const coverageHeading = screen.getByRole('heading', { name: '選択した分析項目と表示期間の対応' })
    const coverage = coverageHeading.closest('section')
    expect(within(coverage).getByText('1件')).toBeInTheDocument()
    expect(within(coverage).queryByText('4件')).not.toBeInTheDocument()
    expect(within(coverage).getByText(/最新期間: 2026-06/)).toBeInTheDocument()
  })
})
