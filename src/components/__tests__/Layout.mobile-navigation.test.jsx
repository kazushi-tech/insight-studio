import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Layout from '../Layout'

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasAnalysisKey: false,
    analysisProvider: 'gemini',
    isAdsAuthenticated: true,
    logoutAds: vi.fn(),
    user: { display_name: 'テスト担当' },
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
    selectCase: vi.fn(),
  }),
}))

vi.mock('../../contexts/AnalysisRunsContext', () => ({
  useAnalysisRuns: () => ({ getRunningKinds: () => [] }),
}))

vi.mock('../../contexts/UserProfileContext', () => ({
  useUserProfile: () => ({ displayName: 'テスト担当', avatarInitial: 'テ' }),
}))

vi.mock('../../contexts/RbacContext', () => ({
  useRbac: () => ({ canManageProjects: false, isCaseUser: false }),
}))

vi.mock('../../api/marketLens', () => ({ warmMarketLensBackend: vi.fn() }))
vi.mock('../../api/adsInsights', () => ({ warmAdsInsightsBackend: vi.fn() }))
vi.mock('../GuideModal', () => ({ default: () => null }))
vi.mock('../CaseSelector', () => ({ default: () => <div>ペタサイト</div> }))
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
})
