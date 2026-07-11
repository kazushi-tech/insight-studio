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
    })

    await user.click(screen.getByRole('button', { name: /^次へ/ }))

    expect(await screen.findByRole('heading', { name: '最初のレポートができました' })).toBeInTheDocument()
    expect(mocks.generateBatchWithRetry).toHaveBeenCalledWith({
      query_types: ['pv', 'traffic', 'cv', 'landing'],
      dataset_id: 'analytics_311324674',
      period: '2026-07',
    })
    expect(mocks.completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({ periods: ['2026-07'], datasetId: 'analytics_311324674' }),
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

    expect(await screen.findByText(/一時的な取得エラー/)).toHaveTextContent('1/2 期間は生成済み')
    await user.click(screen.getByRole('button', { name: /^次へ/ }))

    await screen.findByRole('heading', { name: '最初のレポートができました' })
    expect(mocks.generateBatchWithRetry).toHaveBeenCalledTimes(3)
    await waitFor(() => {
      const finalCall = mocks.buildAdsReportBundle.mock.calls.at(-1)?.[0]
      expect(finalCall.results.map((item) => item.period)).toEqual(['2026-07', '2026-06'])
    })
  })

  it('shows beginner labels and the corresponding professional GA4 terms', async () => {
    const user = userEvent.setup()
    renderWizard()

    expect(screen.getByText('見られた回数')).toBeInTheDocument()
    expect(screen.getByText('（ページビュー数（PV）・ユーザー数・セッション数）')).toBeInTheDocument()
    expect(screen.getByText('（流入元／参照元・メディア）')).toBeInTheDocument()
    expect(screen.getByText('（キーイベント／コンバージョン（CV））')).toBeInTheDocument()
    expect(screen.getByText('（ランディングページ（LP））')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '詳しい分析項目を選ぶ' }))
    expect(screen.getByText('（時間帯別分析）')).toBeInTheDocument()
    expect(screen.getByText('（新規／リピーター・地域別分析）')).toBeInTheDocument()
    expect(screen.queryByText(/インプレッション数|クリック数|年齢・性別/)).not.toBeInTheDocument()
  })

  it('uses fictional source wording for the demo case only', async () => {
    const user = userEvent.setup()
    mocks.currentCase = {
      case_id: 'demo',
      name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    mocks.authUser = { role: 'case_user', is_demo: true }

    renderWizard()

    expect(screen.getByText('現在のデモデータ')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '詳しい分析項目を選ぶ' }))
    expect(screen.getByText('（流入チャネル構成比（架空データ推定））')).toBeInTheDocument()
    expect(screen.queryByText('（流入チャネル構成比（GA4推定））')).not.toBeInTheDocument()
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
      query_types: ['pv', 'traffic', 'cv', 'landing'],
      dataset_id: 'demo_portfolio_dataset',
      period: '2026-06',
    })
    expect(mocks.generateBatchWithRetry).toHaveBeenNthCalledWith(2, {
      query_types: ['pv', 'traffic', 'cv', 'landing'],
      dataset_id: 'demo_portfolio_dataset',
      period: '2026-05',
    })
    expect(mocks.completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({ periods: ['2026-06', '2026-05'] }),
      expect.any(Object),
    )
  })
})
