import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalysisGraphs from '../AnalysisGraphs'

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

function renderPage() {
  return render(
    <MemoryRouter>
      <AnalysisGraphs />
    </MemoryRouter>,
  )
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
})
