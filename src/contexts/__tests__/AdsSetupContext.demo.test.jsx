import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdsSetupProvider, useAdsSetup } from '../AdsSetupContext'

const mocks = vi.hoisted(() => ({
  user: null,
  loginCase: vi.fn(),
  syncTokenFromApi: vi.fn(),
}))

vi.mock('../AuthContext', () => ({
  useAuth: () => ({
    user: mocks.user,
    onAdsLogout: () => () => {},
    syncTokenFromApi: mocks.syncTokenFromApi,
  }),
}))

vi.mock('../../api/adsInsights', () => ({
  DEFAULT_ADS_DATASET_ID: 'analytics_default',
  getCaseTrustToken: vi.fn(() => null),
  setCaseTrustToken: vi.fn(),
  loginCase: (...args) => mocks.loginCase(...args),
}))

function SetupProbe() {
  const { currentCase, authenticateCase } = useAdsSetup()
  return (
    <div>
      <output aria-label="current-case">{currentCase ? JSON.stringify(currentCase) : ''}</output>
      <button onClick={() => authenticateCase('demo', 'test-password')}>デモ案件を認証</button>
    </div>
  )
}

describe('AdsSetupContext demo metadata', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    mocks.user = null
    mocks.loginCase.mockReset()
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
})
