import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SetupWizard from '../SetupWizard'

const mocks = vi.hoisted(() => ({
  bqPeriods: vi.fn(),
  generateBatchWithRetry: vi.fn(),
  buildAdsReportBundle: vi.fn(),
  completeSetup: vi.fn(),
  getCurrentDatasetId: vi.fn(() => 'analytics_311324674'),
  currentCase: {
    case_id: 'petabit',
    name: 'ペタサイト',
    dataset_id: 'analytics_311324674',
    is_demo: false,
  },
  authUser: { role: 'case_user', is_demo: false },
}))

vi.mock('../../api/adsInsights', () => ({
  bqPeriods: (...args) => mocks.bqPeriods(...args),
}))

vi.mock('../../utils/adsReports', () => ({
  generateBatchWithRetry: (...args) => mocks.generateBatchWithRetry(...args),
  buildAdsReportBundle: (...args) => mocks.buildAdsReportBundle(...args),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAdsAuthenticated: true,
    authExpiredMessage: null,
    clearAuthExpiredMessage: vi.fn(),
    user: mocks.authUser,
  }),
}))

vi.mock('../../contexts/AdsSetupContext', () => ({
  useAdsSetup: () => ({
    completeSetup: mocks.completeSetup,
    getCurrentDatasetId: mocks.getCurrentDatasetId,
    currentCase: mocks.currentCase,
  }),
}))

const JULY_RESULT = {
  ok: true,
  data_availability: 'partial',
  report_md: '# 2026-07',
  chart_data: { groups: [{ chart_id: 'july', title: '7月' }] },
  execution_summary: [{ query_type: 'cv', status: 'no_data' }],
}

const ALL_QUERY_TYPES = [
  'pv',
  'traffic',
  'campaign',
  'cv',
  'search',
  'anomaly',
  'landing',
  'device',
  'hourly',
  'user_attr',
  'engagement',
  'auction_proxy',
]

