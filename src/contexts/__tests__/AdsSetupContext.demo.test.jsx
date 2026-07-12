import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdsSetupProvider, useAdsSetup } from '../AdsSetupContext'

const mocks = vi.hoisted(() => ({
  authMode: 'legacy',
  user: null,
  loginCase: vi.fn(),
  listProjects: vi.fn(),
  syncTokenFromApi: vi.fn(),
}))

vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    authMode: mocks.authMode,
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
    mocks.user = null
    mocks.loginCase.mockReset()
    mocks.listProjects.mockReset()
    mocks.syncTokenFromApi.mockReset()
  })

  it('syncs is_demo from an authenticated case user into currentCase storage', async () => {
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
