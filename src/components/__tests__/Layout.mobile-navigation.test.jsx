import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from '../Layout'

const layoutState = vi.hoisted(() => ({
  authUser: { display_name: 'テスト担当' },
  currentCase: null,
  isCaseUser: false,
  canManageProjects: false,
  selectorCase: null,
  selectCase: vi.fn(),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasAnalysisKey: false,
    analysisProvider: 'gemini',
    isAdsAuthenticated: true,
    logoutAds: vi.fn(),
    user: layoutState.authUser,
  }),
}))

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }),
}))

vi.mock('../../contexts/AdsSetupContext', () => ({
  useAdsSetup: () => ({
    isSetupComplete: true,
    setupState: { completedAt: '2026-07-10T00:00:00.000Z' },
    resetSetup: vi.fn(),
    authenticateCase: vi.fn(),
    clearCase: vi.fn(),
    selectCase: layoutState.selectCase,
    currentCase: layoutState.currentCase,
  }),
}))

vi.mock('../../contexts/AnalysisRunsContext', () => ({
  useAnalysisRuns: () => ({ getRunningKinds: () => [] }),
}))

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ displayName: 'テスト担当', avatarInitial: 'テ' }),
}))

vi.mock('../../contexts/RbacContext', () => ({
  useRbac: () => ({ canManageProjects: layoutState.canManageProjects, isCaseUser: layoutState.isCaseUser }),
}))

vi.mock('../../api/marketLens', () => ({ warmMarketLensBackend: vi.fn() }))
vi.mock('../../api/adsInsights', () => ({ warmAdsInsightsBackend: vi.fn() }))
vi.mock('../GuideModal', () => ({ default: () => null }))
vi.mock('../CaseSelector', () => ({
  default: ({ onCaseSelect }) => (
    <button type="button" onClick={() => onCaseSelect(layoutState.selectorCase)}>ペタサイト</button>
  ),
}))
vi.mock('../CaseAuthModal', () => ({ default: () => null }))
vi.mock('../report-history/ReportHistoryDrawer', () => ({ default: () => null }))

function renderLayout(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="*" element={<div>ページ内容</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('Layout mobile analysis navigation', () => {
  beforeEach(() => {
    layoutState.authUser = { display_name: 'テスト担当' }
    layoutState.currentCase = null
    layoutState.isCaseUser = false
    layoutState.canManageProjects = false
    layoutState.selectorCase = null
    layoutState.selectCase.mockReset()
    localStorage.setItem('insight-studio-guide-seen', '1')
  })

  it('keeps five stable destinations and marks an analysis child as the current location', () => {
    renderLayout('/compare')

    const nav = screen.getByRole('navigation', { name: 'モバイル主要ナビゲーション' })
    const links = nav.querySelectorAll('a')
    expect(links).toHaveLength(5)
    for (const label of ['ホーム', 'レポート', 'グラフ', '分析', '設定']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }

    const analysisLink = within(nav).getByRole('link', { name: '分析' })
    expect(analysisLink).toHaveAttribute('href', '/analysis')
    expect(analysisLink).toHaveAttribute('aria-current', 'location')
  })

  it('uses page for the exact analysis hub and lets an active sidebar group close', async () => {
    const user = userEvent.setup()
    renderLayout('/analysis')

    const nav = screen.getByRole('navigation', { name: 'モバイル主要ナビゲーション' })
    expect(within(nav).getByRole('link', { name: '分析' })).toHaveAttribute('aria-current', 'page')
    const groupButton = screen.getByRole('button', { name: /追加分析/ })
    expect(groupButton).toHaveAttribute('aria-expanded', 'true')

    await user.click(groupButton)
    expect(groupButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: /競合LP分析/ })).not.toBeInTheDocument()
  })

  it('shows a compact demo marker and demo connection labels only for verified demo state', () => {
    layoutState.authUser = { role: 'case_user', display_name: 'Insight Studio デモ', is_demo: true }
    layoutState.currentCase = {
      case_id: 'demo',
      name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    layoutState.isCaseUser = true

    renderLayout('/ads/report')

    expect(screen.getByTestId('demo-mode-badge')).toHaveTextContent('DEMO・完全架空データ')
    expect(screen.getByText('完全架空データ')).toBeInTheDocument()
    expect(screen.getAllByText('デモデータ利用中').length).toBeGreaterThan(0)
  })

  it('does not show demo labels for a normal customer', () => {
    renderLayout('/ads/report')

    expect(screen.queryByTestId('demo-mode-badge')).not.toBeInTheDocument()
    expect(screen.getByText('Webサイトデータ')).toBeInTheDocument()
    expect(screen.queryByText('デモデータ利用中')).not.toBeInTheDocument()
  })

  it('does not trust a demo currentCase for an admin session', () => {
    layoutState.authUser = { role: 'admin', display_name: 'テスト管理者', is_demo: true }
    layoutState.currentCase = {
      case_id: 'demo',
      name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    layoutState.canManageProjects = true

    renderLayout('/ads/report')

    expect(screen.queryByTestId('demo-mode-badge')).not.toBeInTheDocument()
    expect(screen.getByText('Webサイトデータ')).toBeInTheDocument()
    expect(screen.queryByText('デモデータ利用中')).not.toBeInTheDocument()
  })

  it('preserves is_demo when an admin selects a case', async () => {
    const user = userEvent.setup()
    layoutState.canManageProjects = true
    layoutState.selectorCase = {
      case_id: 'demo',
      name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }
    renderLayout('/ads/wizard')

    await user.click(screen.getByRole('button', { name: 'ペタサイト' }))

    expect(layoutState.selectCase).toHaveBeenCalledWith(expect.objectContaining({
      case_id: 'demo',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }))
  })
})
