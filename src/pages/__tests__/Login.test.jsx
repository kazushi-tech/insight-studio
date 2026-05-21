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

  it('keeps the login screen simple and tries the saved case first', async () => {
    const user = userEvent.setup()
    localStorage.setItem('insight-studio-current-case', JSON.stringify({ case_id: 'demo' }))
    loginCase.mockResolvedValue({
      ok: true,
      case_id: 'demo',
      name: 'Demo',
      dataset_id: 'analytics_demo',
      token: 'case-token',
    })

    renderLogin()

    expect(screen.queryByText('ログイン種別')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('パスワード'), 'case-password')
    await user.click(screen.getByRole('button', { name: /ログイン|ログイン中/ }))

    await waitFor(() => {
      expect(loginCase).toHaveBeenCalledWith('demo', 'case-password', { deviceTrustToken: null })
    })
    expect(loginAds).not.toHaveBeenCalled()
    expect(loginCase).toHaveBeenCalledTimes(1)
    expect(loginWithCase).toHaveBeenCalledWith(expect.objectContaining({ case_id: 'demo' }))
  })

  it('falls back to admin login when no case password matches', async () => {
    const user = userEvent.setup()
    loginCase.mockRejectedValue({ status: 401 })
    loginAds.mockResolvedValue({ token: 'admin-token' })

    renderLogin()

    await user.type(screen.getByLabelText('パスワード'), 'admin-password')
    await user.click(screen.getByRole('button', { name: /ログイン|ログイン中/ }))

    await waitFor(() => {
      expect(loginAds).toHaveBeenCalledWith('admin-password')
    })
    expect(loginCase).toHaveBeenCalledTimes(2)
  })
})
