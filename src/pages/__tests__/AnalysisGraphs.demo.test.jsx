import { render, screen } from '@testing-library/react'
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

    renderPage()

    expect(screen.getByTestId('demo-data-connection')).toHaveTextContent('デモデータ利用中')
    expect(screen.getByTestId('demo-site-name')).toHaveTextContent('こもれび工房（完全架空サイト）')
    expect(screen.getByText('完全架空データ')).toBeInTheDocument()
    expect(screen.queryByText('demo_portfolio_dataset')).not.toBeInTheDocument()
    expect(screen.queryByText('サイト計測データ')).not.toBeInTheDocument()
  })

  it('keeps the normal source label unchanged', () => {
    renderPage()

    expect(screen.getByText('サイト計測データ接続済み')).toBeInTheDocument()
    expect(screen.getByText('サイト計測データ')).toBeInTheDocument()
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
    expect(screen.getByText('サイト計測データ')).toBeInTheDocument()
  })
})
