import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdsSetupProvider, useAdsSetup } from '../AdsSetupContext'

const mocks = vi.hoisted(() => ({
  authMode: 'legacy',
  isAdsAuthenticated: false,
  user: null,
  getCases: vi.fn(),
  loginCase: vi.fn(),
  listProjects: vi.fn(),
  syncTokenFromApi: vi.fn(),
}))

vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    authMode: mocks.authMode,
    isAdsAuthenticated: mocks.isAdsAuthenticated,
    user: mocks.user,
    onAdsLogout: () => () => {},
    syncTokenFromApi: mocks.syncTokenFromApi,
  }),
}))

vi.mock('../../api/platform', () => ({
  platformApi: {
    listProjects: (...args) => mocks.listProjects(...args),
  },
}))

vi.mock('../../api/adsInsights', () => ({
  DEFAULT_ADS_DATASET_ID: 'analytics_default',
  getCases: (...args) => mocks.getCases(...args),
  getCaseTrustToken: vi.fn(() => null),
  setCaseTrustToken: vi.fn(),
  loginCase: (...args) => mocks.loginCase(...args),
}))

function SetupProbe() {
  const { currentCase, isCaseAuthenticated, authenticateCase, getCurrentDatasetId } = useAdsSetup()
  return (
    <div>
      <output aria-label="current-case">{currentCase ? JSON.stringify(currentCase) : ''}</output>
      <output aria-label="case-authenticated">{String(isCaseAuthenticated)}</output>
      <output aria-label="current-dataset">{String(getCurrentDatasetId())}</output>
      <button onClick={() => authenticateCase('demo', 'test-password')}>デモ案件を認証</button>
    </div>
  )
}

