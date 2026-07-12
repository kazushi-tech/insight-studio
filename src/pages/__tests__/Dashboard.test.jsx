import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '../Dashboard'

const state = vi.hoisted(() => ({
  setupState: {
    datasetId: 'analytics_311324674',
    periods: ['2026-07'],
    queryTypes: ['pv', 'traffic', 'cv', 'landing'],
    granularity: 'monthly',
    completedAt: '2026-07-10T04:00:00.000Z',
  },
  reportBundle: null,
  hasAnalysisKey: false,
  role: 'admin',
  getScans: vi.fn(),
}))

vi.mock('../../api/marketLens', () => ({
  getScans: (...args) => state.getScans(...args),
}))

vi.mock('../../contexts/AdsSetupContext', () => ({
  useAdsSetup: () => ({
    setupState: state.setupState,
    reportBundle: state.reportBundle,
    currentCase: { name: 'ペタサイト' },
  }),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAdsAuthenticated: true,
    hasAnalysisKey: state.hasAnalysisKey,
    analysisProvider: 'gemini',
    user: { role: state.role },
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Dashboard />
    </MemoryRouter>,
  )
}

describe('Dashboard', () => {
  beforeEach(() => {
    state.reportBundle = null
    state.hasAnalysisKey = false
    state.role = 'admin'
    state.getScans.mockReturnValue(new Promise(() => {}))
  })

  it('shows a useful home dashboard and every additional analysis entry without fake activity', async () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '前回の条件から、すぐ再表示できます' })).toBeInTheDocument()
    expect(document.querySelector('img[src="/imagegen/beginner-analytics-collaboration.webp"]')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /前回のレポートを再表示/ })).toHaveAttribute('href', '/ads/report')
    expect(screen.getByRole('link', { name: '分析メニューを開く' })).toHaveAttribute('href', '/analysis')

    expect(screen.getByRole('heading', { name: 'もっと詳しく調べる' })).toBeInTheDocument()
    expect(screen.getByText('自社と競合LPを比べる')).toBeInTheDocument()
    expect(screen.getByText('競合になりそうなサイトを探す')).toBeInTheDocument()
    expect(screen.getByText('広告画像の改善点を見つける')).toBeInTheDocument()
    expect(screen.getAllByText('追加分析の設定が必要')).toHaveLength(3)
    expect(screen.queryByText('トレンドキーワード')).not.toBeInTheDocument()
    expect(screen.queryByText('最近のアクティビティ')).not.toBeInTheDocument()
    expect(screen.queryByText(/専門用語/)).not.toBeInTheDocument()

  })

  it('does not expose operator-only advanced tools to case users', () => {
    state.role = 'case_user'
    renderPage()

    expect(screen.queryByRole('heading', { name: 'もっと詳しく調べる' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '分析メニューを開く' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /自社と競合LPを比べる|競合になりそうなサイトを探す|広告画像の改善点を見つける/ })).not.toBeInTheDocument()
  })

  it('promotes real report summaries and the next action when a report exists', () => {
    state.reportBundle = {
      generatedAt: '2026-07-10T04:00:00.000Z',
      chartGroups: [],
      beginnerReport: {
        summary_cards: [
          { type: 'what_happened', title: 'サイト閲覧が増えています', body: '前の期間より閲覧が増えました。' },
          { type: 'so_what', title: '検索からの来訪を確認します', body: '増加した入口を確認します。' },
        ],
        next_actions: [{ priority: 'P1', title: '入口ページを確認する', reason: '伸びた理由を特定するためです。' }],
        data_gaps: [{ key: 'cv', label: '問い合わせ数は判断保留', impact: '計測設定を確認します。' }],
      },
    }

    renderPage()

    expect(screen.getByRole('heading', { name: 'いまのサイトを、すぐ確認できます' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'いまのサイト' })).toBeInTheDocument()
    expect(screen.getByText('サイト閲覧が増えています')).toBeInTheDocument()
    expect(screen.getByText('入口ページを確認する')).toBeInTheDocument()
    expect(screen.getByText('問い合わせ数は判断保留')).toBeInTheDocument()
  })

  it('renders dependency-free decorative line and bar mini charts beside their numeric summaries', () => {
    state.reportBundle = {
      generatedAt: '2026-07-10T04:00:00.000Z',
      chartGroups: [
        {
          title: '訪問の推移',
          chartType: 'line',
          labels: ['1日', '2日', '3日'],
          datasets: [{ label: '訪問', data: [10, 30, 20] }],
          _periodTag: '2026-07',
        },
        {
          title: '来訪元の比較',
          chartType: 'bar_horizontal',
          labels: ['検索', '直接'],
          datasets: [{ label: '訪問', data: [25, 10] }],
          _periodTag: '2026-07',
        },
      ],
      beginnerReport: {
        summary_cards: [{ type: 'what_happened', title: '訪問を確認しました', body: '推移を表示します。' }],
        next_actions: [],
        data_gaps: [],
      },
    }

    const { container } = renderPage()

    expect(screen.getByRole('heading', { name: 'Webサイトデータの概要' })).toBeInTheDocument()
    expect(container.querySelectorAll('svg[aria-hidden="true"] polyline')).toHaveLength(1)
    expect(container.querySelectorAll('svg[aria-hidden="true"] rect').length).toBeGreaterThan(0)
    expect(container.querySelector('canvas')).not.toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
  })
})