const ALL_QUERY_LABELS = [
  '見られた回数',
  'どこから来たか',
  'キャンペーン別の来訪',
  '問い合わせ・予約・購入',
  'サイト内で検索された言葉',
  '急に変わった日',
  '入口になったページ',
  'スマホ・パソコン',
  '見られた時間帯',
  '初めて・再訪した人と地域',
  'ちゃんと読まれたか',
  '流入集中の参考値',
]

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/ads/wizard']}>
      <SetupWizard />
    </MemoryRouter>,
  )
}

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.currentCase = {
      case_id: 'petabit',
      name: 'ペタサイト',
      dataset_id: 'analytics_311324674',
      is_demo: false,
    }
    mocks.authUser = { role: 'case_user', is_demo: false }
    mocks.getCurrentDatasetId.mockReturnValue('analytics_311324674')
    mocks.bqPeriods.mockResolvedValue({
      ok: true,
      dataset_id: 'analytics_311324674',
      granularity: 'monthly',
      table_count: 168,
      periods: [
        { period_tag: '2026-07', period_type: 'monthly' },
        { period_tag: '2026-06', period_type: 'monthly' },
      ],
    })
    mocks.generateBatchWithRetry.mockResolvedValue(JULY_RESULT)
    mocks.buildAdsReportBundle.mockReturnValue({
      reportMd: '# まとめ',
      chartGroups: [{ chart_id: 'july', title: '7月' }],
    })
  })

  it('selects the newest period and completes the recommended report flow', async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByRole('button', { name: /^次へ/ }))

    expect(await screen.findByRole('heading', { name: 'いつの結果を見ますか？' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2026-07/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /2026-06/ })).toHaveAttribute('aria-pressed', 'false')
    expect(mocks.bqPeriods).toHaveBeenCalledWith({
      granularity: 'monthly',
      dataset_id: 'analytics_311324674',
      project_ref: 'petabit',
    })

    await user.click(screen.getByRole('button', { name: /^次へ/ }))

    expect(await screen.findByRole('heading', { name: '最初のレポートができました' })).toBeInTheDocument()
    expect(mocks.generateBatchWithRetry).toHaveBeenCalledWith({
      query_types: ALL_QUERY_TYPES,
      dataset_id: 'analytics_311324674',
      project_ref: 'petabit',
      period: '2026-07',
      granularity: 'monthly',
    })
    expect(mocks.completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({ queryTypes: ALL_QUERY_TYPES, periods: ['2026-07'], datasetId: 'analytics_311324674' }),
      expect.objectContaining({ reportMd: '# まとめ' }),
    )
  })

  it('keeps successful period results when a later period succeeds on retry', async () => {
    const user = userEvent.setup()
    let juneAttempts = 0
    mocks.generateBatchWithRetry.mockImplementation(async ({ period }) => {
      if (period === '2026-07') return JULY_RESULT
      juneAttempts += 1
      if (juneAttempts === 1) throw new Error('一時的な取得エラー')
      return {
        ...JULY_RESULT,
        report_md: '# 2026-06',
        chart_data: { groups: [{ chart_id: 'june', title: '6月' }] },
      }
    })

    renderWizard()
    await user.click(screen.getByRole('button', { name: /^次へ/ }))
    await screen.findByRole('heading', { name: 'いつの結果を見ますか？' })
    await user.click(screen.getByRole('button', { name: 'すべて比べる' }))
    await user.click(screen.getByRole('button', { name: /^次へ/ }))

    const safeError = await screen.findByText(/1\/2 期間は準備済み/)
    expect(safeError).toHaveTextContent('管理者にお問い合わせください')
    expect(screen.queryByText(/一時的な取得エラー/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^次へ/ }))

    await screen.findByRole('heading', { name: '最初のレポートができました' })
    expect(mocks.generateBatchWithRetry).toHaveBeenCalledTimes(3)
    await waitFor(() => {
      const finalCall = mocks.buildAdsReportBundle.mock.calls.at(-1)?.[0]
      expect(finalCall.results.map((item) => item.period)).toEqual(['2026-07', '2026-06'])
    })
  })

  it('shows all query cards without a disclosure and selects every query by default', () => {
    renderWizard()

    expect(screen.getByRole('heading', { name: '表示するグラフを選んでください' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('12 / 12 項目を選択中')
    expect(screen.queryByRole('button', { name: /細かく調整|詳しい項目/ })).not.toBeInTheDocument()
    ALL_QUERY_LABELS.forEach((label) => {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toHaveAttribute('aria-pressed', 'true')
    })
    expect(screen.queryByText(/ページビュー数（PV）|BigQuery|データセット|保存先ID/)).not.toBeInTheDocument()
  })

  it('restores all queries after an individual query is deselected', async () => {
    const user = userEvent.setup()
    renderWizard()

    const pageViews = screen.getByRole('button', { name: /見られた回数/ })
    await user.click(pageViews)

    expect(pageViews).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('status')).toHaveTextContent('11 / 12 項目を選択中')

    await user.click(screen.getByRole('button', { name: 'すべて選ぶ' }))

    expect(pageViews).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('12 / 12 項目を選択中')
  })

  it('clears stale errors and returns to the first step when the selected case changes', async () => {
    const user = userEvent.setup()
    mocks.currentCase = {
      case_id: 'demo',
      name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    mocks.getCurrentDatasetId.mockReturnValue('demo_portfolio_dataset')
    mocks.bqPeriods.mockRejectedValueOnce(Object.assign(new Error('案件が見つかりません'), { status: 404 }))
    const view = renderWizard()

    await user.click(screen.getByRole('button', { name: /^次へ/ }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    mocks.currentCase = {
      case_id: 'petabit',
      name: 'ペタサイト',
      dataset_id: 'analytics_311324674',
      is_demo: false,
    }
    mocks.getCurrentDatasetId.mockReturnValue('analytics_311324674')
    view.rerender(
      <MemoryRouter initialEntries={['/ads/wizard']}>
        <SetupWizard />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: '表示するグラフを選んでください' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('12 / 12 項目を選択中')
    expect(screen.getByRole('button', { name: /^次へ/ })).toBeEnabled()
  })

  it('shows professional analysis terms only to platform admins', () => {
    mocks.authUser = { role: 'admin', platform_role: 'platform_admin' }
    renderWizard()
    expect(screen.getByText('（ページビュー数（PV）・ユーザー数・セッション数）')).toBeInTheDocument()
    expect(screen.getByText('（時間帯別分析）')).toBeInTheDocument()
  })

  it('uses fictional source wording for the demo case only', () => {
    mocks.currentCase = {
      case_id: 'demo',
      name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    mocks.authUser = { role: 'case_user', is_demo: true }

    renderWizard()

    expect(screen.getByText('現在のデモデータ')).toBeInTheDocument()
    expect(screen.getByText('流入集中の参考値')).toBeInTheDocument()
    expect(screen.queryByText(/GA4|BigQuery|流入チャネル構成比/)).not.toBeInTheDocument()
  })

  it('locks the demo target and comparison months and generates both after attempted deselection', async () => {
    const user = userEvent.setup()
    mocks.currentCase = {
      case_id: 'demo',
      name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    mocks.authUser = { role: 'case_user', is_demo: true }
    mocks.getCurrentDatasetId.mockReturnValue('demo_portfolio_dataset')
    mocks.bqPeriods.mockResolvedValue({
      ok: true,
      dataset_id: 'demo_portfolio_dataset',
      granularity: 'monthly',
      periods: [
        { period_tag: '2026-06', period_type: 'monthly' },
        { period_tag: '2026-05', period_type: 'monthly' },
      ],
    })

    renderWizard()
    await user.click(screen.getByRole('button', { name: /^次へ/ }))

    const june = await screen.findByRole('button', { name: /2026-06/ })
    const may = screen.getByRole('button', { name: /2026-05/ })
    const latestOnly = screen.getByRole('button', { name: '最新だけ見る' })
    expect(screen.getByTestId('demo-period-lock')).toHaveTextContent('対象月と比較月をセットで使います')
    expect(june).toBeDisabled()
    expect(may).toBeDisabled()
    expect(latestOnly).toBeDisabled()
    expect(june).toHaveAttribute('aria-pressed', 'true')
    expect(may).toHaveAttribute('aria-pressed', 'true')

    await user.click(june)
    await user.click(latestOnly)
    expect(june).toHaveAttribute('aria-pressed', 'true')
    expect(may).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: /^次へ/ }))
    expect(await screen.findByRole('heading', { name: '最初のレポートができました' })).toBeInTheDocument()
    expect(mocks.generateBatchWithRetry).toHaveBeenNthCalledWith(1, {
      query_types: ALL_QUERY_TYPES,
      dataset_id: 'demo_portfolio_dataset',
      project_ref: 'demo',
      period: '2026-06',
      granularity: 'monthly',
    })
    expect(mocks.generateBatchWithRetry).toHaveBeenNthCalledWith(2, {
      query_types: ALL_QUERY_TYPES,
      dataset_id: 'demo_portfolio_dataset',
      project_ref: 'demo',
      period: '2026-05',
      granularity: 'monthly',
    })
    expect(mocks.completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({ queryTypes: ALL_QUERY_TYPES, periods: ['2026-06', '2026-05'], granularity: 'monthly' }),
      expect.any(Object),
    )
  })
})