describe('AdsSetupContext demo metadata', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    mocks.authMode = 'legacy'
    mocks.isAdsAuthenticated = false
    mocks.user = null
    mocks.getCases.mockReset()
    mocks.loginCase.mockReset()
    mocks.listProjects.mockReset()
    mocks.syncTokenFromApi.mockReset()
  })

  it('syncs is_demo from an authenticated case user into currentCase storage', async () => {
    mocks.isAdsAuthenticated = true
    mocks.user = {
      role: 'case_user',
      case_id: 'demo',
      display_name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }

    render(<AdsSetupProvider><SetupProbe /></AdsSetupProvider>)

    await waitFor(() => expect(screen.getByLabelText('current-case')).toHaveTextContent('"is_demo":true'))
    expect(JSON.parse(localStorage.getItem('insight-studio-current-case'))).toEqual(expect.objectContaining({
      case_id: 'demo',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }))
    expect(mocks.getCases).not.toHaveBeenCalled()
  })

  it('reconciles a stale saved demo to the active Petabit case after admin login', async () => {
    localStorage.setItem('insight-studio-current-case', JSON.stringify({
      case_id: 'demo',
      name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    }))
    localStorage.setItem('insight-studio-case-authenticated', 'true')
    mocks.isAdsAuthenticated = true
    mocks.user = { role: 'admin', display_name: 'オペレーター' }
    mocks.getCases.mockResolvedValue({
      cases: [
        { case_id: 'petabit', name: 'ペタサイト', dataset_id: 'analytics_live', status: 'active' },
        { case_id: 'other', name: '別サイト', dataset_id: 'analytics_other', status: 'active' },
      ],
    })

    render(<AdsSetupProvider><SetupProbe /></AdsSetupProvider>)

    await waitFor(() => expect(screen.getByLabelText('current-case')).toHaveTextContent('petabit'))
    expect(screen.getByLabelText('current-case')).not.toHaveTextContent('demo_portfolio_dataset')
    expect(screen.getByLabelText('case-authenticated')).toHaveTextContent('true')
    expect(JSON.parse(localStorage.getItem('insight-studio-current-case'))).toEqual(expect.objectContaining({
      case_id: 'petabit',
      dataset_id: 'analytics_live',
    }))
  })

  it('keeps a valid saved admin case but refreshes its metadata from the server', async () => {
    localStorage.setItem('insight-studio-current-case', JSON.stringify({
      case_id: 'other',
      name: '古い名前',
      dataset_id: 'analytics_old',
    }))
    mocks.isAdsAuthenticated = true
    mocks.user = { role: 'admin' }
    mocks.getCases.mockResolvedValue({
      cases: [
        { case_id: 'petabit', name: 'ペタサイト', dataset_id: 'analytics_live', status: 'active' },
        { case_id: 'other', name: '更新後サイト', dataset_id: 'analytics_current', status: 'active' },
      ],
    })

    render(<AdsSetupProvider><SetupProbe /></AdsSetupProvider>)

    await waitFor(() => expect(screen.getByLabelText('current-case')).toHaveTextContent('更新後サイト'))
    expect(screen.getByLabelText('current-case')).toHaveTextContent('analytics_current')
    expect(screen.getByLabelText('current-case')).not.toHaveTextContent('analytics_old')
  })

  it('clears an unverified admin selection when the server has no active case', async () => {
    localStorage.setItem('insight-studio-current-case', JSON.stringify({
      case_id: 'removed-case',
      name: '削除済みサイト',
      dataset_id: 'analytics_removed',
    }))
    localStorage.setItem('insight-studio-case-authenticated', 'true')
    mocks.isAdsAuthenticated = true
    mocks.user = { role: 'admin' }
    mocks.getCases.mockResolvedValue({ cases: [] })

    render(<AdsSetupProvider><SetupProbe /></AdsSetupProvider>)

    await waitFor(() => expect(localStorage.getItem('insight-studio-current-case')).toBeNull())
    expect(screen.getByLabelText('current-case')).toBeEmptyDOMElement()
    expect(screen.getByLabelText('case-authenticated')).toHaveTextContent('false')
    expect(localStorage.getItem('insight-studio-current-case')).toBeNull()
    expect(localStorage.getItem('insight-studio-case-authenticated')).toBeNull()
  })

  it('keeps is_demo returned by case authentication', async () => {
    const user = userEvent.setup()
    mocks.loginCase.mockResolvedValue({
      ok: true,
      case_id: 'demo',
      name: 'Insight Studio デモ',
      dataset_id: 'demo_portfolio_dataset',
      is_demo: true,
    })

    render(<AdsSetupProvider><SetupProbe /></AdsSetupProvider>)
    await user.click(screen.getByRole('button', { name: 'デモ案件を認証' }))

    await waitFor(() => expect(screen.getByLabelText('current-case')).toHaveTextContent('"is_demo":true'))
    expect(mocks.syncTokenFromApi).toHaveBeenCalledTimes(1)
  })

  it('selects only a tenant project in Clerk mode without persisting its dataset', async () => {
    mocks.authMode = 'clerk'
    mocks.user = {
      user_id: 'user-a',
      role: 'member',
      workspace_role: null,
      project_roles: { 'project-a': 'project_editor' },
    }
    mocks.listProjects.mockResolvedValue({
      projects: [
        { id: 'project-a', name: '顧客サイト', status: 'active', is_demo: false },
        { id: 'project-archived', name: '旧サイト', status: 'archived' },
      ],
    })

    render(<AdsSetupProvider><SetupProbe /></AdsSetupProvider>)

    await waitFor(() => expect(screen.getByLabelText('current-case')).toHaveTextContent('project-a'))
    expect(screen.getByLabelText('current-case')).not.toHaveTextContent('dataset')
    expect(screen.getByLabelText('current-dataset')).toHaveTextContent('undefined')
    expect(screen.getByLabelText('case-authenticated')).toHaveTextContent('true')
    expect(localStorage.getItem('insight-studio-current-case')).not.toMatch(/analytics_|dataset/i)
  })
})
