import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from '../Login'

const loginAds = vi.fn()
const loginWithCase = vi.fn()
const getCasesPublic = vi.fn()
const loginCase = vi.fn()
const getCaseTrustToken = vi.fn()
const warmAdsInsightsBackend = vi.fn()

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    loginAds,
    loginWithCase,
    user: null,
  }),
}))

vi.mock('../../api/adsInsights', () => ({
  getCasesPublic: (...args) => getCasesPublic(...args),
  loginCase: (...args) => loginCase(...args),
  getCaseTrustToken: (...args) => getCaseTrustToken(...args),
  warmAdsInsightsBackend: (...args) => warmAdsInsightsBackend(...args),
}))

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

describe('Login', () => {
  beforeEach(() => {
    localStorage.clear()
    loginAds.mockReset()
    loginWithCase.mockReset()
    getCasesPublic.mockReset()
    loginCase.mockReset()
    getCaseTrustToken.mockReset()
    warmAdsInsightsBackend.mockReset()
    getCasesPublic.mockResolvedValue({
      cases: [
        { case_id: 'petabit', name: 'ペタビット' },
        { case_id: 'demo', name: 'Demo' },
      ],
    })
    getCaseTrustToken.mockReturnValue(null)
    warmAdsInsightsBackend.mockResolvedValue(false)
  })

  it('logs into only the selected case without trying admin first', async () => {
    const user = userEvent.setup()
    loginCase.mockResolvedValue({
      ok: true,
      case_id: 'demo',
      name: 'Demo',
      dataset_id: 'analytics_demo',
      token: 'case-token',
    })

    renderLogin()

    await user.selectOptions(await screen.findByRole('combobox'), 'demo')
    await user.type(screen.getByLabelText('パスワード'), 'case-password')
    await user.click(screen.getByRole('button', { name: /ログイン|ログイン中/ }))

    await waitFor(() => {
      expect(loginCase).toHaveBeenCalledWith('demo', 'case-password', { deviceTrustToken: null })
    })
    expect(loginAds).not.toHaveBeenCalled()
    expect(loginCase).toHaveBeenCalledTimes(1)
    expect(loginWithCase).toHaveBeenCalledWith(expect.objectContaining({ case_id: 'demo' }))
  })

  it('uses admin login only when admin mode is selected', async () => {
    const user = userEvent.setup()
    loginAds.mockResolvedValue({ token: 'admin-token' })

    renderLogin()

    await user.click(screen.getByRole('button', { name: '管理者' }))
    await user.type(screen.getByLabelText('パスワード'), 'admin-password')
    await user.click(screen.getByRole('button', { name: /ログイン|ログイン中/ }))

    await waitFor(() => {
      expect(loginAds).toHaveBeenCalledWith('admin-password')
    })
    expect(loginCase).not.toHaveBeenCalled()
  })
})
